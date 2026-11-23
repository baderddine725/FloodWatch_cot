#!/usr/bin/env bash
# =============================================================================
#  Module   : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Fichier  : backend/deploy/scripts/renew-web-cert.sh
#  Équipe   : FloodWatch – Auteur : Guesmi Baderddine
#  Version  : 1.0 – 2026-11-23
#  Rôle     : certificat Let's Encrypt des noms web (www, admin, api, iam et le domaine nu),
#             obtenu puis renouvelé par le défi HTTP-01 servi par Nginx (/.well-known/acme-challenge/).
#             Idempotent : certbot ne renouvelle qu'à moins de 30 jours de l'expiration ; à lancer
#             chaque jour (cron posé par deploy-cloud.sh). Copie le certificat dans certs/web.crt et
#             certs/web.key, bascule Nginx dessus (WEB_CERT / WEB_KEY dans .env) et le recharge.
#             Le broker MQTT n'est pas concerné : il garde l'AC privée de ses passerelles.
#  Usage    : ./scripts/renew-web-cert.sh            (domaine et courriel lus dans .env ; passe en root)
# =============================================================================
set -euo pipefail
# root : les fichiers de letsencrypt/ (créés par le conteneur certbot) ne sont lisibles que par lui
[ "$(id -u)" = 0 ] || exec sudo "$0" "$@"
cd "$(dirname "$0")/.."
CERTBOT_IMAGE=certbot/certbot:v3.3.0

env_get() { sed -n "s/^$1=//p" .env | tail -1 | tr -d '"'; }
# réécriture SUR PLACE (et non sed -i) : lancé en root par cron, le script garde le propriétaire de .env
env_set() {
  if grep -q "^$1=" .env; then
    local content
    content=$(sed "s|^$1=.*|$1=$2|" .env)
    printf '%s\n' "$content" > .env
  else
    printf '%s=%s\n' "$1" "$2" >> .env
  fi
}

DOMAIN=$(env_get BASE_DOMAIN)
EMAIL=$(env_get LETSENCRYPT_EMAIL)
[ -n "$DOMAIN" ] && [ -n "$EMAIL" ] || { echo "BASE_DOMAIN et LETSENCRYPT_EMAIL requis dans .env" >&2; exit 1; }

mkdir -p certbot letsencrypt
docker run --rm -v "$PWD/certbot:/var/www/certbot" -v "$PWD/letsencrypt:/etc/letsencrypt" "$CERTBOT_IMAGE" \
  certonly --webroot -w /var/www/certbot --non-interactive --agree-tos -m "$EMAIL" --keep-until-expiring \
  --cert-name "$DOMAIN" -d "$DOMAIN" -d "www.$DOMAIN" -d "admin.$DOMAIN" -d "api.$DOMAIN" -d "iam.$DOMAIN"

LIVE=letsencrypt/live/$DOMAIN
NEW=$(cat "$LIVE/fullchain.pem")
if [ -f certs/web.crt ] && [ "$NEW" = "$(cat certs/web.crt)" ] && [ "$(env_get WEB_CERT)" = web.crt ]; then
  echo ">> certificat web inchangé ($(openssl x509 -noout -enddate -in certs/web.crt))"
  exit 0
fi
umask 077
cat "$LIVE/privkey.pem" > certs/web.key.tmp
printf '%s\n' "$NEW" > certs/web.crt.tmp
chmod 644 certs/web.crt.tmp
mv certs/web.crt.tmp certs/web.crt
mv certs/web.key.tmp certs/web.key
env_set WEB_CERT web.crt
env_set WEB_KEY web.key
# up -d recrée Nginx si WEB_CERT a changé ; sinon simple rechargement de la configuration
docker compose up -d nginx
docker compose exec -T nginx nginx -s reload
echo ">> certificat web installé : $(openssl x509 -noout -subject -enddate -in certs/web.crt | tr '\n' ' ')"
