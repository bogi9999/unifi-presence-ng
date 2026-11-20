#!/bin/bash
# Argumente: $1 Tempordner, $2 Plugin-Name, $3 Plugin-Ordner, $4 Version
PDIR=$3
LBHOMEDIR=${LBHOMEDIR:-REPLACELBHOMEDIR}
BACKUP=/tmp/${PDIR}_upgrade

echo "<INFO> Stoppe Dienst"
/bin/bash "$LBHOMEDIR/bin/plugins/$PDIR/service.sh" stop

echo "<INFO> Sichere Konfiguration und Daten nach $BACKUP"
rm -rf "$BACKUP"
mkdir -p "$BACKUP/config" "$BACKUP/data"
cp -p -r "$LBHOMEDIR/config/plugins/$PDIR/." "$BACKUP/config/" 2>/dev/null
cp -p -r "$LBHOMEDIR/data/plugins/$PDIR/." "$BACKUP/data/" 2>/dev/null
exit 0
