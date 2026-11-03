# Déploiement

## 1. Cloud (VM IaaS Ubuntu 22.04/24.04)

Prérequis : un nom DNS pointant vers la VM, ports 80, 443 et 8883 ouverts.

```bash
curl -fsSL https://raw.githubusercontent.com/baderddine725/FloodWatch_cot/main/deploy/scripts/install-vm.sh \
  | bash -s -- https://github.com/baderddine725/FloodWatch_cot.git floodwatch.example.tn
```

Le script installe Docker, clone le dépôt et génère `deploy/.env` (secrets aléatoires) ainsi que les
certificats. Il lance ensuite `docker compose up -d --build`.

Mise à jour (déploiement exclusivement depuis GitHub) : `deploy/scripts/update.sh` (`git pull` + reconstruction).

### Certificat reconnu par les smartphones (recommandé)

Les PWA (installation, Service Worker, Web Push) exigent un HTTPS de confiance.

```bash
cd deploy && mkdir -p certbot
docker run --rm -v "$PWD/certbot:/var/www/certbot" -v "$PWD/letsencrypt:/etc/letsencrypt" certbot/certbot \
  certonly --webroot -w /var/www/certbot -d floodwatch.example.tn --agree-tos -m vous@exemple.tn -n
cp letsencrypt/live/floodwatch.example.tn/fullchain.pem certs/server.crt
cp letsencrypt/live/floodwatch.example.tn/privkey.pem  certs/server.key
docker compose restart nginx mosquitto
```

Avec un certificat Let's Encrypt, les passerelles peuvent utiliser `/etc/ssl/certs/ca-certificates.crt` comme CA.

### Vérifications

```bash
curl -k https://localhost/api/health          # {"status":"UP","database":true,"mqtt":true,...}
docker compose logs -f api                     # « MQTT connected », « Subscribed to ... »
```

## 2. Passerelle Raspberry Pi

```bash
git clone https://github.com/baderddine725/FloodWatch_cot.git && cd FloodWatch_cot/gateway
sudo ./install-gateway.sh floodwatch.example.tn gw-ariana-01 <MQTT_GATEWAY_PASSWORD> ../deploy/certs/ca.crt
sudo mosquitto_passwd /etc/mosquitto/floodwatch.passwd underpass-01   # un compte par station
sudo systemctl restart mosquitto
```

Configurer le Raspberry Pi en point d'accès Wi-Fi WPA2 (ou utiliser le Wi-Fi existant) pour les stations.
L'éditeur Node-RED est accessible sur `http://<ip-passerelle>:1880`.

## 3. Stations ESP32

1. Câblage : HC-SR04 TRIG→GPIO5, ECHO→GPIO18 (**pont diviseur 1 kΩ/2 kΩ**), pluie AO→GPIO34,
   servo→GPIO13, LED rouge/orange/verte→GPIO25/26/27, buzzer→GPIO14 (via transistor).
2. `cp firmware/include/station_config.example.h firmware/include/station_config.h` : renseigner le code de station,
   le Wi-Fi, l'IP de la passerelle et le mot de passe MQTT.
3. `cd firmware && pio run -t upload && pio device monitor`.
4. Créer la station dans la PWA Pilotage (même code). Ses seuils sont envoyés automatiquement (topic `config` retenu).

## 4. Développement local sans Docker

PostgreSQL et Mosquitto locaux, puis WildFly 40 :
```bash
cd backend && mvn package
$WILDFLY_HOME/bin/jboss-cli.sh --file=wildfly/configure.cli      # après avoir copié postgresql.jar dans /tmp
cp api/target/floodwatch.war $WILDFLY_HOME/standalone/deployments/
DB_HOST=localhost DB_PASSWORD=... MQTT_BROKER_URL=tcp://localhost:1883 JWT_SECRET=... \
  $WILDFLY_HOME/bin/standalone.sh
```
API : `http://localhost:8080/floodwatch/api`. PWA : servir `pwa/` avec la configuration Nginx fournie.

## Variables d'environnement de l'API

| Variable | Défaut | Rôle |
|---|---|---|
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | postgres, 5432, floodwatch | source de données |
| `MQTT_BROKER_URL` | `tcp://localhost:1883` | `ssl://hôte:8883` pour TLS |
| `MQTT_BROKER_USERNAME`, `MQTT_BROKER_PASSWORD` | – | compte du middleware |
| `MQTT_BROKER_TRUSTSTORE_PATH`, `…_PASSWORD` | – | CA privée (.jks ou .p12) |
| `JWT_SECRET` (≥ 32 car.), `JWT_TTL_SECONDS` | aléatoire, 28800 | jetons |
| `ADMIN_USERNAME/PASSWORD`, `OPERATOR_USERNAME/PASSWORD` | admin / operator | comptes créés au 1er démarrage |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | générées | Web Push |
| `STATION_OFFLINE_AFTER_SECONDS`, `COMMAND_ACK_TIMEOUT_SECONDS` | 45, 15 | supervision |
| `SEED_DEMO_STATIONS` | true | crée les 2 stations de la maquette |
