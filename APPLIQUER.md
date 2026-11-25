# Appliquer la version améliorée de TRV & BEC Navires

Tout est prêt dans ce dossier. Il ne faut **rien pousser sur GitHub à ma place** :
c'est toi qui copies les fichiers dans ton dépôt et qui pousses — 10 minutes environ.

> ⚠️ Avant de commencer : ne partage jamais de jeton, de mot de passe ni de
> fichier `.env`. La seule clé de cette version, la clé gratuite AISStream,
> se met en **secret GitHub** (`AISSTREAM_API_KEY`) — jamais dans le code,
> jamais dans un `.env`, jamais en chat. Voir la section dédiée plus bas.
> Sans cette clé, l'appli fonctionne quand même : seuls les badges
> « Confirmé AIS » restent inactifs.

## Fichiers fournis

| Fichier dans ce dossier | Destination dans ton dépôt |
| --- | --- |
| `index.html` | `index.html` (remplace l'ancien) |
| `styles.css` | `styles.css` (**nouveau**) |
| `app.js` | `app.js` (**nouveau**) |
| `scripts/scripts/scrape_efiche.mjs` | `scripts/scripts/scrape_efiche.mjs` (remplace) |
| `scripts/verify_ais.mjs` | `scripts/verify_ais.mjs` (**nouveau** — vérification AIS) |
| `data/ais_verification.json` | `data/ais_verification.json` (**nouveau** — exemple « non configuré », le robot l'écrasera) |
| `.github/workflows/update-efiche.yml` | `.github/workflows/update-efiche.yml` (remplace) |
| `sw.js` | `sw.js` (remplace) |
| `manifest.json` | `manifest.json` (remplace) |
| `package.json` | `package.json` (remplace) |
| `icon.svg` | `icon.svg` (remplace) |
| `icon-192.png` | `icon-192.png` (**nouveau**) |
| `icon-512.png` | `icon-512.png` (**nouveau**) |
| `data/vessels.json` | `data/vessels.json` (exemple nettoyé — le robot l'écrasera à la prochaine exécution, c'est normal) |
| `README.md` | `README.md` (**nouveau**) |
| `.gitignore` | `.gitignore` (**nouveau**) |

## Option A — avec git en ligne de commande (recommandé)

Sur ton ordinateur, dans un terminal :

```bash
# 1. Récupérer ton dépôt (si ce n'est pas déjà fait)
git clone https://github.com/ggkwich-arch/trv-bec-navires.git
cd trv-bec-navires

# 2. Copier les fichiers améliorés par-dessus
#    (remplace CHEMIN par l'endroit où tu as mis ce dossier)
cp -r CHEMIN/trv-bec-navires-ameliore/* .
cp -r CHEMIN/trv-bec-navires-ameliore/.github .
cp CHEMIN/trv-bec-navires-ameliore/.gitignore .

# 3. Générer package-lock.json une seule fois (le workflow utilise npm ci)
npm install

# 4. Vérifier ce qui va être poussé — tu dois voir les fichiers ci-dessus,
#    et surtout AUCUN .env, AUCUN node_modules
git status

# 5. Pousser
git add .
git commit -m "Version 1.3 : vérification MarineTraffic / VesselFinder + AISStream automatique"
git push origin main
```

## Option B — avec GitHub Desktop

1. Ouvre ton dépôt dans GitHub Desktop.
2. Copie les fichiers de ce dossier dans le dossier du dépôt (avec l'Explorateur /
   le Finder), en gardant la même structure de dossiers.
3. Dans un terminal, dans le dossier du dépôt, lance une fois `npm install`
   pour générer `package-lock.json`.
4. Dans GitHub Desktop, vérifie la liste des changements, écris le message
   « Version 1.3 : vérification MarineTraffic / VesselFinder + AISStream automatique »,
   puis « Push origin ».

## Option C — sur le site GitHub (plus long, fichier par fichier)

1. Va sur https://github.com/ggkwich-arch/trv-bec-navires
2. Pour chaque fichier à remplacer, ouvre-le, clique sur l'icône crayon,
   colle le nouveau contenu, puis « Commit changes ».
3. Pour les nouveaux fichiers (`styles.css`, `app.js`, `icon-192.png`,
   `icon-512.png`, `README.md`, `.gitignore`), utilise « Add file → Upload files ».
4. `package-lock.json` ne pourra pas être généré par cette méthode : le workflow
   fera `npm install` à sa place la première fois, puis tu pourras le récupérer
   plus tard. Ce n'est pas bloquant.

## Ajouter la clé AISStream gratuite (pour les badges « Confirmé AIS »)

Les liens MarineTraffic / VesselFinder fonctionnent **sans clé**, dès le
déploiement. La vérification AIS automatique, elle, ne démarre qu'une fois
la clé ajoutée — c'est gratuit, 5 minutes, et la clé ne quitte jamais
GitHub :

1. Va sur **https://aisstream.io/** et connecte-toi avec ton compte **GitHub**
   (« Sign in with GitHub »).
2. Dans ton compte, ouvre **Account / API Keys** et crée une clé
   (« Create API key »). La clé ne s'affiche qu'une fois : copie-la.
3. Va sur ton dépôt GitHub → **Settings** → **Secrets and variables** →
   **Actions** → **New repository secret**.
   - Nom : `AISSTREAM_API_KEY` (exactement ce nom)
   - Valeur : colle la clé, puis « Add secret ».
4. Ne mets la clé **nulle part ailleurs** : pas dans le code, pas dans un
   fichier `.env`, pas en chat, pas en capture d'écran. Si elle a déjà été
   partagée quelque part, supprime-la sur aisstream.io et crées-en une autre.
5. Relance le workflow à la main (Actions → « Mise à jour e-fiche TRV & BEC »
   → « Run workflow ») : l'étape « Vérifier les navires par AIS (AISStream) »
   doit apparaître et réussir, et `data/ais_verification.json` doit passer
   au statut `ok` ou `no_data` au lieu de `not_configured`.

Si tu ne veux pas de clé pour l'instant, ne fais rien : l'appli affiche
« Vérification AIS non configurée » sous la vue Manœuvres, et les liens
de vérification fonctionnent quand même.

## Après le push — vérifications (5 minutes)

1. **Onglet Actions du dépôt** : le workflow « Mise à jour e-fiche TRV & BEC »
   doit se lancer. Tu peux aussi le lancer à la main : Actions → le workflow →
   « Run workflow ».
2. Attends 2 à 3 minutes, puis vérifie que `data/vessels.json` a été mis à jour
   sur GitHub (la date `updatedAt` doit être récente).
3. **Ouvre le site** : https://ggkwich-arch.github.io/trv-bec-navires/
   - Les noms doivent être propres : « PORT NARA », « THEBE », « RF MARINA » —
     sans « (A) SAILING (DDS) : 1 PLT » dans le nom.
   - La vitesse ne doit plus jamais afficher « 9h 32m nds » : soit une vraie
     vitesse (« 12.5 nds »), soit « — », et la durée va dans « Transit ».
   - En haut : « il y a X min » doit s'afficher à côté de l'heure de mise à jour.
   - En bas de page : la mention « Données e-fiche — Pilotage Saint-Laurent
     (APL) : c'est le planning, pas de l'AIS en direct » doit être visible,
     avec la ligne de vérification (liens + badge AIS).
   - **Nouvelle vue « Mes prochaines manœuvres »** (juste sous les onglets de port) :
     - Le compteur en haut doit dire « N manœuvre(s) dans les prochaines 48 h ».
     - Les cartes sont triées par heure, regroupées sous « Aujourd'hui » puis
       « Demain », chacune avec un compte à rebours (« dans 3 h 20 »), le quai,
       le tirant d'eau et les pilotes — « — » quand l'info n'est pas publiée.
     - Les filtres Toutes / Arrivées / Départs doivent changer la liste.
     - La ligne « e-fiche publiée jusqu'au … » doit être visible, avec un
       avertissement si e-fiche ne publie pas 48 h à l'avance (c'est normal :
       la vue ne prétend pas couvrir ce qui n'est pas publié).
     - Au premier chargement, aucune carte ne doit porter « Nouveau » ou
       « Heure changée » : ces marques n'apparaissent qu'à partir de la
       deuxième version d'e-fiche reçue (après ~15 minutes).
   - **Vérification manuelle** : sur chaque carte (manœuvre et navire),
     « Vérifier : MarineTraffic (recherche) ↗ · VesselFinder ↗ ».
     - VesselFinder doit ouvrir directement la fiche du navire.
     - MarineTraffic ouvre une recherche web restreinte à marinetraffic.com :
       c'est normal, MarineTraffic ne publie pas d'URL de recherche directe.
   - **Badge AIS** : sans secret, une ligne « Vérification AIS non
     configurée » apparaît sous la vue Manœuvres et les cartes affichent
     « Non confirmé par AIS ». Après avoir ajouté le secret et relancé le
     workflow, `data/ais_verification.json` doit passer au statut `ok` ou
     `no_data`, et les navires vus par AIS affichent « ✓ Confirmé AIS •
     il y a X min ». « Non confirmé par AIS » veut dire « pas vu pendant
     75 s d'écoute », pas « le navire n'existe pas ».
4. **Vider le cache du téléphone** (important) : l'ancien service worker
   (`trv-bec-v4`, puis `trv-bec-v6`, puis `trv-bec-v7`) peut garder l'ancienne page en cache. Dans Chrome sur ton
   téléphone : menu ⋮ → Paramètres → Confidentialité → Effacer les données de
   navigation → « Images et fichiers en cache », puis rouvre le site. La
   nouvelle version utilise le cache `trv-bec-v8`.
5. **Si tu utilises aussi Cloudflare Pages** : les mêmes fichiers fonctionnent.
   Redéploie depuis le dépôt `main` comme d'habitude ; la page se met à jour
   au prochain déploiement.

## Si quelque chose ne marche pas — retour en arrière

Tout est dans git, rien n'est perdu :

```bash
git log --oneline -5        # trouve le commit « Version 1.3 ... »
git revert <numéro-du-commit>
git push origin main
```

Tu reviens à l'ancienne version, et on corrige ensemble.

## Ce qui n'a pas pu être testé ici

Le code n'a pas été exécuté dans cet environnement (par sécurité, aucun
`npm install`, aucun lancement du robot, aucun build). Seule la syntaxe des
fichiers JavaScript a été vérifiée (`node --check`, sans exécution).
Vérifie donc sur le site en direct après le déploiement, et ouvre la console
du navigateur (Chrome → ⋮ → Outils de développement) s'il y a un message
d'erreur : envoie-moi une capture et je corrige.

En particulier, quatre choses ne seront connues qu'après le premier lancement
du robot en production :
- **Jusqu'où e-fiche publie vraiment à l'avance** (12 h ? 24 h ? 48 h ?) :
  la vue l'affichera (« e-fiche publiée jusqu'au … »), avec un avertissement
  si ça s'arrête avant 48 h.
