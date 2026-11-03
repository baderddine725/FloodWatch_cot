# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – back-end & IoT
#  Fichier   : simulator/Dockerfile
#  Équipe    : FloodWatch – Auteur : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03          Version : 1.0
#  Rôle      : image du simulateur de stations (Python 3.12 + paho-mqtt 2).
#              Configuration par variables SIM_* (voir fwsim/config.py), registre des stations
#              monté sur /gateway/stations.json.
# =============================================================================
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONIOENCODING=utf-8 PYTHONDONTWRITEBYTECODE=1 \
    LOG_FORMAT=json SIM_HEALTH_PORT=8081
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY fwsim ./fwsim
COPY floodwatch_sim.py .
USER nobody
EXPOSE 8081
HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
    CMD python -c "import os,urllib.request,sys; urllib.request.urlopen('http://127.0.0.1:%s/health' % os.environ['SIM_HEALTH_PORT'], timeout=2)" || exit 1
ENTRYPOINT ["python", "floodwatch_sim.py"]
