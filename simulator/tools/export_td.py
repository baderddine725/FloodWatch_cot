#!/usr/bin/env python3
# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – back-end & IoT
#  Fichier   : simulator/tools/export_td.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03
#  Version   : 1.0
# =============================================================================
"""Exporte les Thing Descriptions depuis la fabrique Python (source unique) :

* ``docs/wot/<code>.td.json`` : TD des stations du registre (gateway/stations.json), lisibles ;
* ``firmware/include/td_template.h`` : un gabarit par type de station, avec des marqueurs
  ``{{CODE}}``, ``{{TITLE}}``, ``{{ZONE}}``, ``{{BROKER}}``, ``{{LAT}}``, ``{{LON}}``, ``{{FW}}``
  remplacés par le firmware au démarrage. Ainsi l'ESP32 publie exactement la TD validée par les tests.

Usage (depuis simulator/) : ``python tools/export_td.py``  ;  ``--check`` : échoue si les fichiers
générés ne sont pas à jour (utilisé par les tests).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from fwsim.config import DEFAULT_STATIONS_FILE, STATION_TYPES, StationInfo, load_registry  # noqa: E402
from fwsim.wot import ThingDescriptionFactory, validate_thing_description  # noqa: E402

REPO = HERE.parents[1]
DOCS_DIR = REPO / "docs" / "wot"
FIRMWARE_HEADER = REPO / "firmware" / "include" / "td_template.h"
DOCS_BROKER = "mqtts://floodwatch.example.tn:8883"
LAT_SENTINEL, LON_SENTINEL = 11.111111, 22.222222  # valeurs témoins remplacées par {{LAT}} / {{LON}}

PLACEHOLDERS = ("{{CODE}}", "{{TITLE}}", "{{ZONE}}", "{{BROKER}}", "{{LAT}}", "{{LON}}", "{{FW}}")


def template_for(station_type: str) -> str:
    """Gabarit JSON compact d'un type de station (marqueurs à la place des valeurs propres à la station)."""
    info = StationInfo(code="{{CODE}}", title="{{TITLE}}", type=station_type, zone="{{ZONE}}",
                       lat=LAT_SENTINEL, lon=LON_SENTINEL)
    td = ThingDescriptionFactory("{{BROKER}}", firmware_version="{{FW}}", device_model="FloodWatch ESP32").create(info)
    text = json.dumps(td, ensure_ascii=False, separators=(",", ":"))
    return text.replace(repr(LAT_SENTINEL), "{{LAT}}").replace(repr(LON_SENTINEL), "{{LON}}")


def fill(template: str, **values) -> str:
    """Remplace les marqueurs (même opération que tdFill() du firmware). Clés : code, title, zone..."""
    for key, value in values.items():
        template = template.replace("{{" + key.upper() + "}}", str(value))
    return template


def firmware_header() -> str:
    """Contenu de firmware/include/td_template.h."""
    lines = [
        "/*",
        " * ============================================================================",
        " *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)",
        " *  Couche    : firmware – back-end & IoT",
        " *  Fichier   : firmware/include/td_template.h  (FICHIER GÉNÉRÉ – ne pas modifier)",
        " *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)",
        " *  Auteur    : Ksontini Amine",
        " *  Créé le   : 2026-11-03          Modifié le : 2026-11-03",
        " *  Version   : 1.0",
        " * ============================================================================",
        " *  Gabarits de Thing Description W3C WoT 1.1, un par type de station, générés par",
        " *  simulator/tools/export_td.py depuis la fabrique Python validée par les tests.",
        " *  Marqueurs remplacés au démarrage : " + " ".join(PLACEHOLDERS),
        " */",
        "#pragma once",
        "#include <Arduino.h>",
        "",
    ]
    for t in STATION_TYPES:
        lines.append(f"static const char TD_TEMPLATE_{t}[] PROGMEM = R\"TD({template_for(t)})TD\";")
        lines.append("")
    lines.append("/** Gabarit correspondant au type de station (UNDERPASS, WADI, LOW_ROAD, FORD, OTHER). */")
    lines.append("inline const char *tdTemplateFor(const char *type) {")
    for t in STATION_TYPES[:-1]:
        lines.append(f"  if (strcmp(type, \"{t}\") == 0) return TD_TEMPLATE_{t};")
    lines.append(f"  return TD_TEMPLATE_{STATION_TYPES[-1]};")
    lines.append("}")
    return "\n".join(lines) + "\n"


def docs_files() -> dict[Path, str]:
    """TD lisibles des stations du registre."""
    factory = ThingDescriptionFactory(DOCS_BROKER, firmware_version="1.1.0", device_model="FloodWatch ESP32")
    out = {}
    for info in load_registry(DEFAULT_STATIONS_FILE).values():
        td = factory.create(info)
        result = validate_thing_description(td)
        if not result["valid"]:
            raise SystemExit(f"TD invalide pour {info.code} : {result['errors']}")
        out[DOCS_DIR / f"{info.code}.td.json"] = json.dumps(td, ensure_ascii=False, indent=2) + "\n"
    return out


def main(argv: list[str]) -> int:
    """Écrit (ou vérifie avec --check) les fichiers générés."""
    files = {FIRMWARE_HEADER: firmware_header(), **docs_files()}
    stale = [p for p, c in files.items() if not p.is_file() or p.read_text(encoding="utf-8") != c]
    if "--check" in argv:
        for p in stale:
            print(f"pas à jour : {p.relative_to(REPO)}  (lancer python tools/export_td.py)")
        return 1 if stale else 0
    for p, content in files.items():
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content, encoding="utf-8", newline="\n")
        print(f"écrit : {p.relative_to(REPO)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
