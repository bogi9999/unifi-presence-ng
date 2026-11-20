#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Unifi-PresenceNG - LoxBerry Plugin
==================================

Anwesenheitserkennung über den UniFi Network Controller, Ausgabe per MQTT.

* Keine externen Abhängigkeiten: nur Python 3 Standardbibliothek
  (kein Node.js, kein npm, kein Express-Server).
* Läuft auf LoxBerry 3 (Debian 12 "Bookworm") und LoxBerry 4 (Debian 13 "Trixie").
* Erkennt automatisch:
    - UniFi OS Konsolen (UDM, UDM-Pro/SE, UDR, UCG, UX, CloudKey Gen2+) Port 443
    - UniFi OS Server (selbst gehostet, Network 9.x/10.x)              Port 11443
    - klassischen Network Controller (Software)                         Port 8443
* Versionsprüfung numerisch (10.x > 9.x > 6.4.54) statt String-Vergleich.

Aufruf:
    unifi_presenceng.py daemon                 Hintergrunddienst
    unifi_presenceng.py cli <befehl> [...]     Hilfsbefehle für die Weboberfläche
        detect [--host H] [--port P]
        login  [--token CODE]
        clients | sites | stats | mqtttest
"""

import argparse
import base64
import fcntl
import hashlib
import http.client
import json
import logging
import logging.handlers
import os
import re
import select
import signal
import socket
import ssl
import struct
import sys
import threading
import time

PLUGIN = "unifi_presenceng"
OLD_PLUGIN = "unifi_presence"
VERSION = "4.3.1"
MIN_CONTROLLER_VERSION = (6, 4, 54)


# --------------------------------------------------------------------------
# Pfade
# --------------------------------------------------------------------------
def _paths():
    dev = os.environ.get("UPNG_DEVDIR")
    if dev:  # Entwicklungs-/Testmodus
        return {
            "home": dev,
            "config": os.path.join(dev, "config"),
            "data": os.path.join(dev, "data"),
            "log": os.path.join(dev, "log"),
            "general": os.path.join(dev, "general.json"),
        }
    # $LBHOMEDIR/bin/plugins/<plugin>/unifi_presenceng.py -> $LBHOMEDIR
    home = os.environ.get("LBHOMEDIR") or os.path.abspath(
        os.path.join(os.path.dirname(os.path.realpath(__file__)), "..", "..", ".."))
    return {
        "home": home,
        "config": "%s/config/plugins/%s" % (home, PLUGIN),
        "data": "%s/data/plugins/%s" % (home, PLUGIN),
        "log": "%s/log/plugins/%s" % (home, PLUGIN),
        "general": "%s/config/system/general.json" % home,
    }


P = _paths()
CONFIG_FILE = os.path.join(P["config"], "unifi.json")
SUBSCRIPTION_FILE = os.path.join(P["config"], "mqtt_subscriptions.cfg")
SESSION_FILE = os.path.join(P["data"], "session.json")
STATUS_FILE = os.path.join(P["data"], "status.json")
LOCK_FILE = os.path.join(P["data"], "daemon.lock")
LOG_FILE = os.path.join(P["log"], "unifi_presenceng.log")

DEFAULT_CONFIG = {
    "ipaddress": "",
    "port": None,
    "controllerType": "auto",  # auto | unifios | classic
    "username": "",
    "password": "",
    "site": "default",
    "twoFaEnabled": False,
    "topic": "UniFi/clients",
    "summaryTopic": "UniFi/presence",
    "retain": False,
    "wiredTimeout": 60,
    "pollInterval": 30,
    "loglevel": "info",
    "mqtt": {"mode": "loxberry", "host": "", "port": 1883, "user": "", "password": "", "tls": False},
    "clients": [],
}

log = logging.getLogger("upng")


# --------------------------------------------------------------------------
# Hilfsfunktionen
# --------------------------------------------------------------------------
def read_json(path, default=None):
    try:
        with open(path, "r", encoding="utf-8") as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return default


def write_json(path, data, mode=0o600):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.tmp.%d" % (path, os.getpid())
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(data, fh, indent=2, ensure_ascii=False)
    os.chmod(tmp, mode)
    os.replace(tmp, path)


def mtime(path):
    try:
        return os.stat(path).st_mtime
    except OSError:
        return 0


def to_int(value, default=None):
    try:
        if value is None or value == "":
            return default
        return int(value)
    except (TypeError, ValueError):
        return default


def load_config():
    raw = read_json(CONFIG_FILE, {}) or {}
    cfg = dict(DEFAULT_CONFIG)
    cfg.update(raw)
    # Migration aus "unifi_presence" 3.x: native=true/false
    if "controllerType" not in raw and "native" in raw:
        cfg["controllerType"] = "auto"
    cfg.pop("native", None)
    cfg["port"] = to_int(cfg.get("port"))
    cfg["wiredTimeout"] = max(5, to_int(cfg.get("wiredTimeout"), 60))
    cfg["pollInterval"] = min(600, max(10, to_int(cfg.get("pollInterval"), 30)))
    if cfg.get("controllerType") not in ("auto", "unifios", "classic"):
        cfg["controllerType"] = "auto"
    if not isinstance(cfg.get("clients"), list):
        cfg["clients"] = []
    mq = dict(DEFAULT_CONFIG["mqtt"])
    if isinstance(raw.get("mqtt"), dict):
        mq.update(raw["mqtt"])
    if mq.get("mode") not in ("loxberry", "custom"):
        mq["mode"] = "loxberry"
    cfg["mqtt"] = mq
    host, port = split_host(cfg.get("ipaddress", ""))
    cfg["ipaddress"] = host
    if port and not cfg["port"]:
        cfg["port"] = port
    return cfg


def save_config(cfg):
    write_json(CONFIG_FILE, cfg)


def split_host(value):
    """'https://192.168.1.1:11443/' -> ('192.168.1.1', 11443)"""
    v = (value or "").strip()
    v = re.sub(r"^[a-z]+://", "", v, flags=re.I)
    v = v.split("/")[0]
    m = re.match(r"^\[?([^\]]+?)\]?:(\d+)$", v)
    if m and v.count(":") == 1:
        return m.group(1), int(m.group(2))
    return v, None


def version_tuple(value):
    nums = re.findall(r"\d+", str(value or ""))
    return tuple(int(n) for n in nums[:4]) if nums else (0,)


SIGNAL_TABLE = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100,
                100, 100, 100, 100, 99, 99, 99, 98, 98, 98, 97, 97, 96, 96, 95, 95, 94, 93, 93, 92,
                91, 90, 90, 89, 88, 87, 86, 85, 84, 83, 82, 81, 80, 79, 78, 76, 75, 74, 73, 71, 70,
                69, 67, 66, 64, 63, 61, 60, 58, 56, 55, 53, 51, 50, 48, 46, 44, 42, 40, 38, 36, 34,
                32, 30, 28, 26, 24, 22, 20, 17, 15, 13, 10, 8, 6, 3, 1, 1, 1, 1, 1, 1, 1, 1]


def signal_percentage(dbm):
    dbm = to_int(dbm)
    if dbm is None or dbm >= 0:
        return 0
    idx = min(100, -dbm) - 1
    return SIGNAL_TABLE[idx]


def group_key(name):
    """Gruppenname als MQTT-/Loxone-tauglicher Schlüssel (Umlaute umschreiben)."""
    n = str(name or "")
    for a, b in (("ä", "ae"), ("ö", "oe"), ("ü", "ue"), ("Ä", "Ae"), ("Ö", "Oe"), ("Ü", "Ue"), ("ß", "ss")):
        n = n.replace(a, b)
    return mqtt_name(n)


def mqtt_name(name):
    n = re.sub(r"[^a-z0-9]+", "-", name or "", flags=re.I)
    return re.sub(r"-+$", "", n) or "unbekannt"


# --------------------------------------------------------------------------
# Fehler
# --------------------------------------------------------------------------
class UniFiError(Exception):
    code = "ERROR"


class Unauthorized(UniFiError):
    code = "UNAUTHORIZED"


class LoginFailed(Unauthorized):
    code = "UNAUTHORIZED"


class TwoFactorRequired(UniFiError):
    code = "TWO_FA_REQUIRED"


class RateLimited(UniFiError):
    code = "RATE_LIMITED"


class ConnectionFailed(UniFiError):
    code = "UNREACHABLE"


class VersionTooOld(UniFiError):
    code = "VERSION_ERROR"


class NotFound(UniFiError):
    code = "NOT_FOUND"


# --------------------------------------------------------------------------
# HTTPS
# --------------------------------------------------------------------------
def _ssl_context():
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # UniFi nutzt selbstsignierte Zertifikate
    try:
        ctx.set_ciphers("DEFAULT:@SECLEVEL=1")  # ältere CloudKeys
    except ssl.SSLError:
        pass
    return ctx


SSL_CTX = _ssl_context()
USER_AGENT = "Unifi-PresenceNG/%s" % VERSION


def http_request(host, port, method, path, body=None, headers=None, timeout=10):
    hdrs = {"Accept": "application/json", "User-Agent": USER_AGENT}
    hdrs.update(headers or {})
    data = None
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        hdrs["Content-Type"] = "application/json"
    conn = http.client.HTTPSConnection(host, port, timeout=timeout, context=SSL_CTX)
    try:
        conn.request(method, path, body=data, headers=hdrs)
        resp = conn.getresponse()
        raw = resp.read()
        return resp.status, resp.getheaders(), raw
    except socket.timeout:
        raise ConnectionFailed("Zeitüberschreitung bei %s:%s" % (host, port))
    except (OSError, ssl.SSLError, http.client.HTTPException) as e:
        raise ConnectionFailed("%s:%s nicht erreichbar (%s)" % (host, port, e))
    finally:
        conn.close()


# --------------------------------------------------------------------------
# Sitzung (Cookies, CSRF, erkannter Controller) – geteilt zwischen Daemon und CLI
# --------------------------------------------------------------------------
class Session:
    def __init__(self):
        self.cookies = {}
        self.csrf = None
        self.controller = None
        self.dirty = False

    @classmethod
    def load(cls):
        s = cls()
        data = read_json(SESSION_FILE, {}) or {}
        s.cookies = data.get("cookies") or {}
        s.csrf = data.get("csrf")
        s.controller = data.get("controller")
        return s

    def save(self):
        write_json(SESSION_FILE, {"cookies": self.cookies, "csrf": self.csrf, "controller": self.controller,
                                  "saved": int(time.time())})
        self.dirty = False

    def clear_auth(self):
        self.cookies = {}
        self.csrf = None
        self.dirty = True

    def cookie_header(self):
        return "; ".join("%s=%s" % (k, v) for k, v in self.cookies.items())

    def update(self, headers):
        for key, value in headers:
            k = key.lower()
            if k == "set-cookie":
                pair = value.split(";", 1)[0]
                if "=" not in pair:
                    continue
                name, val = pair.split("=", 1)
                name, val = name.strip(), val.strip().strip('"')
                expired = re.search(r"expires=Thu, 01[ -]Jan[ -]1970", value, re.I) or re.search(r"max-age=0\b", value, re.I)
                if not val or val == "deleted" or expired:
                    if name in self.cookies:
                        del self.cookies[name]
                        self.dirty = True
                elif self.cookies.get(name) != val:
                    self.cookies[name] = val
                    self.dirty = True
            elif k in ("x-csrf-token", "x-updated-csrf-token"):
                if value and value != self.csrf:
                    self.csrf = value
                    self.dirty = True


# --------------------------------------------------------------------------
# Controller-Erkennung
# --------------------------------------------------------------------------
DEFAULT_PORTS = {"unifios": 443, "classic": 8443}
PROBE_PORTS = [443, 11443, 8443]


def detect_controller(host, port=None, timeout=5):
    """Ermittelt Typ und Port des Controllers.

    UniFi OS (Konsole/Server):  GET /  -> 200, /api/auth/login existiert
    Klassischer Controller:     GET /  -> Redirect auf /manage
    """
    ports = [port] if port else PROBE_PORTS
    errors = []
    for p in ports:
        try:
            st, hd, _ = http_request(host, p, "GET", "/", timeout=timeout,
                                     headers={"Accept": "text/html,application/json"})
        except ConnectionFailed as e:
            errors.append(str(e))
            continue
        headers = {k.lower(): v for k, v in hd}
        location = headers.get("location", "")
        if st in (301, 302, 303, 307, 308) and "/manage" in location:
            return {"type": "classic", "port": p, "host": host}
        try:
            st_os, _, _ = http_request(host, p, "GET", "/api/auth/login", timeout=timeout)
        except ConnectionFailed:
            st_os = None
        if st_os is not None and st_os != 404:
            return {"type": "unifios", "port": p, "host": host}
        if st == 200 and "x-csrf-token" in headers:
            return {"type": "unifios", "port": p, "host": host}
        try:
            st_cl, _, _ = http_request(host, p, "GET", "/api/self", timeout=timeout)
        except ConnectionFailed:
            st_cl = None
        if st_cl in (200, 401):
            return {"type": "classic", "port": p, "host": host}
        errors.append("%s:%s antwortet nicht wie ein UniFi Controller (HTTP %s)" % (host, p, st))
    raise ConnectionFailed("; ".join(errors) or "Kein UniFi Controller gefunden")


# --------------------------------------------------------------------------
# UniFi API
# --------------------------------------------------------------------------
def normalize_client(c):
    mac = (c.get("mac") or "").lower()
    ctype = c.get("type")
    if ctype not in ("WIRED", "WIRELESS"):
        ctype = "WIRED" if c.get("is_wired") else "WIRELESS"
    name = c.get("display_name") or c.get("name") or c.get("hostname") or c.get("oui") or mac
    return {
        "name": name,
        "system": c.get("oui"),
        "mac": mac,
        "type": ctype,
        "userId": c.get("user_id") or c.get("_id"),
        "ip": c.get("ip") or c.get("last_ip") or c.get("fixed_ip"),
        "ssid": c.get("essid"),
        "apMac": (c.get("ap_mac") or c.get("sw_mac") or c.get("gw_mac") or "").lower() or None,
        "signal": to_int(c.get("signal")),
        "experience": c.get("wifi_experience_score", c.get("satisfaction")),
        "lastSeen": to_int(c.get("last_seen")),
        "rx": to_int(c.get("rx_bytes", c.get("wired-rx_bytes"))),
        "tx": to_int(c.get("tx_bytes", c.get("wired-tx_bytes"))),
    }


class UniFiApi:
    def __init__(self, cfg, session=None):
        self.cfg = cfg
        self.session = session or Session.load()
        self.host = cfg["ipaddress"]
        self.site = cfg.get("site") or "default"
        self._ctl = None
        self._devices = {}
        self._devices_loaded = 0

    # -- Controller ---------------------------------------------------------
    def controller(self, force_detect=False):
        if self._ctl and not force_detect:
            return self._ctl
        ctype = self.cfg.get("controllerType", "auto")
        port = self.cfg.get("port")
        if ctype in ("unifios", "classic"):
            self._ctl = {"type": ctype, "port": port or DEFAULT_PORTS[ctype], "host": self.host}
        else:
            cached = self.session.controller
            if (not force_detect and cached and cached.get("host") == self.host
                    and (not port or cached.get("port") == port)):
                self._ctl = cached
            else:
                self._ctl = detect_controller(self.host, port)
                log.info("Controller erkannt: %s auf Port %s", self._ctl["type"], self._ctl["port"])
        if self.session.controller != self._ctl:
            self.session.controller = self._ctl
            self.session.dirty = True
        return self._ctl

    @property
    def prefix(self):
        return "/proxy/network" if self.controller()["type"] == "unifios" else ""

    # -- Login --------------------------------------------------------------
    def login(self, token=None):
        ctl = self.controller()
        if not self.cfg.get("username") or not self.cfg.get("password"):
            raise LoginFailed("Benutzername oder Passwort fehlt")
        if ctl["type"] == "unifios":
            path = "/api/auth/login"
            body = {"username": self.cfg["username"], "password": self.cfg["password"], "rememberMe": True}
            if token:
                body["token"] = str(token).strip()
        else:
            path = "/api/login"
            body = {"username": self.cfg["username"], "password": self.cfg["password"], "remember": True,
                    "strict": True}
            if token:
                body["ubic_2fa_token"] = str(token).strip()
        self.session.clear_auth()
        st, hd, raw = http_request(self.host, ctl["port"], "POST", path, body=body, timeout=15)
        text = raw.decode("utf-8", "replace")
        if 200 <= st < 300:
            self.session.update(hd)
            self.session.controller = ctl
            self.session.save()
            log.info("Login am UniFi Controller erfolgreich (%s)", ctl["type"])
            return True
        self.session.save()
        if st == 499 or re.search(r"2fa|mfa|Ubic2faTokenRequired|token required", text, re.I):
            raise TwoFactorRequired("Zwei-Faktor-Code erforderlich")
        if st == 429:
            raise RateLimited("Zu viele Login-Versuche – der Controller sperrt vorübergehend")
        if st in (400, 401, 403):
            raise LoginFailed("Login abgelehnt (HTTP %s) – Benutzername/Passwort prüfen" % st)
        if st == 404 and self.cfg.get("controllerType") == "auto":
            self.session.controller = None
            self.session.save()
        raise UniFiError("Login fehlgeschlagen: HTTP %s %s" % (st, text[:200]))

    def ensure_login(self, allow_login=True, token=None):
        if token:
            return self.login(token)
        if self.session.cookies:
            try:
                self.request("GET", "/api/s/%s/self" % self.site)
                return True
            except Unauthorized:
                log.info("Sitzung abgelaufen")
        if not allow_login:
            raise TwoFactorRequired("Sitzung abgelaufen – Login mit Zwei-Faktor-Code über die Weboberfläche nötig")
        return self.login()

    # -- Requests -----------------------------------------------------------
    def request(self, method, path, body=None, timeout=10, raw_path=False):
        ctl = self.controller()
        headers = {}
        cookie = self.session.cookie_header()
        if cookie:
            headers["Cookie"] = cookie
        if method != "GET" and self.session.csrf:
            headers["X-CSRF-Token"] = self.session.csrf
        full = path if raw_path else self.prefix + path
        st, hd, raw = http_request(self.host, ctl["port"], method, full, body=body, headers=headers, timeout=timeout)
        self.session.update(hd)
        if self.session.dirty:
            self.session.save()
        if st == 401 or (st == 403 and b"LoginRequired" in raw):
            raise Unauthorized("Nicht angemeldet (HTTP %s)" % st)
        if st == 404:
            raise NotFound("HTTP 404 %s" % full)
        if st >= 400:
            raise UniFiError("HTTP %s bei %s" % (st, full))
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8", "replace"))
        except ValueError:
            raise UniFiError("Ungültige Antwort von %s" % full)

    def legacy(self, path, timeout=10):
        data = self.request("GET", path, timeout=timeout)
        if isinstance(data, dict):
            return data.get("data") or []
        return data or []

    # -- Daten --------------------------------------------------------------
    def sysinfo(self):
        rows = self.legacy("/api/s/%s/stat/sysinfo" % self.site)
        row = rows[0] if rows else {}
        version = row.get("version") or "0"
        return {
            "version": version,
            "deviceType": row.get("ubnt_device_type"),
            "name": row.get("name") or row.get("hostname"),
            "versionOk": version_tuple(version) >= MIN_CONTROLLER_VERSION,
        }

    def health(self):
        rows = self.legacy("/api/s/%s/stat/health" % self.site)
        sub = {r.get("subsystem"): r for r in rows if isinstance(r, dict)}
        wan = sub.get("wan", {})
        www = sub.get("www", {})
        stats = wan.get("gw_system-stats") or {}
        return {
            "gateway": wan.get("gw_name") or "",
            "status": wan.get("status") or "",
            "cpu": stats.get("cpu"),
            "mem": stats.get("mem"),
            "isp": wan.get("isp_name") or www.get("isp_name") or "",
            "wanIp": wan.get("wan_ip") or "",
            "uptime": www.get("uptime") or stats.get("uptime"),
            "wlanStatus": sub.get("wlan", {}).get("status"),
            "lanStatus": sub.get("lan", {}).get("status"),
        }

    def sites(self):
        rows = self.legacy("/api/self/sites")
        return [{"value": r.get("name"), "label": r.get("desc") or r.get("name")} for r in rows]

    def devices(self, force=False):
        now = time.time()
        if force or not self._devices or now - self._devices_loaded > 600:
            if now - self._devices_loaded < 30 and self._devices:
                return self._devices
            try:
                rows = self.legacy("/api/s/%s/stat/device" % self.site, timeout=15)
                self._devices = {(r.get("mac") or "").lower(): r.get("name") or r.get("model") or r.get("mac")
                                 for r in rows}
            finally:
                self._devices_loaded = now
        return self._devices

    def access_point(self, mac):
        if not mac:
            return None
        mac = mac.lower()
        devs = self.devices()
        if mac not in devs:
            devs = self.devices(force=True)
        return {"name": devs.get(mac, mac), "mac": mac}

    def active_clients(self):
        try:
            rows = self.request("GET", "/v2/api/site/%s/clients/active" % self.site, timeout=20)
            if isinstance(rows, dict):
                rows = rows.get("data") or []
        except NotFound:
            rows = self.legacy("/api/s/%s/stat/sta" % self.site, timeout=20)
        return [normalize_client(r) for r in rows if isinstance(r, dict) and r.get("mac")]

    def history_clients(self):
        try:
            rows = self.request("GET", "/v2/api/site/%s/clients/history?onlyNonBlocked=true&withinHours=168"
                                % self.site, timeout=20)
            if isinstance(rows, dict):
                rows = rows.get("data") or []
        except NotFound:
            rows = self.legacy("/api/s/%s/rest/user" % self.site, timeout=20)
        return [normalize_client(r) for r in rows if isinstance(r, dict) and r.get("mac")]

    def ws_path(self):
        return "%s/wss/s/%s/events?clients=v2" % (self.prefix, self.site)


# --------------------------------------------------------------------------
# Minimaler WebSocket-Client (RFC 6455) – nur Standardbibliothek
# --------------------------------------------------------------------------
class WebSocket:
    GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

    def __init__(self, host, port, path, headers=None, timeout=10):
        self.host, self.port, self.path = host, port, path
        self.headers = headers or {}
        self.timeout = timeout
        self.sock = None
        self.buf = b""
        self.fragments = []
        self.frag_opcode = None
        self.last_rx = time.time()
        self.closed = False

    def connect(self):
        raw = socket.create_connection((self.host, self.port), timeout=self.timeout)
        try:
            self.sock = SSL_CTX.wrap_socket(raw, server_hostname=self.host)
        except Exception:
            raw.close()
            raise
        key = base64.b64encode(os.urandom(16)).decode()
        host_hdr = self.host if self.port == 443 else "%s:%s" % (self.host, self.port)
        lines = ["GET %s HTTP/1.1" % self.path, "Host: %s" % host_hdr, "Upgrade: websocket",
                 "Connection: Upgrade", "Sec-WebSocket-Key: %s" % key, "Sec-WebSocket-Version: 13",
                 "User-Agent: %s" % USER_AGENT]
        for k, v in self.headers.items():
            lines.append("%s: %s" % (k, v))
        self.sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionFailed("WebSocket: Verbindung beim Handshake geschlossen")
            data += chunk
            if len(data) > 65536:
                raise ConnectionFailed("WebSocket: Handshake zu groß")
        head, self.buf = data.split(b"\r\n\r\n", 1)
        lines = head.decode("latin-1").split("\r\n")
        m = re.match(r"HTTP/\d\.\d (\d+)", lines[0])
        status = int(m.group(1)) if m else 0
        if status in (401, 403):
            self.close()
            raise Unauthorized("WebSocket: nicht angemeldet (HTTP %s)" % status)
        if status != 101:
            self.close()
            raise ConnectionFailed("WebSocket: unerwartete Antwort HTTP %s" % status)
        hdrs = {}
        for line in lines[1:]:
            if ":" in line:
                k, v = line.split(":", 1)
                hdrs[k.strip().lower()] = v.strip()
        expected = base64.b64encode(hashlib.sha1((key + self.GUID).encode()).digest()).decode()
        if hdrs.get("sec-websocket-accept") != expected:
            self.close()
            raise ConnectionFailed("WebSocket: ungültiger Accept-Header")
        self.sock.settimeout(None)
        self.last_rx = time.time()

    def _send_frame(self, opcode, payload):
        if self.closed or not self.sock:
            raise ConnectionFailed("WebSocket geschlossen")
        header = bytes([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header += bytes([0x80 | n])
        elif n < 65536:
            header += bytes([0x80 | 126]) + struct.pack("!H", n)
        else:
            header += bytes([0x80 | 127]) + struct.pack("!Q", n)
        mask = os.urandom(4)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        try:
            self.sock.sendall(header + mask + masked)
        except OSError as e:
            self.closed = True
            raise ConnectionFailed("WebSocket: Senden fehlgeschlagen (%s)" % e)

    def send_text(self, text):
        self._send_frame(0x1, text.encode("utf-8"))

    def _parse(self):
        """Liefert (opcode, fin, payload) oder None wenn der Puffer unvollständig ist."""
        b = self.buf
        if len(b) < 2:
            return None
        fin = bool(b[0] & 0x80)
        opcode = b[0] & 0x0F
        masked = bool(b[1] & 0x80)
        length = b[1] & 0x7F
        pos = 2
        if length == 126:
            if len(b) < 4:
                return None
            length = struct.unpack("!H", b[2:4])[0]
            pos = 4
        elif length == 127:
            if len(b) < 10:
                return None
            length = struct.unpack("!Q", b[2:10])[0]
            pos = 10
        mask = None
        if masked:
            if len(b) < pos + 4:
                return None
            mask = b[pos:pos + 4]
            pos += 4
        if len(b) < pos + length:
            return None
        payload = b[pos:pos + length]
        if mask:
            payload = bytes(x ^ mask[i % 4] for i, x in enumerate(payload))
        self.buf = b[pos + length:]
        return opcode, fin, payload

    def poll(self, timeout=1.0):
        """Wartet bis zu `timeout` Sekunden auf Daten und gibt fertige Textnachrichten zurück."""
        messages = []
        if self.closed:
            raise ConnectionFailed("WebSocket geschlossen")
        pending = self.sock.pending() if hasattr(self.sock, "pending") else 0
        if not pending and not self._has_frame():
            r, _, _ = select.select([self.sock], [], [], timeout)
            if not r:
                return messages
        while True:
            try:
                self.sock.setblocking(False)
                chunk = self.sock.recv(65536)
            except (ssl.SSLWantReadError, BlockingIOError):
                chunk = None
            except OSError as e:
                self.closed = True
                raise ConnectionFailed("WebSocket: Lesefehler (%s)" % e)
            finally:
                if self.sock:
                    self.sock.setblocking(True)
            if chunk == b"":
                self.closed = True
                raise ConnectionFailed("WebSocket vom Controller geschlossen")
            if chunk:
                self.buf += chunk
                self.last_rx = time.time()
                if self.sock.pending():
                    continue
            break
        while True:
            frame = self._parse()
            if frame is None:
                break
            opcode, fin, payload = frame
            if opcode == 0x8:  # close
                self.closed = True
                code = struct.unpack("!H", payload[:2])[0] if len(payload) >= 2 else 0
                raise ConnectionFailed("WebSocket vom Controller geschlossen (Code %s)" % code)
            if opcode == 0x9:  # ping
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:  # pong
                continue
            if opcode in (0x1, 0x2):
                if fin:
                    messages.append(payload.decode("utf-8", "replace"))
                else:
                    self.frag_opcode = opcode
                    self.fragments = [payload]
            elif opcode == 0x0:
                self.fragments.append(payload)
                if fin:
                    messages.append(b"".join(self.fragments).decode("utf-8", "replace"))
                    self.fragments = []
        return messages

    def _has_frame(self):
        if len(self.buf) < 2:
            return False
        saved = self.buf
        frame = self._parse()
        self.buf = saved
        return frame is not None

    def close(self):
        if self.sock:
            try:
                if not self.closed:
                    self._send_frame(0x8, struct.pack("!H", 1000))
            except Exception:
                pass
            try:
                self.sock.close()
            except Exception:
                pass
        self.sock = None
        self.closed = True


# --------------------------------------------------------------------------
# Minimaler MQTT 3.1.1 Client (nur Publish, QoS 0)
# --------------------------------------------------------------------------
def loxberry_mqtt():
    general = read_json(P["general"], {}) or {}
    m = general.get("Mqtt") or general.get("MQTT")
    if not isinstance(m, dict) or not m:
        return None
    return {
        "source": "loxberry",
        "host": m.get("Brokerhost") or "localhost",
        "port": to_int(m.get("Brokerport"), 1883),
        "user": m.get("Brokeruser") or "",
        "password": m.get("Brokerpass") or "",
        "tls": False,
    }


def mqtt_settings(cfg=None):
    """Broker aus der Plugin-Konfiguration (mqttMode=custom) oder aus den LoxBerry-Systemeinstellungen."""
    cfg = cfg if cfg is not None else load_config()
    m = cfg.get("mqtt") or {}
    if m.get("mode") == "custom":
        if not m.get("host"):
            return None
        tls = bool(m.get("tls"))
        return {
            "source": "custom",
            "host": str(m["host"]).strip(),
            "port": to_int(m.get("port"), 8883 if tls else 1883),
            "user": m.get("user") or "",
            "password": m.get("password") or "",
            "tls": tls,
        }
    return loxberry_mqtt()


def _mqtt_len(n):
    out = bytearray()
    while True:
        byte = n % 128
        n //= 128
        if n:
            byte |= 0x80
        out.append(byte)
        if not n:
            return bytes(out)


def _mqtt_str(s):
    b = s.encode("utf-8")
    return struct.pack("!H", len(b)) + b


class Mqtt:
    KEEPALIVE = 60

    def __init__(self, settings, client_id=None):
        self.settings = settings
        self.client_id = client_id or ("UniFiPresenceNG-%s" % socket.gethostname())[:23]
        self.sock = None
        self.lock = threading.Lock()
        self.connected = False
        self.last_tx = 0
        self._reader = None

    def connect(self):
        self.disconnect()
        s = self.settings
        sock = socket.create_connection((s["host"], s["port"]), timeout=10)
        if s.get("tls"):
            try:
                sock = SSL_CTX.wrap_socket(sock, server_hostname=s["host"])
            except (OSError, ssl.SSLError):
                sock.close()
                raise
        flags = 0x02  # clean session
        payload = _mqtt_str(self.client_id)
        if s.get("user"):
            flags |= 0x80
            payload += _mqtt_str(s["user"])
            if s.get("password"):
                flags |= 0x40
                payload += _mqtt_str(s["password"])
        var = _mqtt_str("MQTT") + bytes([4, flags]) + struct.pack("!H", self.KEEPALIVE)
        body = var + payload
        sock.sendall(bytes([0x10]) + _mqtt_len(len(body)) + body)
        ack = b""
        while len(ack) < 4:
            chunk = sock.recv(4 - len(ack))
            if not chunk:
                sock.close()
                raise ConnectionError("MQTT: Verbindung vom Broker geschlossen")
            ack += chunk
        if ack[0] != 0x20 or ack[3] != 0:
            sock.close()
            reasons = {1: "Protokollversion", 2: "Client-ID abgelehnt", 3: "Broker nicht verfügbar",
                       4: "Benutzer/Passwort falsch", 5: "nicht autorisiert"}
            raise ConnectionError("MQTT: Verbindung abgelehnt (%s)" % reasons.get(ack[3], ack[3]))
        sock.settimeout(None)
        self.sock = sock
        self.connected = True
        self.last_tx = time.time()
        self._reader = threading.Thread(target=self._read_loop, args=(sock,), daemon=True)
        self._reader.start()
        log.info("MQTT verbunden mit %s:%s (%s%s)", s["host"], s["port"],
                 "LoxBerry-Broker" if s.get("source") == "loxberry" else "eigener Broker",
                 ", TLS" if s.get("tls") else "")

    def _read_loop(self, sock):
        try:
            while True:
                data = sock.recv(1024)
                if not data:
                    break
        except OSError:
            pass
        if self.sock is sock:
            self.connected = False
            log.warning("MQTT Verbindung getrennt")

    def disconnect(self):
        with self.lock:
            if self.sock:
                try:
                    self.sock.sendall(b"\xe0\x00")
                except OSError:
                    pass
                try:
                    self.sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                try:
                    self.sock.close()
                except OSError:
                    pass
            self.sock = None
            self.connected = False

    def _send(self, packet):
        with self.lock:
            if not self.sock:
                raise ConnectionError("MQTT nicht verbunden")
            self.sock.sendall(packet)
            self.last_tx = time.time()

    def publish(self, topic, payload, retain=False):
        if isinstance(payload, str):
            payload = payload.encode("utf-8")
        body = _mqtt_str(topic) + payload
        packet = bytes([0x30 | (0x01 if retain else 0)]) + _mqtt_len(len(body)) + body
        for attempt in (1, 2):
            try:
                if not self.connected:
                    self.connect()
                self._send(packet)
                return True
            except (OSError, ConnectionError) as e:
                self.connected = False
                if attempt == 2:
                    log.error("MQTT publish fehlgeschlagen: %s", e)
                    return False
        return False

    def keepalive(self):
        if self.connected and time.time() - self.last_tx > self.KEEPALIVE / 2:
            try:
                self._send(b"\xc0\x00")
            except OSError:
                self.connected = False


# --------------------------------------------------------------------------
# Anwesenheitslogik
# --------------------------------------------------------------------------
EVT_RE = re.compile(r"^EVT_(WU|WG|LU|LG)_(Connected|Disconnected|Roam|RoamRadio|Reconnected)$")


class Tracker:
    def __init__(self, publish_fn, ap_lookup):
        self.publish_fn = publish_fn
        self.ap_lookup = ap_lookup
        self.watched = {}
        self.states = {}
        self.internal = {}
        self.published = {}
        self.summary_published = None
        self.summary_changed = None
        self.cfg = {}

    def reset_published(self):
        """Nach (Re-)Connect alle Zustände und Sammelwerte erneut senden."""
        self.published.clear()
        self.summary_published = None

    def set_config(self, cfg):
        self.cfg = cfg
        watched = {}
        for entry in cfg.get("clients", []):
            mac = (entry.get("mac") or "").lower()
            if mac:
                watched[mac] = entry
        for mac in list(self.states):
            if mac not in watched:
                self.states.pop(mac, None)
                self.internal.pop(mac, None)
                self.published.pop(mac, None)
        self.watched = watched
        for mac, entry in watched.items():
            st = self.states.get(mac)
            if st is None:
                ctype = entry.get("type") if entry.get("type") in ("WIRED", "WIRELESS") else "WIRELESS"
                st = {"name": entry.get("name") or mac, "system": entry.get("system"), "mac": mac,
                      "type": ctype, "userId": entry.get("userId"), "ip": entry.get("ip"), "ssid": None,
                      "experience": None, "signalDbm": -100 if ctype == "WIRELESS" else None,
                      "signalPercentage": 0 if ctype == "WIRELESS" else None, "connected": False,
                      "ap": None, "since": None}
                self.states[mac] = st
                self.internal[mac] = {"activity": 0, "rx": None, "tx": None, "known": False}
            st["name"] = (entry.get("alias") or "").strip() or entry.get("name") or st["name"]

    def topic_for(self, mac):
        entry = self.watched.get(mac, {})
        name = (entry.get("alias") or "").strip() or entry.get("name") or self.states[mac]["name"]
        return "%s/%s" % (self.cfg.get("topic", "UniFi/clients").strip("/"), mqtt_name(name))

    def _set_connected(self, st, value):
        value = bool(value)
        if st["connected"] != value:
            st["connected"] = value
            st["since"] = time.strftime("%Y-%m-%dT%H:%M:%S")
            log.info("%s (%s) ist jetzt %s", st["name"], st["mac"], "ONLINE" if value else "OFFLINE")
        if not value and st["type"] == "WIRELESS":
            st["signalDbm"] = -100
            st["signalPercentage"] = 0
            st["ssid"] = None
            st["experience"] = None

    def update(self, n):
        """n: normalisierter Client aus Polling oder client:sync"""
        mac = n.get("mac")
        if mac not in self.watched:
            return
        st, it = self.states[mac], self.internal[mac]
        now = time.time()
        st["type"] = n.get("type") or st["type"]
        st["system"] = n.get("system") or st.get("system")
        if n.get("userId"):
            st["userId"] = n["userId"]
        if n.get("ip"):
            st["ip"] = n["ip"]
        if n.get("apMac"):
            try:
                st["ap"] = self.ap_lookup(n["apMac"])
            except UniFiError:
                pass
        if st["type"] == "WIRELESS":
            self._set_connected(st, True)
            st["ssid"] = n.get("ssid") or st.get("ssid")
            if n.get("experience") is not None:
                st["experience"] = n.get("experience")
            if n.get("signal"):
                st["signalDbm"] = n["signal"]
                st["signalPercentage"] = signal_percentage(n["signal"])
        else:
            st["ssid"] = None
            st["signalDbm"] = None
            st["signalPercentage"] = None
            rx, tx = n.get("rx"), n.get("tx")
            changed = (rx is not None and it["rx"] is not None and rx != it["rx"]) or \
                      (tx is not None and it["tx"] is not None and tx != it["tx"])
            if not it["known"]:
                changed = True  # erstes Auftauchen in der Liste aktiver Clients
            if rx is not None:
                it["rx"] = rx
            if tx is not None:
                it["tx"] = tx
            if changed:
                it["activity"] = now
            last_seen = n.get("lastSeen")
            if last_seen and last_seen > it["activity"] and last_seen <= now + 60:
                it["activity"] = min(last_seen, now)
            it["known"] = True
            self._set_connected(st, now - it["activity"] <= self.cfg.get("wiredTimeout", 60))
        self.flush(mac)

    def event(self, ev):
        key = ev.get("key") or ""
        m = EVT_RE.match(key)
        if not m:
            return
        mac = (ev.get("user") or ev.get("client") or ev.get("guest") or "").lower()
        if mac not in self.watched:
            return
        st, it = self.states[mac], self.internal[mac]
        action = m.group(2)
        if action in ("Connected", "Reconnected", "Roam", "RoamRadio"):
            ap = ev.get("ap_to") or ev.get("ap") or ev.get("sw") or ev.get("gw")
            if ap:
                try:
                    st["ap"] = self.ap_lookup(ap)
                except UniFiError:
                    pass
            if m.group(1) in ("WU", "WG"):
                st["type"] = "WIRELESS"
                st["ssid"] = ev.get("ssid") or st.get("ssid")
            else:
                it["activity"] = time.time()
            self._set_connected(st, True)
        elif action == "Disconnected":
            self._set_connected(st, False)
            it["known"] = False
        self.flush(mac)

    def reconcile(self, active_macs):
        """Alle überwachten Clients, die nicht mehr aktiv sind, als offline melden."""
        for mac, st in self.states.items():
            if mac not in active_macs:
                self.internal[mac]["known"] = False
                if st["connected"]:
                    self._set_connected(st, False)
                self.flush(mac)

    def tick(self):
        now = time.time()
        timeout = self.cfg.get("wiredTimeout", 60)
        for mac, st in self.states.items():
            if st["type"] == "WIRED" and st["connected"] and now - self.internal[mac]["activity"] > timeout:
                self._set_connected(st, False)
                self.flush(mac)

    def flush(self, mac, force=False, summary=True):
        st = self.states.get(mac)
        if st is None:
            return
        payload = dict(st)
        topic = self.topic_for(mac)
        snapshot = (topic, json.dumps(payload, sort_keys=True))
        if force or self.published.get(mac) != snapshot:
            if self.publish_fn(topic, payload):
                self.published[mac] = snapshot
        if summary:
            self.publish_summary()

    def flush_all(self, force=False):
        for mac in list(self.states):
            self.flush(mac, force=force, summary=False)
        self.publish_summary(force=force)

    # -- Sammelwerte ----------------------------------------------------------
    def is_person(self, mac):
        """Zählt das Gerät für 'jemand zu Hause'? Standard: WLAN ja, LAN nein."""
        flag = self.watched.get(mac, {}).get("person")
        if flag is None:
            return self.states[mac]["type"] == "WIRELESS"
        return bool(flag)

    def summary(self):
        present, total, groups = [], 0, {}
        for mac, st in self.states.items():
            entry = self.watched.get(mac, {})
            for g in [x.strip() for x in str(entry.get("group") or "").split(",") if x.strip()]:
                grp = groups.setdefault(g, {"anyone": False, "count": 0, "total": 0, "names": []})
                grp["total"] += 1
                if st["connected"]:
                    grp["count"] += 1
                    grp["anyone"] = True
                    grp["names"].append(st["name"])
            if not self.is_person(mac):
                continue
            total += 1
            if st["connected"]:
                present.append(st["name"])
        return {
            "anyone": bool(present),
            "count": len(present),
            "total": total,
            "present": ", ".join(sorted(present)),
            "groups": {group_key(g): {"name": g, "anyone": v["anyone"], "count": v["count"], "total": v["total"],
                                      "present": ", ".join(sorted(v["names"]))}
                       for g, v in sorted(groups.items())},
        }

    def summary_topic(self):
        return (self.cfg.get("summaryTopic") or "").strip().strip("/")

    def publish_summary(self, force=False):
        topic = self.summary_topic()
        if not topic or not self.states:
            return
        data = self.summary()
        snapshot = (topic, json.dumps(data, sort_keys=True))
        if not force and snapshot == self.summary_published:
            return
        if self.summary_published is None or json.loads(self.summary_published[1]).get("anyone") != data["anyone"]:
            self.summary_changed = time.strftime("%Y-%m-%dT%H:%M:%S")
        payload = dict(data, since=self.summary_changed)
        if self.publish_fn(topic, payload):
            self.summary_published = snapshot


# --------------------------------------------------------------------------
# Daemon
# --------------------------------------------------------------------------
CONNECTION_FIELDS = ("ipaddress", "port", "controllerType", "username", "password", "site")


class Daemon:
    def __init__(self):
        self.running = True
        self.status = "STARTING"
        self.error = None
        self.controller_info = {}
        self.stats = {}
        self.active_count = None
        self.mqtt = None
        self.mqtt_cfg = None
        self.last_status_write = 0
        self.fail_count = 0
        self.cfg = load_config()
        self.cfg_mtime = mtime(CONFIG_FILE)
        self.api = None
        self.tracker = Tracker(self.publish, self.ap_lookup)

    # -- Status -------------------------------------------------------------
    def set_status(self, status, error=None):
        if status != self.status or error != self.error:
            if error:
                log.warning("Status %s: %s", status, error)
            else:
                log.info("Status %s", status)
        self.status, self.error = status, error
        self.write_status(force=True)

    def write_status(self, force=False):
        now = time.time()
        if not force and now - self.last_status_write < 3:
            return
        self.last_status_write = now
        data = {
            "status": self.status,
            "error": self.error,
            "updated": int(now),
            "pid": os.getpid(),
            "version": VERSION,
            "controller": self.controller_info,
            "stats": self.stats,
            "activeClients": self.active_count,
            "mqtt": bool(self.mqtt and self.mqtt.connected),
            "mqttBroker": ("%s:%s" % (self.mqtt_cfg["host"], self.mqtt_cfg["port"])) if self.mqtt_cfg else None,
            "mqttSource": self.mqtt_cfg.get("source") if self.mqtt_cfg else None,
            "clients": {mac: dict(st, topic=self.tracker.topic_for(mac), person=self.tracker.is_person(mac))
                        for mac, st in self.tracker.states.items()},
            "summary": dict(self.tracker.summary(), topic=self.tracker.summary_topic(),
                            since=self.tracker.summary_changed) if self.tracker.states else None,
        }
        try:
            write_json(STATUS_FILE, data, mode=0o644)
        except OSError as e:
            log.error("Statusdatei kann nicht geschrieben werden: %s", e)

    # -- MQTT ---------------------------------------------------------------
    def publish(self, topic, payload):
        if not self.mqtt:
            return False
        ok = self.mqtt.publish(topic, json.dumps(payload, ensure_ascii=False), retain=bool(self.cfg.get("retain")))
        if ok:
            log.debug("MQTT %s -> %s", topic, payload)
        return ok

    def ensure_mqtt(self):
        settings = mqtt_settings(self.cfg)
        if not settings:
            if (self.cfg.get("mqtt") or {}).get("mode") == "custom":
                self.set_status("NO_MQTT", "Eigener MQTT Broker gewählt, aber keine Adresse eingetragen")
            else:
                self.set_status("NO_MQTT", "In LoxBerry ist kein MQTT Broker konfiguriert")
            return False
        if settings != self.mqtt_cfg or self.mqtt is None:
            if self.mqtt:
                self.mqtt.disconnect()
            self.mqtt_cfg = settings
            self.mqtt = Mqtt(settings)
        if not self.mqtt.connected:
            try:
                self.mqtt.connect()
            except (OSError, ConnectionError) as e:
                self.set_status("MQTT_ERROR", str(e))
                return False
        return True

    def ap_lookup(self, mac):
        if self.api:
            return self.api.access_point(mac)
        return {"name": mac, "mac": mac}

    # -- Warten -------------------------------------------------------------
    def sleep(self, seconds, watch_session=False):
        end = time.time() + seconds
        cfg_m = self.cfg_mtime
        ses_m = mtime(SESSION_FILE)
        while self.running and time.time() < end:
            time.sleep(1)
            if mtime(CONFIG_FILE) != cfg_m:
                return "config"
            if watch_session and mtime(SESSION_FILE) != ses_m:
                return "session"
            self.write_status()
        return "timeout"

    def reload_config(self):
        m = mtime(CONFIG_FILE)
        if m == self.cfg_mtime:
            return None
        old = self.cfg
        self.cfg = load_config()
        self.cfg_mtime = m
        self.apply_loglevel()
        changed = any(old.get(f) != self.cfg.get(f) for f in CONNECTION_FIELDS)
        log.info("Konfiguration neu geladen%s", " (Verbindungsdaten geändert)" if changed else "")
        return changed

    def apply_loglevel(self):
        log.setLevel(logging.DEBUG if self.cfg.get("loglevel") == "debug" else logging.INFO)

    # -- Hauptschleife ------------------------------------------------------
    def stop(self, *_):
        self.running = False

    def run(self):
        signal.signal(signal.SIGTERM, self.stop)
        signal.signal(signal.SIGINT, self.stop)
        self.apply_loglevel()
        log.info("Unifi-PresenceNG %s gestartet (Python %s)", VERSION, sys.version.split()[0])
        while self.running:
            self.reload_config()
            if not self.ensure_mqtt():
                self.sleep(15)
                continue
            cfg = self.cfg
            if not cfg.get("ipaddress") or not cfg.get("username") or not cfg.get("password"):
                self.set_status("WAIT_FOR_CONFIG", "Controller-Adresse, Benutzername oder Passwort fehlt")
                self.sleep(3600)
                continue
            try:
                self.session_loop()
            except TwoFactorRequired as e:
                self.set_status("TWO_FA_REQUIRED", str(e))
                self.sleep(600, watch_session=True)
            except LoginFailed as e:
                self.set_status("UNAUTHORIZED", str(e))
                self.sleep(300, watch_session=True)
            except Unauthorized as e:
                # Sitzung abgelaufen -> sofort neu einloggen, bei Wiederholung bremsen (Login-Sperre vermeiden)
                self.fail_count += 1
                self.set_status("UNAUTHORIZED", str(e))
                self.sleep(3 if self.fail_count <= 2 else 300, watch_session=True)
            except RateLimited as e:
                self.set_status("RATE_LIMITED", str(e))
                self.sleep(600, watch_session=True)
            except VersionTooOld as e:
                self.set_status("VERSION_ERROR", str(e))
                self.sleep(3600)
            except ConnectionFailed as e:
                self.fail_count += 1
                self.set_status("DISCONNECTED", str(e))
                if self.fail_count >= 3 and self.api and self.cfg.get("controllerType") == "auto":
                    self.api.session.controller = None  # neu erkennen
                    self.api.session.save()
                self.sleep(min(60, 5 * self.fail_count))
            except UniFiError as e:
                self.fail_count += 1
                self.set_status("ERROR", str(e))
                self.sleep(min(120, 10 * self.fail_count))
            except Exception as e:  # pragma: no cover
                self.fail_count += 1
                log.exception("Unerwarteter Fehler")
                self.set_status("ERROR", "%s: %s" % (type(e).__name__, e))
                self.sleep(30)
        if self.mqtt:
            self.mqtt.disconnect()
        self.status = "STOPPED"
        self.write_status(force=True)
        log.info("Beendet")

    def session_loop(self):
        cfg = self.cfg
        self.set_status("CONNECTING")
        self.api = api = UniFiApi(cfg, Session.load())
        api.controller()
        api.ensure_login(allow_login=not cfg.get("twoFaEnabled"))
        info = api.sysinfo()
        ctl = api.controller()
        self.controller_info = {"type": ctl["type"], "port": ctl["port"], "host": ctl["host"],
                                "version": info["version"], "deviceType": info["deviceType"],
                                "name": info["name"]}
        if not info["versionOk"]:
            raise VersionTooOld("Controller-Version %s ist zu alt (mindestens 6.4.54)" % info["version"])
        log.info("Verbunden mit %s %s (Network %s, Port %s)", ctl["type"], info["deviceType"] or "",
                 info["version"], ctl["port"])
        self.tracker.set_config(cfg)
        self.refresh_stats()
        self.tracker.reset_published()  # nach (Re-)Connect alle Zustände einmal senden
        self.poll_clients()

        headers = {}
        if api.session.cookie_header():
            headers["Cookie"] = api.session.cookie_header()
        ws = WebSocket(api.host, ctl["port"], api.ws_path(), headers=headers)
        ws.connect()
        log.info("Event-WebSocket verbunden (%s)", api.ws_path())
        self.set_status("CONNECTED")
        self.fail_count = 0
        last_ping = last_poll = last_stats = time.time()
        try:
            while self.running:
                for msg in ws.poll(1.0):
                    self.handle_message(msg)
                now = time.time()
                if now - last_ping >= 20:
                    ws.send_text("ping")
                    last_ping = now
                if now - ws.last_rx > 120:
                    raise ConnectionFailed("WebSocket: seit 120 s keine Daten mehr")
                if now - last_poll >= self.cfg["pollInterval"]:
                    self.poll_clients()
                    last_poll = now
                if now - last_stats >= 60:
                    self.refresh_stats()
                    last_stats = now
                self.tracker.tick()
                if self.mqtt:
                    if not self.mqtt.connected:
                        if not self.ensure_mqtt():
                            raise ConnectionFailed("MQTT Broker nicht erreichbar")
                        self.tracker.flush_all(force=True)
                        self.set_status("CONNECTED")
                    self.mqtt.keepalive()
                changed = self.reload_config()
                if changed:
                    return
                if changed is not None and mqtt_settings(self.cfg) != self.mqtt_cfg:
                    log.info("MQTT-Einstellungen geändert – verbinde neu")
                    if not self.ensure_mqtt():
                        raise ConnectionFailed("MQTT Broker nicht erreichbar")
                    self.tracker.reset_published()
                if changed is False:
                    old = (self.tracker.cfg.get("topic"), self.tracker.cfg.get("summaryTopic"))
                    self.tracker.set_config(self.cfg)
                    self.tracker.flush_all(force=(self.cfg.get("topic"), self.cfg.get("summaryTopic")) != old)
                self.write_status()
        finally:
            ws.close()

    def refresh_stats(self):
        try:
            self.stats = self.api.health()
        except (NotFound, UniFiError) as e:
            if isinstance(e, (Unauthorized, ConnectionFailed)):
                raise
            log.debug("Health nicht verfügbar: %s", e)

    def poll_clients(self):
        clients = self.api.active_clients()
        self.active_count = len(clients)
        active = set()
        for c in clients:
            active.add(c["mac"])
            self.tracker.update(c)
        self.tracker.reconcile(active)

    def handle_message(self, text):
        if text == "pong":
            return
        try:
            ev = json.loads(text)
        except ValueError:
            return
        if not isinstance(ev, dict):
            return
        meta = ev.get("meta") or {}
        kind = meta.get("message")
        data = ev.get("data") or []
        if not isinstance(data, list):
            data = [data]
        if kind in ("client:sync", "sta:sync"):
            for c in data:
                if isinstance(c, dict) and c.get("mac"):
                    self.tracker.update(normalize_client(c))
        elif kind == "events":
            for e in data:
                if isinstance(e, dict):
                    self.tracker.event(e)
        elif kind:
            log.debug("Ignoriere Event %s", kind)


def setup_logging(to_file):
    fmt = logging.Formatter("%(asctime)s <%(levelname)s> %(message)s", "%Y-%m-%d %H:%M:%S")
    log.handlers[:] = []
    if to_file:
        os.makedirs(P["log"], exist_ok=True)
        h = logging.handlers.RotatingFileHandler(LOG_FILE, maxBytes=512 * 1024, backupCount=1, encoding="utf-8")
    else:
        h = logging.StreamHandler(sys.stderr)
    h.setFormatter(fmt)
    log.addHandler(h)
    log.setLevel(logging.INFO)


def run_daemon(args):
    os.makedirs(P["data"], exist_ok=True)
    setup_logging(not args.foreground)
    lock = open(LOCK_FILE, "w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        log.error("Daemon läuft bereits")
        print("Daemon läuft bereits", file=sys.stderr)
        return 1
    lock.write(str(os.getpid()))
    lock.flush()
    Daemon().run()
    return 0


# --------------------------------------------------------------------------
# CLI für die Weboberfläche (Ausgabe immer JSON)
# --------------------------------------------------------------------------
def cli(args):
    cfg = load_config()
    if args.host:
        host, port = split_host(args.host)
        cfg["ipaddress"] = host
        cfg["port"] = to_int(args.port) or port
    elif args.port:
        cfg["port"] = to_int(args.port)
    out = {"ok": True}
    try:
        if args.command == "mqtttest":
            test_cfg = cfg
            override = os.environ.get("UPNG_MQTT_TEST")
            if override:
                try:
                    test_cfg = dict(cfg, mqtt=json.loads(override))
                except ValueError:
                    pass
            s = mqtt_settings(test_cfg)
            if not s:
                raise UniFiError("Kein MQTT Broker konfiguriert")
            m = Mqtt(s, client_id=("UPNG-test-%d" % os.getpid())[:23])
            try:
                m.connect()
            except (OSError, ConnectionError) as e:
                raise ConnectionFailed("%s:%s – %s" % (s["host"], s["port"], e))
            m.disconnect()
            out["broker"] = "%s:%s" % (s["host"], s["port"])
            out["source"] = s["source"]
            return out
        if not cfg.get("ipaddress"):
            raise UniFiError("Keine Controller-Adresse konfiguriert")
        if args.command == "detect":
            ctl = detect_controller(cfg["ipaddress"], cfg.get("port"))
            out["controller"] = ctl
            if cfg.get("controllerType") == "auto":
                s = Session.load()
                if s.controller != ctl:
                    s.controller = ctl
                    s.save()
            return out
        api = UniFiApi(cfg, Session.load())
        if args.command == "login":
            api.controller(force_detect=cfg.get("controllerType") == "auto")
            try:
                api.login(args.token)
            except TwoFactorRequired:
                if not cfg.get("twoFaEnabled"):
                    stored = load_config()
                    stored["twoFaEnabled"] = True
                    save_config(stored)
                raise
            stored = load_config()
            if bool(stored.get("twoFaEnabled")) != bool(args.token):
                stored["twoFaEnabled"] = bool(args.token)
                save_config(stored)
            info = api.sysinfo()
            out["controller"] = api.controller()
            out["sysinfo"] = info
            return out
        api.ensure_login(allow_login=not cfg.get("twoFaEnabled"))
        if args.command == "clients":
            active = api.active_clients()
            seen = {c["mac"] for c in active}
            for c in active:
                c["online"] = True
            history = [dict(c, online=False) for c in api.history_clients() if c["mac"] not in seen]
            allc = active + history
            for c in allc:
                c["signalPercentage"] = signal_percentage(c.get("signal")) if c["online"] else 0
                ap = c.get("apMac")
                c["ap"] = api.access_point(ap)["name"] if ap and c["online"] else None
            out["clients"] = allc
        elif args.command == "sites":
            out["sites"] = api.sites()
        elif args.command == "stats":
            out["sysinfo"] = api.sysinfo()
            out["controller"] = api.controller()
            try:
                out["health"] = api.health()
            except UniFiError:
                out["health"] = {}
        else:
            raise UniFiError("Unbekannter Befehl %s" % args.command)
    except UniFiError as e:
        out = {"ok": False, "code": e.code, "error": str(e)}
    except Exception as e:  # pragma: no cover
        out = {"ok": False, "code": "ERROR", "error": "%s: %s" % (type(e).__name__, e)}
    return out


def migrate():
    """Übernimmt die Einstellungen aus dem alten Plugin 'unifi_presence' (3.x), falls noch nichts konfiguriert ist."""
    cfg = load_config()
    if cfg.get("ipaddress"):
        print("Konfiguration vorhanden – keine Übernahme nötig")
        return 0
    old = None
    for name in (OLD_PLUGIN, "unifi_presence_ng"):
        old = read_json(os.path.join(os.path.dirname(P["config"]), name, "unifi.json"))
        if old and old.get("ipaddress"):
            break
    if not old or not old.get("ipaddress"):
        print("Keine alte Unifi-Presence-Konfiguration gefunden")
        return 0
    for key in ("ipaddress", "username", "password", "site", "topic", "wiredTimeout", "clients"):
        if old.get(key) not in (None, ""):
            cfg[key] = old[key]
    if old.get("port") and not old.get("native", True):
        cfg["port"] = to_int(old.get("port"))
    cfg["controllerType"] = "auto"
    cfg["twoFaEnabled"] = bool(old.get("twoFaEnabled"))
    cfg["clients"] = [{k: c.get(k) for k in ("name", "mac", "type", "system", "userId", "alias", "person", "group")
                       if c.get(k) is not None}
                      for c in cfg.get("clients", []) if isinstance(c, dict) and c.get("mac")]
    save_config(cfg)
    try:
        with open(SUBSCRIPTION_FILE, "w") as fh:
            fh.write("%s/#\n%s/#\n" % (cfg["topic"].strip("/"), cfg["summaryTopic"].strip("/")))
    except OSError:
        pass
    print("Einstellungen aus Unifi Presence übernommen (%d Geräte)" % len(cfg["clients"]))
    return 0


def main(argv=None):
    parser = argparse.ArgumentParser(prog="unifi_presenceng")
    sub = parser.add_subparsers(dest="mode")
    d = sub.add_parser("daemon")
    d.add_argument("--foreground", action="store_true", help="Log auf stderr statt Datei")
    c = sub.add_parser("cli")
    c.add_argument("command", choices=["detect", "login", "clients", "sites", "stats", "mqtttest"])
    c.add_argument("--host")
    c.add_argument("--port")
    c.add_argument("--token")
    sub.add_parser("version")
    sub.add_parser("migrate")
    args = parser.parse_args(argv)
    if args.mode == "migrate":
        return migrate()
    if args.mode == "daemon":
        return run_daemon(args)
    if args.mode == "cli":
        setup_logging(False)
        log.setLevel(logging.WARNING)
        print(json.dumps(cli(args), ensure_ascii=False))
        return 0
    if args.mode == "version":
        print(VERSION)
        return 0
    parser.print_help()
    return 2


if __name__ == "__main__":
    sys.exit(main())
