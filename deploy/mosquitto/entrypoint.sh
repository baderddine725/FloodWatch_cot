#!/bin/sh
# Génère le fichier de mots de passe à partir des variables d'environnement puis lance Mosquitto.
set -e
PW=/mosquitto/data/passwd
rm -f "$PW"
mosquitto_passwd -b -c "$PW" "${MQTT_API_USERNAME:-floodwatch-api}" "${MQTT_API_PASSWORD:?MQTT_API_PASSWORD required}"
mosquitto_passwd -b "$PW" "${MQTT_GATEWAY_USERNAME:-gateway}" "${MQTT_GATEWAY_PASSWORD:?MQTT_GATEWAY_PASSWORD required}"
# Compte observateur en lecture seule (optionnel, ajouté en v1.1 – Ksontini Amine)
if [ -n "${MQTT_OBSERVER_PASSWORD:-}" ]; then
  mosquitto_passwd -b "$PW" observer "$MQTT_OBSERVER_PASSWORD"
fi
chown mosquitto:mosquitto "$PW" /mosquitto/data
chmod 0700 "$PW"
exec mosquitto -c /mosquitto/config/mosquitto.conf
