# Déploiement

## 0. Hébergement public gratuit : Oracle Cloud « Always Free » + DuckDNS

La pile complète (WildFly et les deux PWA, PostgreSQL, brokers, passerelle et stations simulées,
cycle MLOps) demande environ 2 Go de mémoire : les VM gratuites de 1 Go (AWS, Google) ne suffisent
pas. Oracle offre **gratuitement et sans limite de durée** une VM ARM jusqu'à 4 cœurs et 24 Go ;
toutes les images de la pile existent en ARM64. DuckDNS fournit un nom gratuit dont **tous les
sous-noms** (`www.`, `admin.`, `api.`, `iam.`) pointent vers la VM, et Let's Encrypt les certificats
reconnus par les smartphones (indispensables pour installer la PWA et recevoir les notifications).

**Dans les consoles (une fois) :**

1. `duckdns.org` : se connecter (GitHub), créer un nom, p. ex. `floodwatch-cot` ; garder le **jeton**
   pour soi (il ne va jamais dans le dépôt).
2. Oracle Cloud → *Compute → Instances → Create instance* :
   image **Ubuntu 24.04** ; forme **VM.Standard.A1.Flex** (Ampere, ARM), 2 OCPU / 12 Go suffisent
   (« Out of capacity » : réessayer plus tard ou changer de domaine de disponibilité) ; ajouter sa
   clé SSH publique ; noter l'**IP publique**.
3. *Networking → Virtual Cloud Networks → (VCN) → Security Lists → Default* → *Add Ingress Rules* :
   source `0.0.0.0/0`, TCP, ports de destination **80, 443, 8883** (22 est déjà ouvert).

**Sur la VM** (`ssh ubuntu@<ip-publique>`) :

```bash
curl -fsSLO https://raw.githubusercontent.com/baderddine725/FloodWatch_cot/main/backend/deploy/scripts/deploy-cloud.sh
bash deploy-cloud.sh floodwatch-cot.duckdns.org vous@exemple.tn      # le jeton DuckDNS est demandé
```

Le script (rejouable) ouvre le pare-feu de la VM, installe Docker, clone le dépôt, génère les
secrets (`backend/deploy/.env`, mode 600), relie le nom DuckDNS à l'IP (puis toutes les 5 min),
démarre la pile avec les profils `iot` et `ml`, obtient le certificat Let's Encrypt des cinq noms
web et programme son renouvellement quotidien (`scripts/renew-web-cert.sh`). Résultat :

| Adresse | Contenu |
|---|---|
| `https://www.floodwatch-cot.duckdns.org/` | espace citoyen (PWA installable) |
| `https://admin.floodwatch-cot.duckdns.org/` | espace de pilotage (comptes `ADMIN_*` / `OPERATOR_*` du `.env`) |
| `https://api.floodwatch-cot.duckdns.org/api/health` | état de l'API |
| `mqtts://floodwatch-cot.duckdns.org:8883` | broker des passerelles réelles (AC privée `certs/ca.crt`) |

**Ce qui n'est PAS exposé** : Node-RED (1880), le broker local (1883), MLflow (5000) et le DNS de la
pile n'écoutent que sur `127.0.0.1` de la VM ; on y accède par tunnel SSH :
`ssh -L 1880:localhost:1880 -L 5000:localhost:5000 ubuntu@<ip>`, puis `http://localhost:5000`.
Le certificat web est celui de Let's Encrypt ; le broker MQTT garde l'AC privée, que les passerelles
vérifient.

Mise à jour après un `git push` sur `main` : `~/FloodWatch_cot/backend/deploy/scripts/update.sh`
(les profils viennent de `COMPOSE_PROFILES` dans `.env`).

## 1. Cloud (VM IaaS Ubuntu 22.04/24.04)

Prérequis : ports 80, 443, 8883 ouverts et 53 (UDP/TCP) si la VM doit servir le DNS du domaine.

Depuis la version 2.0, **WildFly 42 sert aussi les deux front-ends** (hôtes virtuels Undertow) et le
déploiement expose quatre noms DNS d'un même domaine : `www.`, `admin.`, `api.`, `iam.` (plus
`mqtt.` pour le broker). Nginx se limite à la terminaison TLS et relaie vers WildFly en conservant
l'en-tête `Host`, qui est la clé du routage.

```bash
curl -fsSL https://raw.githubusercontent.com/baderddine725/FloodWatch_cot/main/backend/deploy/scripts/install-vm.sh \
  | bash -s -- https://github.com/baderddine725/FloodWatch_cot.git floodwatch.example.tn
```

Le script installe Docker, clone le dépôt et génère `backend/deploy/.env` (secrets aléatoires, `BASE_DOMAIN`,
`PUBLIC_IP`) ainsi que les certificats (SAN joker `*.<domaine>`). Il lance ensuite
`docker compose up -d --build`.

> `BASE_DOMAIN` est lu **à la construction de l'image** : les alias des hôtes virtuels sont écrits
> dans `standalone.xml` par `middleware/wildfly/configure.sh`. Changer de domaine impose donc un
> `docker compose build` (et non un simple `restart`).

### Résolution du domaine local

Le service `dns` (CoreDNS, `backend/deploy/coredns/Corefile`) fait pointer **tout** nom du domaine vers
`PUBLIC_IP` et transmet le reste aux résolveurs publics. Trois façons de l'utiliser :