- **Si e-fiche publie des déplacements entre postes** : le scraper les
  détecte seulement s'ils sont indiqués comme tels ; sinon le filtre
  « Déplacements » reste caché et la limite est notée dans le README.
- **Si AISStream voit bien les navires dans la zone TRV / BEC** : la
  correspondance se fait par nom (l'e-fiche ne donne pas de MMSI), et un
  navire à quai peut émettre rarement. Le premier `data/ais_verification.json`
  en production dira combien de navires sont confirmés — `no_data` ne veut
  pas dire que le script est cassé, juste qu'aucun navire d'e-fiche n'a été
  vu pendant les 75 s d'écoute.
- **Si la clé AISStream est acceptée** : tant que le secret n'est pas ajouté,
  le statut reste `not_configured` (normal). Après l'ajout, une erreur de
  connexion répétée (`connection_failed`) veut généralement dire que la clé
  est invalide ou mal copiée.

## Résumé des changements (par priorité de la revue)

1. **Parsing propre** — nom seul, classe séparée, statut et pilotes séparés,
   tirant d'eau dans `draft` seulement, vitesse seulement si c'est une vitesse,
   durée dans `transitDuration`, plus de troncature à 36 caractères.
2. **Une seule source de vérité** — `vessels.json` seulement, plus de données
   embarquées dans `index.html` (la page passe d'environ 1 Mo à une douzaine de Ko),
   affichage « il y a X min » + avertissement après 1 h.
3. **Scraper robuste** — colonnes par en-tête, retry ×3, `browser.close()` dans
   un `finally`, identifiant stable nom + poste, pas d'écrasement si le résultat
   est anormalement vide, journalisation détectés / rejetés.
4. **Workflow durci** — `npm ci` (+ `package-lock.json` à générer une fois),
   cache Playwright, `timeout-minutes: 10`, `concurrency`, alerte par issue
   GitHub en cas d'échec, actions épinglées (`checkout@v4.2.2`, etc.).
5. **PWA / hors-ligne réelle** — `vessels.json` en cache avec repli « dernières
   données connues + date », nettoyage des vieux caches, icônes PNG 192 et 512,
   aucune dépendance externe (plus de Tailwind CDN ni Google Fonts).
6. **Plus de valeurs inventées** — pas de `progress: 55`, pas d'épinglage
   arbitraire (la vedette est le prochain mouvement vérifié, ou ton choix),
   tri par heure de mouvement, « — » plutôt qu'une valeur devinée.
7. **Source clarifiée** — mention permanente « Données e-fiche — Pilotage
   Saint-Laurent (APL), pas de l'AIS en direct — outil d'information seulement,
   pas pour naviguer ni éviter les collisions », avec la date exacte de mise à jour.

Secondaire : CSS et JavaScript séparés (`styles.css`, `app.js`), zoom autorisé
(`user-scalable=no` retiré), `README.md`, `.gitignore` (jamais de `.env`).

8. **Vue « Mes prochaines manœuvres — 48 h » (version 1.2)** — la vue
   principale pour le travail sur remorqueur : arrivées et départs (et
   déplacements entre postes quand e-fiche les publie) triés par heure,
   regroupés par jour (« Aujourd'hui », « Demain »), compteur « N manœuvres
   dans les prochaines 48 h », compte à rebours sur chaque carte, filtres
   Toutes / Arrivées / Départs, et détection des changements (Nouveau,
   Heure changée avec l'ancienne heure, Disparu de l'e-fiche, sans raison
   inventée). Le scraper conserve l'heure de mouvement telle que publiée
   (`movementTime`) et publie un objet `horizon` dans `vessels.json` ; la vue
   affiche honnêtement jusqu'où e-fiche publie au lieu de prétendre couvrir
   48 h. Service worker passé en `trv-bec-v7` pour que les téléphones
   prennent la nouvelle version.

9. **Vérification supplémentaire (version 1.3)** — deux couches :
   - **Liens manuels gratuits, sans clé :** chaque carte (manœuvre et navire)
     a « Vérifier : MarineTraffic (recherche) ↗ · VesselFinder ↗ ».
     VesselFinder va directement à la fiche du navire (URL vérifiée).
     MarineTraffic ne publiant pas d'URL de recherche directe (l'ancien
     motif renvoie 404, vérifié le 2026-11-25), le lien passe par une
     recherche web restreinte à marinetraffic.com. Aucun appel à l'API
     MarineTraffic (payante / entreprise).
   - **AISStream automatique, gratuit :** nouveau script
     `scripts/verify_ais.mjs` (dépendance `ws` ajoutée à `package.json`) —
     écoute le flux AIS ~75 s sur la boîte TRV / BEC (46,1 – 46,6 /
     -73,0 – -72,1) après chaque lecture d'e-fiche, et écrit
     `data/ais_verification.json`. L'appli affiche « ✓ Confirmé AIS •
     il y a X min » ou « Non confirmé par AIS », avec une ligne d'état sous
     la vue Manœuvres. La clé gratuite se met en secret GitHub
     `AISSTREAM_API_KEY` (jamais dans le code, jamais en chat, jamais dans
     un `.env`) ; sans secret, la vérification reste « non configurée » et
     ne fait jamais échouer le workflow. Service worker passé en `trv-bec-v8`.
