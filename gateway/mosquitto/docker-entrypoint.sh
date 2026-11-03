#!/bin/sh
# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : passerelle – back-end & IoT
#  Fichier   : gateway/mosquitto/docker-entrypoint.sh
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03          Version : 1.0
#  Rôle      : démarrage du broker local (conteneur mosquitto-local) :
#              1. valide les variables d'environnement (arrêt si un secret manque) ;
#              2. génère les mots de passe hachés : gateway, diag, une entrée par station ;
#              3. copie l'ACL du dépôt avec des droits stricts (un fichier monté depuis
#                 Windows est lisible par tous, ce que Mosquitto refuse à terme) ;
#              4. lance Mosquitto.
#  Variables : LOCAL_GATEWAY_PASSWORD, LOCAL_DIAG_PASSWORD, STATION_PASSWORD,
#              STATION_CODES (ex. "underpass-01 wadi-01")
# =============================================================================
set -eu
CONF_DIR=${CONF_DIR:-/gateway-config}
DATA=/mosquitto/data

# Vérifie qu'une variable obligatoire est définie (configuration validée au démarrage).
missing=""
for var in LOCAL_GATEWAY_PASSWORD LOCAL_DIAG_PASSWORD STATION_PASSWORD STATION_CODES; do
    eval "value=\${$var:-}"
    [ -n "$value" ] || missing="$missing $var"
done
if [ -n "$missing" ]; then
    echo "[mosquitto-local] configuration invalide, variables manquantes :$missing (voir deploy/.env.example)" >&2
    exit 1
fi

PW="$DATA/passwd"
: > "$PW.new"
chmod 0600 "$PW.new"
mosquitto_passwd -b "$PW.new" gateway "$LOCAL_GATEWAY_PASSWORD"
mosquitto_passwd -b "$PW.new" diag "$LOCAL_DIAG_PASSWORD"
for station in $STATION_CODES; do
    mosquitto_passwd -b "$PW.new" "$station" "$STATION_PASSWORD"
done
mv "$PW.new" "$PW"
cp "$CONF_DIR/floodwatch.acl" "$DATA/acl"
chown mosquitto:mosquitto "$DATA" "$PW" "$DATA/acl"
chmod 0600 "$DATA/acl"
echo "[mosquitto-local] comptes : gateway diag $STATION_CODES"
exec mosquitto -c "$CONF_DIR/mosquitto-docker.conf"
