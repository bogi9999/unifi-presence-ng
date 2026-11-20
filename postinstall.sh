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
  echo "<FAIL> python3 not found - please run 'apt install python3'"
  exit 2
fi
PYV=$(python3 -c 'import sys; print("%d.%d" % sys.version_info[:2])')
echo "<OK> Python $PYV found - no further dependencies needed (no Node.js / Express)"

echo "<INFO> Checking for settings of 'Unifi Presence' to migrate"
LBHOMEDIR=$LBHOMEDIR python3 "$PBIN/unifi_presenceng.py" migrate | sed 's/^/<INFO> /'

if [ -d "$LBHOMEDIR/bin/plugins/unifi_presence" ]; then
  echo "<WARNING> The old plugin 'Unifi Presence' is still installed. Please uninstall it, otherwise both publish to the same MQTT topics."
fi

echo "<INFO> Starting service"
/bin/bash "$PBIN/service.sh" restart | sed 's/^/<INFO> /'
exit 0
