# 📜 Déclaration d'Attribution et d'Intégrité Académique
### Module : Cloud of Things (COT) · Année 2026/2027 · SUP'COM

Ce document est un *livrable obligatoire* devant être complété et mis à jour à chaque sprint par l'équipe. Il vise à cartographier de manière transparente l'origine du code, des architectures et l'usage des outils d'assistance (IA, bibliothèques tiers, codes d'archive).

---

## 👥 1. Identification de l'Équipe
*   *Projet (Nom) :* FloodWatch — Alerte précoce des crues et des routes inondées
*   *Équipe (Numéro) :* ___
*   *Membres :*
    *   Membre 1 (Prénom, Nom) : Baderddine Guesmi — Middleware
    *   Membre 2 (Prénom, Nom) : Amine Ksontini — Back-end & IoT
    *   Membre 3 (Prénom, Nom) : Ahmed Kamoun — Front-end PWA

---

## 🧠 2. Usage des Assistants de Génération (IA)
Cochez l'option qui correspond à votre réalité et détaillez le périmètre.

*   [ ] *Option A :* Aucun outil de génération de code par IA n'a été utilisé.
*   [x] *Option B :* Utilisation modérée (Aide au débogage, génération de fonctions isolées, documentation).
*   [ ] *Option C :* Utilisation intensive (Génération de structures de dossiers, squelettes d'API complets, scripts de déploiement).

### 📝 Journal des invites (Prompts) notables et composants générés par IA :

| Composant / Module | Outil utilisé (ChatGPT/Claude/Copilot...) | Description du prompt ou du rôle confié à l'IA |
| :--- | :--- | :--- |
| Documentation (docs/*.md, README) | ChatGPT | Relecture, reformulation et mise en forme Markdown |
| Tests unitaires (moteur d'alerte, UUIDv7) | GitHub Copilot | Auto-complétion de cas de tests JUnit 5 à partir des signatures |
| Flux Node-RED (passerelle) | ChatGPT | Aide au débogage d'un sous-flux de filtrage des mesures aberrantes |
| PWA — Service Worker (cache hors ligne) | GitHub Copilot | Suggestions sur la stratégie de cache (stale-while-revalidate) |
| Scripts Bash (gen-certs.sh, Docker Compose) | ChatGPT | Génération d'un squelette d'invocation openssl pour mTLS |

---

## 📚 3. Emprunts, Squelettes de Cours & Plagiat
Précisez si vous avez utilisé une base de code préexistante.

*   *Code de départ enseignant / squelette du cours :*
    *   [x] Oui (indiquer quels modules : backend/core, backend/iam, backend/api — squelette Jakarta EE 11 cot.zip fourni par l'enseignant ; corrections détaillées dans [`docs/corrections-code-depart.md`](docs/corrections-code-depart.md))
    *   [ ] Non
*   *Réutilisation d'anciens projets (Années précédentes / GitHub externes) :*
    *   [ ] Oui (Lien du dépôt d'origine : https://github.com...)
    *   [x] Non
    *   Si Oui, listez les fichiers ou concepts importés directement : N/A

---

## 🛠️ 4. Répartition Réelle de l'Écriture du Code
Indiquez la provenance réelle (en %) des lignes de code actuellement sur votre branche principale.

| Module / Composant | % Écrit à la main par l'équipe | % Généré par IA | % Emprunté / Réutilisé |
| :--- | :---: | :---: | :---: |
| *Passerelle IoT / Node-RED / Edge* | 90 % | 5 % | 5 % |
| *Backend / API REST / Middleware* | 70 % | 5 % | 25 % |
| *Sécurité (IAM / Keycloak / mTLS)* | 60 % | 5 % | 35 % |
| *Frontend / PWA* | 90 % | 10 % | 0 % |
| *Scripts d'Infra / Déploiement* | 85 % | 10 % | 5 % |

Les pourcentages « empruntés » du Backend et de l'IAM reflètent la part conservée du squelette `cot.zip` après corrections (voir [`docs/corrections-code-depart.md`](docs/corrections-code-depart.md)).


---

## ✍️ 5. Engagement sur l'Honneur
En validant ce fichier sur notre dépôt GitHub, nous certifions sur l'honneur que les déclarations ci-dessus sont exactes, sincères et reflètent fidèlement notre processus de développement. Nous sommes conscients que la falsification de ce document ou la non-maîtrise technique du code déclaré comme "écrit par l'équipe" lors des soutenances entraînera une *pénalité immédiate et sévère sur la note globale*.

*   [x] *Lu et approuvé par l'ensemble des membres de l'équipe.*
*   *Date de dernière mise à jour :* 10 / 11 / 2026