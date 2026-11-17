/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : firmware – banc d'essai du cœur portable sur le poste de travail
 *  Fichier   : firmware/test/host/core_replay.cpp
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 *  Rejoue des lectures dans le MÊME code que l'ESP32 (lib/floodwatch_core) et écrit, pour chaque
 *  lecture, tout ce que la station en déduit. ml/tests/test_core_parity.py compare ces lignes à
 *  celles du jumeau Python du simulateur : elles doivent être identiques.
 *
 *  Entrée (stdin)  : t_s,ok,level_cm,echo_ok,spread_cm,rain           (ok = 0|1, level vide si 0)
 *  Sortie (stdout) : f0;...;f9|suspect|barrier|light|siren|mode      (« - » si la lecture est rejetée)
 *  Compilation     : g++ -std=c++17 -O2 -ffp-contract=off -Ilib/floodwatch_core/src \
 *                        test/host/core_replay.cpp lib/floodwatch_core/src/fw_core.cpp
 * ============================================================================
 */
#include <cstdio>
#include <cstdlib>
#include <cstring>

#include "fw_core.h"

int main() {
  fw::FeatureState features;
  fw::SafetyController safety;
  fw::Outputs out;
  char line[512];
  while (std::fgets(line, sizeof line, stdin) != nullptr) {
    char *p = line;
    fw::Burst b{};
    b.tS = std::strtod(p, &p); p++;
    b.ok = std::strtol(p, &p, 10) != 0; p++;
    b.levelCm = (*p == ',') ? 0.0 : std::strtod(p, &p); p++;
    b.echoOk = (int)std::strtol(p, &p, 10); p++;
    b.spreadCm = std::strtod(p, &p); p++;
    b.rain = std::strtod(p, &p);

    float x[fw::N_FEATURES];
    bool has = features.update(b, x);
    bool suspect = has && fw::isSuspect(x);
    safety.step(b, suspect, out);
    if (has) {
      for (int i = 0; i < fw::N_FEATURES; i++) std::printf(i ? ";%.9g" : "%.9g", (double)x[i]);
    } else {
      std::printf("-");
    }
    std::printf("|%d|%d|%s|%d|%s\n", suspect ? 1 : 0, out.barrierClosed ? 1 : 0, fw::lightName(out.light),
                out.siren ? 1 : 0, fw::modeName(safety.mode()));
  }
  return 0;
}
