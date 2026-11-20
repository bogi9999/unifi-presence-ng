#!/bin/bash
# Argumente: $1 Tempordner, $2 Plugin-Name, $3 Plugin-Ordner, $4 Version
PDIR=$3
LBHOMEDIR=${LBHOMEDIR:-REPLACELBHOMEDIR}
BACKUP=/tmp/${PDIR}_upgrade

if [ -d "$BACKUP" ]; then
  echo "<INFO> Restoring configuration and data"
  cp -p -r "$BACKUP/config/." "$LBHOMEDIR/config/plugins/$PDIR/" 2>/dev/null
  cp -p -r "$BACKUP/data/." "$LBHOMEDIR/data/plugins/$PDIR/" 2>/dev/null
  rm -rf "$BACKUP"
fi

echo "<INFO> Restarting service"
/bin/bash "$LBHOMEDIR/bin/plugins/$PDIR/service.sh" restart | sed 's/^/<INFO> /'
exit 0
