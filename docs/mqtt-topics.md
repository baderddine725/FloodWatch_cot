# Contrat MQTT FloodWatch

Racine : `floodwatch/stations/{code}/…` (`code` = identifiant de la station, ex. `underpass-01`,
également nom d'utilisateur MQTT de la station sur le broker local). Charges utiles : JSON UTF-8.

| Topic | Sens | QoS | Retenu | Contenu |
|---|---|---|---|---|
| `fw/raw/{code}/telemetry` | station → Node-RED (local uniquement) | 1 | non | télémétrie brute, validée et filtrée par la passerelle |
| `floodwatch/stations/{code}/telemetry` | → Cloud | 1 | non | `{"levelCm":12.4,"rain":0.8,"sensorOk":true,"seq":42}` |
| `…/heartbeat` | → Cloud, toutes les 15 s | 0/1 | non | `{"uptime":3600,"rssi":-61,"fw":"1.0.0","heap":180000}` |
| `…/state` | → Cloud, à chaque changement | 1 | **oui** | `{"barrier":"CLOSED","light":"RED","siren":true,"sampling":"WATCH","localSafety":true}` |
| `…/status` | → Cloud (LWT) | 1 | **oui** | `online` / `offline` (message de dernière volonté) |
| `…/ack` | → Cloud | 1 | non | `{"id":"<uuid commande>","ok":false,"detail":"verrouillage sécurité"}` |
| `…/cmd` | Cloud → station | 1 | non | `{"id":"<uuid>","actuator":"barrier","value":"CLOSE","ts":1793640000000}` |
| `…/config` | Cloud → station | 1 | **oui** | seuils : `criticalCm, yellowPct, orangePct, redPct, rainThreshold, reopenDelaySec, sensorHeightCm, periodNormalSec, periodWatchSec, heartbeatSec` |
| `…/td` | → Cloud, à chaque connexion | 1 | **oui** | Thing Description W3C WoT 1.1 de la station (exemples : `docs/wot/`). Non lue par le middleware |
| `floodwatch/gateways/{gw}/events` | passerelle → Cloud | 1 | non | `{"type":"station_mute","station":"wadi-01","silentSec":46}` / `station_back` / `gateway_alive` / `local_safety` (règle 85 % de la passerelle) |
| `floodwatch/gateways/{gw}/bridge` | Node-RED (naissance / LWT) ou pont Mosquitto | 1 | oui | `1` connecté / `0` déconnecté |

Actionneurs et valeurs : `barrier` OPEN|CLOSE · `light` GREEN|ORANGE|RED|OFF · `siren` ON|OFF · `sampling` NORMAL|WATCH.

Règles côté station (firmware et simulateur) :
- au-delà de `redPct` : fermeture autonome (barrière, feu rouge, sirène) et `localSafety=true`, sans attendre le Cloud ;
- réouverture autonome seulement après `reopenDelaySec` sous `orangePct` ;
- une commande `barrier=OPEN` reçue au-dessus de `redPct` est **refusée** (`ack.ok=false`) ;
- période de mesure : 5 s si pluie, niveau ≥ jaune ou `sampling=WATCH`, sinon 30 s.

Sécurité : broker local accessible en Wi-Fi WPA2 avec authentification et ACL par station
(la station `%u` publie seulement ses propres topics montants et lit seulement ses `cmd` / `config`,
cf. `gateway/mosquitto/floodwatch.acl`). Relais passerelle → Cloud par Node-RED en **TLS 1.3** sur le
port 8883, avec file d'attente persistante pendant une coupure (le pont Mosquitto reste disponible en repli).
Le listener 1883 du Cloud n'est accessible que depuis le réseau Docker interne (API).
