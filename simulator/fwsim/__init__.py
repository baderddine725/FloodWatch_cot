# =============================================================================
#  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
#  Couche    : simulateur – back-end & IoT
#  Fichier   : simulator/fwsim/__init__.py
#  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
#  Auteur    : Ksontini Amine
#  Créé le   : 2026-11-03          Modifié le : 2026-11-03
#  Version   : 1.1
# =============================================================================
"""Simulateur de stations FloodWatch, organisé en couches.

    config       configuration centralisée (variables d'environnement + CLI), validée au démarrage
    logs         journaux structurés (texte ou JSON)
    topics       contrat MQTT du middleware (floodwatch/stations/{code}/...)
    mqtt_service client MQTT : abonnement par motif, qos, retain, reconnexion (Retry), observateurs
    scenarios    scénarios de pluie (patron Strategy)
    wot          Thing Description W3C WoT 1.1 (patron Factory) et validation
    station      station virtuelle (même logique que le firmware ESP32)
    health       contrôle de santé HTTP (GET /health)
"""

__version__ = "1.1.0"
