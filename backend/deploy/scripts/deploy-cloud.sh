#!/usr/bin/env bash
# =============================================================================
#  Module   : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Fichier  : backend/deploy/scripts/deploy-cloud.sh
#  Équipe   : FloodWatch – Auteur : Guesmi Baderddine
#  Version  : 1.0 – 2026-11-23
#  Rôle     : déploiement PUBLIC complet sur une VM Ubuntu 22.04/24.04 (Oracle Cloud « Always Free »
#             ARM ou x86, ou tout autre IaaS), avec un nom DuckDNS gratuit et des certificats
#             Let's Encrypt reconnus par les smartphones (PWA installable, Web Push).
#
#             1. pare-feu de la VM (80, 443, 8883) ;     5. AC privée (MQTT) et pile complète :
#             2. Docker ;                                    middleware, PWA, brokers, passerelle et
#             3. dépôt GitHub et .env (secrets aléatoires,   stations simulées, cycle MLOps ;
#                services d'administration sur 127.0.0.1); 6. certificat web Let's Encrypt ;
#             4. DuckDNS : nom -> IP publique (cron 5 min); 7. renouvellement quotidien (cron).
#
#             Rejouable : chaque étape vérifie ce qui existe déjà. Les ports de la VM doivent AUSSI
#             être ouverts dans la console du fournisseur (Oracle : liste de sécurité du VCN).
#
#  Usage    : curl -fsSLO https://raw.githubusercontent.com/baderddine725/FloodWatch_cot/main/backend/deploy/scripts/deploy-cloud.sh
#             bash deploy-cloud.sh <nom>.duckdns.org <courriel-lets-encrypt>
#             (le jeton DuckDNS est demandé au clavier, puis gardé dans ~/.config/floodwatch, mode 600)
#  Variables: REPO (dépôt), BRANCH (main), DIR (~/FloodWatch_cot), PROFILES (iot,ml)
# =============================================================================
set -euo pipefail
DOMAIN=${1:?usage: deploy-cloud.sh <nom>.duckdns.org <courriel>}
EMAIL=${2:?usage: deploy-cloud.sh <nom>.duckdns.org <courriel>}
REPO=${REPO:-https://github.com/baderddine725/FloodWatch_cot.git}
BRANCH=${BRANCH:-main}
DIR=${DIR:-$HOME/FloodWatch_cot}
PROFILES=${PROFILES:-iot,ml}
CONF=$HOME/.config/floodwatch
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

# ------------------------------------------------------------------ 1. pare-feu de la VM
step "1/7 Pare-feu : ports 80, 443 (web) et 8883 (MQTT TLS)"
# Les images Ubuntu d'Oracle finissent la chaîne INPUT par un REJECT : on ouvre avant lui.
for port in 80 443 8883; do
  if ! sudo iptables -C INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT 2>/dev/null; then
    n=$(sudo iptables -L INPUT --line-numbers -n | awk '$2 == "REJECT" {print $1; exit}')
    if [ -n "$n" ]; then
      sudo iptables -I INPUT "$n" -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    else
      sudo iptables -A INPUT -p tcp -m state --state NEW --dport "$port" -j ACCEPT
    fi
  fi
done
if command -v netfilter-persistent >/dev/null; then sudo netfilter-persistent save >/dev/null; fi

# ------------------------------------------------------------------ 2. Docker
step "2/7 Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER" || true
DOCKER="sudo docker"

# ------------------------------------------------------------------ 3. dépôt et configuration
step "3/7 Dépôt $REPO ($BRANCH) et configuration"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" fetch --quiet origin "$BRANCH" && git -C "$DIR" checkout --quiet "$BRANCH" \
    && git -C "$DIR" pull --quiet --ff-only origin "$BRANCH"
else
  git clone --quiet --branch "$BRANCH" "$REPO" "$DIR"
fi
cd "$DIR/backend/deploy"
env_set() {
  if grep -q "^$1=" .env; then sed -i "s|^$1=.*|$1=$2|" .env; else printf '%s=%s\n' "$1" "$2" >> .env; fi
}
if [ ! -f .env ]; then
  cp .env.example .env
  for k in DB_PASSWORD MQTT_API_PASSWORD MQTT_GATEWAY_PASSWORD ADMIN_PASSWORD OPERATOR_PASSWORD \
           MQTT_OBSERVER_PASSWORD LOCAL_GATEWAY_PASSWORD LOCAL_DIAG_PASSWORD STATION_PASSWORD \
           NODE_RED_ADMIN_PASSWORD GATEWAY_CLOUD_PASSWORD; do
    env_set "$k" "$(openssl rand -hex 12)"
  done
  env_set JWT_SECRET "$(openssl rand -hex 32)"
  chmod 600 .env
  echo ">> secrets générés dans $PWD/.env"
fi
PUBLIC_IP=$(curl -fsS https://api.ipify.org || hostname -I | awk '{print $1}')
env_set BASE_DOMAIN "$DOMAIN"
env_set PUBLIC_IP "$PUBLIC_IP"
env_set LETSENCRYPT_EMAIL "$EMAIL"
env_set COMPOSE_PROFILES "$PROFILES"
# Administration jamais exposée sur Internet (accès par tunnel SSH) ; pas de résolveur DNS ouvert :
# le nom public est résolu par DuckDNS, le service « dns » de la pile reste local à la VM.
env_set DNS_PORT 127.0.0.1:5353
env_set NODE_RED_PORT 127.0.0.1:1880
env_set LOCAL_MQTT_PORT 127.0.0.1:1883

# ------------------------------------------------------------------ 4. DuckDNS
case "$DOMAIN" in
  *.duckdns.org)
    step "4/7 DuckDNS : $DOMAIN -> $PUBLIC_IP"
    SUB=${DOMAIN%.duckdns.org}
    mkdir -p "$CONF" && chmod 700 "$CONF"
    if [ ! -s "$CONF/duckdns.curl" ]; then
      TOKEN=${DUCKDNS_TOKEN:-}
      [ -n "$TOKEN" ] || { read -rsp "Jeton DuckDNS (affiché sur duckdns.org) : " TOKEN < /dev/tty; echo; }
      # jeton dans un fichier de configuration curl (mode 600), jamais sur la ligne de commande
      (umask 077; printf 'url = "https://www.duckdns.org/update?domains=%s&token=%s&ip="\nsilent\n' \
        "$SUB" "$TOKEN" > "$CONF/duckdns.curl")
    fi
    [ "$(curl -K "$CONF/duckdns.curl")" = OK ] || { echo "DuckDNS refuse la mise à jour (nom ou jeton ?)" >&2; exit 1; }
    ( crontab -l 2>/dev/null | grep -v duckdns.curl; echo "*/5 * * * * curl -K $CONF/duckdns.curl >/dev/null 2>&1" ) | crontab -
    for _ in $(seq 1 30); do
      [ "$(getent ahostsv4 "www.$DOMAIN" | awk 'NR==1{print $1}')" = "$PUBLIC_IP" ] && break
      sleep 10
    done
    ;;
  *) step "4/7 Domaine $DOMAIN : enregistrement DNS « *.$DOMAIN -> $PUBLIC_IP » à créer chez votre fournisseur" ;;
