## 4.3.2 (2026-11-20)

* Localization completed: error messages of the web interface now come from the language files (German/English)
* Log, service error texts and installation messages in English (as usual for LoxBerry)
* Help in German and English, with a link to the wiki page

## 4.3.1 (2026-11-20)

* Light/dark switch completed (it was still missing in 4.3.0, the interface stayed light)

## 4.3.0 (2026-11-20)

* New display name "Unifi-Presence NG" and new icon
* Dark design (default), switchable dark / light / follow system via the button in the status header – the choice is stored in the browser

## 4.2.0 (2026-11-20)

* New design: status header with key figures, presence overview, collapsible sections, toggles, save bar only when something changed
* Summary values via MQTT (`UniFi/presence`): anyone home, number of people present, groups (e.g. family, guests)
* Devices: "Person" switch (counts for anyone home) and group per device
* New "Loxone" tab: names of the virtual inputs (HTTP) or command recognitions (UDP) with copy function, download of a template for a virtual UDP input
* Backup: export the settings as a password-protected file and import them again (AES-256-GCM)
* Notice about new versions (release/pre-release) in the status header

## 4.1.0 (2026-11-20)

* Selectable MQTT broker: LoxBerry broker (system settings) or custom broker (address, port, user, password, optional TLS)
* "Test MQTT" checks the values currently entered, the status shows the broker in use
* No more hard-coded /opt/loxberry paths (installer warning fixed)
* Settings are also migrated from the 4.0.0-rc versions (`unifi_presence_ng`)
* Automatic updates via GitHub releases

## 4.0.0 – Unifi-PresenceNG (2026-11-20)

* Renamed to Unifi-PresenceNG (plugin folder `unifi_presenceng`)
* Express server, Node.js, pm2 and npm removed – Python 3 service without dependencies, PHP web interface
* Runs on LoxBerry 3 (Debian 12) and LoxBerry 4 (Debian 13 Trixie)
* Automatic controller detection: UniFi OS (443), UniFi OS Server (11443), classic (8443)
* Support for UniFi Network 9.x and 10.x (numeric version comparison)
* Reconciliation of the active clients in addition to the WebSocket events
* Fix: WiFi connected events were not evaluated
* New: retained option, MQTT alias per device, add devices manually by MAC, log view, watchdog
* Settings are migrated from Unifi Presence 3.x

## 3.0.1 (2023-04-01) – Unifi Presence (Lox Your Life)

* Last version of the original plugin
