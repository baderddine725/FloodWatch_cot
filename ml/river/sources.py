# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – données réelles ouvertes
#  Fichier   : ml/river/sources.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-23          Modifié le : 2026-11-23          Version : 1.0
# =============================================================================
"""Données hydrologiques RÉELLES : Environment Agency (Angleterre), API « Hydrology », pas de 15 min.

Contains Environment Agency data licensed under the Open Government Licence v3.0
(https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).

Bassin choisi : la **Calder** (Yorkshire de l'Ouest), rivière à crues rapides — Hebden Bridge et
Mytholmroyd inondées le 26 décembre 2015 (3,63 m à Hebden Bridge, record) puis en février 2020
(tempête Ciara). Trois limnimètres en chaîne, comme les trois stations FloodWatch :

    Todmorden (amont)  ──►  Hebden Bridge  ──►  Sowerby Bridge (aval)

et quatre pluviomètres du bassin versant amont. Seuils : « typical range high » publié par l'agence
pour chaque station (API flood-monitoring, ``stageScale``) : au-delà, la rivière sort de sa plage
habituelle — c'est l'équivalent du seuil critique d'une station FloodWatch.
"""
from __future__ import annotations

import csv
import io
import logging
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

LOG = logging.getLogger("river.sources")
BASE = "https://environment.data.gov.uk/hydrology/id/measures"
LICENCE = ("Contains Environment Agency data licensed under the Open Government Licence v3.0 "
           "(https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/)")
USER_AGENT = "FloodWatch-education/1.0 (projet tutoré)"

#: limnimètres : code -> (référence EA, mesure niveau 15 min, seuil « typical range high » en m, amont)
GAUGES = {
    "todmorden": ("F1207", "d514099e-fa72-4241-b655-cb6899a21cc7-level-i-900-m-qualified", 1.30, None),
    "hebden-bridge": ("L1206", "cc307b4d-a053-4282-9042-7b8a64fccd0e-level-i-900-m-qualified", 1.60, "todmorden"),
    "sowerby-bridge": ("L1205", "7903e92a-0462-4a6e-a7b0-231cf11b1673-level-i-900-m-qualified", 1.40, "hebden-bridge"),
}
#: pluviomètres du bassin amont (mm cumulés sur 15 min)
RAIN_GAUGES = {
    "gorpley": "cbd85eb5-b6fe-4478-b2e8-245205ef84e3-rainfall-t-900-mm-qualified",
    "gorple": "b71f87b9-99fc-4d54-bc8e-f1820ac74c94-rainfall-t-900-mm-qualified",
    "walshaw-dean": "445f2262-65b1-4904-9587-c9bdfea18d50-rainfall-t-900-mm-qualified",
    "blackstone-edge": "b81a76b5-3a81-4222-8207-105d4a1d146b-rainfall-t-900-mm-qualified",
}
FIRST_YEAR = 2008
#: qualités retenues (les valeurs « Suspect » ou absentes sont écartées)
KEEP_QUALITY = {"Good", "Estimated", "Unchecked"}


def _download(url: str, attempts: int = 4) -> bytes:
    for k in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.read()
        except OSError as e:
            if k == attempts - 1:
                raise
            LOG.warning("téléchargement en échec (%s), nouvel essai", e)
            time.sleep(5 * (k + 1))
    raise AssertionError


def year_file(cache: Path, measure: str, year: int, refresh_days: float = 7.0) -> Path:
    """CSV brut d'une mesure pour une année, en cache ; l'année en cours est retéléchargée après 7 jours."""
    path = cache / measure / f"{year}.csv"
    current = year >= date.today().year - 1                 # les données « qualifiées » arrivent en retard
    if path.is_file() and (not current or time.time() - path.stat().st_mtime < refresh_days * 86400):
        return path
    url = f"{BASE}/{measure}/readings.csv?mineq-date={year}-01-01&max-date={year + 1}-01-01&_limit=200000"
    LOG.info("téléchargement %s %d", measure[:8], year)
    data = _download(url)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)
    return path


def parse(text: str) -> list[tuple[int, float]]:
    """(instant UTC en s, valeur) des lectures exploitables, triées."""
    out = []
    for rec in csv.DictReader(io.StringIO(text)):
        if rec.get("quality") not in KEEP_QUALITY or rec.get("value") in (None, ""):
            continue
        ts = datetime.fromisoformat(rec["dateTime"]).replace(tzinfo=timezone.utc).timestamp()
        out.append((int(ts), float(rec["value"])))
    out.sort()
    return out


def fetch_all(cache: Path, last_year: int | None = None) -> dict[str, list[tuple[int, float]]]:
    """Toutes les séries (niveaux et pluies) de FIRST_YEAR à ``last_year`` inclus."""
    last_year = last_year or date.today().year
    series: dict[str, list[tuple[int, float]]] = {}
    measures = {**{f"level:{c}": g[1] for c, g in GAUGES.items()}, **{f"rain:{c}": m for c, m in RAIN_GAUGES.items()}}
    for key, measure in measures.items():
        rows: list[tuple[int, float]] = []
        for year in range(FIRST_YEAR, last_year + 1):
            rows.extend(parse(year_file(cache, measure, year).read_text(encoding="utf-8")))
        series[key] = sorted(set(rows))
        LOG.info("%s : %d lectures", key, len(series[key]))
    return series
