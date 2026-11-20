## 4.3.1 (2026-11-20)

* Umschalter Hell/Dunkel vervollständigt (in 4.3.0 fehlte er noch, die Oberfläche blieb hell)

## 4.3.0 (2026-11-20)

* Neuer Anzeigename „Unifi-Presence NG“ und neues Icon
* Dunkles Design (Standard), umschaltbar Dunkel / Hell / wie System über den Knopf im Statuskopf – die Wahl wird im Browser gespeichert

## 4.2.0 (2026-11-20)

* Neues Design: Statuskopf mit Kennzahlen, Anwesenheitsübersicht, einklappbare Abschnitte, Umschalter, Speichern-Leiste nur bei Änderungen
* Sammelwerte per MQTT (`UniFi/presence`): jemand zu Hause, Anzahl anwesender Personen, Gruppen (z. B. Familie, Gäste)
* Geräte: Schalter „Person“ (zählt für jemand zu Hause) und Gruppe je Gerät
* Neuer Tab „Loxone“: Namen der virtuellen Eingänge (HTTP) bzw. Befehlserkennungen (UDP) mit Kopierfunktion, Download einer Vorlage für einen virtuellen UDP-Eingang
* Sicherung: Einstellungen als passwortgeschützte Datei exportieren und wieder importieren (AES-256-GCM)
* Hinweis auf neue Versionen (Release/Prerelease) im Statuskopf

## 4.1.0 (2026-11-20)

* MQTT Broker wählbar: LoxBerry-Broker (Systemeinstellungen) oder eigener Broker (Adresse, Port, Benutzer, Passwort, optional TLS)
* „MQTT testen“ prüft die aktuell eingegebenen Werte, Status zeigt den verwendeten Broker
* Keine hartkodierten /opt/loxberry-Pfade mehr (Installer-Warnung behoben)
* Übernahme der Einstellungen auch aus den 4.0.0-rc-Versionen (`unifi_presence_ng`)
* Automatische Updates über GitHub-Releases

## 4.0.0 – Unifi-PresenceNG (2026-11-20)

* Umbenannt in Unifi-PresenceNG (Plugin-Ordner `unifi_presenceng`)
* Express-Server, Node.js, pm2 und npm entfernt – Python-3-Dienst ohne Abhängigkeiten, PHP-Weboberfläche
* Lauffähig auf LoxBerry 3 (Debian 12) und LoxBerry 4 (Debian 13 Trixie)
* Automatische Controller-Erkennung: UniFi OS (443), UniFi OS Server (11443), klassisch (8443)
* Unterstützung für UniFi Network 9.x und 10.x (numerischer Versionsvergleich)
* Abgleich der aktiven Clients zusätzlich zu den WebSocket-Events
* Fix: WLAN-Connected-Events wurden nicht ausgewertet
* Neu: retained-Option, MQTT-Alias je Gerät, manuelles Hinzufügen per MAC, Log-Ansicht, Watchdog
* Übernahme der Einstellungen aus Unifi Presence 3.x

## 3.0.1 (2023-04-01) – Unifi Presence (Lox Your Life)

* letzte Version des Original-Plugins
