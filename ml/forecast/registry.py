# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – cloud (prévision du niveau)
#  Fichier   : ml/forecast/registry.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-23          Modifié le : 2026-11-23          Version : 1.0
# =============================================================================
"""Registre des modèles : ce que le middleware sert, et sa trace dans MLflow.

* **Dossier de déploiement** ``<racine>/models/`` (volume partagé, monté en lecture seule dans l'API) :
  un fichier ``<modèle>.json`` par version acceptée et ``registry.json`` qui désigne le **champion**
  (sert les prévisions s'il a fait ses preuves en service) et le **challenger** (évalué en ombre sur les
  mesures réelles, ne sert rien). Écritures atomiques (fichier temporaire puis renommage) : l'API ne
  lit jamais un fichier à moitié écrit.
* **MLflow** (si ``MLFLOW_TRACKING_URI`` est défini) : chaque entraînement est une exécution (paramètres,
  métriques, instantané de données, rapport) ; chaque modèle accepté une version du modèle enregistré
  ``floodwatch-level-forecast``, avec les alias ``challenger`` et ``champion``. Le dossier reste la
  source de vérité du service : une panne de MLflow ne bloque ni l'apprentissage ni le service.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

LOG = logging.getLogger("forecast.registry")
REGISTERED_NAME = "floodwatch-level-forecast"
EXPERIMENT = "floodwatch-level-forecast"
MAX_EVENTS = 50


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def write_atomic(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


class Registry:
    def __init__(self, root: Path):
        self.models = root / "models"
        self.file = self.models / "registry.json"

    def state(self) -> dict:
        if self.file.is_file():
            return json.loads(self.file.read_text(encoding="utf-8"))
        return {"champion": None, "challenger": None, "events": [], "monitoring": None, "mlflow": {}}

    def save(self, state: dict) -> None:
        state["updatedAt"] = now_iso()
        state["events"] = state.get("events", [])[-MAX_EVENTS:]
        write_atomic(self.file, json.dumps(state, indent=2, ensure_ascii=False) + "\n")

    def event(self, state: dict, kind: str, **detail) -> None:
        state.setdefault("events", []).append({"at": now_iso(), "event": kind, **detail})
        LOG.info("%s %s", kind, detail)

    def model(self, model_id: str | None) -> dict | None:
        if not model_id:
            return None
        p = self.models / f"{model_id}.json"
        return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else None

    def add_challenger(self, exported: dict, mlflow_version: str | None) -> None:
        write_atomic(self.models / f"{exported['modelId']}.json", json.dumps(exported, separators=(",", ":")) + "\n")
        st = self.state()
        previous = st.get("challenger")
        st["challenger"] = exported["modelId"]
        if mlflow_version:
            st.setdefault("mlflow", {})[exported["modelId"]] = mlflow_version
        self.event(st, "challenger", model=exported["modelId"], replaces=previous,
                   dataset=exported["dataset"]["id"])
        self.save(st)

    def promote(self, reason: dict) -> str:
        st = self.state()
        new, old = st["challenger"], st.get("champion")
        st["champion"], st["challenger"] = new, None
        self.event(st, "promoted", model=new, previous=old, **reason)
        self.save(st)
        return new

    def demote(self, reason: dict) -> None:
        st = self.state()
        old = st.get("champion")
        st["champion"] = None
        self.event(st, "demoted", model=old, **reason)
        self.save(st)

    def set_monitoring(self, report: dict) -> None:
        st = self.state()
        st["monitoring"] = report
        self.save(st)


# ------------------------------------------------------------------------------------------- MLflow
class Tracker:
    """Façade MLflow : sans ``MLFLOW_TRACKING_URI``, ou en cas de panne, ne fait rien (journalisé)."""

    def __init__(self, experiment: str = EXPERIMENT, registered: str = REGISTERED_NAME):
        self.registered = registered
        self.enabled = bool(os.environ.get("MLFLOW_TRACKING_URI"))
        self.client = None
        if self.enabled:
            try:
                import mlflow
                from mlflow.tracking import MlflowClient

                self.mlflow = mlflow
                self.client = MlflowClient()
                mlflow.set_experiment(experiment)
            except Exception as e:  # noqa: BLE001 – MLflow est un témoin, pas une dépendance du service
                LOG.warning("MLflow indisponible : %s", e)
                self.enabled = False

    def log_training(self, report: dict, exported: dict | None, model_path: Path | None) -> str | None:
        """Enregistre l'exécution ; si le modèle est accepté, en crée une version alias ``challenger``."""
        if not self.enabled:
            return None
        try:
            mlflow = self.mlflow
            with mlflow.start_run(run_name=report["modelId"]) as run:
                mlflow.set_tags({"dataset.id": report["dataset"]["id"], "dataset.source": report["dataset"]["source"],
                                 "accepted": str(report["accepted"]).lower(), "modelId": report["modelId"]})
                mlflow.log_params({"dataset_rows": report["dataset"]["rows"], "features": len(report["features"]),
                                   **{f"h{h['sec']}_{k}": v for h in report["horizons"]
                                      for k, v in h["params"].items()}})
                for h in report["horizons"]:
                    for name in ("model", "persistence", "linear"):
                        for k in ("maeCm", "biasCm", "rmseCm"):
                            if h["test"][name][k] is not None:
                                mlflow.log_metric(f"test_{name}_{k}_h{h['sec']}", h["test"][name][k])
                    mlflow.log_metric(f"skill_h{h['sec']}", h["skill"])
                mlflow.log_dict(report, "report.json")
                if not exported:
                    return None
                mlflow.log_artifact(str(model_path), artifact_path="model")
                source = f"{run.info.artifact_uri}/model/{model_path.name}"
            try:
                self.client.create_registered_model(self.registered)
            except Exception:  # noqa: BLE001 – déjà enregistré
                pass
            mv = self.client.create_model_version(self.registered, source, run.info.run_id,
                                                  tags={"modelId": exported["modelId"]})
            self.client.set_registered_model_alias(self.registered, "challenger", mv.version)
            return str(mv.version)
        except Exception as e:  # noqa: BLE001
            LOG.warning("MLflow : exécution non enregistrée (%s)", e)
            return None

    def alias(self, alias: str, version: str | None) -> None:
        if not self.enabled or not version:
            return
        try:
            self.client.set_registered_model_alias(self.registered, alias, version)
            if alias == "champion":
                self.client.delete_registered_model_alias(self.registered, "challenger")
        except Exception as e:  # noqa: BLE001
            LOG.warning("MLflow : alias %s non posé (%s)", alias, e)

    def log_monitoring(self, report: dict) -> None:
        if not self.enabled:
            return
        try:
            with self.mlflow.start_run(run_name=f"monitoring {report['at']}"):
                self.mlflow.set_tag("kind", "monitoring")
                for k, v in report.get("psi", {}).items():
                    self.mlflow.log_metric(f"psi_{k}", v)
                for row in report.get("live", []):
                    if row.get("maeCm") is not None:
                        name = re.sub(r"[^\w\-. /]", "_", row["model"])     # « + » refusé par MLflow
                        self.mlflow.log_metric(f"live_mae_{name}_h{row['horizonSec']}", row["maeCm"])
                self.mlflow.log_dict(report, "monitoring.json")
        except Exception as e:  # noqa: BLE001
            LOG.warning("MLflow : surveillance non enregistrée (%s)", e)
