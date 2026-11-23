# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : apprentissage automatique – cloud (prévision du niveau)
#  Fichier   : ml/forecast/data.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Guesmi Baderddine
#  Créé le   : 2026-11-23          Modifié le : 2026-11-23          Version : 1.0
# =============================================================================
"""Jeux de données VERSIONNÉS : extraction, empreinte, relecture.

Deux sources, un seul format :

* ``db`` (production) : la télémétrie réellement reçue par le middleware (table ``measurements``,
  mesures ACCEPTÉES) et la topologie des stations (``stations.upstream_links``), lues en lecture
  seule dans PostgreSQL ;
* ``sim`` (intégration continue, tests) : le banc du fog (``backend/simulator/tools/fog_bench.py``)
  produit la même télémétrie sans la pile Docker, filtrée comme le middleware la filtre.

Chaque extraction devient un **instantané** immuable ``<racine>/datasets/<id>/`` : ``measurements.csv.gz``
(gzip sans date : mêmes données, mêmes octets), ``sites.json`` et ``manifest.json``. L'identifiant est
l'empreinte SHA-256 des deux fichiers de données : un modèle cite l'instantané exact qui l'a produit.
"""
from __future__ import annotations

import csv
import gzip
import hashlib
import io
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from .features import Series, Site

REPO = Path(__file__).resolve().parents[2]


class Dataset:
    def __init__(self, sites: dict[str, Site], rows: list[tuple[str, float, float, float]], source: str,
                 meta: dict | None = None):
        self.sites = sites
        self.rows = sorted(rows, key=lambda r: (r[0], r[1]))
        self.source = source
        self.meta = meta or {}
        self.id = None
        self.manifest = None

    def span_hours(self) -> float:
        if not self.rows:
            return 0.0
        ts = [r[1] for r in self.rows]
        return (max(ts) - min(ts)) / 3600.0

    def series(self) -> dict[str, Series]:
        out: dict[str, Series] = {}
        for code, ts, level, rain in self.rows:
            s = out.setdefault(code, Series())
            s.ts.append(ts)
            s.level.append(level)
            s.rain.append(rain)
        return out

    # ------------------------------------------------------------------------------------ instantané
    def _blobs(self) -> tuple[bytes, bytes]:
        text = io.StringIO()
        w = csv.writer(text, lineterminator="\n")
        w.writerow(("code", "ts", "level_cm", "rain"))
        for code, ts, level, rain in self.rows:
            w.writerow((code, repr(float(ts)), repr(float(level)), repr(float(rain))))
        data = gzip.compress(text.getvalue().encode(), mtime=0)
        sites = json.dumps({c: {"criticalCm": s.critical_cm, "sensorHeightCm": s.sensor_height_cm,
                                "upstream": [list(u) for u in s.upstream]} for c, s in sorted(self.sites.items())},
                           indent=2, sort_keys=True).encode()
        return data, sites

    def save(self, root: Path) -> Path:
        data, sites = self._blobs()
        digest = hashlib.sha256(data + b"\0" + sites).hexdigest()
        self.id = digest[:12]
        folder = root / "datasets" / self.id
        counts: dict[str, int] = {}
        for r in self.rows:
            counts[r[0]] = counts.get(r[0], 0) + 1
        self.manifest = {
            "id": self.id, "sha256": digest, "source": self.source, "rows": len(self.rows), "perStation": counts,
            "from": self.rows[0][1] if self.rows else None, "to": self.rows[-1][1] if self.rows else None,
            "extractedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"), **self.meta,
        }
        if not (folder / "manifest.json").is_file():          # immuable : jamais réécrit
            folder.mkdir(parents=True, exist_ok=True)
            (folder / "measurements.csv.gz").write_bytes(data)
            (folder / "sites.json").write_bytes(sites)
            (folder / "manifest.json").write_text(json.dumps(self.manifest, indent=2), encoding="utf-8")
        else:
            self.manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        return folder

    @classmethod
    def load(cls, folder: Path) -> "Dataset":
        manifest = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        raw = json.loads((folder / "sites.json").read_text(encoding="utf-8"))
        sites = {c: Site(c, v["criticalCm"], v["sensorHeightCm"], tuple((u[0], float(u[1])) for u in v["upstream"]))
                 for c, v in raw.items()}
        rows = []
        with gzip.open(folder / "measurements.csv.gz", "rt", newline="") as f:
            for rec in csv.DictReader(f):
                rows.append((rec["code"], float(rec["ts"]), float(rec["level_cm"]), float(rec["rain"])))
        ds = cls(sites, rows, manifest["source"])
        ds.id, ds.manifest = manifest["id"], manifest
        return ds


