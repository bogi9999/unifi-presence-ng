#!/bin/bash
# Syntaxprüfung aller Bestandteile
set -e
cd "$(dirname "$0")/.."
python3 -m py_compile bin/unifi_presenceng.py
for f in webfrontend/htmlauth/*.php; do php -l "$f" >/dev/null; done
node --check webfrontend/htmlauth/app.js
for f in bin/service.sh postinstall.sh preupgrade.sh postupgrade.sh daemon/daemon uninstall/uninstall cron/cron.05min; do bash -n "$f"; done
for f in templates/lang/*.ini; do php -r "exit(is_array(parse_ini_file('$f', true, INI_SCANNER_RAW)) ? 0 : 1);"; done
V=$(sed -n 's/^VERSION=//p' plugin.cfg | head -1)
grep -q "VERSION = \"$V\"" bin/unifi_presenceng.py || { echo "Version in unifi_presenceng.py != $V"; exit 1; }
grep -q "VERSION=$V" release.cfg || { echo "release.cfg != $V"; exit 1; }
grep -q "UPNG_VERSION = '$V'" webfrontend/htmlauth/ajax.php || { echo "Version in ajax.php != $V"; exit 1; }
grep -q "\$v = '$V'" webfrontend/htmlauth/index.php || { echo "Version in index.php != $V"; exit 1; }
LBPATH="/opt/""loxberry"
if grep -rn "$LBPATH" bin webfrontend daemon uninstall cron ./*.sh ; then
  echo "Hartkodierter LoxBerry-Pfad gefunden"; exit 1
fi
echo "Alles OK ($V)"
