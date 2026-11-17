#!/usr/bin/env python3
# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – edge (TinyML)
#  Fichier   : ml/sensor_anomaly/train.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-17          Modifié le : 2026-11-17
#  Version   : 1.0
# =============================================================================
"""Entraîne, évalue et exporte le classifieur embarqué de validité du capteur.

Protocole, fixé AVANT de regarder les résultats :

1. **Données.** Banc simulé (``backend/simulator/tools/sensor_bench.py``), 24 h par graine. Apprentissage :
   6 graines ; choix du modèle : 2 graines ; test : 1 graine jamais vue, sous les hypothèses
   nominales puis sous les hypothèses DÉCALÉES (``SensorPhysics.shifted``).
2. **Cible.** Parmi les lectures retenues par le firmware, celles fausses de plus de 2 cm (``BAD``).
3. **Référence.** La règle « salve incomplète ou dispersion > 1 cm ».
4. **Choix.** Parmi les candidats (profondeur × poids de la classe ``BAD``), on retient celui
   qui attrape le plus de lectures fausses en validation SANS dépasser le taux de fausses
   alertes de la règle sur ces mêmes données. Rien n'est réajusté pour le profil décalé.
5. **Deux expériences.**
   * ``nominal`` : apprentissage et validation sur le capteur nominal seul. Conservée comme
     contre-exemple : excellente sur ce capteur, elle s'effondre sur le profil décalé.
   * ``randomized`` : chaque journée d'apprentissage et de validation a son propre capteur, tiré
     au hasard (``SensorPhysics.randomized``, plages qui EXCLUENT le profil décalé). C'est elle
     qui est exportée.
6. **Famille.** Le meilleur arbre et la meilleure forêt sont départagés en validation (même clé :
   respect de la limite, puis rappel, puis fausses alertes, puis taille). Amendement ajouté après
   la première exécution, qui montrait la fragilité de l'arbre seul sur le profil décalé ; la
   validation désignait déjà la forêt, indépendamment de ce test.
7. **Vote.** Une forêt décide par **vote majoritaire** (au moins 6 arbres sur 10) ; scikit-learn
   moyenne des probabilités, ce qui donnait 0,74 % de décisions différentes avec le code C. La règle
   majoritaire sert donc PARTOUT : choix, évaluation et export.
8. **Export.** Le modèle retenu est converti en C pour l'ESP32 et en JSON pour le simulateur
   (``codegen.py`` : seuils float32 arrondis vers le bas, comparaison ``<=``, donc décisions
   identiques par construction). Le C est compilé et exécuté sur les vecteurs de test, l'évaluateur
   Python aussi : tous deux doivent décider exactement comme scikit-learn.

Usage (depuis la racine du dépôt) ::

    python ml/sensor_anomaly/train.py            # entraîne et livre le modèle (firmware, simulateur, rapport)
    python ml/sensor_anomaly/train.py --check    # intégration continue : refait tout, applique les
                                                 # critères et vérifie que ml/export/ est à jour
"""
from __future__ import annotations

import argparse
import json
import random
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.tree import DecisionTreeClassifier

REPO = Path(__file__).resolve().parents[2]
sys.path[:0] = [str(REPO / "backend" / "simulator"), str(REPO / "backend" / "simulator" / "tools"), str(REPO / "ml")]

import sensor_bench  # noqa: E402
from fwsim.sensor import Condition, SensorPhysics  # noqa: E402
from sensor_anomaly.features import FEATURES, WINDOW, extract  # noqa: E402

EXPORT = REPO / "ml" / "export"
HEADER = "sensor_anomaly_model.h"
MODEL_JSON = "sensor_anomaly_model.json"
REPORT = "sensor_anomaly_report.json"
#: chaque artefact est livré là où il est consommé
DESTINATIONS = {
    HEADER: REPO / "firmware" / "lib" / "floodwatch_core" / "src" / HEADER,       # ESP32
    MODEL_JSON: REPO / "backend" / "simulator" / "fwsim" / MODEL_JSON,           # stations virtuelles
    REPORT: EXPORT / REPORT,                                                     # rapport d'évaluation
}
HARNESS = REPO / "ml" / "harness" / "check_model.c"

