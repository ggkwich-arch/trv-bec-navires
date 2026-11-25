// Scrape e-fiche — Pilotage Saint-Laurent (TRV & BEC).
//
// Principe : on lit le tableau de https://efiche.live.pilotagestlaurent.gc.ca/
// en mappant les colonnes PAR LEUR EN-TÊTE (pas par leur position), puis on
// nettoie chaque champ séparément :
//   - nom : juste le nom du navire (sans classe, sans statut, sans pilotes)
//   - pilotClass : la classe (A, B1, B2, C1, C2, C0…) dans son propre champ
//   - pilotStatus : le vrai statut (Sailing, Dispatched, Order confirmed…)
//   - pilots : le nombre de pilotes, ou null si inconnu
//   - draft : le tirant d'eau, depuis la colonne du tirant d'eau seulement
//   - speed : une vitesse en nœuds SEULEMENT si la valeur est une vitesse.
//     Une durée comme « 9h 32m » n'est JAMAIS une vitesse : elle va dans
//     transitDuration. Sinon speed vaut null et l'appli affiche « — ».
//   - movementTime : l'heure de mouvement telle que publiée par e-fiche
//     (« 2026-11-24 18:20 » ou null si absente) — jamais devinée. C'est
//     elle qui place la manœuvre dans la vue 48 h de l'appli.
//   - movement : arrival, departure ou shift (déplacement entre postes,
//     seulement quand e-fiche l'indique).
//   - horizon : jusqu'où e-fiche publie vraiment (dernière heure publiée,
//     couvre-t-elle 48 h ?) — l'appli l'affiche au lieu de prétendre
//     couvrir 48 h quand les données s'arrêtent avant.
//
// Règles de prudence : retry, browser fermé dans un finally, et on n'écrase
// jamais data/vessels.json avec un résultat anormalement vide (0 navire, ou
// chute de plus de 75 % par rapport au fichier précédent).
//
// Usage : node scripts/scripts/scrape_efiche.mjs
// Sortie : data/vessels.json

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const EFICHE_URL = 'https://efiche.live.pilotagestlaurent.gc.ca/';
const OUT_FILE = path.join('data', 'vessels.json');
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 10_000;

const NON_COMM = ['TUG', 'REMORQUEUR', 'TAXI', 'PILOT', 'BARGE', 'GCC', 'CCGS'];

// Mots qui, dans une cellule de nom, font partie du statut — pas du nom.
const STATUS_WORDS = [
  'SAILING',
  'ORDER CONFIRMED',
  'ORDER CONFIRME',
  'DISPATCHED',
  'PROSPECT',
  'ANCHORED',
  'ANCRÉ',
  'ANCRE',
  'ARRIVED',
  'ARRIVÉ',
  'DEPARTED',
  'DÉPART',
  'EN TRANSIT',
  'MOUILLAGE',
  'DDS',
  'PAF',
];

const CLASS_RE = /\(([ABC]\d?)\)/i;
const PILOTS_RE = /(\d+)\s*(?:PLT|PILOTE|PILOT)/i;
// Une vitesse : un nombre suivi de nds / nœuds / kn.
const SPEED_RE = /(\d{1,2}(?:[.,]\d{1,2})?)\s*(?:NDS|NŒUDS?|NOEUDS?|KN)\b/i;
// Une durée : « 9h 32m », « 6h 24m ».
const DURATION_RE = /(\d{1,2})\s*h\s*(\d{1,2})\s*m/i;
// Un déplacement entre postes (changement de quai, pas une arrivée ni un départ).
const SHIFT_RE = /d[eé]placement|shift|shifting|changement de poste|berth shift|mouvement interne|repositionnement/i;
const DATE_TIME_RE = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/;
const BERTH_RE = /\b(TRV\d+|BEC\d+)\b/i;
const DRAFT_RE = /(\d{1,2}[.,]\d{1,2})\s*m?\b/;

