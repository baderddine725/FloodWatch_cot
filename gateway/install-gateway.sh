#!/usr/bin/env bash
# =============================================================================
#  FloodWatch – installation de la passerelle IoT sur Raspberry Pi OS (Bookworm)
#  Usage : sudo ./install-gateway.sh <CLOUD_HOST> <GATEWAY_ID> <GATEWAY_PASSWORD> <ca.crt>
#  Équipe FloodWatch – Ksontini Amine – v1.0 – 2026-11-02
# =============================================================================
set -euo pipefail
CLOUD_HOST=${1:?CLOUD_HOST}; GATEWAY_ID=${2:?GATEWAY_ID}; GATEWAY_PASSWORD=${3:?GATEWAY_PASSWORD}; CA=${4:?ca.crt}
HERE=$(cd "$(dirname "$0")" && pwd)

apt-get update
apt-get install -y mosquitto mosquitto-clients curl

# 1. Broker local + pont TLS vers le Cloud
install -d -m 755 /etc/mosquitto/certs
install -m 644 "$CA" /etc/mosquitto/certs/floodwatch-ca.crt
sed -e "s/CLOUD_HOST/$CLOUD_HOST/" -e "s/GATEWAY_ID/$GATEWAY_ID/g" -e "s/GATEWAY_PASSWORD/$GATEWAY_PASSWORD/" \
    "$HERE/mosquitto/floodwatch-gateway.conf" > /etc/mosquitto/conf.d/floodwatch-gateway.conf
install -m 644 "$HERE/mosquitto/floodwatch.acl" /etc/mosquitto/floodwatch.acl
if [ ! -f /etc/mosquitto/floodwatch.passwd ]; then
  touch /etc/mosquitto/floodwatch.passwd
  echo ">> Ajoutez un compte par station :  sudo mosquitto_passwd /etc/mosquitto/floodwatch.passwd underpass-01"
fi
chown mosquitto: /etc/mosquitto/floodwatch.passwd && chmod 600 /etc/mosquitto/floodwatch.passwd
systemctl enable --now mosquitto && systemctl restart mosquitto

# 2. Node-RED (script officiel) + flux FloodWatch
if ! command -v node-red >/dev/null; then
  bash <(curl -sL https://raw.githubusercontent.com/node-red/linux-installers/master/deb/update-nodejs-and-nodered) --confirm-install --confirm-pi
fi
USER_HOME=$(getent passwd "${SUDO_USER:-pi}" | cut -d: -f6)
install -d "$USER_HOME/.node-red"
install -m 644 "$HERE/node-red/flows.json" "$USER_HOME/.node-red/flows.json"
install -d /etc/systemd/system/nodered.service.d
cat > /etc/systemd/system/nodered.service.d/floodwatch.conf <<CONF
[Service]
Environment=GATEWAY_ID=$GATEWAY_ID
Environment=MQTT_LOCAL_HOST=127.0.0.1
Environment=MQTT_LOCAL_PORT=1884
Environment=MUTE_AFTER_SEC=45
CONF
chown -R "${SUDO_USER:-pi}": "$USER_HOME/.node-red"
systemctl daemon-reload && systemctl enable --now nodered.service && systemctl restart nodered.service
echo ">> Passerelle $GATEWAY_ID installée. Éditeur Node-RED : http://$(hostname -I | cut -d' ' -f1):1880"