HOURS = 24.0
SEEDS = {"train": (101, 102, 103, 104, 105, 106), "validation": (201, 202), "test": (301,)}
RULE_SPREAD_CM = 1.0
DEPTHS = (4, 6, 8)
BAD_WEIGHTS = (1.0, 1.5, 2.0, 3.0, 4.0, 6.0, 8.0, 12.0)
MIN_SAMPLES_LEAF = 25
EXPORTED = "randomized"

#: critères d'acceptation du modèle exporté (voir docs/ml-architecture.md)
GATE = {
    "max_extra_false_alarm": 0.01,      # tolérance : le seuil est choisi en validation, pas en test
    "max_depth": 8,
    # Code machine du modèle compilé en -Os, mesuré sur x86-64 : faute de chaîne Xtensa, c'est un
    # ordre de grandeur de l'empreinte en flash sur l'ESP32 (4 Mo), pas une mesure exacte.
    "max_text_bytes": 16 * 1024,
    "min_c_agreement": 1.0,             # le C embarqué doit décider exactement comme Python
    "min_py_agreement": 1.0,            # ... et l'évaluateur Python du simulateur aussi
}

PHYSICS = {
    "nominal": lambda seed: SensorPhysics(),
    "randomized": lambda seed: SensorPhysics.randomized(random.Random(10_000 + seed)),
}


# ----------------------------------------------------------------------------- données
def build(seeds: tuple[int, ...], physics_for) -> tuple[np.ndarray, list[dict]]:
    """Lectures retenues des graines données, avec leurs indicateurs (une série par graine)."""
    X, rows = [], []
    for seed in seeds:
        x, kept = extract(sensor_bench.generate(seed=seed, hours=HOURS, physics=physics_for(seed)))
        X += x
        rows += kept
    return np.asarray(X, dtype=np.float32), rows


def labels(rows: list[dict]) -> np.ndarray:
    return np.array([r["quality"] == "BAD" for r in rows], dtype=np.int32)


def rule(rows: list[dict]) -> np.ndarray:
    return np.array([sensor_bench.rule_flags(r, RULE_SPREAD_CM) for r in rows], dtype=bool)


def score(flags: np.ndarray, rows: list[dict]) -> dict:
    """Lectures fausses attrapées, fausses alertes sur lectures saines, détail par condition."""
    quality = np.array([r["quality"] for r in rows])
    condition = np.array([r["condition"] for r in rows])
    bad, good, degraded = quality == "BAD", quality == "GOOD", quality == "DEGRADED"
    per_condition = {}
    for c in Condition:
        mask = bad & (condition == c.value)
        if mask.any():
            per_condition[c.value] = {"bad": int(mask.sum()), "caught": round(float(flags[mask].mean()), 4)}
    return {
        "bad": int(bad.sum()),
        "good": int(good.sum()),
        "bad_recall": round(float(flags[bad].mean()), 4),
        "false_alarm": round(float(flags[good].mean()), 4),
        "flagged_degraded": round(float(flags[degraded].mean()), 4) if degraded.any() else None,
        "by_condition": per_condition,
    }


# ----------------------------------------------------------------------------- modèles
def candidates(kind: str):
    if kind == "tree":
        for depth in DEPTHS:
            for w in BAD_WEIGHTS:
                yield {"max_depth": depth, "bad_weight": w}, DecisionTreeClassifier(
                    max_depth=depth, min_samples_leaf=MIN_SAMPLES_LEAF, class_weight={0: 1.0, 1: w}, random_state=0)
    else:
        for w in BAD_WEIGHTS:
            yield {"max_depth": 6, "bad_weight": w, "trees": 10}, RandomForestClassifier(
                n_estimators=10, max_depth=6, min_samples_leaf=MIN_SAMPLES_LEAF, class_weight={0: 1.0, 1: w},
                random_state=0, n_jobs=1)


