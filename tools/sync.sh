#!/bin/bash
# Überträgt die Version aus release.cfg in plugin.cfg, Dienst und Weboberfläche,
# setzt weitere plugin.cfg-Werte aus tools/plugin-meta.cfg und erzeugt die Icon-PNGs
# aus icons/src/icon.svg (wenn rsvg-convert vorhanden ist).
set -e
cd "$(dirname "$0")/.."
V=$(sed -n 's/^VERSION=//p' release.cfg | head -1)
[ -n "$V" ] || { echo "Keine VERSION in release.cfg"; exit 1; }
sed -i "s/^VERSION=.*/VERSION=$V/" plugin.cfg
sed -i "s/^VERSION = \".*\"/VERSION = \"$V\"/" bin/unifi_presenceng.py
sed -i "s/^const UPNG_VERSION = '.*';/const UPNG_VERSION = '$V';/" webfrontend/htmlauth/ajax.php
sed -i "s/^\$v = '.*';/\$v = '$V';/" webfrontend/htmlauth/index.php
if [ -f tools/plugin-meta.cfg ]; then
  grep -E '^[A-Z_]+=' tools/plugin-meta.cfg | while IFS='=' read -r K VAL; do
    [ "$K" = "VERSION" ] && continue
    VAL_ESC=$(printf '%s' "$VAL" | sed 's/[\/&]/\\&/g')
    sed -i "s/^$K=.*/$K=$VAL_ESC/" plugin.cfg
  done
fi
if [ -f icons/src/icon.svg ] && command -v rsvg-convert >/dev/null; then
  for s in 64 128 256 512; do rsvg-convert -w "$s" -h "$s" icons/src/icon.svg -o "icons/icon_$s.png"; done
fi
echo "$V"
