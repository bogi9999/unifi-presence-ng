#!/bin/bash
# Unifi-PresenceNG – Dienststeuerung
# Aufruf: service.sh start|stop|restart|status|watchdog

PLUGIN=unifi_presenceng
if [ -z "$LBHOMEDIR" ] && [ -r /etc/environment ]; then
  set -a; . /etc/environment 2>/dev/null; set +a
fi
LBHOMEDIR=${LBHOMEDIR:-REPLACELBHOMEDIR}
export LBHOMEDIR

BIN="$LBHOMEDIR/bin/plugins/$PLUGIN/unifi_presenceng.py"
DATA="$LBHOMEDIR/data/plugins/$PLUGIN"
LOGDIR="$LBHOMEDIR/log/plugins/$PLUGIN"
PIDFILE="$DATA/daemon.pid"

# Als root (Systemstart / Uninstall) immer als Benutzer loxberry ausführen
if [ "$(id -u)" = "0" ]; then
  exec su loxberry -s /bin/bash -c "LBHOMEDIR='$LBHOMEDIR' /bin/bash '$0' '$1'"
fi

find_pids() {
  pgrep -u "$(id -u)" -f "unifi_presenceng.py daemon" 2>/dev/null
}

is_running() {
  [ -n "$(find_pids)" ]
}

do_start() {
  if is_running; then
    echo "Unifi-Presence NG is already running (PID $(find_pids | tr '\n' ' '))"
    return 0
  fi
  if ! command -v python3 >/dev/null 2>&1; then
    echo "ERROR: python3 is not installed" >&2
    return 1
  fi
  mkdir -p "$DATA" "$LOGDIR"
  setsid nohup python3 -u "$BIN" daemon >> "$LOGDIR/daemon_stdout.log" 2>&1 < /dev/null &
  echo $! > "$PIDFILE"
  sleep 1
  if is_running; then
    echo "Unifi-Presence NG started (PID $(cat "$PIDFILE"))"
  else
    echo "ERROR: start failed - see $LOGDIR" >&2
    tail -n 20 "$LOGDIR/daemon_stdout.log" 2>/dev/null >&2
    return 1
  fi
}

do_stop() {
  local pids
  pids=$(find_pids)
  if [ -z "$pids" ]; then
    rm -f "$PIDFILE"
    echo "Unifi-Presence NG is not running"
    return 0
  fi
  kill $pids 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    sleep 0.5
    is_running || break
  done
  pids=$(find_pids)
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null
  rm -f "$PIDFILE"
  echo "Unifi-Presence NG stopped"
}

case "$1" in
  start)    do_start ;;
  stop)     do_stop ;;
  restart)  do_stop; do_start ;;
  status)
    if is_running; then echo "running"; exit 0; else echo "stopped"; exit 3; fi ;;
  watchdog)
    # nur starten, wenn das Plugin installiert ist und der Dienst nicht läuft
    [ -f "$BIN" ] || exit 0
    is_running || do_start ;;
  *)
    echo "Usage: $0 {start|stop|restart|status|watchdog}"
    exit 2 ;;
esac
