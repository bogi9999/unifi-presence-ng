# Testumgebung

`fake_env.py` simuliert einen UniFi-Controller (UniFi OS mit Network 10.x auf Port 18443,
klassisch auf 18444) und einen MQTT-Broker (Port 11883).

```bash
cd tests
openssl req -x509 -newkey rsa:2048 -nodes -keyout key.pem -out cert.pem -days 30 -subj /CN=unifi
python3 fake_env.py 10.0.160 &
mkdir -p dev/config dev/data dev/log
echo '{"Mqtt":{"Brokerhost":"127.0.0.1","Brokerport":"11883","Brokeruser":"u","Brokerpass":"p"}}' > dev/general.json
echo '{"ipaddress":"127.0.0.1","port":18443,"username":"admin","password":"secret",
 "clients":[{"mac":"aa:bb:cc:00:00:01","name":"Handy","type":"WIRELESS"}]}' > dev/config/unifi.json
export UPNG_DEVDIR=$PWD/dev
python3 ../bin/unifi_presenceng.py cli login
python3 ../bin/unifi_presenceng.py daemon --foreground
```

Events einspielen: `echo '{"do":"ws","msg":{"meta":{"message":"events"},"data":[{"key":"EVT_WU_Disconnected","user":"aa:bb:cc:00:00:01"}]}}' > ctl.json`
Veröffentlichte MQTT-Nachrichten landen in `published.log`.
