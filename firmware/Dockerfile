# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : firmware – back-end & IoT
#  Fichier   : firmware/Dockerfile
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03          Version : 1.0
#  Rôle      : compilation du firmware ESP32 sans installer PlatformIO sur le poste.
#              docker compose --profile tools run --rm firmware
# =============================================================================
FROM python:3.12-slim
RUN pip install --no-cache-dir "platformio>=6.1,<7"
COPY tools/build.sh /usr/local/bin/fw-build
RUN chmod 0755 /usr/local/bin/fw-build
WORKDIR /firmware
ENTRYPOINT ["fw-build"]