1. **Résolveur du poste client** → l'adresse de la VM. Sous Ubuntu, le port 53 est déjà occupé par
   `systemd-resolved` : ajouter `DNSStubListener=no` dans `/etc/systemd/resolved.conf` puis
   `sudo systemctl restart systemd-resolved`, ou choisir un autre `DNS_PORT` dans `.env`.
2. **Fichier hosts** (le plus simple sur un poste de travail, et obligatoire en pratique avec un
   domaine en `.local`, réservé au mDNS par la RFC 6762) :
   ```bash
   sudo ./scripts/dns-hosts.sh floodwatch.local 127.0.0.1      # Linux / macOS
   ```
   ```powershell
   .\scripts\dns-hosts.ps1 -Domain floodwatch.local -Ip 127.0.0.1   # PowerShell administrateur
   ```
3. **DNS de l'infrastructure** : créer un enregistrement joker `*.<domaine>` vers la VM.

Mise à jour (déploiement exclusivement depuis GitHub) : `backend/deploy/scripts/update.sh` (`git pull` + reconstruction).

### Certificat reconnu par les smartphones (recommandé)

Les PWA (installation, Service Worker, Web Push) exigent un HTTPS de confiance.

```bash
cd backend/deploy && mkdir -p certbot
docker run --rm -v "$PWD/certbot:/var/www/certbot" -v "$PWD/letsencrypt:/etc/letsencrypt" certbot/certbot \
  certonly --webroot -w /var/www/certbot -d floodwatch.example.tn --agree-tos -m vous@exemple.tn -n
cp letsencrypt/live/floodwatch.example.tn/fullchain.pem certs/server.crt
cp letsencrypt/live/floodwatch.example.tn/privkey.pem  certs/server.key
docker compose restart nginx mosquitto
```

Avec un certificat Let's Encrypt, les passerelles peuvent utiliser `/etc/ssl/certs/ca-certificates.crt` comme CA.

### Vérifications

```bash
D=floodwatch.local
curl -k https://api.$D/api/health      # {"status":"UP","database":true,"mqtt":true,...}
curl -k -o /dev/null -w '%{http_code}\n' https://www.$D/          # 200 : front-office
curl -k -o /dev/null -w '%{http_code}\n' https://admin.$D/        # 200 : back-office
curl -k -o /dev/null -w '%{http_code}\n' https://www.$D/shared/css/base.css   # 200 : code commun
curl -k -o /dev/null -w '%{http_code}\n' https://iam.$D/api/stations          # 404 : hors périmètre IAM
docker compose logs -f api             # « MQTT connected », « Subscribed to ... »
```

Contrôle du routage sans DNS (en-tête `Host` forcé) :

```bash
curl -s -o /dev/null -w '%{http_code}\n' -H "Host: admin.floodwatch.local" http://localhost:8080/
```

## 2. Passerelle Raspberry Pi

```bash
git clone https://github.com/baderddine725/FloodWatch_cot.git && cd FloodWatch_cot/backend/gateway
sudo ./install-gateway.sh mqtt.floodwatch.example.tn gw-ariana-01 <MQTT_GATEWAY_PASSWORD> ../deploy/certs/ca.crt
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
4. Créer la station dans le back-office (`https://admin.<domaine>/`, même code). Ses seuils sont envoyés automatiquement (topic `config` retenu).

## 4. Développement local sans Docker

PostgreSQL et Mosquitto locaux, puis WildFly 42 :

```bash
cd middleware && mvn package
cp /chemin/postgresql.jar /tmp/postgresql.jar
JBOSS_HOME=$WILDFLY_HOME BASE_DOMAIN=floodwatch.local ./wildfly/configure.sh
cp api/target/api-1.0.war $WILDFLY_HOME/standalone/deployments/
ln -s "$PWD/../frontend/frontoffice" $WILDFLY_HOME/www/frontoffice   # ou copier les dossiers
ln -s "$PWD/../frontend/backoffice"  $WILDFLY_HOME/www/backoffice
ln -s "$PWD/../frontend/shared"      $WILDFLY_HOME/www/shared
DB_HOST=localhost DB_PASSWORD=... MQTT_BROKER_URL=tcp://localhost:1883 JWT_SECRET=... \
  $WILDFLY_HOME/bin/standalone.sh
```

`configure.sh` enchaîne `configure.cli` (source de données, filtres Undertow), puis `add-api.cli` et
`add-host.cli`. Sur un serveur **déjà démarré**, les mêmes scripts s'appliquent un par un — c'est le
mode prévu pour une chaîne d'intégration continue :

```bash
jboss-cli.sh --connect --file=wildfly/add-api.cli  --properties=wildfly/hosts/api.properties
jboss-cli.sh --connect --file=wildfly/add-host.cli --properties=wildfly/hosts/www.properties
jboss-cli.sh --connect --file=wildfly/add-host.cli --properties=wildfly/hosts/admin.properties
```

API : `http://localhost:8080/api` (alias `localhost` de `api-host`). Les front-ends ne répondent
que sur leurs noms DNS : ajoutez-les au fichier hosts, ou forcez l'en-tête `Host` avec `curl`.

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
