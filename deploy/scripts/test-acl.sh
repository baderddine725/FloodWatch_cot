#!/bin/sh
# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : brokers – back-end & IoT (tests)
#  Fichier   : deploy/scripts/test-acl.sh
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-05          Version : 1.2
#  Rôle      : vérifie la sécurité des deux brokers : authentification, ACL et TLS 1.3.
#              MQTT v5 : le broker répond explicitement « Not authorized » à une publication
#              interdite (en 3.1.1 il l'ignorerait en silence). Les tests de réception vérifient
#              la livraison réelle (Mosquitto accepte l'abonnement et filtre à la livraison).
#              Côté Cloud, les cas visent une station fictive « acl-test » : aucune fausse
#              commande n'est envoyée aux vraies stations.
#  Lancement : docker compose --profile iot up -d   puis
#              docker compose --profile test run --rm --build acl-test
# =============================================================================
set -u

LOCAL_HOST=${LOCAL_HOST:-mosquitto-local}
CLOUD_HOST=${CLOUD_HOST:-mosquitto}
CA=${CA:-/certs/ca.crt}
STATION=${STATION:-underpass-01}
OTHER=${OTHER:-wadi-01}
passed=0
failed=0

# Affiche le résultat d'un cas et met à jour les compteurs.
report() {
    expected=$1 actual=$2 label=$3
    if [ "$expected" = "$actual" ]; then
        passed=$((passed + 1)); echo "  OK      $label"
    else
        failed=$((failed + 1)); echo "  ÉCHEC   $label (attendu : $expected, obtenu : $actual)"
    fi
}

# Tente une publication QoS 1 (MQTT v5) et renvoie « autorisé » ou « refusé ».
# Usage : try_publish <hôte> <port> <utilisateur|-> <mot_de_passe> <topic> [options mosquitto_pub...]
try_publish() {
    host=$1 port=$2 user=$3 pass=$4 topic=$5
    shift 5
    if [ "$user" = "-" ]; then
        out=$(mosquitto_pub -V 5 -q 1 -h "$host" -p "$port" "$@" -t "$topic" -m "test-acl" 2>&1)
    else
        out=$(mosquitto_pub -V 5 -q 1 -h "$host" -p "$port" -u "$user" -P "$pass" "$@" -t "$topic" -m "test-acl" 2>&1)
    fi
    code=$?
    if [ $code -eq 0 ] && ! echo "$out" | grep -qi "not authori\|error\|refused"; then echo "autorisé"; else echo "refusé"; fi
}

# Vérifie qu'un abonné reçoit (ou non) un message publié par un compte autorisé.
# Usage : try_receive <hôte> <port> <abonné> <mdp> <filtre> <éditeur> <mdp> <topic> [options...]
try_receive() {
    host=$1 port=$2 user=$3 pass=$4 filter=$5 pub_user=$6 pub_pass=$7 topic=$8
    shift 8
    received=$(mktemp)
    # -R : ignore les messages retenus déjà présents. Le topic peut porter du trafic réel (simulateur) :
    # on écoute 4 s (jusqu'à 200 messages) et on cherche le message de test parmi eux.
    mosquitto_sub -h "$host" -p "$port" -u "$user" -P "$pass" "$@" -t "$filter" -R -C 200 -W 4 > "$received" 2>/dev/null &
    sub_pid=$!
    sleep 1
    mosquitto_pub -q 1 -h "$host" -p "$port" -u "$pub_user" -P "$pub_pass" "$@" -t "$topic" -m "test-acl" 2>/dev/null
    wait "$sub_pid" 2>/dev/null
    if grep -q "test-acl" "$received"; then echo "autorisé"; else echo "refusé"; fi
    rm -f "$received"
}

# Poignée de main TLS avec une SEULE version autorisée côté client (openssl s_client -tls1_2 / -tls1_3).
# (mosquitto_pub --tls-version fixe seulement une version MINIMALE : il négocierait quand même TLS 1.3.)
# Usage : try_tls <hôte> <port> <-tls1_2|-tls1_3>  -> « accepté » ou « refusé »
try_tls() {
    out=$(echo | openssl s_client -connect "$1:$2" -servername "$1" "$3" -CAfile "$CA" 2>&1)
    if echo "$out" | grep -q "Verify return code: 0" && ! echo "$out" | grep -q "Cipher is (NONE)"; then
        echo "accepté"
    else
        echo "refusé"
    fi
}

for var in LOCAL_GATEWAY_PASSWORD LOCAL_DIAG_PASSWORD STATION_PASSWORD MQTT_API_PASSWORD MQTT_GATEWAY_PASSWORD; do
    eval "value=\${$var:-}"
    [ -n "$value" ] || { echo "Variable $var manquante (deploy/.env)" >&2; exit 2; }
done

L="$LOCAL_HOST 1883"
C="$CLOUD_HOST 8883"
S=floodwatch/stations

echo "Broker LOCAL de la passerelle ($LOCAL_HOST:1883)"
report refusé   "$(try_publish $L - - fw/raw/$STATION/telemetry)" "connexion anonyme"
report refusé   "$(try_publish $L $STATION mauvais-mot-de-passe fw/raw/$STATION/telemetry)" "mauvais mot de passe"
report autorisé "$(try_publish $L $STATION "$STATION_PASSWORD" fw/raw/$STATION/telemetry)" "station $STATION publie SA télémétrie brute"
report autorisé "$(try_publish $L $STATION "$STATION_PASSWORD" $S/$STATION/td)" "station $STATION publie SA Thing Description"
report refusé   "$(try_publish $L $STATION "$STATION_PASSWORD" fw/raw/$OTHER/telemetry)" "station $STATION publie pour $OTHER"
report refusé   "$(try_publish $L $STATION "$STATION_PASSWORD" $S/$STATION/cmd)" "station $STATION se publie une commande"
report autorisé "$(try_receive $L $STATION "$STATION_PASSWORD" $S/$STATION/cmd gateway "$LOCAL_GATEWAY_PASSWORD" $S/$STATION/cmd)" \
                "station $STATION reçoit SES commandes"
