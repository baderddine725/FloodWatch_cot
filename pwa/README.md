<!--
 ============================================================================
  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
  Couche    : front-end
  Fichier   : pwa/README.md
  Équipe    : FloodWatch (Guesmi Baderddine, Ksontini Amine, Kamoun Ahmed)
  Auteur    : Kamoun Ahmed
  Créé le   : 2026-11-03          Modifié le : 2026-11-03
  Version   : 1.0
 ============================================================================
-->
# FloodWatch – PWA Citoyen et Pilotage

Deux Progressive Web Apps en **HTML5, CSS3 et JavaScript (modules ES natifs)**, sans framework,
sans dépendance npm et sans étape de build. Le design reprend la maquette Figma (`figma_ai_demo/`,
non versionnée) ; toutes les données viennent de l'API Jakarta EE et du flux temps réel.

| PWA | URL (Nginx) | Public | Rôle |
|---|---|---|---|
| **Citoyen** | `https://<hôte>/` | tout le monde, sans compte | état des routes, alertes dans un rayon, favoris, notifications |
| **Pilotage** | `https://<hôte>/pilotage/` | `OPERATOR`, `ADMIN` | supervision, alertes et acquittement, commandes, historique, configuration |

Chaque PWA a son manifeste (`manifest.webmanifest`, `theme_color #0B4F8A`), son Service Worker dans sa
propre portée et s'installe indépendamment.

## Arborescence

```
pwa/
  shared/                  code commun (servi sous /shared/)
    css/base.css           remise à zéro, police Inter locale, intégration Leaflet
    css/charte.css         charte de la maquette Figma (index.css sans Tailwind)
    js/config.js           URL relatives (/api, /ws/live), mode démo, ?perf=1
    js/api.js              client REST : Bearer JWT, If-Match/ETag, erreurs 401/403/409/412 en français
    js/auth.js             login, /auth/me, rôles, échéance du jeton
    js/realtime.js         WSS /ws/live (?token=), reconnexion à délai croissant, mesure de latence
    js/store.js            état observable (patron Observer) alimenté par REST + WebSocket
    js/push.js             clé VAPID, PushManager.subscribe, POST /api/push/subscriptions
    js/offline.js          dernières données dans IndexedDB (mode hors connexion)
    js/format.js           libellés, couleurs des niveaux, heures Africa/Tunis
    js/icons.js            icônes Lucide (ISC) en SVG inline
    js/components/         carte Leaflet, courbes SVG, pastilles, modales, toasts
    js/demo.js             backend simulé (?demo=1 uniquement, jamais chargé sinon)
    vendor/                Leaflet 1.9.4 (BSD-2), police Inter (OFL)
  citoyen/                 index.html, manifest, sw.js, css/citizen.css, js/ (app, vues)
  pilotage/                index.html, manifest, sw.js, css/pilotage.css, js/ (app, coquille, vues)
```

Rendu : des fonctions JavaScript produisent le HTML (valeurs échappées par `esc()`), le routage se fait
par le hash (`#dashboard`, `#alerts`, `#station/<code>`…) et chaque vue s'abonne au store pour se mettre à
jour quand un message temps réel la concerne.

## Contrats utilisés

| Besoin | Appel |
|---|---|
| Connexion | `POST /api/auth/login` → `{token, user}` puis `GET /api/auth/me` |
| Stations | `GET /api/stations`, `GET/PUT/DELETE /api/stations/{code}` (`If-Match`), `POST /api/stations` |
| Mesures | `GET /api/stations/{code}/measurements?minutes=` ou `?from=&to=` |
| Commandes | `POST /api/stations/{code}/commands` (202, `PENDING`) puis messages WebSocket `command` |
| Mode | `PUT /api/stations/{code}/mode` `{mode: AUTO \| MANUAL}` |
| Alertes | `GET /api/alerts?active=&station=&limit=`, `POST /api/alerts/{id}/ack` |
| Indicateurs | `GET /api/kpi?days=` ou `?from=&to=` |
| Comptes | `GET/POST /api/users`, `PUT/DELETE /api/users/{id}` |
| Push | `GET /api/push/public-key`, `POST/DELETE /api/push/subscriptions` |
| Temps réel | `wss://<hôte>/ws/live` (public) ou `?token=<jwt>` (opérateurs : + `alert`, `command`) |

Le front **n'invente ni ne recalcule** aucune règle métier : niveaux, prédiction, indice de risque, état
de la route (`roadOpen`) et automatismes viennent du serveur.

## Lancer en local

### Pile complète (recommandé)

```bash
cd deploy
cp .env.example .env               # puis changer les secrets
./scripts/gen-certs.sh localhost
docker compose up -d --build
```

