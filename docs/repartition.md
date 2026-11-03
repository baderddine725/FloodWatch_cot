# Répartition du travail (3 membres × ≈ 24 jours)

Capacité réelle : 3 étudiants × 8 semaines × 3 j = **72 hommes-jours**. Le cahier des charges
(§ 5.4, § 7.1) prévoit 5 étudiants et 120 hommes-jours. Le périmètre « souhaitable » est donc reporté.

| Membre | Rôle | Livrables (code) | Charge |
|---|---|---|---|
| Guesmi Baderddine | Middleware | `MqttManager`, `EventManager`, `ThingManager`, moteur d'alerte (`alerting/`), prédiction, commandes et automatisme, `StationWatchdog`, WebSocket, Web Push, Thing Description, contrat MQTT, tests unitaires | ≈ 24 j |
| Ksontini Amine | Back-end & IoT | entités/dépôts/PostgreSQL, ressources REST, IAM (JWT, PBKDF2), KPI, firmware ESP32, passerelle (Mosquitto, Node-RED), simulateur, Docker Compose / VM, Postman | ≈ 24,5 j |
| Kamoun Ahmed | Front-end PWA | maquettes, socle PWA (manifeste, Service Worker, hors ligne), PWA Pilotage, PWA Citoyen (carte, push géolocalisé), mode démonstration, manuels utilisateur | ≈ 23 j |

Interfaces à figer tôt : contrat MQTT (`docs/mqtt-topics.md`), OpenAPI (`docs/openapi.yaml`),
format WebSocket (`{"type": "...", "data": ...}`, types `snapshot`, `station`, `measurement`, `alert`, `command`, `gateway`, `ping`).
