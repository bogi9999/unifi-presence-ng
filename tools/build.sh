#!/bin/bash
# Baut das installierbare Plugin-ZIP: dist/Unifi-PresenceNG-<version>.zip
set -e
cd "$(dirname "$0")/.."
VERSION=$(sed -n 's/^VERSION=//p' plugin.cfg | head -1)
NAME="unifi-presence-ng-$VERSION"
rm -rf dist && mkdir -p "dist/$NAME"
cp -a bin config cron daemon dpkg icons templates uninstall webfrontend \
      plugin.cfg postinstall.sh preupgrade.sh postupgrade.sh Readme.md Readme.en.md CHANGELOG.md CHANGELOG.en.md "dist/$NAME/"
find "dist/$NAME" -name __pycache__ -prune -exec rm -rf {} +
chmod +x "dist/$NAME"/bin/*.sh "dist/$NAME"/bin/*.py "dist/$NAME"/*.sh "dist/$NAME"/daemon/daemon \
         "dist/$NAME"/uninstall/uninstall "dist/$NAME"/cron/cron.05min
(cd dist && zip -qr -X "Unifi-PresenceNG-$VERSION.zip" "$NAME" && rm -rf "$NAME")
echo "dist/Unifi-PresenceNG-$VERSION.zip"
