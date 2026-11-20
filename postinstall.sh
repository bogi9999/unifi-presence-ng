#!/bin/bash
# Argumente: $1 Tempordner, $2 Plugin-Name, $3 Plugin-Ordner, $4 Version
PDIR=$3
LBHOMEDIR=${LBHOMEDIR:-REPLACELBHOMEDIR}
PCONFIG=$LBHOMEDIR/config/plugins/$PDIR
PDATA=$LBHOMEDIR/data/plugins/$PDIR
PLOG=$LBHOMEDIR/log/plugins/$PDIR
PBIN=$LBHOMEDIR/bin/plugins/$PDIR

mkdir -p "$PDATA" "$PLOG"
chmod 600 "$PCONFIG/unifi.json" 2>/dev/null

if ! command -v python3 >/dev/null 2>&1; then
  echo "<FAIL> python3 wurde nicht gefunden – bitte 'apt install python3' ausführen"
  exit 2
fi
PYV=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
echo "<OK> Python $PYV gefunden – keine weiteren Abhängigkeiten nötig (kein Node.js / Express)"

echo "<INFO> Prüfe Übernahme der Einstellungen aus 'Unifi Presence'"
LBHOMEDIR=$LBHOMEDIR python3 "$PBIN/unifi_presenceng.py" migrate | sed 's/^/<INFO> /'

if [ -d "$LBHOMEDIR/bin/plugins/unifi_presence" ]; then
  echo "<WARNING> Das alte Plugin 'Unifi Presence' ist noch installiert. Bitte deinstallieren, sonst senden beide auf dieselben MQTT-Topics."
fi

echo "<INFO> Starte Dienst"
/bin/bash "$PBIN/service.sh" restart | sed 's/^/<INFO> /'
exit 0
