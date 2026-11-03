#!/usr/bin/env bash
# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : passerelle – back-end & IoT
#  Fichier   : gateway/install-gateway.sh
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-02          Modifié le : 2026-11-03          Version : 1.1
#  Rôle      : installation de la passerelle IoT sur Raspberry Pi OS (Bookworm).
#  Usage     : sudo ./install-gateway.sh <CLOUD_HOST> <GATEWAY_ID> <GATEWAY_PASSWORD> <ca.crt>
#  v1.1      : Node-RED relaie vers le Cloud (file d'attente, règle locale) ; pont Mosquitto désactivé.
#              Mot de passe de l'éditeur Node-RED : variable NODE_RED_ADMIN_PASSWORD (sinon aléatoire).
# =============================================================================
set -euo pipefail
CLOUD_HOST=${1:?CLOUD_HOST}; GATEWAY_ID=${2:?GATEWAY_ID}; GATEWAY_PASSWORD=${3:?GATEWAY_PASSWORD}; CA=${4:?ca.crt}
HERE=$(cd "$(dirname "$0")" && pwd)

apt-get update
apt-get install -y mosquitto mosquitto-clients curl openssl

# 1. Broker local (stations : comptes + ACL ; AC du Cloud pour Node-RED)
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

# 2. Node-RED (script officiel) + flux, réglages et registre des stations FloodWatch
if ! command -v node-red >/dev/null; then
  bash <(curl -sL https://raw.githubusercontent.com/node-red/linux-installers/master/deb/update-nodejs-and-nodered) --confirm-install --confirm-pi
fi
USER_NAME=${SUDO_USER:-pi}
USER_HOME=$(getent passwd "$USER_NAME" | cut -d: -f6)
GW_DIR=/opt/floodwatch-gateway
install -d "$GW_DIR/node-red" "$USER_HOME/.node-red"
install -m 644 "$HERE/node-red/flows.json" "$HERE/node-red/settings.js" "$GW_DIR/node-red/"
install -m 644 "$HERE/stations.json" "$GW_DIR/stations.json"
ADMIN_PW=${NODE_RED_ADMIN_PASSWORD:-$(openssl rand -hex 12)}
install -d /etc/systemd/system/nodered.service.d
cat > /etc/systemd/system/nodered.service.d/floodwatch.conf <<CONF
[Service]
Environment=GATEWAY_DIR=$GW_DIR
Environment=NODE_RED_USER_DIR=$USER_HOME/.node-red
Environment=GATEWAY_ID=$GATEWAY_ID
Environment=LOCAL_MQTT_HOST=127.0.0.1
Environment=LOCAL_MQTT_PORT=1884
Environment=CLOUD_MQTT_HOST=$CLOUD_HOST
Environment=CLOUD_MQTT_PORT=8883
Environment=CLOUD_MQTT_USER=gateway
Environment=CLOUD_MQTT_PASSWORD=$GATEWAY_PASSWORD
Environment=CLOUD_CA_FILE=/etc/mosquitto/certs/floodwatch-ca.crt
Environment=NODE_RED_ADMIN_PASSWORD=$ADMIN_PW
Environment=MUTE_AFTER_SEC=60
Environment=SAFETY_PCT=85
ExecStart=
ExecStart=/usr/bin/env node-red --settings $GW_DIR/node-red/settings.js
CONF
chmod 600 /etc/systemd/system/nodered.service.d/floodwatch.conf
chown -R "$USER_NAME": "$USER_HOME/.node-red"
systemctl daemon-reload && systemctl enable --now nodered.service && systemctl restart nodered.service
echo ">> Passerelle $GATEWAY_ID installée. Éditeur Node-RED : http://$(hostname -I | cut -d' ' -f1):1880 (admin / $ADMIN_PW)"
echo ">> Santé : curl http://localhost:1880/health"
