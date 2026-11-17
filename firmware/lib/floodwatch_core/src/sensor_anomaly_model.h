/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : firmware – classifieur embarqué (TinyML)
 *  Fichier   : firmware/lib/floodwatch_core/src/sensor_anomaly_model.h
 *  FICHIER GÉNÉRÉ par ml/sensor_anomaly/train.py (codegen.py) : NE PAS MODIFIER À LA MAIN.
 * ============================================================================
 *  Arbre de décision (profondeur 4, 31 nœuds), 10 entrées float.
 *  Seuils float32 arrondis vers le bas et comparaison « <= » : décisions identiques à celles de
 *  l'entraînement (scikit-learn) et du simulateur, par construction.
 *  Sortie de sensor_anomaly_predict() : 1 = lecture probablement fausse, 0 = lecture plausible.
 *  Le classifieur ne décide de rien seul : voir l'invariant de sécurité de docs/ml-architecture.md.
 *  Entrées, dans l'ordre des SENSOR_ANOMALY_F_* ci-dessous (calcul : backend/simulator/fwsim/features.py
 *  et lib/floodwatch_core/src/fw_core.cpp, fenêtre de 6 lectures).
 * ============================================================================
 */
#ifndef SENSOR_ANOMALY_MODEL_H
#define SENSOR_ANOMALY_MODEL_H

#include <stdint.h>

#define SENSOR_ANOMALY_N_FEATURES 10
#define SENSOR_ANOMALY_F_ECHO_OK 0
#define SENSOR_ANOMALY_F_SPREAD_CM 1
#define SENSOR_ANOMALY_F_JUMP_CM 2
#define SENSOR_ANOMALY_F_STD6_CM 3
#define SENSOR_ANOMALY_F_SLOPE6_CM_MIN 4
#define SENSOR_ANOMALY_F_RAIN 5
#define SENSOR_ANOMALY_F_RAIN_MEAN6 6
#define SENSOR_ANOMALY_F_REJECTED6 7
#define SENSOR_ANOMALY_F_SPREAD_MEAN6 8
#define SENSOR_ANOMALY_F_ECHO_OK_MEAN6 9

static int32_t sensor_anomaly_tree_0(const float *f) {
    if (f[8] <= 0.703083336f) {
        if (f[2] <= 1.95550001f) {
            if (f[3] <= 0.129580736f) {
                if (f[6] <= 0.431249976f) {
                    return 0;
                } else {
                    return 1;
                }
            } else {
                if (f[4] <= 11.0849142f) {
                    return 0;
                } else {
                    return 1;
                }
            }
        } else {
            if (f[7] <= 3.5f) {
                if (f[2] <= 2.10099983f) {
                    return 1;
                } else {
                    return 1;
                }
            } else {
                if (f[9] <= 1.41666663f) {
                    return 0;
                } else {
                    return 0;
                }
            }
        }
    } else {
        if (f[4] <= -0.706211865f) {
            if (f[1] <= 0.848499954f) {
                if (f[8] <= 6.01824999f) {
                    return 0;
                } else {
                    return 1;
                }
            } else {
                if (f[2] <= -0.0199999996f) {
                    return 1;
                } else {
                    return 1;
                }
            }
        } else {
            if (f[2] <= -0.191f) {
                if (f[1] <= 0.711499989f) {
                    return 0;
                } else {
                    return 1;
                }
            } else {
                if (f[8] <= 1.42774999f) {
                    return 1;
                } else {
                    return 1;
                }
            }
        }
    }
}

/** 1 = lecture probablement fausse : au moins 1 arbre(s) sur 1 (à égalité : lecture plausible). */
static inline int32_t sensor_anomaly_predict(const float *features, int32_t features_length) {
    (void)features_length;
    int32_t votes = 0;
    votes += sensor_anomaly_tree_0(features);
    return 2 * votes > 1 ? 1 : 0;
}

#endif /* SENSOR_ANOMALY_MODEL_H */
