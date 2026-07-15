#!/bin/sh

# To use important variables from command line use the following code:
COMMAND=$0    # Zero argument is shell command
PTEMPDIR=$1   # First argument is temp folder during install
PSHNAME=$2    # Second argument is Plugin-Name for scipts etc.
PDIR=$3       # Third argument is Plugin installation folder
PVERSION=$4   # Forth argument is Plugin version
#LBHOMEDIR=$5 # Comes from /etc/environment now. Fifth argument is
              # Base folder of LoxBerry
PTEMPPATH=$6  # Sixth argument is full temp path during install (see also $1)

# Combine them with /etc/environment
PHTMLAUTH=$LBHOMEDIR/webfrontend/htmlauth/plugins/$PDIR
PHTML=$LBPHTML/$PDIR
PTEMPL=$LBPTEMPL/$PDIR
PDATA=$LBPDATA/$PDIR
PLOGS=$LBPLOG/$PDIR # Note! This is stored on a Ramdisk now!
PCONFIG=$LBPCONFIG/$PDIR
PSBIN=$LBPSBIN/$PDIR
PBIN=$LBPBIN/$PDIR

run_as_loxberry() {
    CMD="$1"
    if [ "$(id -u)" -eq 0 ]; then
        if command -v runuser >/dev/null 2>&1; then
            runuser -u loxberry -- sh -c "$CMD"
        else
            su -s /bin/sh loxberry -c "$CMD"
        fi
    else
        sh -c "$CMD"
    fi
}

echo "<INFO> installing bin dependencies"
npm --prefix $PBIN ci --only=production

echo "<INFO> Ensure plugin config/data folders"
mkdir -p "$PCONFIG" "$PDATA"
if [ ! -f "$PCONFIG/unifi.json" ] && [ -f "$PBIN/../config/unifi.json" ]; then
    cp -p "$PBIN/../config/unifi.json" "$PCONFIG/unifi.json"
fi
if [ ! -f "$PCONFIG/mqtt_subscriptions.cfg" ] && [ -f "$PBIN/../config/mqtt_subscriptions.cfg" ]; then
    cp -p "$PBIN/../config/mqtt_subscriptions.cfg" "$PCONFIG/mqtt_subscriptions.cfg"
fi
chown -R loxberry:loxberry "$PCONFIG" "$PDATA"

echo "<INFO> Preparing plugin log files"
mkdir -p "$PLOGS"
touch "$PLOGS/unifi-presence.log" "$PLOGS/unifi-presence-error.log"
chown -R loxberry:loxberry "$PLOGS"
echo "$(date '+%Y-%m-%dT%H:%M:%S%z') postinstall: preparing first service start" >> "$PLOGS/unifi-presence.log"

echo "<INFO> Sync frontend to classic webroot"
mkdir -p $PHTML
cp -p -v -r $PHTMLAUTH/* $PHTML/

echo "<INFO> Start Event App in background"
run_as_loxberry "pkill -f '/plugins/${PDIR}/index.js' >>$PLOGS/unifi-presence.log 2>>$PLOGS/unifi-presence-error.log || true"
run_as_loxberry "nohup env NODE_ENV=production npm --prefix $PBIN start >>$PLOGS/unifi-presence.log 2>>$PLOGS/unifi-presence-error.log &"

exit 0;