- Citoyen : `https://localhost/` · Pilotage : `https://localhost/pilotage/` (comptes de `.env`)
- `pwa/` est monté en volume dans Nginx : une modification du front est visible au simple rechargement,
  sans rebuild (le Service Worker sert le réseau d'abord).

Générer des mesures avec le simulateur :

```bash
pip install -r simulator/requirements.txt
python3 simulator/floodwatch_sim.py --host localhost --port 8883 --tls --cafile deploy/certs/ca.crt \
        --username gateway --password <MQTT_GATEWAY_PASSWORD> --scenario storm --speed 3 -v
```

| Scénario | Commande | Ce qu'on doit voir |
|---|---|---|
| Montée jusqu'au rouge | `--scenario storm --speed 3` | jaune → orange → rouge, barrière fermée, toast + bandeau rouge (Pilotage), bandeau « route fermée » (Citoyen), notification push |
| Averse soudaine | `--scenario flash` | montée rapide : vérifier le passage en orange puis rouge et la courbe en direct |
| Station muette | `--offline-after 60` | station grise « Hors ligne » puis alerte `OFFLINE` en 45 s au plus |
| Capteur défaillant | `--scenario fault` | badge « Capteur défaillant », alerte `SENSOR_FAULT` |

### Sans serveur (présentation)

```bash
cd pwa && python -m http.server 8080
```

Ouvrir `http://localhost:8080/citoyen/?demo=1` et `http://localhost:8080/pilotage/?demo=1` : un backend
simulé dans le navigateur reproduit les mêmes formats JSON (deux stations, orage toutes les 6 min).
Comptes : `operator` / `operator123!`, `admin` / `admin123!`. Sortir avec `?demo=0`.

## Mesurer la latence (objectif < 3 s mesure → affichage)

1. Ouvrir la Pilotage avec `?perf=1` (`https://localhost/pilotage/?perf=1`) et la console du navigateur.
2. Lancer le simulateur (`--scenario storm --speed 3`, période renforcée de 5 s).
3. Chaque mesure affiche `[perf] … ingestion → réception X ms, → affichage Y ms` ; toutes les 20 mesures,
   une synthèse donne la médiane, le 95e centile et le maximum.
4. Le trajet station → serveur (MQTT) s'ajoute : comparer l'heure d'envoi du simulateur (`-v`) avec
   `docker compose logs api`. Sur une même machine, les horloges sont identiques.

Pour les notifications (< 10 s) : abonner un appareil (menu du profil en Pilotage, Paramètres en Citoyen),
puis mesurer entre le passage au rouge (journal de l'API) et l'apparition de la notification.

## Hors connexion

- Le Service Worker met en cache l'enveloppe (HTML, CSS, JS, icônes, police, Leaflet) et une partie des
  tuiles OpenStreetMap. Il ne met **jamais** en cache `/api/` ni `/ws/`.
- Les applications enregistrent les dernières données dans IndexedDB (stations, alertes et points des
  30 dernières minutes pour la Pilotage ; stations pour le Citoyen) et les réaffichent avec le bandeau
  « Données mémorisées » quand le serveur est injoignable.
- Commandes, changement de mode, acquittements et configuration sont désactivés hors connexion.
- Les données de la Pilotage sont effacées à la déconnexion (poste potentiellement partagé).
- Test : DevTools → Application → Service Workers (actif), puis Network → Offline et recharger.

## Déploiement

Aucun build : sur la VM, `git pull` dans le dépôt suffit (Nginx sert `pwa/` en volume).
Le Service Worker charge le réseau d'abord : la nouvelle version est servie dès le rechargement. Changer
`VERSION` dans `citoyen/sw.js` et `pilotage/sw.js` force en plus le renouvellement du cache hors ligne.

## Écarts connus avec le back-end (contournements isolés dans le front)

| Écart | Contournement (marqué `TEMPORAIRE` ou `ÉCART API` dans le code) | Évolution proposée |
|---|---|---|
| L'ETag d'une station change à chaque mesure (`@Version`) | `pilotage/js/station-form.js` compare la configuration avant d'envoyer `If-Match` | ETag propre à la configuration |
| Commande expirée = `FAILED` + texte « délai d'acquittement dépassé » | `shared/js/format.js` `commandState()` reconnaît le texte | statut `EXPIRED` |
| Pas d'endpoint des épisodes de crue | `pilotage/js/views/history.js` les reconstitue depuis les alertes rouges | `GET /api/episodes` |
| Pas de commentaire d'acquittement | champ retiré de la modale | `POST /alerts/{id}/ack {comment}` |
| `GET /api/alerts` réservé aux opérateurs | le Citoyen déduit ses alertes de l'état public des stations | endpoint public des alertes en cours (facultatif) |
| Push citoyen : orange, rouge et fin du rouge, sans choix | écran Paramètres en lecture seule | champ `levels` dans l'abonnement (facultatif) |
| `rain` est une intensité 0..1 (la maquette parlait de mm/h) | affichée en % | à confirmer |
| Lien des notifications toujours `"/"` | les Service Workers ouvrent la fiche à partir du champ `station` | `url` selon l'audience |

## Conventions

En-tête de commentaire sur chaque fichier (module, couche, équipe, auteur, dates, version), un commentaire
JSDoc par fonction, interface en français, aucune dépendance npm.