esac

# ------------------------------------------------------------------ 5. AC privée et pile
step "5/7 AC privée (MQTT) et pile complète (profils : $PROFILES) – la première construction est longue"
[ -f certs/server.crt ] || ./scripts/gen-certs.sh "$DOMAIN"
$DOCKER compose up -d --build
for _ in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1/.well-known/acme-challenge/ping" || true)
  [ "$code" = 404 ] && break
  sleep 5
done

# ------------------------------------------------------------------ 6. certificat web
step "6/7 Certificat Let's Encrypt pour $DOMAIN, www, admin, api, iam"
sudo ./scripts/renew-web-cert.sh

# ------------------------------------------------------------------ 7. renouvellement
step "7/7 Renouvellement quotidien du certificat (cron root)"
( sudo crontab -l 2>/dev/null | grep -v renew-web-cert.sh
  echo "17 3 * * * cd $PWD && ./scripts/renew-web-cert.sh >> /var/log/floodwatch-cert.log 2>&1" ) | sudo crontab -

$DOCKER compose ps --format 'table {{.Service}}\t{{.Status}}'
cat <<EOT

>> FloodWatch est en ligne :
     https://www.$DOMAIN/      espace citoyen (PWA installable)
     https://admin.$DOMAIN/    espace de pilotage (comptes : ADMIN_* et OPERATOR_* dans $PWD/.env)
     https://api.$DOMAIN/api/health
     mqtts://$DOMAIN:8883      broker des passerelles (AC privée : certs/ca.crt)
   Administration par tunnel SSH :  ssh -L 1880:localhost:1880 -L 5000:localhost:5000 <vm>
     http://localhost:1880   Node-RED (passerelle simulée)      http://localhost:5000   MLflow
   Mise à jour depuis GitHub : $PWD/scripts/update.sh
EOT
