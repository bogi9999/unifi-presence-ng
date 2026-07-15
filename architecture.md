# Unifi Presence NG Architecture (4.0.0-alpha1)

## Milestone 0 Analyse (Stand)

- Projektbasis aus `unifi-presence` in neues Repo `unifi-presence-ng` uebernommen.
- Kernkopplungen gefunden:
  - Externes Express-Plugin ueber `webfrontend/htmlauth/express/*`
  - PM2-Prozesssteuerung ueber `bin/package.json` und Upgrade/Uninstall-Skripte
  - Frontend-API-Pfade fest auf `/admin/express/plugins/unifi_presence/api/*`
- MQTT bisher hart an LoxBerry-Globalconfig (`general.json -> Mqtt`) gebunden.

## Milestone 1 Stabilitaet (umgesetzt in alpha1)

- Externes Express-Plugin entfernt:
  - Integrierter HTTP- und WebSocket-Server laeuft direkt im Prozess `bin/index.js`
  - Endpunkte:
    - `GET /api/health`
    - `GET /api/config`
    - `PUT /api/config`
    - `GET /api/stats`
    - `GET /api/clients`
    - `GET /api/sites`
    - `POST /api/restartService`
  - WebSocket:
    - `/api/socket`
- PM2 entfernt:
  - `bin/package.json` startet direkt mit `node index.js`
  - Upgrade-/Uninstall-Skripte stoppen Prozess via `pkill`
- GUI auf neue API-Basis umgestellt:
  - API und Socket URLs dynamisch ueber `app/utils/apiBase.js`
- Logging/Fehler:
  - HTTP-Layer liefert weiterhin 403/408/499 fuer bekannte Fehlerbilder
  - `GET /api/health` fuer schnellen Health-Check

## Laufzeit-Kompatibilitaet

- Node/npm Engines:
  - `node >=22.4.1 <27`
  - `npm >=10.8.1 <12`
- Zielplattformen:
  - LoxBerry 3 (Bookworm): Node 22.4.1 / npm 10.8.1
  - LoxBerry 4 (Trixie): Node 26.4.0 / npm 11.17.0
- CI-Matrix:
  - Node 22
  - Node 26

## MQTT (wichtig, umgesetzt)

- Neue Betriebsarten in `config/unifi.json`:
  - `mqttMode = loxberry` (Default)
  - `mqttMode = custom`
- Bei `custom` werden folgende Felder genutzt:
  - `mqttHost`
  - `mqttPort`
  - `mqttUser`
  - `mqttPassword`
  - `mqttClientId`
- Implementierung in `bin/lib/Mqtt.js`.

## Zielstruktur fuer die naechsten Phasen

```text
src/
  api/
  controller/
    network8.js
    network9.js
    network10.js
    autodetect.js
  daemon/
  gui/
  health/
  logger/
  presence/
  routes/
  server/
  services/
  utils/
  websocket/
  tests/
docs/
```

## Milestone 2+ (geplant)

- Controller-Layer statt Versions-`if`:
  - AutoDetect + Adapter fuer Network 8/9/10
- Presence Engine als klares Datenmodell:
  - MAC, connected/disconnected, AP, RSSI, SSID, lastSeen
- GUI 4.x:
  - Live Events
  - Live Devices
  - API Test
  - Controller Status
  - Health Check
  - Reconnect Button
  - Log Viewer
- Simulation Mode (Beispiel-Events)
- Tests modernisieren und auf neue API/WebSocket-Schicht heben

## Branching Vorschlag

- `main`
- `develop`
- `release/*`
- `feature/*`
- `hotfix/*`
