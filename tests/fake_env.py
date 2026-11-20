"""Fake UniFi controller (UniFi OS + classic) and fake MQTT broker for testing."""
import base64, hashlib, json, os, socket, ssl, struct, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

HERE = os.path.dirname(os.path.abspath(__file__))
STATE = {
    "version": sys.argv[1] if len(sys.argv) > 1 else "10.0.160",
    "active": [
        {"mac": "aa:bb:cc:00:00:01", "display_name": "Handy Ralf", "type": "WIRELESS", "essid": "Home",
         "signal": -55, "ap_mac": "11:22:33:44:55:66", "ip": "192.168.1.50", "wifi_experience_score": 97, "oui": "Apple"},
        {"mac": "aa:bb:cc:00:00:02", "display_name": "NAS", "type": "WIRED", "ip": "192.168.1.10",
         "rx_bytes": 1000, "tx_bytes": 1000, "last_seen": int(time.time())},
    ],
    "history": [{"mac": "aa:bb:cc:00:00:03", "display_name": "Tablet", "type": "WIRELESS", "oui": "Google"}],
    "ws_clients": [],
    "logins": 0,
}
TOKEN = "jwt-123"


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    classic = False

    def log_message(self, *a):
        pass

    def send_json(self, code, obj, headers=None):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        for k, v in (headers or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def authed(self):
        c = self.headers.get("Cookie", "")
        return ("TOKEN=" + TOKEN) in c or ("unifises=" + TOKEN) in c

    def do_GET(self):
        p = self.path
        pre = "" if self.classic else "/proxy/network"
        if p == "/":
            if self.classic:
                self.send_response(302); self.send_header("Location", "/manage"); self.send_header("Content-Length", "0"); self.end_headers(); return
            return self.send_json(200, {}, {"X-CSRF-Token": "csrf-1"})
        if p == "/api/auth/login":
            if self.classic:
                return self.send_json(404, {})
            return self.send_json(405, {})
        if self.headers.get("Upgrade", "").lower() == "websocket" and p.startswith(pre + "/wss/s/default/events"):
            if not self.authed():
                return self.send_json(401, {})
            return self.ws()
        if not p.startswith(pre):
            return self.send_json(404, {})
        p = p[len(pre):]
        if not self.authed():
            return self.send_json(401, {"meta": {"rc": "error", "msg": "api.err.LoginRequired"}, "data": []})
        if p == "/api/s/default/self":
            return self.send_json(200, {"meta": {"rc": "ok"}, "data": [{"name": "admin"}]})
        if p == "/api/s/default/stat/sysinfo":
            return self.send_json(200, {"meta": {"rc": "ok"}, "data": [{"version": STATE["version"], "ubnt_device_type": "UDMPRO", "name": "Dream Machine"}]})
        if p == "/api/s/default/stat/health":
            return self.send_json(200, {"data": [{"subsystem": "wan", "gw_name": "UDM Pro", "status": "ok", "isp_name": "Telekom", "gw_system-stats": {"cpu": "5.1", "mem": "60.2", "uptime": "1234"}}, {"subsystem": "www", "uptime": 999}]})
        if p == "/api/s/default/stat/device":
            return self.send_json(200, {"data": [{"mac": "11:22:33:44:55:66", "name": "AP Wohnzimmer"}]})
        if p == "/api/self/sites":
            return self.send_json(200, {"data": [{"name": "default", "desc": "Default"}, {"name": "x1", "desc": "Ferienhaus"}]})
        if p.startswith("/v2/api/site/default/clients/active"):
            return self.send_json(200, STATE["active"])
        if p.startswith("/v2/api/site/default/clients/history"):
            return self.send_json(200, STATE["history"])
        return self.send_json(404, {})

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(n) or b"{}")
        path = "/api/login" if self.classic else "/api/auth/login"
        if self.path == path:
            STATE["logins"] += 1
            if body.get("username") == "admin" and body.get("password") == "secret":
                ck = ("unifises=%s; Path=/; Secure" if self.classic else "TOKEN=%s; Path=/; HttpOnly") % TOKEN
                return self.send_json(200, {"ok": True}, {"Set-Cookie": ck, "X-CSRF-Token": "csrf-2"})
            if body.get("username") == "mfa":
                if body.get("token") == "123456" or body.get("ubic_2fa_token") == "123456":
                    return self.send_json(200, {}, {"Set-Cookie": "TOKEN=%s; Path=/" % TOKEN})
                return self.send_json(499, {"code": "MFA_AUTH_REQUIRED"})
            return self.send_json(401, {"errors": ["Invalid username or password"]})
        return self.send_json(404, {})

    def ws(self):
        key = self.headers["Sec-WebSocket-Key"]
        acc = base64.b64encode(hashlib.sha1((key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode()).digest()).decode()
        self.wfile.write(("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: %s\r\n\r\n" % acc).encode())
        self.wfile.flush()
        sock = self.connection
        lock = threading.Lock()

        def send(text):
            data = text.encode()
            n = len(data)
            if n < 126: hdr = bytes([0x81, n])
            elif n < 65536: hdr = bytes([0x81, 126]) + struct.pack("!H", n)
            else: hdr = bytes([0x81, 127]) + struct.pack("!Q", n)
            with lock:
                sock.sendall(hdr + data)
        STATE["ws_clients"].append(send)
        try:
            while True:
                h = self.rfile.read(2)
                if len(h) < 2: break
                op = h[0] & 0xF; ln = h[1] & 0x7F
                if ln == 126: ln = struct.unpack("!H", self.rfile.read(2))[0]
                elif ln == 127: ln = struct.unpack("!Q", self.rfile.read(8))[0]
                mask = self.rfile.read(4)
                pl = bytes(b ^ mask[i % 4] for i, b in enumerate(self.rfile.read(ln)))
                if op == 8: break
                if op == 1 and pl == b"ping": send("pong")
        finally:
            STATE["ws_clients"].remove(send)
        self.close_connection = True


class Classic(H):
    classic = True


def https(port, handler):
    srv = ThreadingHTTPServer(("127.0.0.1", port), handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(os.path.join(HERE, "cert.pem"), os.path.join(HERE, "key.pem"))
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


PUBLISHED = []


def mqtt_broker(port):
    srv = socket.socket(); srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", port)); srv.listen(5)

    def handle(c):
        def rd(n):
            b = b""
            while len(b) < n:
                x = c.recv(n - len(b))
                if not x: raise EOFError
                b += x
            return b
        try:
            while True:
                h = rd(1)[0]
                mult, ln = 1, 0
                while True:
                    d = rd(1)[0]; ln += (d & 127) * mult; mult *= 128
                    if not d & 128: break
                body = rd(ln) if ln else b""
                t = h >> 4
                if t == 1:
                    c.sendall(b"\x20\x02\x00\x00")
                elif t == 3:
                    tl = struct.unpack("!H", body[:2])[0]
                    PUBLISHED.append((body[2:2 + tl].decode(), body[2 + tl:].decode(), bool(h & 1)))
                    with open(os.path.join(HERE, "published.log"), "a") as f:
                        f.write(json.dumps([body[2:2 + tl].decode(), json.loads(body[2 + tl:]), bool(h & 1)]) + "\n")
                elif t == 12:
                    c.sendall(b"\xd0\x00")
                elif t == 14:
                    break
        except (EOFError, OSError):
            pass
        c.close()

    def loop():
        while True:
            c, _ = srv.accept()
            threading.Thread(target=handle, args=(c,), daemon=True).start()
    threading.Thread(target=loop, daemon=True).start()


if __name__ == "__main__":
    https(18443, H)      # UniFi OS
    https(18444, Classic)
    mqtt_broker(11883)
    # control via fifo-ish file commands
    ctl = os.path.join(HERE, "ctl.json")
    print("ready", flush=True)
    while True:
        time.sleep(0.3)
        if os.path.exists(ctl):
            try:
                cmd = json.load(open(ctl))
            except ValueError:
                continue
            os.remove(ctl)
            if cmd["do"] == "ws":
                for s in list(STATE["ws_clients"]): s(json.dumps(cmd["msg"]))
            elif cmd["do"] == "set_active":
                STATE["active"] = cmd["active"]
            elif cmd["do"] == "expire":
                globals()["TOKEN"] = "jwt-new"
                for s in list(STATE["ws_clients"]): pass
            print("done", cmd["do"], "logins=", STATE["logins"], flush=True)