def nodes(model) -> int:
    if hasattr(model, "estimators_"):
        return int(sum(t.tree_.node_count for t in model.estimators_))
    return int(model.tree_.node_count)


def decide(model, X: np.ndarray) -> np.ndarray:
    """Décision exactement comme le code C embarqué (1 = lecture probablement fausse).

    Arbre : classe majoritaire de la feuille. Forêt : vote majoritaire STRICT des arbres ; à
    égalité, la lecture est jugée plausible (classe 0), comme dans le code C généré.
    """
    if hasattr(model, "estimators_"):
        votes = np.sum([est.predict(X) for est in model.estimators_], axis=0)
        return (votes > len(model.estimators_) / 2).astype(np.int32)
    return model.predict(X).astype(np.int32)


def selection_key(s: dict, max_false_alarm: float, size: int) -> tuple:
    feasible = s["false_alarm"] <= max_false_alarm
    return (feasible, s["bad_recall"] if feasible else -s["false_alarm"], -s["false_alarm"], -size)


def select(kind: str, X, y, Xv, rows_v, max_false_alarm: float):
    """Meilleur candidat d'une famille : rappel maximal en validation sous la contrainte de fausses alertes."""
    best = None
    for params, model in candidates(kind):
        model.fit(X, y)
        s = score(decide(model, Xv).astype(bool), rows_v)
        key = selection_key(s, max_false_alarm, nodes(model))
        if best is None or key > best[0]:
            best = (key, params, model, s)
    key, params, model, s = best
    return model, {**params, "nodes": nodes(model), "meets_false_alarm_limit": key[0]}, s, key


def experiment(physics_name: str, tests: dict) -> tuple[dict, object, np.ndarray]:
    """Une expérience complète : apprentissage, choix en validation, test nominal et décalé."""
    physics_for = PHYSICS[physics_name]
    X, rows = build(SEEDS["train"], physics_for)
    Xv, rows_v = build(SEEDS["validation"], physics_for)
    y = labels(rows)
    rule_val = score(rule(rows_v), rows_v)
    limit = rule_val["false_alarm"]
    tree, tree_params, tree_val, tree_key = select("tree", X, y, Xv, rows_v, limit)
    forest, forest_params, forest_val, forest_key = select("forest", X, y, Xv, rows_v, limit)
    tree_params["depth"] = int(tree.get_depth())
    forest_params["depth"] = int(max(t.get_depth() for t in forest.estimators_))
    family = "forest" if forest_key > tree_key else "tree"
    chosen = forest if family == "forest" else tree
    importance = chosen.feature_importances_
    result = {
        "training_sensor": physics_name,
        "data": {"train_readings": len(rows), "train_bad": int(y.sum()), "validation_readings": len(rows_v)},
        "false_alarm_limit_from_validation": limit,
        "chosen_family": family,
        "selected": {"tree": tree_params, "forest": forest_params},
        "validation": {"rule": rule_val, "tree": tree_val, "forest": forest_val},
        "feature_importance": {n: round(float(v), 4) for n, v in zip(FEATURES, importance)},
    }
    for name, (Xt, rows_t) in tests.items():
        result[name] = {"rule": score(rule(rows_t), rows_t), "tree": score(decide(tree, Xt).astype(bool), rows_t),
                        "forest": score(decide(forest, Xt).astype(bool), rows_t)}
    return result, chosen, tests["test_nominal"][0]


# ----------------------------------------------------------------------------- export C
def describe(model) -> str:
    if hasattr(model, "estimators_"):
        depth = max(t.get_depth() for t in model.estimators_)
        return (f"Forêt de {len(model.estimators_)} arbres (profondeur {depth}, {nodes(model)} nœuds), "
                f"vote majoritaire strict")
    return f"Arbre de décision (profondeur {model.get_depth()}, {nodes(model)} nœuds)"


