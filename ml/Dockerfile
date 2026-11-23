# =============================================================================
#  FloodWatch – service d'apprentissage (cycle MLOps de la prévision du niveau)
#  Contexte de construction : racine du dépôt (docker-compose : context ../.., dockerfile ml/Dockerfile)
#  Équipe FloodWatch – Guesmi Baderddine – v1.0 – 2026-11-23
#
#  Boucle : évaluation en service -> promotion -> surveillance -> réapprentissage (ml/forecast/pipeline.py).
#  Lit PostgreSQL en lecture seule, écrit dans ML_HOME (volume partagé, lu par l'API) et dans MLflow.
# =============================================================================
FROM python:3.12-slim

WORKDIR /app
COPY backend/simulator/requirements.txt backend/simulator/requirements.txt
COPY ml/requirements.txt ml/requirements-trainer.txt ml/
RUN pip install --no-cache-dir -r ml/requirements-trainer.txt

# simulateur : source « sim » (python -m forecast.pipeline train --source sim), utile hors pile
COPY backend/simulator backend/simulator
COPY backend/gateway/stations.json backend/gateway/stations.json
COPY ml/forecast ml/forecast
COPY ml/river ml/river

RUN useradd --system --uid 10001 --home-dir /var/lib/floodwatch-ml ml \
    && mkdir -p /var/lib/floodwatch-ml
WORKDIR /app/ml
# GIT_PYTHON_REFRESH : MLflow cherche git pour étiqueter les exécutions ; absent de l'image, sans objet
ENV ML_HOME=/var/lib/floodwatch-ml PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 GIT_PYTHON_REFRESH=quiet

# Le volume peut avoir été créé vide (propriétaire root) par l'API qui le monte en lecture seule :
# on rend le dossier au compte « ml », puis on abandonne les droits root avant de lancer la boucle.
CMD ["sh", "-c", "chown -R ml:ml \"$ML_HOME\" && exec setpriv --reuid=ml --regid=ml --init-groups python -m forecast.pipeline loop"]
