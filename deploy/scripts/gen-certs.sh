#!/usr/bin/env bash
# =============================================================================
#  Génère une autorité de certification privée FloodWatch et un certificat serveur
#  (Mosquitto 8883 + Nginx 443) valable pour les quatre noms de service du domaine.
#  Usage : ./scripts/gen-certs.sh <domaine-de-base> [ip]
#  Exemple : ./scripts/gen-certs.sh floodwatch.local 127.0.0.1
#  Pour les smartphones (PWA + Web Push), préférez un certificat Let's Encrypt :
#  voir docs/deployment.md.
# =============================================================================
set -euo pipefail
NAME=${1:?usage: gen-certs.sh <base-domain> [ip]}
IP=${2:-}
DIR=$(cd "$(dirname "$0")/.." && pwd)/certs
mkdir -p "$DIR" && cd "$DIR"
# Les DEUX fichiers sont testés : une génération interrompue laissait une ca.key
# orpheline, et le certificat serveur échouait ensuite faute de ca.crt.
if [ ! -f ca.key ] || [ ! -f ca.crt ]; then
  openssl req -x509 -newkey rsa:3072 -nodes -days 3650 -keyout ca.key -out ca.crt \
    -subj "/C=TN/O=FloodWatch/CN=FloodWatch Root CA"
fi
# Le certificat couvre le domaine nu, ses sous-domaines (joker) et les noms internes
SAN="DNS:$NAME,DNS:*.$NAME,DNS:localhost,DNS:mosquitto"
[ -n "$IP" ] && SAN="$SAN,IP:$IP"
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/C=TN/O=FloodWatch/CN=$NAME"
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -days 825 -out server.crt \
  -extfile <(printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\nkeyUsage=digitalSignature,keyEncipherment" "$SAN")
rm -f server.csr
chmod 644 ca.crt server.crt server.key
echo "Certificats générés dans $DIR (CA à copier sur les passerelles : ca.crt)"
