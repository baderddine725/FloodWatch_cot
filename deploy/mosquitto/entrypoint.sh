#!/bin/sh
# Génère le fichier de mots de passe à partir des variables d'environnement puis lance Mosquitto.
set -e
PW=/mosquitto/data/passwd
rm -f "$PW"
mosquitto_passwd -b -c "$PW" "${MQTT_API_USERNAME:-floodwatch-api}" "${MQTT_API_PASSWORD:?MQTT_API_PASSWORD required}"
mosquitto_passwd -b "$PW" "${MQTT_GATEWAY_USERNAME:-gateway}" "${MQTT_GATEWAY_PASSWORD:?MQTT_GATEWAY_PASSWORD required}"
chown mosquitto:mosquitto "$PW" /mosquitto/data
chmod 0700 "$PW"
exec mosquitto -c /mosquitto/config/mosquitto.conf
