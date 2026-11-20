#!/bin/bash
# Argumente: $1 Tempordner, $2 Plugin-Name, $3 Plugin-Ordner, $4 Version
PDIR=$3
LBHOMEDIR=${LBHOMEDIR:-REPLACELBHOMEDIR}
BACKUP=/tmp/${PDIR}_upgrade

if [ -d "$BACKUP" ]; then
  echo "<INFO> Stelle Konfiguration und Daten wieder her"
  cp -p -r "$BACKUP/config/." "$LBHOMEDIR/config/plugins/$PDIR/" 2>/dev/null
  cp -p -r "$BACKUP/data/." "$LBHOMEDIR/data/plugins/$PDIR/" 2>/dev/null
  rm -rf "$BACKUP"
fi

echo "<INFO> Starte Dienst neu"
/bin/bash "$LBHOMEDIR/bin/plugins/$PDIR/service.sh" restart | sed 's/^/<INFO> /'
exit 0