def export_header(model, path: Path) -> None:
    from sensor_anomaly.codegen import to_c

    defines = "\n".join(f"#define SENSOR_ANOMALY_F_{name.upper()} {i}" for i, name in enumerate(FEATURES))
    banner = f"""/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : firmware – classifieur embarqué (TinyML)
 *  Fichier   : firmware/lib/floodwatch_core/src/{HEADER}
 *  FICHIER GÉNÉRÉ par ml/sensor_anomaly/train.py (codegen.py) : NE PAS MODIFIER À LA MAIN.
 * ============================================================================
 *  {describe(model)}, {len(FEATURES)} entrées float.
 *  Seuils float32 arrondis vers le bas et comparaison « <= » : décisions identiques à celles de
 *  l'entraînement (scikit-learn) et du simulateur, par construction.
 *  Sortie de sensor_anomaly_predict() : 1 = lecture probablement fausse, 0 = lecture plausible.
 *  Le classifieur ne décide de rien seul : voir l'invariant de sécurité de docs/ml-architecture.md.
 *  Entrées, dans l'ordre des SENSOR_ANOMALY_F_* ci-dessous (calcul : backend/simulator/fwsim/features.py
 *  et lib/floodwatch_core/src/fw_core.cpp, fenêtre de {WINDOW} lectures).
 * ============================================================================
 */
#ifndef SENSOR_ANOMALY_MODEL_H
#define SENSOR_ANOMALY_MODEL_H

#include <stdint.h>

#define SENSOR_ANOMALY_N_FEATURES {len(FEATURES)}
{defines}

"""
    path.write_text(banner + to_c(model) + "\n#endif /* SENSOR_ANOMALY_MODEL_H */\n", encoding="utf-8")


def export_json(model, path: Path) -> None:
    """Même modèle, format JSON lu par les stations virtuelles (fwsim/anomaly.py)."""
    from sensor_anomaly.codegen import to_json

    path.write_text(json.dumps(to_json(model, list(FEATURES), describe(model)), separators=(",", ":")) + "\n",
                    encoding="utf-8")


def py_agreement(path: Path, X: np.ndarray, expected: np.ndarray) -> float:
    from fwsim.anomaly import AnomalyModel

    m = AnomalyModel.load(path)
    got = np.array([int(m.suspect([float(v) for v in row])) for row in X], dtype=np.int32)
    return float((got == expected).mean())


def c_agreement(header_dir: Path, X: np.ndarray, expected: np.ndarray) -> float:
    """Compile le modèle C avec le banc d'essai et compare ses décisions à celles de Python."""
    gcc = shutil.which("gcc")
    if gcc is None:
        raise RuntimeError("gcc introuvable : impossible de vérifier le modèle C")
    with tempfile.TemporaryDirectory() as tmp:
        exe = Path(tmp) / "check_model"
        subprocess.run([gcc, "-O2", "-Wall", "-Werror", "-std=c99", f"-I{header_dir}", str(HARNESS), "-o", str(exe)],
                       check=True)
        lines = "\n".join(",".join(format(float(v), ".9g") for v in row) for row in X) + "\n"
        out = subprocess.run([str(exe)], input=lines, capture_output=True, text=True, check=True).stdout.split()
    predicted = np.array([int(v) for v in out], dtype=np.int32)
    if len(predicted) != len(expected):
        raise RuntimeError(f"le modèle C a répondu {len(predicted)} fois pour {len(expected)} vecteurs")
    return float((predicted == expected).mean())


