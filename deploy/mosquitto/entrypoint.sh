#!/bin/sh
# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : broker Cloud – back-end & IoT
#  Fichier   : deploy/mosquitto/entrypoint.sh
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-02          Modifié le : 2026-11-05          Version : 1.2
#  Rôle      : génère les comptes (mots de passe hachés) et l'ACL à partir des variables
#              d'environnement, puis lance Mosquitto.
#  v1.1      : compte observateur optionnel (MQTT_OBSERVER_PASSWORD).
#  v1.2      : un compte par passerelle (GATEWAY_ACCOUNTS), limité à SES stations et à SES
#              événements ; ACL copiée dans /mosquitto/data avec des droits stricts.
#
#  GATEWAY_ACCOUNTS : passerelles séparées par « ; », champs séparés par « | » :
#      <id-passerelle>|<mot de passe>|<code station> <code station> ...
#      ex. "gw-ariana-01|s3cr3t|underpass-01 wadi-01;gw-tunis-01|autre|tunnel-01"
#  Une entrée sans mot de passe est ignorée (le compte n'est pas créé).
# =============================================================================
set -e
PW=/mosquitto/data/passwd
ACL=/mosquitto/data/acl
KINDS_UP="telemetry heartbeat state status ack td"   # messages montants (contrat du middleware)
KINDS_DOWN="cmd config"                               # messages descendants

rm -f "$PW"
mosquitto_passwd -b -c "$PW" "${MQTT_API_USERNAME:-floodwatch-api}" "${MQTT_API_PASSWORD:?MQTT_API_PASSWORD required}"
mosquitto_passwd -b "$PW" "${MQTT_GATEWAY_USERNAME:-gateway}" "${MQTT_GATEWAY_PASSWORD:?MQTT_GATEWAY_PASSWORD required}"
# Compte observateur en lecture seule (optionnel)
if [ -n "${MQTT_OBSERVER_PASSWORD:-}" ]; then
  mosquitto_passwd -b "$PW" observer "$MQTT_OBSERVER_PASSWORD"
fi

# ACL de base du dépôt, puis une section par passerelle déclarée
cp /mosquitto/config/acl "$ACL"
accounts=""
OLD_IFS=$IFS
IFS=';'
for entry in ${GATEWAY_ACCOUNTS:-}; do
  IFS=$OLD_IFS
  gw=$(echo "$entry" | cut -d'|' -f1 | tr -d ' ')
  pass=$(echo "$entry" | cut -d'|' -f2)
  stations=$(echo "$entry" | cut -d'|' -f3)
  if [ -z "$gw" ] || [ -z "$pass" ]; then
    IFS=';'
    continue
  fi
  case "$gw" in
    *[!a-z0-9-]*) echo "[mosquitto] identifiant de passerelle invalide : $gw" >&2; exit 1 ;;
  esac
  for st in $stations; do
    case "$st" in
      *[!a-z0-9-]*) echo "[mosquitto] code de station invalide pour $gw : $st" >&2; exit 1 ;;
    esac
  done
  mosquitto_passwd -b "$PW" "$gw" "$pass"
  {
    echo ""
    echo "# Passerelle $gw (générée au démarrage depuis GATEWAY_ACCOUNTS) : ses stations uniquement"
    echo "user $gw"
    for st in $stations; do
      for k in $KINDS_UP; do echo "topic write floodwatch/stations/$st/$k"; done
      for k in $KINDS_DOWN; do echo "topic read floodwatch/stations/$st/$k"; done
    done
    echo "topic write floodwatch/gateways/$gw/#"
  } >> "$ACL"
  accounts="$accounts $gw[$stations]"
  IFS=';'
done
IFS=$OLD_IFS

chown mosquitto:mosquitto "$PW" "$ACL" /mosquitto/data
chmod 0700 "$PW"
chmod 0600 "$ACL"
echo "[mosquitto] comptes passerelles dédiés :${accounts:- aucun}"
exec mosquitto -c /mosquitto/config/mosquitto.conf
