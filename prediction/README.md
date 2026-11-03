<!--
  Module    : Cloud of Things – FloodWatch (Sup'Com 2026-2027)
  Couche    : prediction – back-end & IoT
  Fichier   : prediction/README.md
  Équipe    : FloodWatch – Auteur : Ksontini Amine
  Créé le   : 2026-11-02          Modifié le : 2026-11-03
  Version   : 1.0
-->

# floodwatch-prediction

Bibliothèque **Java 21** de prédiction de débordement, sans aucune dépendance d'exécution.
C'est un projet Maven autonome (hors de `backend/`). Le middleware l'intègre quand il le souhaite.

## Ce qu'elle calcule

À partir des mesures d'une station et de son niveau critique :

| Résultat | Calcul |
|---|---|
| `riseSpeedCmPerMin()` | pente de la régression linéaire (moindres carrés) sur les **10 dernières mesures** (au moins 3) |
| `minutesToOverflow()` | `(critique − niveau actuel) / vitesse` si l'eau monte ; `0` si le critique est atteint ; vide sinon |
| `overflowAlert()` | débordement prévu dans **moins de 10 min**, avec deux gardes : **au moins 5 mesures** et **niveau > 50 % du critique** |
| `decision()` | la raison : `NOT_ENOUGH_SAMPLES`, `LEVEL_TOO_LOW`, `NO_OVERFLOW_EXPECTED`, `OUTSIDE_WINDOW` ou `ALERT` |

Les gardes évitent les fausses alertes : une montée rapide à 20 % du critique donne une échéance
courte. Ce n'est pas pour autant une alerte de prédiction : c'est une « montée rapide », que le
moteur d'alerte du middleware traite déjà (passage à l'orange).

## Construire et tester

```powershell
cd prediction
.\mvnw.cmd verify      # compile (-Xlint:all -Werror) + 38 tests JUnit 5 → target\floodwatch-prediction-1.0.jar
.\mvnw.cmd install     # installe le jar dans le dépôt Maven local (~/.m2)
```

Sans JDK sur la machine :

```powershell
docker run --rm -v "${PWD}:/w" -w /w maven:3.9-eclipse-temurin-21 sh ./mvnw -B verify
```

## Intégration dans le middleware (à faire par G. Baderddine)

1. `cd prediction && .\mvnw.cmd install`, puis dans `backend/api/pom.xml` :

   ```xml
   <dependency>
       <groupId>tn.supcom</groupId>
       <artifactId>floodwatch-prediction</artifactId>
       <version>1.0</version>
   </dependency>
   ```

   Le `Dockerfile` du backend ne copie que `core/`, `iam/` et `api/`. Pour une image Docker, il
   faudra soit copier `prediction/` dans le contexte de build, soit coller les 6 classes dans
   `controllers/alerting/`. Elles ne dépendent que du JDK.

2. Le middleware a déjà la stratégie `OverflowPredictor` (patron Strategy). Un adaptateur suffit :

   ```java
   /** Adaptateur : expose la bibliothèque de prédiction comme stratégie du moteur d'alerte. */
   public class RegressionLibraryPredictor implements OverflowPredictor {
       private final FloodPredictor lib = new FloodPredictor();   // immuable, partageable

       @Override
       public Prediction predict(List<Sample> samples, double criticalCm) {
           if (samples.isEmpty()) return Prediction.none(0, null);
           var p = lib.predict(samples.stream().map(s -> new LevelSample(s.ts(), s.levelCm())).toList(), criticalCm);
           Double ttf = p.minutesToOverflow().isPresent() ? p.minutesToOverflow().getAsDouble() : null;
           return new Prediction(p.riseSpeedCmPerMin(), ttf, p.sampleCount(), p.currentLevelCm());
       }
   }
   ```

   `p.decision()` indique en plus pourquoi l'alerte n'est pas levée (utile dans `alertReasons`).

## Différences avec `LinearRegressionPredictor` du middleware

| | middleware (actuel) | cette bibliothèque |
|---|---|---|
| fenêtre | 2 min glissantes | **10 dernières mesures** (cahier des charges) |
| minimum pour prédire | 4 mesures sur ≥ 15 s | 3 mesures pour la vitesse, **5 pour alerter** |
| garde de niveau | aucune | **niveau > 50 % du critique** pour alerter |
| décision | `minutesToOverflow` seul | `decision()` explicite (5 cas) |

La passerelle Node-RED lisse déjà les mesures (rejet des aberrations + moyenne glissante sur 5) :
la régression travaille donc sur un signal propre.
