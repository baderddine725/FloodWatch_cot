# Corrections apportées au code de départ (`cot.zip`)

| # | Fichier / zone | Problème | Correction |
|---|---|---|---|
| 1 | `iam/entities/Grant`, `Identity`, `Tenant` | `RootEntity` et `UUIDPKEntity` utilisés sans import : **le module ne compilait pas** | imports ajoutés ; `Identity` complétée (mot de passe haché, rôles en masque de bits) |
| 2 | `iam/pom.xml` | module empaqueté en `war` alors qu'il est une bibliothèque de l'API | `jar`, embarqué dans `floodwatch.war` (un seul artefact, conforme au diagramme de déploiement) |
| 3 | `MqttManager` | l'identifiant client était construit à partir de `mqttClient` (encore `null`) → `null#uuid` | construit à partir de la propriété `mqtt.client.id` |
| 4 | `MqttManager` | `getValue()` sur `mqtt.broker.username/password/truststore.*` absents de la configuration → **échec du déploiement** | `getOptionalValue()` avec valeurs par défaut, surcharge par variables d'environnement |
| 5 | `MqttManager` | callback enregistré **après** `connect()` : messages perdus | callback enregistré avant la connexion |
| 6 | `MqttManager` | abonnements perdus à la reconnexion (`cleanStart=true`) | réabonnement dans `connectComplete()` ; reconnexion différée si le broker est absent au démarrage |
| 7 | `MqttManager` | URL `mqtts://localhost:1882` : schéma inconnu de Paho et port non conforme (8883) | `ssl://hôte:8883` (TLS) ou `tcp://` (réseau Docker interne) |
| 8 | `MqttManager` | `messageArrived` traite `datum` qui n'est pas abonné ; `alerts/x` provoque un `ArrayIndexOutOfBounds` | contrat de topics `floodwatch/stations/{code}/{type}` (voir `mqtt-topics.md`), analyse défensive |
| 9 | `MqttManager` | bean implémentant `MqttCallback` sans `@LocalBean` retiré → vue sans interface indisponible (`WELD-001408`) | `@LocalBean` conservé et documenté ; `@ConcurrencyManagement(BEAN)` (la publication n'est plus sérialisée par le verrou EJB) |
| 10 | `EventManager` | `@Singleton` (EJB) **et** `@ApplicationScoped` (CDI) sur la même classe | bean CDI ; traitement ordonné par station sur un `ManagedExecutorService` |
| 11 | `UUIDv7` | horodatage tronqué à 32 bits (`& 0xFFFFFFFFL`) : les UUID ne sont plus triés dans le temps | 48 bits (RFC 9562) + test unitaire |
| 12 | `UUIDPKEntity` | `columnDefinition = "binary(16)"` (MySQL) incompatible avec PostgreSQL | type `uuid` natif |
| 13 | `NosqlEntity.hashCode` | `NullPointerException` si l'identifiant est nul | `Objects.hashCode` ; classe NoSQL retirée (PostgreSQL retenu) |
| 14 | Configuration | MongoDB / JNoSQL configurés alors que le cahier des charges impose PostgreSQL | unité de persistance JPA PostgreSQL, dépendances MongoDB/NoSQL retirées |
| 15 | `pom.xml` | Java 25 ciblé (non supporté par toutes les images serveur) ; plugin WAR sans `failOnMissingWebXml` | Java 21 LTS ; plugins versionnés ; JUnit 5 |
| 16 | `AbstractItemManager` / `AddressItemManager` | `toDto`/`fromDto` renvoient `null` ; dépôts Jakarta Data non configurés | dépôt JPA générique `AbstractRepository` + DTO (records) |
| 17 | Projet | aucune ressource REST, aucun point WebSocket, aucun test | API complète (19 routes), `/ws/live`, tests unitaires et collection Postman |

Problèmes révélés par les tests de bout en bout pendant le développement (et corrigés) :

- fausse alerte rouge provoquée par un écho parasite sur la dernière mesure → rejet des valeurs aberrantes
  par médiane locale, prévision exigeant 4 mesures sur 15 s et un niveau ≥ seuil jaune ;
- pente encore positive pendant la décrue → fenêtre de régression ramenée à 2 min ;
- ACL Mosquitto de la passerelle fondée sur l'identifiant client (contournable) → fondée sur l'utilisateur ;
- conflits de version optimiste (station mise à jour chaque seconde) lors des actions opérateur → nouvelle tentative automatique.
