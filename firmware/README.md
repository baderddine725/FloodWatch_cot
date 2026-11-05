<!--
  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
  Couche    : firmware – back-end & IoT
  Fichier   : firmware/README.md
  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
  Auteur    : Ksontini Amine
  Créé le   : 2026-11-05          Modifié le : 2026-11-05
  Version   : 1.0
-->

# Firmware de la station FloodWatch (ESP32)

Firmware PlatformIO / Arduino ([`src/main.cpp`](src/main.cpp)). Il fait le même travail qu'une station
simulée : mesure du niveau (HC-SR04) et de la pluie, barrière (servo), feu (3 LED), sirène (buzzer),
Last Will MQTT, règle de sécurité locale à 85 % et Thing Description WoT publiée à la connexion.

## 1. Matériel et câblage (ESP32 DevKit v1)

| Composant | Broche ESP32 | Remarque |
|---|---|---|
| HC-SR04 `TRIG` | GPIO 5 | |
| HC-SR04 `ECHO` | GPIO 18 | **pont diviseur 1 kΩ / 2 kΩ** : l'écho sort en 5 V, l'ESP32 accepte 3,3 V |
| HC-SR04 `VCC` / `GND` | 5 V (VIN) / GND | |
| Capteur de pluie `AO` | GPIO 34 | entrée analogique (ADC1, compatible Wi-Fi) |
| Servo SG90 (signal) | GPIO 13 | alimentation 5 V, masse commune avec l'ESP32 |
| LED rouge / orange / verte | GPIO 25 / 26 / 27 | résistance 220 Ω en série |
| Buzzer actif | GPIO 14 | via transistor NPN (le buzzer tire trop de courant pour une broche) |
| LED d'état | GPIO 2 (intégrée) | fixe = MQTT connecté, clignote = déconnecté |

Brochage et étalonnage modifiables dans `include/station_config.h`.

## 2. Configuration

```powershell
cd firmware
Copy-Item include\station_config.example.h include\station_config.h   # ignoré par git (secrets)
```

À renseigner dans `station_config.h` :

| Constante | Valeur pour un essai sur la pile Docker du PC |
|---|---|
| `STATION_CODE` | `underpass-01` (doit figurer dans `STATION_CODES` de `deploy/.env`) |
| `MQTT_PASSWORD` | valeur de `STATION_PASSWORD` dans `deploy/.env` |
| `WIFI_SSID`, `WIFI_PASSWORD` | ton réseau Wi-Fi (le même que le PC) |
| `MQTT_HOST` | adresse IP du PC (`ipconfig`), `MQTT_PORT` = 1883 (broker `mosquitto-local`) |
| `USE_GATEWAY_RAW` | `1` (mesures brutes filtrées par Node-RED) |
| `USE_TLS` | `0` (le TLS 1.3 est entre la passerelle et le Cloud) |
| `STATION_TYPE`, `STATION_TITLE`, `STATION_ZONE`, `STATION_LAT`, `STATION_LON` | identité publiée dans la TD |

Sous Windows, autoriser le port 1883 en entrée dans le pare-feu (réseau privé).

## 3. Compiler et flasher

- **Compilation seule**, sans rien installer : `cd deploy; docker compose --profile tools run --rm firmware`.
- **Flashage** : il faut l'accès au port USB, donc PlatformIO sur le PC (extension *PlatformIO IDE* de
  VS Code, ou `pip install platformio`) :

```powershell
cd firmware
pio run -t upload        # compile et flashe
pio device monitor       # moniteur série, 115200 bauds
```

Messages attendus au démarrage :

```
FloodWatch station underpass-01 – firmware 1.1.0
[WIFI] connexion...
[MQTT] connexion...
[WOT] Thing Description publiée (8xxx octets)
[MQTT] connecté
[CONFIG] critique 20.0 cm, rouge 85 %
```

## 4. Procédure de test sur la vraie carte

Pile Docker démarrée (`docker compose --profile iot up -d`, simulateur arrêté pour ne pas mélanger :
`docker compose stop simulator`), MQTT Explorer connecté à `localhost:1883` avec le compte `diag`.

Avec les réglages par défaut, le capteur est supposé **à 30 cm du fond** (`sensorHeightCm`) et le niveau
critique vaut **20 cm** : niveau = 30 − distance mesurée. Rapprocher la main du capteur revient donc à
faire monter l'eau.

| # | Action | Résultat attendu | OK |
|---|---|---|---|
| 1 | Mise sous tension | LED d'état fixe ; `floodwatch/stations/underpass-01/status` = `online` (retenu) | ☐ |
| 2 | Lire `…/td` dans MQTT Explorer | TD complète, `id` = `urn:floodwatch:station:underpass-01`, `location` correcte | ☐ |
| 3 | Rien devant le capteur (≈ 30 cm) | `fw/raw/underpass-01/telemetry` toutes les 30 s, niveau ≈ 0 ; feu vert | ☐ |
| 4 | Mouiller le capteur de pluie | `rain` > 0,2 ; mesures toutes les 5 s (`sampling` = `WATCH`) | ☐ |
| 5 | Main à **20 cm** (niveau 10 cm = 50 %), puis à **17 cm** (niveau 13 cm = 65 %) | jaune puis orange côté PWA Pilotage ; pas de fermeture | ☐ |
| 6 | Main à **moins de 13 cm** (niveau > 17 cm = 85 %) | **sans attendre le Cloud** : servo fermé, LED rouge, buzzer ; série `[SECURITE] … fermeture autonome` ; `state.localSafety` = `true` | ☐ |
| 7 | Depuis la PWA Pilotage, ouvrir la barrière (main toujours proche) | refus : `ack.ok` = `false`, « verrouillage sécurité » | ☐ |
| 8 | Retirer la main (> 18 cm, sous 60 %) | réouverture **après 60 s** : `[SECURITE] retour sous le seuil orange` | ☐ |
| 9 | Commandes manuelles (feu, sirène) depuis la PWA | exécutées, `[CMD] light=ORANGE -> OK`, acquittement `ok=true` | ☐ |
| 10 | Débrancher le Wi-Fi (couper le point d'accès) puis refaire l'étape 6 | la barrière se ferme quand même (règle locale) ; LED d'état clignote | ☐ |
| 11 | Débrancher l'alimentation de l'ESP32 | `status` = `offline` publié par le broker (Last Will), puis alerte « hors ligne » | ☐ |
| 12 | Obstacle hors de portée / capteur débranché | `sensorOk` = `false` ; alerte « capteur défaillant » côté middleware | ☐ |

Si l'étape 1 échoue, le moniteur série affiche le code d'erreur MQTT (`[MQTT] échec rc=…`) :
`rc=5` = mot de passe ou compte refusé (vérifier `STATION_CODE` / `STATION_PASSWORD`),
`rc=-2` = broker injoignable (IP du PC, pare-feu, port 1883).
