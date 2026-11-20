# Unifi-Presence NG (LoxBerry Plugin)

[Deutsch](Readme.md) · **English**

Presence detection via the UniFi Network controller – published via MQTT for Loxone.
Successor of "Unifi Presence" 3.0.1 (Lox Your Life).

Documentation: [LoxBerry wiki](https://wiki.loxberry.de/en/plugins/unifi_presence_ng/start) ([Deutsch](https://wiki.loxberry.de/plugins/unifi_presence_ng/start)) · Changelog: [English](CHANGELOG.en.md) / [Deutsch](CHANGELOG.md)

## What's new compared to Unifi Presence 3.x

* **No Express server, no Node.js, no npm** – background service in Python 3 (standard library only),
  web interface in PHP. Runs on **LoxBerry 3 (Debian 12)** and **LoxBerry 4 (Debian 13 "Trixie")**.
* **Automatic controller detection**: UniFi OS consoles (port 443), **UniFi OS Server (port 11443)**
  and the classic Network Application (port 8443). A custom port is still possible.
* **Network 9.x, 10.x and 11.x** are supported – the version check now compares numerically
  (in the old plugin `"10.0.x" < "6.4.54"` was true as a string comparison and the controller was rejected).
* Live events via WebSocket **plus** regular reconciliation with the list of active clients
  (offline detection works even if an event gets lost).
* Bug in the old event handling fixed (WiFi "connected" events were never evaluated).
* **Selectable MQTT broker**: the LoxBerry broker from the system settings or a custom broker
  (address, port, user, password, optional TLS).
* **Summary values**: `UniFi/presence` with `anyone`, `count`, `total` and groups (e.g. family, guests).
* **Loxone tab**: names of the virtual inputs or UDP command recognitions to copy, template for a virtual UDP input.
* **Backup**: export the settings password-protected (AES-256-GCM) and import them on another LoxBerry.
* **Light/dark**: dark design by default, switchable in the status header.
* Interface in **German and English** (follows the LoxBerry language), log in English.
* Optional: MQTT "retained", custom MQTT name per device, add devices manually by MAC, log view.
* Settings of "Unifi Presence" are migrated automatically during installation.

## MQTT

For every watched device `<topic>/<name>` is published as JSON, e.g. `UniFi/clients/Phone-Ralf`:

```json
{"name":"Phone Ralf","mac":"aa:bb:cc:00:00:01","type":"WIRELESS","ip":"192.168.1.50",
 "ssid":"Home","experience":97,"signalDbm":-55,"signalPercentage":73,"connected":true,
 "ap":{"name":"AP Living room","mac":"11:22:33:44:55:66"},"since":"2026-11-20T17:23:10"}
```

The fields are compatible with the old plugin (only `since` is new). The LoxBerry MQTT gateway
splits the JSON, e.g. into `UniFi_clients_Phone-Ralf_connected`.

Summary values (topic configurable, empty = off), e.g. `UniFi/presence`:

```json
{"anyone":true,"count":2,"total":3,"present":"Anja, Ralf","since":"2026-11-20T19:18:44",
 "groups":{"Family":{"name":"Family","anyone":true,"count":2,"total":3,"present":"Anja, Ralf"}}}
```

Devices with the "Person" switch count as people (default: WiFi yes, LAN no). Groups are set per device,
several separated by commas. The gateway turns this into e.g. `UniFi_presence_anyone` and
`UniFi_presence_groups_Family_count`.

## Installation

LoxBerry → Plugin management → upload the ZIP from the [releases](https://github.com/bogi9999/unifi-presence-ng/releases)
(or enter the URL of the ZIP). Updates are then delivered automatically via `release.cfg`.

## Notes

* Preferably create a local UniFi user without 2FA. 2FA is supported (enter the code in the settings),
  but a new code has to be entered whenever the session expires.
* Please uninstall the old plugin "Unifi Presence" and the "Express Server".
* Log: `log/plugins/unifi_presenceng/unifi_presenceng.log` (also in the web interface under "Log").
* Service manually: `bin/plugins/unifi_presenceng/service.sh start|stop|restart|status`

## Files

| Path | Purpose |
|---|---|
| `bin/unifi_presenceng.py` | Background service + CLI (UniFi API, WebSocket, MQTT) |
| `bin/service.sh` | Start/stop/watchdog |
| `webfrontend/htmlauth/` | Web interface (`index.php`, `ajax.php`, `lang.php`, `app.js`, `style.css`) |
| `templates/lang/`, `templates/help/` | Language files and help (German/English) |
| `daemon/daemon` | Start at boot |
| `cron/cron.05min` | Watchdog |
| `tools/sync.sh`, `tools/check.sh`, `tools/build.sh` | Transfer version, syntax check, build ZIP |
| `tests/fake_env.py` | Simulated controller + MQTT broker |

## Creating a release

1. Update the version in `release.cfg`/`prerelease.cfg` and add the entry to `CHANGELOG.md` and `CHANGELOG.en.md`
2. Push to `main`
3. The workflow transfers the version with `tools/sync.sh` into `plugin.cfg`, the service and the web interface, sets the title from
   `tools/plugin-meta.cfg`, renders the icons from `icons/src/icon.svg`,
   checks everything, builds `Unifi-PresenceNG-<version>.zip` and creates tag + release if the version does not exist yet.
   The release notes contain the German and the English changelog entry.

## License / origin

Based on [LoxYourLife/unifi-presence](https://github.com/LoxYourLife/unifi-presence) by Ronald Marske (ISC).
The code was completely rewritten for the NG version.
