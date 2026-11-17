/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : firmware – classifieur embarqué (TinyML)
 *  Fichier   : ml/export/sensor_anomaly_model.h
 *  FICHIER GÉNÉRÉ par ml/sensor_anomaly/train.py (emlearn) : NE PAS MODIFIER À LA MAIN.
 * ============================================================================
 *  Arbre de décision (profondeur 4, 31 nœuds), 10 entrées float.
 *  Sortie de sensor_anomaly_predict() : 1 = lecture probablement fausse, 0 = lecture plausible.
 *  Le classifieur ne décide de rien seul : voir l'invariant de sécurité de docs/ml-architecture.md.
 *  Entrées, dans l'ordre des SENSOR_ANOMALY_F_* ci-dessous (calcul : ml/sensor_anomaly/features.py,
 *  fenêtre de 6 lectures).
 * ============================================================================
 */
#ifndef SENSOR_ANOMALY_MODEL_H
#define SENSOR_ANOMALY_MODEL_H

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



    // !!! This file is generated using emlearn !!!

    #include <stdint.h>
    

static inline int32_t sensor_anomaly_tree_0(const float *features, int32_t features_length) {
          if (features[8] < 0.703083f) {
              if (features[2] < 1.955500f) {
                  if (features[3] < 0.129581f) {
                      if (features[6] < 0.431250f) {
                          return 0;
                      } else {
                          return 1;
                      }
                  } else {
                      if (features[4] < 11.084915f) {
                          return 0;
                      } else {
                          return 1;
                      }
                  }
              } else {
                  if (features[7] < 3.500000f) {
                      if (features[2] < 2.101000f) {
                          return 1;
                      } else {
                          return 1;
                      }
                  } else {
                      if (features[9] < 1.416667f) {
                          return 0;
                      } else {
                          return 0;
                      }
                  }
              }
          } else {
              if (features[4] < -0.706212f) {
                  if (features[1] < 0.848500f) {
                      if (features[8] < 6.018250f) {
                          return 0;
                      } else {
                          return 1;
                      }
                  } else {
                      if (features[2] < -0.020000f) {
                          return 1;
                      } else {
                          return 1;
                      }
                  }
              } else {
                  if (features[2] < -0.191000f) {
                      if (features[1] < 0.711500f) {
                          return 0;
                      } else {
                          return 1;
                      }
                  } else {
                      if (features[8] < 1.427750f) {
                          return 1;
                      } else {
                          return 1;
                      }
                  }
              }
          }
        }
        

int32_t sensor_anomaly_predict(const float *features, int32_t features_length) {

        int32_t votes[2] = {0,};
        int32_t _class = -1;

        _class = sensor_anomaly_tree_0(features, features_length); votes[_class] += 1;
    
        int32_t most_voted_class = -1;
        int32_t most_voted_votes = 0;
        for (int32_t i=0; i<2; i++) {

            if (votes[i] > most_voted_votes) {
                most_voted_class = i;
                most_voted_votes = votes[i];
            }
        }
        return most_voted_class;
    }
    

int sensor_anomaly_predict_proba(const float *features, int32_t features_length, float *out, int out_length) {

        int32_t _class = -1;

        for (int i=0; i<out_length; i++) {
            out[i] = 0.0f;
        }

        _class = sensor_anomaly_tree_0(features, features_length); out[_class] += 1.0f;
    
        // compute mean
        for (int i=0; i<out_length; i++) {
            out[i] = out[i] / 1;
        }
        return 0;
    }

#endif /* SENSOR_ANOMALY_MODEL_H */
