#!/bin/sh
# =============================================================================
#  Module   : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Fichier  : middleware/wildfly/configure.sh
#  Équipe   : FloodWatch – Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed
#  Version  : 1.0 – 2026-11-14
#  Rôle     : enchaîne les scripts jboss-cli qui configurent le serveur.
#             Appelé à la construction de l'image Docker (serveur embarqué) ;
#             sur une VM, les mêmes scripts s'exécutent sur un serveur démarré :
#               jboss-cli.sh --connect --file=add-host.cli --properties=hosts/www.properties
#  Variables : BASE_DOMAIN  domaine de base (défaut floodwatch.local). Les fichiers
#                           hosts/*.properties sont adaptés à ce domaine.
#              JBOSS_HOME   racine de WildFly (défaut /opt/jboss/wildfly)
# =============================================================================
set -eu

JBOSS_HOME=${JBOSS_HOME:-/opt/jboss/wildfly}
BASE_DOMAIN=${BASE_DOMAIN:-floodwatch.local}
CLI_DIR=$(cd "$(dirname "$0")" && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Les .properties sont versionnés pour floodwatch.local : on les réécrit si le
# domaine de déploiement est différent (variable BASE_DOMAIN de backend/deploy/.env).
# Deux formes à remplacer : le domaine lui-même, et sa variante « prête pour une
# regex » (points entre crochets) utilisée par le prédicat CORS.
DOMAIN_RE=$(printf '%s' "$BASE_DOMAIN" | sed 's/\./[.]/g')
mkdir -p "$WORK/hosts"
for p in "$CLI_DIR"/hosts/*.properties; do
  sed -e "s/floodwatch\[\.\]local/${DOMAIN_RE}/g"       -e "s/floodwatch\.local/${BASE_DOMAIN}/g"       "$p" > "$WORK/hosts/$(basename "$p")"
done

# Chaque script est exécuté sur un serveur embarqué : jboss-cli n'a pas de
# directive « include », on encadre donc le script par embed-server / stop.
run_cli() {
  script=$1
  props=${2:-}
  {
    echo 'embed-server --std-out=echo --server-config=standalone.xml'
    cat "$CLI_DIR/$script"
    echo ''
    echo 'stop-embedded-server'
  } > "$WORK/run.cli"
  if [ -n "$props" ]; then
    "$JBOSS_HOME/bin/jboss-cli.sh" --file="$WORK/run.cli" --properties="$WORK/hosts/$props"
  else
    "$JBOSS_HOME/bin/jboss-cli.sh" --file="$WORK/run.cli"
  fi
}

echo ">>> FloodWatch : configuration de base (source de données, filtres Undertow)"
run_cli configure.cli

echo ">>> FloodWatch : hôte virtuel de l'API et de l'IAM (api-host)"
run_cli add-api.cli api.properties

echo ">>> FloodWatch : hôte virtuel du front-office (www-host)"
run_cli add-host.cli www.properties

echo ">>> FloodWatch : hôte virtuel du back-office (admin-host)"
run_cli add-host.cli admin.properties

echo ">>> FloodWatch : configuration terminée pour le domaine ${BASE_DOMAIN}"