report refusé   "$(try_receive $L $STATION "$STATION_PASSWORD" "$S/+/cmd" gateway "$LOCAL_GATEWAY_PASSWORD" $S/$OTHER/cmd)" \
                "station $STATION reçoit les commandes de $OTHER"
report autorisé "$(try_publish $L gateway "$LOCAL_GATEWAY_PASSWORD" $S/$STATION/cmd)" "passerelle envoie une commande à une station"
report refusé   "$(try_publish $L gateway "$LOCAL_GATEWAY_PASSWORD" $S/$STATION/telemetry)" "passerelle forge une mesure de station"
report refusé   "$(try_publish $L diag "$LOCAL_DIAG_PASSWORD" $S/$STATION/cmd)" "compte diag publie une commande"
report autorisé "$(try_receive $L diag "$LOCAL_DIAG_PASSWORD" 'fw/raw/#' $STATION "$STATION_PASSWORD" fw/raw/$STATION/telemetry)" \
                "compte diag lit le trafic"

echo "Broker CLOUD ($CLOUD_HOST:8883, TLS 1.3)"
TLS="--cafile $CA"
report refusé   "$(try_publish $C gateway "$MQTT_GATEWAY_PASSWORD" $S/acl-test/telemetry)" "connexion sans TLS sur 8883"
report refusé   "$(try_tls $CLOUD_HOST 8883 -tls1_2)" "poignée de main TLS 1.2 (seul TLS 1.3 est accepté)"
report accepté  "$(try_tls $CLOUD_HOST 8883 -tls1_3)" "poignée de main TLS 1.3, certificat vérifié par l'AC"
report autorisé "$(try_publish $C gateway "$MQTT_GATEWAY_PASSWORD" $S/acl-test/telemetry $TLS)" "passerelle publie une mesure (TLS)"
report refusé   "$(try_publish $C - - $S/acl-test/telemetry $TLS)" "connexion anonyme (TLS)"
report refusé   "$(try_publish $C gateway mauvais-mot-de-passe $S/acl-test/telemetry $TLS)" "mauvais mot de passe (TLS)"
report autorisé "$(try_publish $C gateway "$MQTT_GATEWAY_PASSWORD" $S/acl-test/td $TLS)" "passerelle publie une Thing Description"
report refusé   "$(try_publish $C gateway "$MQTT_GATEWAY_PASSWORD" $S/acl-test/cmd $TLS)" "passerelle publie une commande sur le Cloud"
report refusé   "$(try_publish $C gateway "$MQTT_GATEWAY_PASSWORD" $S/acl-test/config $TLS)" "passerelle publie une configuration"
report autorisé "$(try_receive $C gateway "$MQTT_GATEWAY_PASSWORD" "$S/+/cmd" floodwatch-api "$MQTT_API_PASSWORD" $S/acl-test/cmd $TLS)" \
                "passerelle reçoit les commandes du middleware"
report autorisé "$(try_publish $C floodwatch-api "$MQTT_API_PASSWORD" $S/acl-test/cmd $TLS)" "middleware publie une commande"
if [ -n "${GATEWAY_CLOUD_PASSWORD:-}" ]; then
    GW=${GATEWAY_ID:-gw-ariana-01}
    echo "Compte Cloud dédié de la passerelle $GW (limité à ses stations)"
    report autorisé "$(try_publish $C $GW "$GATEWAY_CLOUD_PASSWORD" $S/$STATION/td $TLS)" "$GW publie pour SA station $STATION"
    report refusé   "$(try_publish $C $GW "$GATEWAY_CLOUD_PASSWORD" $S/acl-test/telemetry $TLS)" "$GW publie pour une station hors de sa zone"
    report refusé   "$(try_publish $C $GW "$GATEWAY_CLOUD_PASSWORD" $S/$STATION/cmd $TLS)" "$GW publie une commande"
    report autorisé "$(try_publish $C $GW "$GATEWAY_CLOUD_PASSWORD" floodwatch/gateways/$GW/bridge $TLS)" "$GW publie SES notifications"
    report refusé   "$(try_publish $C $GW "$GATEWAY_CLOUD_PASSWORD" floodwatch/gateways/gw-autre/events $TLS)" "$GW se fait passer pour une autre passerelle"
    report autorisé "$(try_receive $C $GW "$GATEWAY_CLOUD_PASSWORD" "$S/+/cmd" floodwatch-api "$MQTT_API_PASSWORD" $S/$STATION/cmd $TLS)"                     "$GW reçoit les commandes de SA station"
    report refusé   "$(try_receive $C $GW "$GATEWAY_CLOUD_PASSWORD" "$S/+/cmd" floodwatch-api "$MQTT_API_PASSWORD" $S/acl-test/cmd $TLS)"                     "$GW reçoit les commandes d'une station hors de sa zone"
fi
if [ -n "${MQTT_OBSERVER_PASSWORD:-}" ]; then
    report refusé   "$(try_publish $C observer "$MQTT_OBSERVER_PASSWORD" $S/acl-test/cmd $TLS)" "observateur publie une commande"
    report autorisé "$(try_receive $C observer "$MQTT_OBSERVER_PASSWORD" 'floodwatch/#' gateway "$MQTT_GATEWAY_PASSWORD" $S/acl-test/heartbeat $TLS)" \
                    "observateur lit les mesures"
fi

echo "Résultat : $passed réussi(s), $failed échec(s)"
[ "$failed" -eq 0 ]
