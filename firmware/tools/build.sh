#!/bin/sh
# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : firmware – back-end & IoT
#  Fichier   : firmware/tools/build.sh
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03          Version : 1.0
#  Rôle      : compile le firmware dans une copie du projet (/firmware monté en lecture seule).
#              Sans include/station_config.h (secrets, ignoré par git), compile avec l'exemple.
# =============================================================================
set -eu
rm -rf /build && cp -r /firmware /build && cd /build
if [ ! -f include/station_config.h ]; then
    echo "station_config.h absent : compilation de contrôle avec station_config.example.h"
    cp include/station_config.example.h include/station_config.h
fi
pio run "$@"
