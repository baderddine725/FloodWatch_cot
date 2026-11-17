# Contrat MQTT FloodWatch

Racine : `floodwatch/stations/{code}/…` (`code` = identifiant de la station, ex. `underpass-01`,
également nom d'utilisateur MQTT de la station sur le broker local). Charges utiles : JSON UTF-8.

| Topic | Sens | QoS | Retenu | Contenu |
|---|---|---|---|---|
| `fw/raw/{code}/telemetry` | station → Node-RED (local uniquement) | 1 | non | télémétrie brute, validée et filtrée par la passerelle : `{"levelCm":12.4,"rain":0.8,"sensorOk":true,"echoOk":5,"echoSpreadCm":0.31,"suspect":false,"seq":42}` |
| `floodwatch/stations/{code}/telemetry` | → Cloud | 1 | non | `{"levelCm":12.4,"rawLevelCm":12.6,"rain":0.8,"sensorOk":true,"echoOk":5,"echoSpreadCm":0.31,"suspect":false,"outliers":[…],"seq":42,"ts":…,"gw":"gw-ariana-01","zone":"ariana"}` |
| `…/heartbeat` | → Cloud, toutes les 15 s | 0/1 | non | `{"uptime":3600,"rssi":-61,"fw":"1.0.0","heap":180000}` |
| `…/state` | → Cloud, à chaque changement | 1 | **oui** | `{"barrier":"CLOSED","light":"RED","siren":true,"sampling":"WATCH","localSafety":true,"mode":"LOCAL_SAFETY"}` (`mode` : NORMAL, LOCAL_SAFETY, DEGRADED ; firmware ≥ 1.3) |
| `…/status` | → Cloud (LWT) | 1 | **oui** | `online` / `offline` (message de dernière volonté) |
| `…/ack` | → Cloud | 1 | non | `{"id":"<uuid commande>","ok":false,"detail":"verrouillage sécurité"}` |
| `…/cmd` | Cloud → station | 1 | non | `{"id":"<uuid>","actuator":"barrier","value":"CLOSE","ts":1793640000000}` |
| `…/config` | Cloud → station | 1 | **oui** | seuils : `criticalCm, yellowPct, orangePct, redPct, rainThreshold, reopenDelaySec, degradedCloseSec, sensorHeightCm, periodNormalSec, periodWatchSec, heartbeatSec` |
| `…/td` | → Cloud, à chaque connexion | 1 | **oui** | Thing Description W3C WoT 1.1 de la station (exemples : `docs/wot/`). Non lue par le middleware |
| `floodwatch/gateways/{gw}/events` | passerelle → Cloud | 1 | non | `{"type":"station_mute","station":"wadi-01","silentSec":46}` / `station_back` / `gateway_alive` / `local_safety` (règle 85 % de la passerelle) / fog : `propagation_alert`, `propagation_end`, `calibration` (voir ci-dessous) |
| `floodwatch/gateways/{gw}/bridge` | Node-RED (naissance / LWT) ou pont Mosquitto | 1 | oui | `1` connecté / `0` déconnecté |

**Diagnostic du capteur** (firmware ≥ 1.2, champs facultatifs — un ancien firmware reste accepté) :

| Champ | Produit par | Sens |
|---|---|---|
| `echoOk` | station | nombre d'échos reçus sur la salve de 5 (moins de 3 : lecture rejetée, `sensorOk=false`) |
| `echoSpreadCm` | station | écart max − min entre les échos reçus : une salve dispersée signale mousse, obstacle ou éclaboussures |
| `rawLevelCm` | passerelle | lecture avant la moyenne glissante (`levelCm` est la valeur lissée) |
| `suspect` | station (firmware ≥ 1.3) | verdict du classifieur embarqué (arbre de décision) : lecture probablement fausse |
| `outliers` | passerelle | lectures écartées comme aberrations depuis la mesure précédente (5 au plus) : `[{"levelCm":16.2,"echoOk":3,"echoSpreadCm":4.2,"ts":…}]` |

La passerelle n'envoie rien au Cloud quand elle écarte une lecture ; elle la joint à la mesure
retenue suivante. Le middleware historise ainsi **toutes** les lectures avec leur verdict
(`ACCEPTED`, `OUTLIER`, `FAULT`) dans `sensor_diagnostics`, sans nouveau topic ni nouvelle ACL.
Voir [`ml-architecture.md`](ml-architecture.md).

**Événements du fog** (`floodwatch/gateways/{gw}/events`, passerelle ≥ v1.1 de `stations.json`) :

| `type` | Contenu | Effet côté Cloud |
|---|---|---|
| `propagation_alert` | `{"from":"upstream-01","to":"wadi-01","etaSec":480,"upstreamPct":50.4,"upstreamSlope":12.5,"basis":"rule"\|"model","projectedPct":72}` | alerte `PROPAGATION` (jaune) sur la station aval |
| `propagation_end` | `{"from":…,"to":…}` | alerte levée (sinon expirée au bout de 45 min) |
| `calibration` | `{"station":"wadi-01","a":6.1,"b":0.26,"g":0.24,"n":720,"r2":0.86,"upstream":[{"code":"upstream-01","travelSec":480}]}` | paramètres du modèle réservoir de la station (`g` nul sans amont) |

Avec une pré-alerte, la passerelle envoie aussi `sampling=WATCH` à la station aval (`…/cmd`, origine
`gateway`), puis `NORMAL` à la fin de l'épisode.

Actionneurs et valeurs : `barrier` OPEN|CLOSE · `light` GREEN|ORANGE|RED|OFF · `siren` ON|OFF · `sampling` NORMAL|WATCH.

Règles côté station (firmware et simulateur) :
- capteur aveugle : feu orange ; aveugle et pluie ≥ `rainThreshold` pendant `degradedCloseSec` : fermeture de précaution sans sirène (`mode=DEGRADED`) ;
- une lecture `suspect` sous l'orange ne compte pas pour rouvrir ;
- au-delà de `redPct` : fermeture autonome (barrière, feu rouge, sirène) et `localSafety=true`, sans attendre le Cloud ;
- réouverture autonome seulement après `reopenDelaySec` sous `orangePct` ;
- une commande `barrier=OPEN` reçue au-dessus de `redPct` est **refusée** (`ack.ok=false`) ;
- période de mesure : 5 s si pluie, niveau ≥ jaune ou `sampling=WATCH`, sinon 30 s.

Sécurité : broker local accessible en Wi-Fi WPA2 avec authentification et ACL par station
(la station `%u` publie seulement ses propres topics montants et lit seulement ses `cmd` / `config`,
cf. `backend/gateway/mosquitto/floodwatch.acl`). Relais passerelle → Cloud par Node-RED en **TLS 1.3** sur le
port 8883, avec file d'attente persistante pendant une coupure (le pont Mosquitto reste disponible en repli).
Le listener 1883 du Cloud n'est accessible que depuis le réseau Docker interne (API).
