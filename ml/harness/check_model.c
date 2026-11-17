/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : apprentissage automatique – banc d'essai du modèle C
 *  Fichier   : ml/harness/check_model.c
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Guesmi Baderddine
 *  Créé le   : 2026-11-17          Modifié le : 2026-11-17
 *  Version   : 1.0
 * ============================================================================
 *  Compile l'en-tête généré (le MÊME qui sera inclus dans le firmware ESP32), lit des vecteurs
 *  d'entrée sur stdin (une ligne = SENSOR_ANOMALY_N_FEATURES flottants séparés par des virgules)
 *  et écrit une décision par ligne. ml/sensor_anomaly/train.py compare ces décisions à celles
 *  de scikit-learn : c'est le contrôle d'écart entre l'entraînement et le service.
 * ============================================================================
 */
#include <stdio.h>
#include <stdlib.h>

#include "sensor_anomaly_model.h"

int main(void) {
    char line[1024];
    float features[SENSOR_ANOMALY_N_FEATURES];
    while (fgets(line, sizeof line, stdin) != NULL) {
        char *p = line;
        for (int i = 0; i < SENSOR_ANOMALY_N_FEATURES; i++) {
            features[i] = strtof(p, &p);
            if (*p == ',') p++;
        }
        printf("%d\n", (int)sensor_anomaly_predict(features, SENSOR_ANOMALY_N_FEATURES));
    }
    return 0;
}
