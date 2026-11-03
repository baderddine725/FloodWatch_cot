# Manuel utilisateur – FloodWatch Pilotage

Adresse : `https://<adresse>/pilotage/`, installable comme application. Connexion avec le compte fourni par
l'administrateur.

## Supervision
- Les **tuiles** affichent les stations en ligne, les barrières fermées, les alertes actives et le risque maximal.
- Chaque **carte de station** montre une jauge (seuils jaune, orange, rouge et critique), le niveau, la tendance,
  le temps avant débordement, l'indice de risque et l'état des actionneurs. Un clic ouvre la fiche.
- Le fil **Événements en direct** liste les changements de niveau, les alertes et les commandes en temps réel.

## Alertes
Types : niveau d'eau, station muette (3 messages de vie manqués), capteur défaillant, sécurité locale
(la station a fermé seule). **Acquittez** une alerte pour signaler sa prise en charge. L'historique est
dans l'onglet « Historique ».

## Fiche station
- Courbe du niveau et de la pluie (15 min à 24 h) avec les seuils.
- **Commande à distance** : barrière, feu, sirène, période de mesure. Toute commande manuelle fait passer la
  station en mode **Manuel** : l'automatisme Cloud est suspendu jusqu'au retour en **Auto**. La règle de sécurité
  locale reste toujours active, et une ouverture est refusée par la station si l'eau dépasse le seuil rouge.
- Chaque commande est suivie : en attente, acquittée, ou échec (station hors ligne, délai dépassé, verrou de sécurité).
- **Administrateurs** : nom, adresse, seuils et périodes. L'enregistrement publie la configuration vers la station.

## KPI
Délai détection → fermeture (objectif < 5 s), durée de fermeture, disponibilité par station,
inondations par station, alertes par niveau et par type, taux d'acquittement des commandes (24 h, 7 j, 30 j).

## Comptes (administrateurs) et réglages
Créez, désactivez ou supprimez des comptes opérateur ou administrateur. Dans « Réglages », activez les
notifications pour recevoir toutes les alertes sur cet appareil et envoyez une notification de test.