def compiled_text_bytes(header_dir: Path) -> int:
    """Taille du code machine du modèle compilé en -Os (x86-64 : ordre de grandeur pour l'ESP32)."""
    with tempfile.TemporaryDirectory() as tmp:
        unit, obj = Path(tmp) / "unit.c", Path(tmp) / "unit.o"
        unit.write_text('#include "sensor_anomaly_model.h"\n'
                        "int32_t classify(const float *f) { return sensor_anomaly_predict(f, SENSOR_ANOMALY_N_FEATURES); }\n")
        subprocess.run(["gcc", "-Os", "-std=c99", "-c", f"-I{header_dir}", str(unit), "-o", str(obj)], check=True)
        out = subprocess.run(["size", "-A", str(obj)], capture_output=True, text=True, check=True).stdout
    return sum(int(line.split()[1]) for line in out.splitlines() if line.startswith(".text"))


# ----------------------------------------------------------------------------- programme
def run(out_dir: Path) -> dict:
    tests = {"test_nominal": build(SEEDS["test"], PHYSICS["nominal"]),
             "test_shifted": build(SEEDS["test"], lambda seed: SensorPhysics.shifted())}
    report = {
        "protocol": {"hours_per_seed": HOURS, "seeds": {k: list(v) for k, v in SEEDS.items()},
                     "rule_spread_cm": RULE_SPREAD_CM, "bad_error_cm": sensor_bench.BAD_ERROR_CM,
                     "features": list(FEATURES), "window": WINDOW, "exported_experiment": EXPORTED,
                     "test_readings": {k: len(v[1]) for k, v in tests.items()}},
        "experiments": {},
    }
    exported = None
    for name in ("nominal", "randomized"):
        result, model, Xt = experiment(name, tests)
        report["experiments"][name] = result
        if name == EXPORTED:
            exported = (model, Xt)
    model, Xt = exported
    export_header(model, out_dir / HEADER)
    export_json(model, out_dir / MODEL_JSON)
    e = report["experiments"][EXPORTED]
    sel = e["selected"][e["chosen_family"]]
    sel["header_bytes"] = (out_dir / HEADER).stat().st_size
    sel["text_bytes_x86_Os"] = compiled_text_bytes(out_dir)
    sel["c_agreement"] = c_agreement(out_dir, Xt, decide(model, Xt))
    sel["py_agreement"] = py_agreement(out_dir / MODEL_JSON, Xt, decide(model, Xt))
    (out_dir / REPORT).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return report


def gate(report: dict) -> list[str]:
    """Critères d'acceptation du modèle exporté ; renvoie les manquements (vide = accepté)."""
    problems = []
    e = report["experiments"][report["protocol"]["exported_experiment"]]
    family = e["chosen_family"]
    t = e["selected"][family]
    if not t["meets_false_alarm_limit"]:
        problems.append("le modèle retenu ne respecte pas en validation le taux de fausses alertes de la règle")
    for split, label in (("test_nominal", "capteur nominal"), ("test_shifted", "capteur décalé")):
        model, ref = e[split][family], e[split]["rule"]
        if model["bad_recall"] <= ref["bad_recall"]:
            problems.append(f"{label} : le modèle attrape {model['bad_recall']:.1%} des lectures fausses, "
                            f"pas plus que la règle ({ref['bad_recall']:.1%})")
        if model["false_alarm"] > ref["false_alarm"] + GATE["max_extra_false_alarm"]:
            problems.append(f"{label} : {model['false_alarm']:.1%} de fausses alertes, "
                            f"contre {ref['false_alarm']:.1%} pour la règle")
    if t["depth"] > GATE["max_depth"]:
        problems.append(f"profondeur {t['depth']} > {GATE['max_depth']}")
    if t["text_bytes_x86_Os"] > GATE["max_text_bytes"]:
        problems.append(f"code compilé de {t['text_bytes_x86_Os']} octets > {GATE['max_text_bytes']}")
    if t["c_agreement"] < GATE["min_c_agreement"]:
        problems.append(f"le modèle C ne décide comme Python que sur {t['c_agreement']:.4%} des lectures")
    if t.get("py_agreement", 0.0) < GATE["min_py_agreement"]:
        problems.append(f"le modèle du simulateur ne décide comme scikit-learn que sur "
                        f"{t.get('py_agreement', 0.0):.4%} des lectures")
    return problems