# ---------------------------------------------------------------------------------------- sources
def parse_links(text: str | None) -> tuple[tuple[str, float], ...]:
    """``stations.upstream_links`` : « code:temps_s,code2:temps_s » (même règle que ForecastService)."""
    out = []
    for part in (text or "").split(","):
        kv = part.strip().split(":")
        if len(kv) == 2 and kv[0].strip():
            try:
                out.append((kv[0].strip(), float(kv[1])))
            except ValueError:
                pass
    return tuple(out)


def from_db(dsn: str | None = None, days: float = 14.0) -> Dataset:
    """Télémétrie acceptée des ``days`` derniers jours (connexion en lecture seule)."""
    import psycopg  # dépendance de production uniquement (image du service d'apprentissage)

    dsn = dsn or os.environ.get("ML_DB_DSN") or (
        f"host={os.environ.get('DB_HOST', 'postgres')} port={os.environ.get('DB_PORT', '5432')} "
        f"dbname={os.environ.get('DB_NAME', 'floodwatch')} user={os.environ.get('DB_USER', 'floodwatch')} "
        f"password={os.environ.get('DB_PASSWORD', '')}")
    with psycopg.connect(dsn, autocommit=True) as conn:
        conn.read_only = True
        sites = {}
        for code, crit, height, links in conn.execute(
                "SELECT code, critical_cm, sensor_height_cm, upstream_links FROM stations"):
            sites[code] = Site(code, float(crit), float(height), parse_links(links))
        rows = [(code, float(ts), float(level), float(rain)) for code, ts, level, rain in conn.execute(
            "SELECT s.code, extract(epoch FROM m.ts), m.level_cm, m.rain FROM measurements m "
            "JOIN stations s ON s.id = m.station_id WHERE m.ts >= now() - make_interval(secs => %s)",
            (days * 86400.0,))]
    return Dataset(sites, rows, "db", {"days": days})


def from_sim(seed: int = 1, hours: float = 24.0) -> Dataset:
    """Télémétrie du banc du fog (pluie de zone aléatoire, réponse propre à chaque site, couplage amont)."""
    sys.path[:0] = [str(REPO / "backend" / "simulator"), str(REPO / "backend" / "simulator" / "tools")]
    import fog_bench
    from fwsim.config import DEFAULT_STATIONS_FILE, load_registry
    from fwsim.topology import links_of

    registry = load_registry(DEFAULT_STATIONS_FILE)
    stations, _, messages, _ = fog_bench.simulate(seed, hours)
    upstream: dict[str, list] = {}
    for link in links_of({s.code: s.info for s in stations}):
        upstream.setdefault(link.downstream, []).append((link.upstream, link.travel_s))
    sites = {s.code: Site(s.code, registry[s.code].critical_cm, registry[s.code].sensor_height_cm,
                          tuple(upstream.get(s.code, ()))) for s in stations}
    rows = []
    for m in messages:
        p, site = m["payload"], sites[m["code"]]
        level = p["levelCm"]
        # filtre du middleware (ThingManager) : mesure refusée si capteur en défaut ou hors plage
        if not p["sensorOk"] or level < -2 or level > site.sensor_height_cm + 2:
            continue
        rows.append((m["code"], m["t"] / 1000.0, max(0.0, float(level)), float(p["rain"])))
    return Dataset(sites, rows, "sim", {"seed": seed, "hours": hours})
