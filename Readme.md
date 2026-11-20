# Unifi-PresenceNG (LoxBerry Plugin)

Anwesenheitserkennung über den UniFi Network Controller – Ausgabe per MQTT für Loxone.
Weiterentwicklung von „Unifi Presence“ 3.0.1 (Lox Your Life).

## Was ist neu gegenüber Unifi Presence 3.x

* **Kein Express-Server, kein Node.js, kein npm** – Hintergrunddienst in Python 3 (nur Standardbibliothek),
  Weboberfläche in PHP. Läuft auf **LoxBerry 3 (Debian 12)** und **LoxBerry 4 (Debian 13 „Trixie“)**.
* **Automatische Controller-Erkennung**: UniFi OS Konsolen (Port 443), **UniFi OS Server (Port 11443)**
  und klassische Network Application (Port 8443). Eigener Port ist weiterhin möglich.
* **Network 9.x / 10.x** werden unterstützt – die Versionsprüfung vergleicht jetzt numerisch
  (im alten Plugin war `"10.0.x" < "6.4.54"` als Text-Vergleich wahr und hat den Controller abgelehnt).
* Live-Events per WebSocket **plus** regelmäßiger Abgleich mit der Liste aktiver Clients
  (Offline-Erkennung auch, wenn ein Event verloren geht).
* Fehler im alten Event-Handling behoben (WLAN-„Connected“-Events wurden nie ausgewertet).
* **MQTT Broker wählbar**: LoxBerry-Broker aus den Systemeinstellungen oder eigener Broker
  (Adresse, Port, Benutzer, Passwort, optional TLS).
* Optional: MQTT „retained“, eigener MQTT-Name je Gerät, Geräte per MAC manuell hinzufügen, Log-Ansicht.
* Einstellungen aus „Unifi Presence“ werden bei der Installation automatisch übernommen.

## MQTT

Je überwachtem Gerät wird `<Topic>/<Name>` als JSON gesendet, z. B. `UniFi/clients/Handy-Ralf`:

```json
{"name":"Handy Ralf","mac":"aa:bb:cc:00:00:01","type":"WIRELESS","ip":"192.168.1.50",
 "ssid":"Home","experience":97,"signalDbm":-55,"signalPercentage":73,"connected":true,
 "ap":{"name":"AP Wohnzimmer","mac":"11:22:33:44:55:66"},"since":"2026-11-20T17:23:10"}
```

Die Felder sind kompatibel zum alten Plugin (neu ist nur `since`). Das MQTT Gateway von LoxBerry
zerlegt das JSON, z. B. in `UniFi_clients_Handy-Ralf_connected`.

## Installation

LoxBerry → Plugin-Verwaltung → ZIP aus den [Releases](https://github.com/bogi9999/unifi-presence-ng/releases)
hochladen (oder URL des ZIPs eintragen). Updates kommen danach automatisch über `release.cfg`.

## Hinweise

* Am besten einen lokalen UniFi-Benutzer ohne 2FA anlegen. 2FA wird unterstützt (Code in den Einstellungen
  eingeben), dann muss nach Ablauf der Sitzung aber erneut ein Code eingegeben werden.
* Das alte Plugin „Unifi Presence“ und den „Express Server“ bitte deinstallieren.
* Log: `log/plugins/unifi_presenceng/unifi_presenceng.log` (auch in der Weboberfläche unter „Log“).
* Dienst manuell: `bin/plugins/unifi_presenceng/service.sh start|stop|restart|status`

## Dateien

| Pfad | Zweck |
|---|---|
| `bin/unifi_presenceng.py` | Hintergrunddienst + CLI (UniFi-API, WebSocket, MQTT) |
| `bin/service.sh` | Start/Stopp/Watchdog |
| `webfrontend/htmlauth/` | Weboberfläche (`index.php`, `ajax.php`, `app.js`, `style.css`) |
| `daemon/daemon` | Start beim Booten |
| `cron/cron.05min` | Watchdog |
| `tools/check.sh`, `tools/build.sh` | Syntaxprüfung, ZIP bauen |
| `tests/fake_env.py` | simulierter Controller + MQTT-Broker |

## Release erstellen

1. Version in `plugin.cfg`, `bin/unifi_presenceng.py` (`VERSION`), `release.cfg`/`prerelease.cfg` und `CHANGELOG.md` anpassen
2. auf `main` pushen
3. Der Workflow prüft, baut `Unifi-PresenceNG-<Version>.zip` und legt Tag + Release an, falls es die Version noch nicht gibt.

## Lizenz / Herkunft

Basiert auf [LoxYourLife/unifi-presence](https://github.com/LoxYourLife/unifi-presence) von Ronald Marske (ISC).
Der Code wurde für die NG-Version vollständig neu geschrieben.