def show(report: dict) -> None:
    def pct(v):
        return "—" if v is None else f"{100 * v:5.1f} %"

    for name, e in report["experiments"].items():
        sel = e["selected"]
        star = "  <- EXPORTÉE" if name == report["protocol"]["exported_experiment"] else ""
        print(f"\n===== expérience « {name} » (capteur d'apprentissage : {e['training_sensor']}){star}")
        print(f"  {e['data']['train_readings']} lectures d'apprentissage ({e['data']['train_bad']} fausses) ; "
              f"limite de fausses alertes {pct(e['false_alarm_limit_from_validation'])} ; "
              f"famille retenue en validation : {e['chosen_family']}")
        for family, label in (("tree", "arbre"), ("forest", "forêt")):
            t = sel[family]
            extra = (f", source {t['header_bytes']} o, code -Os {t['text_bytes_x86_Os']} o, "
                     f"accord C/Python {pct(t['c_agreement'])}") if "c_agreement" in t else ""
            size = f"{t['trees']} arbres, " if "trees" in t else ""
            print(f"  {label} : {size}profondeur {t['depth']}, {t['nodes']} nœuds, poids BAD {t['bad_weight']}{extra}")
        print(f"  {'':<14} {'règle':>17} {'arbre':>17} {'forêt':>17}")
        print(f"  {'':<14} " + "  ".join(f"{'attr.':>7} {'f.al.':>7}" for _ in range(3)))
        for split in ("validation", "test_nominal", "test_shifted"):
            cells = "  ".join(f"{pct(e[split][m]['bad_recall']):>7} {pct(e[split][m]['false_alarm']):>7}"
                              for m in ("rule", "tree", "forest"))
            print(f"  {split:<14} {cells}")
    e = report["experiments"][report["protocol"]["exported_experiment"]]
    for split in ("test_nominal", "test_shifted"):
        print(f"\n{'condition (' + split + ')':<28} {'fausses':>8} {'règle':>8} {'arbre':>8} {'forêt':>8}")
        t = e[split]
        for c, v in t["rule"]["by_condition"].items():
            print(f"  {c:<26} {v['bad']:>8} {pct(v['caught']):>8} {pct(t['tree']['by_condition'][c]['caught']):>8} "
                  f"{pct(t['forest']['by_condition'][c]['caught']):>8}")
    print(f"\nimportance des entrées (modèle exporté : {e['chosen_family']}) : " + ", ".join(
        f"{k} {v:.2f}" for k, v in sorted(e["feature_importance"].items(), key=lambda kv: -kv[1]) if v > 0))


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(description="Classifieur embarqué de validité du capteur de niveau")
    p.add_argument("--check", action="store_true",
                   help="refait tout dans un dossier temporaire, applique les critères et vérifie ml/export/")
    a = p.parse_args(argv)
    if not a.check:
        with tempfile.TemporaryDirectory() as tmp:
            report = run(Path(tmp))
            for name, dest in DESTINATIONS.items():
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(Path(tmp) / name, dest)
        show(report)
        problems = gate(report)
        print("\n" + ("CRITÈRES : modèle accepté" if not problems
                      else "CRITÈRES NON ATTEINTS :\n  - " + "\n  - ".join(problems)))
        return 0 if not problems else 1
    with tempfile.TemporaryDirectory() as tmp:
        out = Path(tmp)
        report = run(out)
        show(report)
        problems = gate(report)
        for name, committed in DESTINATIONS.items():
            if not committed.is_file() or committed.read_bytes() != (out / name).read_bytes():
                problems.append(f"{committed.relative_to(REPO).as_posix()} n'est pas à jour : "
                                f"relancer python ml/sensor_anomaly/train.py")
    if problems:
        print("\nÉCHEC :\n  - " + "\n  - ".join(problems))
        return 1
    print("\nOK : critères atteints et ml/export/ à jour")
    return 0


if __name__ == "__main__":
    sys.exit(main())