function normaliseHeader(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Associe chaque colonne à un rôle, d'après son en-tête.
function mapColumns(headers) {
  const map = {};
  const matchers = [
    ['name', /(navire|vessel|ship|bateau)/],
    ['status', /(statut|status|pilote|pilot)/],
    ['draft', /(tirant|draft)/],
    ['speed', /(vitesse|speed|noeud|nds)/],
    ['berth', /(quai|berth|poste|port)/],
    ['movement', /(mouvement|movement|direction|type)/],
    ['time', /(heure|time|date|eta)/],
    ['origin', /(origine|origin|provenance|depart)/],
    ['waypoint', /(etape|waypoint|station|position)/],
  ];
  headers.forEach((header, index) => {
    const h = normaliseHeader(header);
    if (!h) return;
    for (const [role, re] of matchers) {
      if (!(role in map) && re.test(h)) map[role] = index;
    }
  });
  return map;
}

function slugify(text) {
  return (text || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

// Nettoie « PORT NARA (A) SAILING (DDS) : 1 PLT » -> « PORT NARA ».
function cleanName(raw) {
  let name = (raw || '').replace(/\s+/g, ' ').trim();
  name = name.replace(CLASS_RE, ' ');
  for (const word of STATUS_WORDS) {
    name = name.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
  }
  name = name.replace(/:\s*\d+\s*(?:PLT|PILOTE|PILOT)\b/i, ' ');
  name = name.replace(/\(\s*[^)]*\)/g, ' ');
  name = name.replace(/[^A-Z0-9 '\-À-ÿ]/gi, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  // Un nom ne se termine pas par une lettre ou un chiffre isolé tronqué.
  name = name.replace(/\s+[A-Z0-9]$/, '');
  return name.toUpperCase();
}

function extractClass(...cells) {
  for (const cell of cells) {
    const m = (cell || '').match(CLASS_RE);
    if (m) return m[1].toUpperCase();
  }
  return null;
}

function extractPilots(...cells) {
  for (const cell of cells) {
    const m = (cell || '').match(PILOTS_RE);
    if (m) return Number.parseInt(m[1], 10);
  }
  return null;
}

function cleanStatus(raw) {
  let status = (raw || '').replace(/\s+/g, ' ').trim();
  status = status.replace(CLASS_RE, ' ');
  status = status.replace(/:\s*\d+\s*(?:PLT|PILOTE|PILOT)\b/i, ' ');
  status = status.replace(/\s+/g, ' ').trim();
  if (!status || /^\d{1,2}[.,]\d{1,2}\s*m?$/.test(status)) return null; // un tirant d'eau n'est pas un statut
  return status;
}

// Vitesse : seulement si la valeur est vraiment une vitesse en nœuds.
function parseSpeed(cell) {
  const text = (cell || '').trim();
  if (!text) return { speed: null, speedKnots: null, transitDuration: null };
  const speedMatch = text.match(SPEED_RE);
  if (speedMatch) {
    const knots = Number.parseFloat(speedMatch[1].replace(',', '.'));
    return { speed: `${knots} nds`, speedKnots: knots, transitDuration: null };
  }
  // Une durée n'est jamais une vitesse : elle va dans transitDuration.
  const durationMatch = text.match(DURATION_RE);
  if (durationMatch) {
    return {
      speed: null,
      speedKnots: null,
      transitDuration: `${durationMatch[1]}h ${durationMatch[2].padStart(2, '0')}m`,
    };
  }
  return { speed: null, speedKnots: null, transitDuration: null };
}

function parseDraft(cell) {
  const m = (cell || '').match(DRAFT_RE);
  if (!m) return null;
  return `${Number.parseFloat(m[1].replace(',', '.'))} m`;
}

function parseRow(cells, columnMap) {
  const get = (role) => (role in columnMap ? cells[columnMap[role]] || '' : '');
  const rawText = cells.join(' | ');

  // Le code de poste identifie les lignes TRV / BEC.
  const berthMatch = (get('berth') || rawText).match(BERTH_RE);
  if (!berthMatch) return { vessel: null, reason: 'no-berth' };
  const berthCode = berthMatch[1].toUpperCase();
  const isBec = berthCode.startsWith('BEC');

  if (NON_COMM.some((keyword) => rawText.toUpperCase().includes(keyword))) {
    return { vessel: null, reason: 'non-commercial' };
  }

  const name = cleanName(get('name') || cells[0] || '');
  if (!name) return { vessel: null, reason: 'no-name' };

  const pilotClass = extractClass(get('name'), get('status'), cells[0]);
  const pilots = extractPilots(get('status'), get('name'), cells[0]);
  const pilotStatus = cleanStatus(get('status'));

  // Tirant d'eau : colonne dédiée si elle existe, sinon rien (pas de devinette).
  const draft = parseDraft(get('draft'));

  // Vitesse : colonne dédiée si elle existe.
  const { speed, speedKnots, transitDuration } = parseSpeed(get('speed'));
  // Si la colonne vitesse n'existe pas, une durée trouvée ailleurs reste une durée.
  let transit = transitDuration;
  if (!transit && !('speed' in columnMap)) {
    const durationMatch = rawText.match(DURATION_RE);
    if (durationMatch) transit = `${durationMatch[1]}h ${durationMatch[2].padStart(2, '0')}m`;
  }

  const movementText = get('movement') || get('status') || rawText;
  let movement = 'arrival';
  if (SHIFT_RE.test(movementText)) movement = 'shift';
  else if (/d[eé]part|departure|sailing/i.test(movementText)) movement = 'departure';
  else if (/arriv[eé]e|arrival/i.test(movementText)) movement = 'arrival';
  else if (new RegExp(`${berthCode}\\s*-`, 'i').test(rawText)) movement = 'departure';

  const timeMatch = rawText.match(DATE_TIME_RE);
  const orderTime = timeMatch ? `${timeMatch[1]} ${timeMatch[2]}` : null;
  // Heure de mouvement telle que publiée par e-fiche, conservée telle quelle
  // (null si absente) : c'est elle qui place la manœuvre dans les 48 h.
  const movementTime = orderTime;
  const timeLabel = timeMatch ? timeMatch[2] : '';

  const origin = get('origin') || null;
  const waypoint = get('waypoint') || null;

  const id = `${slugify(name)}-${berthCode.toLowerCase()}`;

  return {
    vessel: {
      id,
      port: isBec ? 'BEC' : 'TRV',
      name,
      pilotClass: pilotClass || '—',
      pilotStatus: pilotStatus || '—',
      pilots,
      isCommercial: true,
      movement,
      movementBadge: `${movement === 'departure' ? '↑ Départ' : movement === 'shift' ? '↔ Déplacement' : '↓ Arrivée'}${timeLabel ? ` ${timeLabel}` : ''}`,
      movementTime,
      draft: draft || '—',
      speed: speed || '—',
      speedKnots,
      transitDuration: transit || '—',
      orderTime: orderTime || 'En cours',
      origin,
      waypoint,
      berthCode,
      berthDesc: isBec ? 'Port de Bécancour' : 'Port de Trois-Rivières',
    },
    reason: null,
  };
}

async function scrapeOnce(browser) {
  const page = await browser.newPage();
  try {
    await page.goto(EFICHE_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    // On attend le vrai tableau, pas juste un mot dans la page.
    await page.waitForSelector('table, [role="grid"], [role="table"]', { timeout: 30_000 });
    await page.waitForTimeout(2000);

    return await page.evaluate(() => {
      const table = document.querySelector('table, [role="grid"], [role="table"]');
      if (!table) return { headers: [], rows: [] };
      const headerCells = Array.from(
        table.querySelectorAll('thead th, thead [role="columnheader"], tr:first-child th')
      ).map((el) => (el.innerText || '').trim());
      const rowEls = Array.from(table.querySelectorAll('tbody tr, [role="row"]'));
      const rows = rowEls
        .map((el) =>
          Array.from(el.querySelectorAll('td, [role="gridcell"], [role="cell"]')).map((c) =>
            (c.innerText || '').trim()
          )
        )
        .filter((cells) => cells.some(Boolean));
      return { headers: headerCells, rows };
    });
  } finally {
    await page.close().catch(() => {});
  }
}

function readPreviousCount() {
  try {
    const previous = JSON.parse(fs.readFileSync(OUT_FILE, 'utf8'));
    return Array.isArray(previous.vessels) ? previous.vessels.length : 0;
  } catch {
    return 0;
  }
}

const browser = await chromium.launch();
let scraped = null;
let lastError = null;
try {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      scraped = await scrapeOnce(browser);
      if (scraped.rows.length) break;
      lastError = new Error(`tentative ${attempt} : aucun tableau lu`);
    } catch (error) {
      lastError = error;
      console.error(`Tentative ${attempt}/${MAX_ATTEMPTS} échouée :`, error.message);
    }
    if (attempt < MAX_ATTEMPTS) await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
  }
} finally {
  // Le navigateur est TOUJOURS fermé, même en cas d'erreur.
  await browser.close().catch(() => {});
}

if (!scraped || !scraped.rows.length) {
  console.error('Échec du scrape après', MAX_ATTEMPTS, 'tentatives :', lastError?.message);
  console.error('data/vessels.json est conservé tel quel (anciennes données).');
  process.exit(1);
}

const columnMap = mapColumns(scraped.headers);
if (Object.keys(columnMap).length === 0) {
  console.warn('Avertissement : aucun en-tête de colonne reconnu, parsing en mode dégradé.');
}
console.log('Colonnes reconnues :', JSON.stringify(columnMap));

const seen = new Set();
const vessels = [];
const rejected = { 'non-commercial': 0, 'no-berth': 0, 'no-name': 0, duplicate: 0 };

for (const cells of scraped.rows) {
  const { vessel, reason } = parseRow(cells, columnMap);
  if (!vessel) {
    if (reason in rejected) rejected[reason] += 1;
    continue;
  }
  if (seen.has(vessel.id)) {
    rejected.duplicate += 1;
    continue;
  }
  seen.add(vessel.id);
  vessels.push(vessel);
}

// Tri par heure de mouvement vérifiée (la plus proche d'abord).
vessels.sort((a, b) => String(a.orderTime).localeCompare(String(b.orderTime)));

console.log('Navires détectés :', vessels.length);
console.log('Rejetés :', JSON.stringify(rejected));
console.log('Déplacements entre postes :', vessels.filter((v) => v.movement === 'shift').length);

// Horizon : jusqu'où e-fiche publie-t-elle vraiment à l'avance ?
// Les heures e-fiche sont locales (America/Toronto) et le robot tourne en
// UTC : on compare en « heure murale » de Toronto des deux côtés, sans
// inventer de fuseau ni décaler les heures publiées.
function parseWallTime(str) {
  const m = (str || '').match(DATE_TIME_RE);
  if (!m) return null;
  const [y, mo, d] = m[1].split('-').map(Number);
  const [hh, mm] = m[2].split(':').map(Number);
  return new Date(y, mo - 1, d, hh, mm);
}
const movementTimes = vessels.map((v) => v.movementTime).filter(Boolean).sort();
const latestMovementTime = movementTimes.length ? movementTimes[movementTimes.length - 1] : null;
const latestDate = latestMovementTime ? parseWallTime(latestMovementTime) : null;
const torontoNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Toronto' }));
const windowEnd = new Date(torontoNow.getTime() + 48 * 3600 * 1000);
const covers48h = latestDate ? latestDate.getTime() >= windowEnd.getTime() : false;
const horizon = {
  windowHours: 48,
  latestMovementTime,
  latestMovementLabel: latestDate
    ? `${latestDate.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' })} • ${String(latestDate.getHours()).padStart(2, '0')}:${String(latestDate.getMinutes()).padStart(2, '0')}`
    : null,
  covers48h,
  note: covers48h
    ? 'e-fiche publie au moins 48 h à l’avance.'
    : 'e-fiche ne publie pas 48 h à l’avance : la vue Manœuvres ne couvre que jusqu’à la dernière heure publiée.',
};
console.log('Horizon e-fiche :', JSON.stringify(horizon));

const previousCount = readPreviousCount();
if (vessels.length === 0) {
  console.error('0 navire détecté : data/vessels.json est conservé, rien n’est écrasé.');
  process.exit(1);
}
if (previousCount >= 8 && vessels.length < previousCount * 0.25) {
  console.error(
    `Résultat anormalement faible (${vessels.length} navires contre ${previousCount} précédemment) : ` +
      'data/vessels.json est conservé, rien n’est écrasé.'
  );
  process.exit(1);
}

const now = new Date().toLocaleTimeString('fr-CA', {
  timeZone: 'America/Toronto',
  hour: '2-digit',
  minute: '2-digit',
});
fs.mkdirSync('data', { recursive: true });
fs.writeFileSync(
  OUT_FILE,
  JSON.stringify(
    {
      updatedAt: new Date().toISOString(),
      updatedLabel: `Auto • ${now}`,
      source: 'e-fiche — Pilotage Saint-Laurent (APL)',
      sourceUrl: EFICHE_URL,
      count: vessels.length,
      horizon,
      vessels,
    },
    null,
    2
  )
);
console.log(`Écrit ${vessels.length} navires dans ${OUT_FILE}`);
