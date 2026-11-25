# TRV & BEC Navires — Trois-Rivières & Bécancour

Widget mobile des mouvements commerciaux de Trois-Rivières (TRV) et Bécancour (BEC),
d'après l'e-fiche du Pilotage Saint-Laurent (APL).

- **Site en direct :** https://ggkwich-arch.github.io/trv-bec-navires/
- **Données :** `data/vessels.json`, mis à jour toutes les 15 minutes par le robot
  GitHub Actions (`.github/workflows/update-efiche.yml` + `scripts/scripts/scrape_efiche.mjs`).

## Ce que fait l'appli

- **Mes prochaines manœuvres — 48 h :** la vue principale pour le travail sur
  remorqueur. Arrivées, départs (et déplacements entre postes quand e-fiche
  les publie), triés par heure, regroupés par jour (« Aujourd'hui », « Demain »),
  avec compte à rebours (« dans 3 h 20 »), poste, tirant d'eau, statut pilote
  et nombre de pilotes. Filtres Toutes / Arrivées / Départs.
  Les changements depuis la dernière version d'e-fiche sont marqués :
  « Nouveau », « Heure changée » (avec l'ancienne heure) et « Disparues de
  l'e-fiche ». La vue dit honnêtement jusqu'où e-fiche publie : si elle ne
  publie pas 48 h à l'avance, un avertissement l'indique au lieu de prétendre
  couvrir les 48 h complètes.
- **Vérification supplémentaire, par navire et par manœuvre :** liens
  « Vérifier sur MarineTraffic » et « VesselFinder » (gratuits, sans clé),
  et badge « Confirmé AIS • il y a X min » (vert) ou « Non confirmé par AIS »
  (gris) quand la vérification AIS automatique (AISStream) a tourné.
- Arrivées et départs commerciaux, par port (TRV / BEC / les deux).
- Prochain mouvement vérifié, avec statut pilote, tirant d'eau, vitesse et transit.
- Recherche par nom de navire ou par quai, filtres arrivées / départs.
- Mode hors-ligne : sans réseau, les dernières données connues s'affichent avec leur date.
- Installable sur Android (PWA).

## Ce qui a changé (version 1.3.0)

- **Liens de vérification manuelle :** sur chaque carte de navire et de
  manœuvre, « Vérifier sur MarineTraffic » et « VesselFinder ».
  VesselFinder utilise une URL de recherche directe vérifiée
  (`vesselfinder.com/vessels?name=NOM`). MarineTraffic ne publie aucune
  URL de recherche directe (leur aide renvoie à la barre de recherche de
  la carte ; l'ancien motif `/ais/index/search/all?keyword=` renvoie 404,
  vérifié le 2026-11-25) : le lien passe donc par une recherche web
  restreinte à marinetraffic.com, et c'est écrit dans le libellé.
  Aucun appel à l'API MarineTraffic — elle est payante / entreprise.
- **Vérification AIS automatique (AISStream, gratuit) :** le robot écoute
  le flux AIS en direct ~75 s sur la zone TRV / BEC après chaque lecture
  d'e-fiche (`scripts/verify_ais.mjs`) et écrit `data/ais_verification.json`.
  L'appli affiche alors « ✓ Confirmé AIS • il y a X min » ou
  « Non confirmé par AIS ». La clé AISStream est gratuite (compte
  aisstream.io, connexion GitHub) et se met en **secret GitHub**
  `AISSTREAM_API_KEY` — jamais dans le code, jamais dans un `.env`,
  jamais partagée en chat. Sans secret, la vérification reste
  « non configurée » et les liens manuels fonctionnent quand même.
  Le script n'échoue jamais : clé absente, connexion impossible ou aucun
  navire vu écrivent un fichier avec un statut et une raison.

## Ce qui a changé (version 1.2.0)

- **Vue « Mes prochaines manœuvres — 48 h » :** c'est la vue principale de
  l'appli, pensée pour le travail sur remorqueur quand le dispatch ne donne
  pas une bonne vue d'ensemble. Tri chronologique, regroupement par jour,
  compte à rebours, filtres, détection des changements (nouveau, heure
  changée, disparu de l'e-fiche) et affichage honnête de l'horizon de
  publication d'e-fiche.
- **Scraper :** l'heure de mouvement est conservée telle que publiée
  (`movementTime`), les déplacements entre postes sont détectés quand e-fiche
  les indique (`movement: "shift"`), et `data/vessels.json` contient un objet
  `horizon` (dernière heure publiée, couvre-t-elle 48 h ?).

## Ce qui a changé (version 1.1.0)

- **Données nettoyées :** le nom du navire est juste un nom, la classe a son propre
  champ, le statut pilote est le vrai statut, et une durée n'est plus jamais
  affichée comme une vitesse (« 9h 32m nds » n'existe plus).
- **Une seule source de vérité :** `data/vessels.json`. Plus de données embarquées
  dans la page, plus de valeurs codées en dur (pas de `progress: 55`).
- **Fraîcheur affichée :** « il y a X min » et avertissement si les données ont
  plus d'une heure.
- **Scraper robuste :** colonnes mappées par en-tête, retry, identifiants stables,
  et on n'écrase jamais le fichier avec un résultat anormalement vide.
- **Workflow durci :** `npm ci`, cache Playwright, timeout, une seule exécution à
  la fois, alerte en cas d'échec.
- **PWA réelle :** `vessels.json` en cache avec repli, vieux caches nettoyés,
  icônes PNG 192 et 512.
- **Page allégée :** CSS et JavaScript séparés (`styles.css`, `app.js`), aucune
  dépendance externe (pas de Tailwind CDN, pas de Google Fonts), zoom autorisé.

## Structure

| Fichier | Rôle |
| --- | --- |
| `index.html` | La page (aucune donnée embarquée) |
| `styles.css` | Tout le style, autonome |
| `app.js` | Affichage, recherche, filtres, fraîcheur, hors-ligne |
| `data/vessels.json` | Données générées par le robot |
| `data/ais_verification.json` | Résultat de la vérification AIS (généré par le robot) |
| `scripts/scripts/scrape_efiche.mjs` | Robot de lecture d'e-fiche |
| `scripts/verify_ais.mjs` | Vérification AIS automatique (AISStream) |
| `.github/workflows/update-efiche.yml` | Robot toutes les 15 minutes |
| `sw.js` | Service worker (cache + hors-ligne) |
| `manifest.json` | Application installable (PWA) |
| `icon.svg`, `icon-192.png`, `icon-512.png` | Icônes |

## Limites — à lire

- L'e-fiche reste la source principale : c'est un **planning de pilotage**,
  pas de l'AIS en direct. La vérification AIS (AISStream) ne fait que
  confirmer qu'un navire est réellement vu par AIS dans la zone — elle ne
  remplace pas e-fiche pour les heures et les postes.
- **Vérification AIS :** la correspondance se fait par nom de navire (l'e-fiche
  ne donne pas de MMSI ; si un jour elle en donne, le script l'utilisera
  aussi). Un navire à quai peut émettre rarement, et la couverture AIS
  terrestre a des trous : « Non confirmé par AIS » veut dire « pas vu
  pendant 75 s d'écoute », pas « le navire n'existe pas ». AISStream ne
  donne aucune garantie de disponibilité et ne rejoue pas les messages
  manqués. La clé est gratuite mais doit rester un secret GitHub.
- **Liens MarineTraffic :** MarineTraffic ne publie pas d'URL de recherche
  directe par nom de navire — le lien passe par une recherche web restreinte
  à marinetraffic.com (l'ancien motif de recherche renvoie 404). Le lien
  VesselFinder, lui, va directement à la fiche du navire.
- **Outil d'information seulement, pas pour naviguer ni éviter les collisions.**
- Les heures sont celles d'e-fiche ; si e-fiche change de mise en page, le robot
  peut échouer — le workflow ouvre alors une issue GitHub d'alerte et les
  anciennes données restent affichées avec leur date.
- **Horizon 48 h :** l'e-fiche ne publie pas forcément 48 h à l'avance — la
  vue l'affiche (« e-fiche publiée jusqu'au … ») au lieu de prétendre couvrir
  les 48 h. La portée réelle ne sera connue qu'après le premier lancement du
  robot en production.
- **Déplacements entre postes :** ils n'apparaissent que si e-fiche les
  publie comme tels. Si e-fiche ne les distingue pas des arrivées/départs,
  la vue ne peut pas les deviner.
- **Changements :** « Nouveau », « Heure changée » et « Disparu » sont
  calculés en comparant avec la dernière version connue gardée sur le
  téléphone (localStorage). Au tout premier chargement, rien n'est marqué.
  Une manœuvre disparue n'a jamais de raison inventée.
- Un navire sans heure publiée dans e-fiche ne peut pas être placé dans les
  48 h : il est compté à part sous la liste, jamais avec une heure devinée.

## Appliquer cette version

Voir `APPLIQUER.md` : copier les fichiers dans le dépôt, pousser sur `main`,
vérifier l'onglet Actions, puis GitHub Pages.
