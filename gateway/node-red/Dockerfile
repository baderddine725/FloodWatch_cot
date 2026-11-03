# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : passerelle – back-end & IoT
#  Fichier   : gateway/node-red/Dockerfile
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03          Version : 1.0
#  Rôle      : passerelle Node-RED (Raspberry Pi simulé). Contexte de build : gateway/
#              (flux, réglages et registre des stations copiés dans /gateway).
# =============================================================================
FROM nodered/node-red:4.1.16-22
COPY --chown=node-red:node-red node-red/flows.json node-red/settings.js /gateway/node-red/
COPY --chown=node-red:node-red stations.json /gateway/
ENV TZ=UTC GATEWAY_DIR=/gateway NODE_RED_USER_DIR=/data
HEALTHCHECK --interval=10s --timeout=5s --start-period=30s --retries=6 \
    CMD node -e "require('http').get('http://127.0.0.1:1880/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"
CMD ["--settings", "/gateway/node-red/settings.js"]
