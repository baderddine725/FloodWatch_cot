/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : firmware – cœur portable de la station (edge)
 *  Fichier   : firmware/lib/floodwatch_core/src/fw_core.h
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 *  Logique de décision de la station, en C++ SANS dépendance Arduino : elle est compilée pour
 *  l'ESP32 (PlatformIO) ET pour le poste de travail (banc d'essai de firmware/test/host), ce qui
 *  permet de vérifier qu'elle se comporte exactement comme son jumeau Python du simulateur.
 *
 *   - FeatureState      indicateurs du classifieur (miroir de ml/sensor_anomaly/features.py)
 *   - isSuspect()       classifieur embarqué (ml/export -> sensor_anomaly_model.h, emlearn)
 *   - SafetyController  règle de sécurité locale + politique de capteur dégradé
 *
 *  Invariant de sécurité : le classifieur peut AVANCER une alerte, jamais la retarder. Une lecture
 *  suspecte au-dessus du rouge ferme quand même ; une lecture suspecte ne compte jamais pour rouvrir.
 * ============================================================================
 */
#pragma once

#include <stdint.h>

namespace fw {

/** Profondeur de l'historique des indicateurs (lectures). */
constexpr int WINDOW = 6;
/** Nombre d'indicateurs (ordre : SENSOR_ANOMALY_F_* de sensor_anomaly_model.h). */
constexpr int N_FEATURES = 10;

/** Une salve d'échos résumée par measure(). */
struct Burst {
  double tS;          // instant en secondes (millis() / 1000.0 sur l'ESP32)
  bool ok;            // lecture retenue par le firmware (>= 3 échos, dans la plage)
  double levelCm;     // niveau lu (significatif seulement si ok)
  int echoOk;         // échos reçus sur 5
  double spreadCm;    // écart max - min des échos
  double rain;        // pluie 0..1
};

/** Indicateurs du classifieur : deux tampons circulaires, aucune allocation. */
class FeatureState {
 public:
  /** Intègre une salve ; si elle est retenue, écrit les N_FEATURES indicateurs et renvoie vrai. */
  bool update(const Burst &b, float out[N_FEATURES]);

 private:
  struct B { bool ok; int echoOk; double spread; double rain; };
  struct L { double t; double level; };
  B bursts_[WINDOW];
  L levels_[WINDOW];
  int nBursts_ = 0, headBursts_ = 0;   // head = position de la PLUS ANCIENNE entrée
  int nLevels_ = 0, headLevels_ = 0;
  void push(const B &b);
  void push(const L &l);
  const B &burst(int i) const { return bursts_[(headBursts_ + i) % WINDOW]; }
  const L &level(int i) const { return levels_[(headLevels_ + i) % WINDOW]; }
};

/** Décision du classifieur embarqué sur un vecteur d'indicateurs (vrai = lecture probablement fausse). */
bool isSuspect(const float features[N_FEATURES]);

enum class Light : uint8_t { GREEN, ORANGE, RED, OFF };
enum class Mode : uint8_t { NORMAL, LOCAL_SAFETY, DEGRADED };

struct Thresholds {
  double criticalCm = 20, yellowPct = 30, orangePct = 60, redPct = 85;
  double rainThreshold = 0.2;
  uint32_t reopenDelaySec = 60;
  /** Capteur aveugle sous la pluie pendant ce délai : fermeture de précaution. */
  uint32_t degradedCloseSec = 120;
};

struct Outputs {
  bool barrierClosed = false;
  Light light = Light::GREEN;
  bool siren = false;
};

/**
 * Règle de sécurité locale et politique de capteur dégradé. Ne dépend ni du Wi-Fi ni du Cloud.
 *
 * - Lecture valide >= rouge (suspecte ou non) : fermeture, feu rouge, sirène (LOCAL_SAFETY).
 * - Réouverture après reopenDelaySec de lectures valides ET non suspectes sous l'orange.
 * - Capteur aveugle : feu orange (avertissement) s'il était vert ; aveugle sous une pluie >= seuil
 *   pendant degradedCloseSec : fermeture de précaution, feu rouge, sans sirène (DEGRADED).
 */
class SafetyController {
 public:
  explicit SafetyController(const Thresholds &t = Thresholds()) : t_(t) {}

  /**
   * Applique une lecture. Renvoie vrai si les sorties ont changé.
   * @param suspect décision du classifieur (ignorée si la lecture n'est pas valide)
   */
  bool step(const Burst &b, bool suspect, Outputs &out);

  /** Niveau que la station croit : dernière lecture valide (comme avant le cœur portable). */
  double believedLevelCm() const { return believed_; }
  Mode mode() const { return mode_; }
  bool blind() const { return blindSince_ >= 0; }
  void setThresholds(const Thresholds &t) { t_ = t; }
  const Thresholds &thresholds() const { return t_; }
  /** Une commande d'ouverture du Cloud lève les modes autonomes (voir handleCommand). */
  void releaseByCommand() { mode_ = Mode::NORMAL; belowOrangeSince_ = -1; }
  double pct(double levelCm) const { return 100.0 * levelCm / t_.criticalCm; }

 private:
  Thresholds t_;
  Mode mode_ = Mode::NORMAL;
  double believed_ = 0;
  double belowOrangeSince_ = -1;   // -1 = non armé
  double blindSince_ = -1;         // -1 = capteur voyant
  double rainBlindSince_ = -1;     // aveugle ET pluie >= seuil depuis
  bool warnedBlind_ = false;       // le feu orange vient de l'avertissement « capteur aveugle »
};

const char *lightName(Light l);
const char *modeName(Mode m);

}  // namespace fw
