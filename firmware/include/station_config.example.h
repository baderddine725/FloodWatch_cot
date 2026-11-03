/*
 * ============================================================================
 *  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
 *  Couche    : firmware – back-end & IoT
 *  Fichier   : firmware/include/station_config.example.h
 *  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
 *  Auteur    : Ksontini Amine
 *  Créé le   : 2026-11-02          Modifié le : 2026-11-03
 *  Version   : 1.1
 * ============================================================================
 *  Configuration d'une station. Copier ce fichier en include/station_config.h
 *  (ignoré par git : il contient les secrets Wi-Fi et MQTT) et l'adapter.
 */
#pragma once

// ---- Identité : le code sert d'identifiant MQTT et de nom d'utilisateur sur le broker local
#define STATION_CODE      "underpass-01"
#define MQTT_PASSWORD     "change-me"

// ---- Thing Description W3C WoT (publiée, retenue, sur floodwatch/stations/<code>/td)
#define STATION_TITLE     "Passage souterrain Ariana"
#define STATION_TYPE      "UNDERPASS"   // UNDERPASS | WADI | LOW_ROAD | FORD | OTHER (StationType du middleware)
#define STATION_ZONE      "ariana"
#define STATION_LAT       "36.8625"     // texte : recopié tel quel dans la TD
#define STATION_LON       "10.1956"
#define TD_BROKER_URL     "mqtts://floodwatch.example.tn:8883"  // broker public cité dans les formulaires

// ---- Réseau Wi-Fi de la passerelle (WPA2)
#define WIFI_SSID         "FloodWatch-GW"
#define WIFI_PASSWORD     "change-me"

// ---- Broker MQTT local de la passerelle Raspberry Pi
#define MQTT_HOST         "192.168.4.1"
#define MQTT_PORT         1883
// 1 = la télémétrie brute passe par Node-RED (fw/raw/...) ; 0 = publication directe floodwatch/...
#define USE_GATEWAY_RAW   1
// 1 = connexion directe au broker Cloud en TLS (sans passerelle) : définir aussi CLOUD_CA_PEM.
//     Le broker Cloud impose TLS 1.3 : cœur Arduino-ESP32 3.x (mbedTLS 3) requis.
//     Chemin recommandé : passer par la passerelle (USE_TLS 0).
#define USE_TLS           0
// #define CLOUD_CA_PEM "-----BEGIN CERTIFICATE-----\n...\n-----END CERTIFICATE-----\n"

// ---- Brochage (ESP32 DevKit v1)
#define PIN_TRIG          5    // HC-SR04 TRIG
#define PIN_ECHO          18   // HC-SR04 ECHO (5 V -> pont diviseur 1k/2k vers 3,3 V !)
#define PIN_RAIN_AO       34   // capteur de pluie, sortie analogique (ADC1)
#define PIN_SERVO         13   // servomoteur SG90 de la barrière
#define PIN_LED_RED       25
#define PIN_LED_ORANGE    26
#define PIN_LED_GREEN     27
#define PIN_BUZZER        14   // buzzer actif (sirène) via transistor
#define PIN_STATUS_LED    2    // LED intégrée : clignote si MQTT déconnecté

// ---- Étalonnage
#define SERVO_OPEN_DEG    90   // barrière levée
#define SERVO_CLOSED_DEG  0    // barrière baissée
#define RAIN_DRY_RAW      4095 // lecture ADC capteur sec
#define RAIN_WET_RAW      1200 // lecture ADC capteur saturé d'eau
