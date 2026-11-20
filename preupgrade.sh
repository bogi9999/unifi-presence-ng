#!/bin/bash
# Argumente: $1 Tempordner, $2 Plugin-Name, $3 Plugin-Ordner, $4 Version
PDIR=$3
LBHOMEDIR=${LBHOMEDIR:-REPLACELBHOMEDIR}
BACKUP=/tmp/${PDIR}_upgrade

echo "<INFO> Stopping service"
/bin/bash "$LBHOMEDIR/bin/plugins/$PDIR/service.sh" stop

echo "<INFO> Backing up configuration and data to $BACKUP"
rm -rf "$BACKUP"
mkdir -p "$BACKUP/config" "$BACKUP/data"
cp -p -r "$LBHOMEDIR/config/plugins/$PDIR/." "$BACKUP/config/" 2>/dev/null
cp -p -r "$LBHOMEDIR/data/plugins/$PDIR/." "$BACKUP/data/" 2>/dev/null
exit 0
