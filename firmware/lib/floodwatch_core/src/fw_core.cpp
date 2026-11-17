/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : firmware – cœur portable de la station (edge)
 *  Fichier   : firmware/lib/floodwatch_core/src/fw_core.cpp
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 *  Les calculs suivent EXACTEMENT ml/sensor_anomaly/features.py : mêmes opérations, même ordre,
 *  en double précision, puis conversion en float. Le classifieur reçoit donc des entrées
 *  identiques au bit près à celles de l'entraînement (vérifié par firmware/test/host).
 *  Compiler avec -ffp-contract=off : une multiplication-addition fusionnée changerait les arrondis.
 * ============================================================================
 */
#include "fw_core.h"

#include <math.h>

#include "sensor_anomaly_model.h"  // généré par ml/sensor_anomaly/train.py : inclus ICI SEULEMENT

namespace fw {

// ----------------------------------------------------------------------------- indicateurs
void FeatureState::push(const B &b) {
  if (nBursts_ < WINDOW) {
    bursts_[(headBursts_ + nBursts_) % WINDOW] = b;
    nBursts_++;
  } else {
    bursts_[headBursts_] = b;
    headBursts_ = (headBursts_ + 1) % WINDOW;
  }
}

void FeatureState::push(const L &l) {
  if (nLevels_ < WINDOW) {
    levels_[(headLevels_ + nLevels_) % WINDOW] = l;
    nLevels_++;
  } else {
    levels_[headLevels_] = l;
    headLevels_ = (headLevels_ + 1) % WINDOW;
  }
}

static double median3(double a, double b, double c) {
  double v[3] = {a, b, c};
  for (int i = 1; i < 3; i++)
    for (int j = i; j > 0 && v[j - 1] > v[j]; j--) { double t = v[j]; v[j] = v[j - 1]; v[j - 1] = t; }
  return v[1];
}

bool FeatureState::update(const Burst &b, float out[N_FEATURES]) {
  push(B{b.ok, b.echoOk, b.spreadCm, b.rain});
  if (!b.ok) return false;

  // saut : niveau - médiane des 3 niveaux retenus précédents (avant d'ajouter le courant)
  double jump = 0.0;
  if (nLevels_ >= 3) jump = b.levelCm - median3(level(nLevels_ - 3).level, level(nLevels_ - 2).level,
                                                level(nLevels_ - 1).level);
  push(L{b.tS, b.levelCm});

  // écart type de population (moyenne, puis somme des carrés des écarts)
  double stdv = 0.0;
  if (nLevels_ >= 2) {
    double sum = 0.0;
    for (int i = 0; i < nLevels_; i++) sum += level(i).level;
    double mean = sum / nLevels_;
    double sq = 0.0;
    for (int i = 0; i < nLevels_; i++) sq += (level(i).level - mean) * (level(i).level - mean);
    double var = sq / nLevels_;
    stdv = sqrt(var > 0.0 ? var : 0.0);
  }

  // pente des moindres carrés, x en minutes relativement à la dernière lecture
  double slope = 0.0;
  if (nLevels_ >= 3) {
    double t0 = level(nLevels_ - 1).t;
    double sx = 0.0, sy = 0.0, sxx = 0.0, sxy = 0.0;
    for (int i = 0; i < nLevels_; i++) sx += (level(i).t - t0) / 60.0;
    for (int i = 0; i < nLevels_; i++) sy += level(i).level;
    for (int i = 0; i < nLevels_; i++) { double x = (level(i).t - t0) / 60.0; sxx += x * x; }
    for (int i = 0; i < nLevels_; i++) { double x = (level(i).t - t0) / 60.0; sxy += x * level(i).level; }
    double n = nLevels_;
    double den = n * sxx - sx * sx;
    slope = fabs(den) < 1e-12 ? 0.0 : (n * sxy - sx * sy) / den;
  }

  double rainSum = 0.0, spreadSum = 0.0, echoSum = 0.0;
  int rejected = 0;
  for (int i = 0; i < nBursts_; i++) rainSum += burst(i).rain;
  for (int i = 0; i < nBursts_; i++) rejected += burst(i).ok ? 0 : 1;
  for (int i = 0; i < nBursts_; i++) spreadSum += burst(i).spread;
  for (int i = 0; i < nBursts_; i++) echoSum += burst(i).echoOk;

  out[0] = (float)b.echoOk;
  out[1] = (float)b.spreadCm;
  out[2] = (float)jump;
  out[3] = (float)stdv;
  out[4] = (float)slope;
  out[5] = (float)b.rain;
  out[6] = (float)(rainSum / nBursts_);
  out[7] = (float)rejected;
  out[8] = (float)(spreadSum / nBursts_);
  out[9] = (float)(echoSum / nBursts_);
  return true;
}

bool isSuspect(const float features[N_FEATURES]) {
  return sensor_anomaly_predict(features, N_FEATURES) == 1;
}

// ----------------------------------------------------------------------------- sécurité
bool SafetyController::step(const Burst &b, bool suspect, Outputs &out) {
  const Outputs before = out;

  if (!b.ok) {
    // ---- capteur aveugle : aucune décision sur la valeur, politique dégradée
    if (blindSince_ < 0) blindSince_ = b.tS;
    belowOrangeSince_ = -1;  // pas de preuve de décrue
    if (b.rain >= t_.rainThreshold) {
      if (rainBlindSince_ < 0) rainBlindSince_ = b.tS;
    } else {
      rainBlindSince_ = -1;
    }
    if (mode_ == Mode::NORMAL && rainBlindSince_ >= 0 && b.tS - rainBlindSince_ >= t_.degradedCloseSec) {
      mode_ = Mode::DEGRADED;
      out.barrierClosed = true;
      out.light = Light::RED;
      out.siren = false;  // défaut de capteur : pas d'alarme sonore
      warnedBlind_ = false;
    } else if (mode_ == Mode::NORMAL && out.light == Light::GREEN) {
      out.light = Light::ORANGE;
      warnedBlind_ = true;
    }
  } else {
    // ---- lecture valide
    blindSince_ = -1;
    rainBlindSince_ = -1;
    believed_ = b.levelCm;
    if (warnedBlind_ && mode_ == Mode::NORMAL) {
      if (out.light == Light::ORANGE) out.light = Light::GREEN;
      warnedBlind_ = false;
    }
    double p = pct(b.levelCm);
    if (p >= t_.redPct) {
      // au-dessus du rouge : on ferme, même si la lecture est suspecte (ne jamais retarder)
      mode_ = Mode::LOCAL_SAFETY;
      belowOrangeSince_ = -1;
      out.barrierClosed = true;
      out.light = Light::RED;
      out.siren = true;
    } else if (mode_ != Mode::NORMAL) {
      if (p < t_.orangePct && !suspect) {
        if (belowOrangeSince_ < 0) {
          belowOrangeSince_ = b.tS;
        } else if (b.tS - belowOrangeSince_ >= t_.reopenDelaySec) {
          mode_ = Mode::NORMAL;
          belowOrangeSince_ = -1;
          out.barrierClosed = false;
          out.siren = false;
          out.light = p < t_.yellowPct ? Light::GREEN : Light::ORANGE;
        }
      } else if (p >= t_.orangePct) {
        belowOrangeSince_ = -1;
      }
      // lecture suspecte sous l'orange : ni preuve de décrue, ni remise à zéro
    }
  }
  return before.barrierClosed != out.barrierClosed || before.light != out.light || before.siren != out.siren;
}

const char *lightName(Light l) {
  switch (l) {
    case Light::GREEN: return "GREEN";
    case Light::ORANGE: return "ORANGE";
    case Light::RED: return "RED";
    default: return "OFF";
  }
}

const char *modeName(Mode m) {
  switch (m) {
    case Mode::LOCAL_SAFETY: return "LOCAL_SAFETY";
    case Mode::DEGRADED: return "DEGRADED";
    default: return "NORMAL";
  }
}

}  // namespace fw
