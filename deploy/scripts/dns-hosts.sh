#!/usr/bin/env bash
# =============================================================================
#  Module   : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Fichier  : deploy/scripts/dns-hosts.sh
#  Équipe   : FloodWatch – Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed
#  Version  : 1.0 – 2026-11-14
#  Rôle     : solution de repli au serveur DNS (service « dns » de docker compose)
#             pour un poste de travail : écrit les quatre noms dans /etc/hosts.
#             Utile notamment parce que « .local » est réservé au mDNS : sur
#             macOS et Windows, le résolveur du système peut court-circuiter un
#             vrai serveur DNS pour ce suffixe.
#  Usage    : sudo ./scripts/dns-hosts.sh [domaine] [ip]      (ajoute)
#             sudo ./scripts/dns-hosts.sh --remove [domaine]  (retire)
# =============================================================================
set -euo pipefail
HOSTS=/etc/hosts
MARK="# FloodWatch"

if [ "${1:-}" = "--remove" ]; then
  DOMAIN=${2:-floodwatch.local}
  sed -i.bak "/${MARK} (${DOMAIN})\$/d" "$HOSTS"
  echo ">> Entrées de ${DOMAIN} retirées de ${HOSTS} (sauvegarde ${HOSTS}.bak)"
  exit 0
fi

DOMAIN=${1:-floodwatch.local}
IP=${2:-127.0.0.1}
sed -i.bak "/${MARK} (${DOMAIN})\$/d" "$HOSTS"
for name in "$DOMAIN" "www.$DOMAIN" "admin.$DOMAIN" "api.$DOMAIN" "iam.$DOMAIN" "mqtt.$DOMAIN"; do
  printf '%s\t%s\t%s (%s)\n' "$IP" "$name" "$MARK" "$DOMAIN" >> "$HOSTS"
done
echo ">> ${DOMAIN} : six noms ajoutés dans ${HOSTS} vers ${IP}"
echo "   https://www.${DOMAIN}/    front-office (citoyen)"
echo "   https://admin.${DOMAIN}/  back-office (pilotage)"
echo "   https://api.${DOMAIN}/    API REST et WebSocket"
echo "   https://iam.${DOMAIN}/    authentification"
