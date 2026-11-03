#!/usr/bin/env bash
# =============================================================================
#  Installation complète sur une VM Ubuntu 22.04/24.04 (IaaS) depuis GitHub.
#  Usage : curl -fsSL .../install-vm.sh | bash -s -- <repo-git> <nom-dns>
# =============================================================================
set -euo pipefail
REPO=${1:-https://github.com/baderddine725/FloodWatch_cot.git}
NAME=${2:?usage: install-vm.sh <repo> <dns-name>}
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi
[ -d FloodWatch_cot ] || git clone "$REPO" FloodWatch_cot
cd FloodWatch_cot/deploy
if [ ! -f .env ]; then
  cp .env.example .env
  for k in DB_PASSWORD MQTT_API_PASSWORD MQTT_GATEWAY_PASSWORD ADMIN_PASSWORD OPERATOR_PASSWORD \
           MQTT_OBSERVER_PASSWORD LOCAL_GATEWAY_PASSWORD LOCAL_DIAG_PASSWORD STATION_PASSWORD NODE_RED_ADMIN_PASSWORD; do
    sed -i "s|^$k=.*|$k=$(openssl rand -hex 12)|" .env
  done
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -hex 32)|; s|^SERVER_NAME=.*|SERVER_NAME=$NAME|" .env
  echo ">> Secrets générés dans deploy/.env (notez ADMIN_PASSWORD et OPERATOR_PASSWORD)"
fi
[ -f certs/server.crt ] || ./scripts/gen-certs.sh "$NAME"
sudo docker compose up -d --build
sudo docker compose ps
echo ">> FloodWatch : https://$NAME/  (Pilotage : https://$NAME/pilotage/)"
