/* TRV & BEC Navires — app.js
 *
 * Une seule source de vérité : data/vessels.json, produit par le robot
 * GitHub Actions. Aucune donnée embarquée dans cette page.
 * En cas de panne réseau, on affiche les dernières données connues
 * (localStorage) avec leur date — jamais de valeurs inventées.
 */
'use strict';

const FEED_URL = './data/vessels.json';
const AIS_URL = './data/ais_verification.json';
const CACHE_KEY = 'trv_bec_v6_data';
const PIN_KEY = 'trv_bec_v6_pin';
const PREV_KEY = 'trv_bec_v6_manoeuvres_prev';
const DIFF_KEY = 'trv_bec_v6_manoeuvres_diff';
const STALE_MINUTES = 60;
const REFRESH_MS = 5 * 60 * 1000;
const MANOEUVRE_WINDOW_HOURS = 48;

const CLASS_RE = /\(([ABC]\d?)\)/i;
const PILOTS_RE = /(\d+)\s*(?:PLT|PILOTE|PILOT)/i;
const DURATION_RE = /(\d{1,2})\s*h\s*(\d{1,2})\s*m/i;
const DATE_TIME_RE = /(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})/;

let vessels = [];
let feedMeta = { updatedAt: null, updatedLabel: '', source: '', offline: false, horizon: null };
let aisVerification = null; // { status, statusReason, checkedAt, checkedLabel, byId: Map(id -> entrée AIS) }
let activePort = 'ALL';
let activeFilter = 'all';
let activeManoeuvreFilter = 'all';
let manoeuvreDiff = { newIds: [], timeChanged: {}, disappeared: [] };
let commercialOnly = true;
let compactMode = false;
let searchQuery = '';

const $ = (id) => document.getElementById(id);

/* ---------- Nettoyage côté client (compatibilité + import collé) ---------- */

function cleanName(raw) {
  let name = String(raw || '').replace(/\s+/g, ' ').trim();
  name = name.replace(CLASS_RE, ' ');
  for (const word of ['SAILING', 'ORDER CONFIRMED', 'DISPATCHED', 'PROSPECT', 'DDS', 'PAF']) {
    name = name.replace(new RegExp(`\\b${word}\\b`, 'gi'), ' ');
  }
  name = name.replace(/:\s*\d+\s*(?:PLT|PILOTE|PILOT)\b/i, ' ');
  name = name.replace(/\([^)]*\)/g, ' ');
  name = name.replace(/\s+/g, ' ').trim();
  return name.toUpperCase();
}

// Normalise un navire venant du flux (ou d'un vieux cache) : on répare les
// défauts connus de l'ancien format au lieu de les afficher tels quels.
function normalizeVessel(raw) {
  const v = { ...raw };
  const nameCell = String(v.name || '');
  const extractedClass = (nameCell.match(CLASS_RE) || [])[1];
  if (!v.pilotClass || v.pilotClass === 'Commercial') {
    v.pilotClass = extractedClass ? extractedClass.toUpperCase() : '—';
  }
  v.name = cleanName(nameCell) || 'NAVIRE';

  // Ancien défaut : le tirant d'eau se retrouvait dans pilotStatus.
  if (/^\d{1,2}[.,]\d{1,2}\s*m?$/.test(String(v.pilotStatus || '').trim())) {
    if ((!v.draft || v.draft === '—') && v.pilotStatus) v.draft = `${v.pilotStatus} m`;
    v.pilotStatus = '—';
  }
  // Ancien défaut : une durée affichée comme vitesse (« 9h 32m nds »).
  if (typeof v.speed === 'string' && DURATION_RE.test(v.speed)) {
    const m = v.speed.match(DURATION_RE);
    if (!v.transitDuration || v.transitDuration === '—') {
      v.transitDuration = `${m[1]}h ${m[2].padStart(2, '0')}m`;
    }
    v.speed = '—';
    v.speedKnots = null;
  }
  if (typeof v.speed === 'number') {
    v.speedKnots = v.speed;
    v.speed = `${v.speed} nds`;
  }
  v.draft = v.draft || '—';
  v.speed = v.speed || '—';
  v.pilotStatus = v.pilotStatus || '—';
  v.pilots = typeof v.pilots === 'number' ? v.pilots : null;
  v.transitDuration = v.transitDuration || '—';
  v.orderTime = v.orderTime || 'En cours';
  // Heure de mouvement telle que publiée par e-fiche, sans la deviner :
  // null quand e-fiche n'en publie pas (la manœuvre ne peut pas être
  // placée dans les 48 h et ne doit jamais recevoir une heure inventée).
  const timeMatch = String(v.orderTime || '').match(DATE_TIME_RE);
  v.movementTime = timeMatch ? `${timeMatch[1]} ${timeMatch[2]}` : null;
  v.origin = v.origin || null;
  v.waypoint = v.waypoint || null;
  v.berthDesc = v.berthDesc || (v.port === 'BEC' ? 'Port de Bécancour' : 'Port de Trois-Rivières');
  return v;
}

function movementTime(v) {
  const m = String(v.orderTime || '').match(DATE_TIME_RE);
  return m ? `${m[1]} ${m[2]}` : '9999';
}

function movementBadge(v) {
  const m = String(v.orderTime || '').match(DATE_TIME_RE);
  const time = m ? m[2] : '';
  const label =
    v.movement === 'departure' ? '↑ Départ' : v.movement === 'shift' ? '↔ Déplacement' : '↓ Arrivée';
  return `${label}${time ? ` ${time}` : ''}`;
}

function pilotLabel(v) {
  const parts = [];
  if (v.pilotStatus && v.pilotStatus !== '—') parts.push(v.pilotStatus);
  if (v.pilots) parts.push(`${v.pilots} plt`);
  return parts.join(' • ') || '—';
}

/* ---------- Vérification : liens manuels + badge AIS ---------- */

// Liens de vérification manuelle (gratuits, sans clé, nouvel onglet).
// - VesselFinder : URL de recherche directe VÉRIFIÉE le 2026-11-25
//   (https://www.vesselfinder.com/vessels?name=PORT+NARA renvoie bien la
//   fiche du navire).
// - MarineTraffic : aucun format d'URL de recherche directe n'est publié
//   par MarineTraffic (leur aide dit de chercher dans la barre de la carte
//   en direct) et l'ancien motif /ais/index/search/all?keyword= renvoie
//   404 (vérifié le 2026-11-25). Le lien passe donc par une recherche web
//   restreinte à marinetraffic.com — c'est écrit dans le libellé.
//   Aucun appel à l'API MarineTraffic (payante / entreprise).
function verifyLinksHTML(v) {
  const name = encodeURIComponent(v.name);
  const mtUrl = `https://www.google.com/search?q=site%3Amarinetraffic.com+%22${name}%22`;
  const vfUrl = `https://www.vesselfinder.com/vessels?name=${name}`;
  return `<div class="verify-links">Vérifier : ` +
    `<a href="${mtUrl}" target="_blank" rel="noopener noreferrer" title="Recherche web restreinte à marinetraffic.com : MarineTraffic ne publie pas d'URL de recherche directe">MarineTraffic (recherche) ↗</a>` +
    ` · <a href="${vfUrl}" target="_blank" rel="noopener noreferrer">VesselFinder ↗</a></div>`;
}

// Badge AIS : vert « ✓ Confirmé AIS • il y a X min » quand le navire a été
// vu par AISStream, gris « Non confirmé par AIS » sinon. Quand le fichier
// de vérification n'existe pas encore (ou n'a jamais tourné), on n'affiche
// rien : on ne peut pas dire « non confirmé » pour une vérification qui
// n'a jamais eu lieu. Jamais de position ni de vitesse AIS inventée.
function aisBadgeHTML(v) {
  if (!aisVerification) return '';
  const entry = aisVerification.byId.get(v.id);
  if (!entry || !entry.confirmed) {
    return '<span class="ais-badge not-confirmed">Non confirmé par AIS</span>';
  }
  const mins = minutesSince(entry.lastSeenAt);
  const ago = mins === null ? '' : mins < 1 ? ' • à l’instant' : ` • ${freshnessLabel(entry.lastSeenAt)}`;
  const title = entry.lastSeenLabel ? `Dernière observation AIS : ${entry.lastSeenLabel}` : 'Vu par AIS';
  return `<span class="ais-badge confirmed" title="${title}">✓ Confirmé AIS${ago}</span>`;
}

function serializeAis() {
  if (!aisVerification) return null;
  return {
    status: aisVerification.status,
    statusReason: aisVerification.statusReason,
    checkedAt: aisVerification.checkedAt,
    checkedLabel: aisVerification.checkedLabel,
    vessels: [...aisVerification.byId.values()],
  };
}

function restoreAis(raw) {
  if (!raw || !Array.isArray(raw.vessels)) return null;
  return {
    status: raw.status || 'unknown',
    statusReason: raw.statusReason || '',
    checkedAt: raw.checkedAt || null,
    checkedLabel: raw.checkedLabel || '',
    byId: new Map(raw.vessels.map((e) => [e.id, e])),
  };
}

// Lecture de data/ais_verification.json : meilleur effort seulement —
// si le fichier est absent (vérification jamais lancée), l'appli continue
// sans badge AIS au lieu d'échouer.
async function tryFetchAisVerification() {
  try {
    const res = await fetch(AIS_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    aisVerification = restoreAis(data);
    return aisVerification !== null;
  } catch (e) {
    aisVerification = null;
    return false;
  }
}

/* ---------- Prochaines manœuvres — 48 h ---------- */

// L'heure publiée est une heure locale de Trois-Rivières / Bécancour
// (America/Toronto) : on l'interprète dans le fuseau de l'appareil, qui
// est celui de Gordon sur son téléphone.
function parseMovementDate(v) {
  const m = String(v.movementTime || v.orderTime || '').match(DATE_TIME_RE);
  if (!m) return null;
  const [y, mo, d] = m[1].split('-').map(Number);
  const [hh, mm] = m[2].split(':').map(Number);
  const date = new Date(y, mo - 1, d, hh, mm);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMovementTime(str) {
  const m = String(str || '').match(DATE_TIME_RE);
  if (!m) return '—';
  const [y, mo, d] = m[1].split('-').map(Number);
  const [hh, mm] = m[2].split(':').map(Number);
  const date = new Date(y, mo - 1, d, hh, mm);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' }) +
    ` • ${m[2]}`;
}

function countdownLabel(date) {
  const diffMin = Math.round((date.getTime() - Date.now()) / 60000);
  if (diffMin < 0) return 'heure passée';
  if (diffMin < 60) return `dans ${diffMin} min`;
  const hours = Math.floor(diffMin / 60);
  const mins = diffMin % 60;
  if (hours < 24) return mins ? `dans ${hours} h ${String(mins).padStart(2, '0')}` : `dans ${hours} h`;
  const days = Math.floor(hours / 24);
  const restH = hours % 24;
  return restH ? `dans ${days} j ${restH} h` : `dans ${days} j`;
}

function dayLabel(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  if (day.getTime() === today.getTime()) return "Aujourd'hui";
  if (day.getTime() === tomorrow.getTime()) return 'Demain';
  return date.toLocaleDateString('fr-CA', { weekday: 'long', day: 'numeric', month: 'long' });
}

function dayKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

/* --- Détection des changements entre deux versions d'e-fiche ---
 * La comparaison se fait contre la dernière version connue, gardée en
 * localStorage. Au tout premier chargement il n'y a rien à comparer :
 * on ne marque rien « Nouveau ». Une manœuvre disparue n'est signalée
 * que si son heure était encore à venir (sinon elle a simplement eu lieu).
 * On n'invente jamais de raison pour une disparition. */
function loadPrevSnapshot() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PREV_KEY) || 'null');
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

function loadDiff() {
  try {
    const parsed = JSON.parse(localStorage.getItem(DIFF_KEY) || 'null');
    if (parsed && Array.isArray(parsed.newIds) && parsed.timeChanged && Array.isArray(parsed.disappeared)) {
      return parsed;
    }
  } catch (e) { /* diff illisible : on repart de zéro */ }
  return { newIds: [], timeChanged: {}, disappeared: [] };
}

function saveDiff() {
  try {
    localStorage.setItem(DIFF_KEY, JSON.stringify(manoeuvreDiff));
  } catch (e) { /* stockage indisponible */ }
}

function computeManoeuvreDiff(next, prev) {
  if (!prev) return { newIds: [], timeChanged: {}, disappeared: [] };
  const prevById = new Map(prev.map((v) => [v.id, v]));
  const nextIds = new Set(next.map((v) => v.id));
  const newIds = [];
  const timeChanged = {};
  for (const v of next) {
    const old = prevById.get(v.id);
    if (!old) {
      newIds.push(v.id);
    } else if (old.movementTime && v.movementTime && old.movementTime !== v.movementTime) {
      timeChanged[v.id] = old.movementTime;
    }
  }
  const now = Date.now();
  const disappeared = prev
    .filter((v) => {
      if (nextIds.has(v.id)) return false;
      const d = parseMovementDate(v);
      return d && d.getTime() >= now;
    })
    .map((v) => ({
      id: v.id,
      name: v.name,
      movement: v.movement,
      movementTime: v.movementTime,
      orderTime: v.orderTime,
      berthCode: v.berthCode,
      berthDesc: v.berthDesc,
      port: v.port,
      draft: v.draft,
      pilotStatus: v.pilotStatus,
      pilots: v.pilots,
    }));
  return { newIds, timeChanged, disappeared };
}

function applyNewFeed(nextVessels) {
  const prev = loadPrevSnapshot();
  manoeuvreDiff = computeManoeuvreDiff(nextVessels, prev);
  saveDiff();
  try {
    localStorage.setItem(PREV_KEY, JSON.stringify(nextVessels));
  } catch (e) { /* stockage indisponible */ }
}

function getManoeuvres() {
  const now = Date.now();
  const end = now + MANOEUVRE_WINDOW_HOURS * 3600 * 1000;
  return vessels
    .filter((v) => !commercialOnly || v.isCommercial)
    .filter((v) => activePort === 'ALL' || v.port === activePort)
    .map((v) => ({ v, date: parseMovementDate(v) }))
    .filter(({ date }) => date && date.getTime() >= now && date.getTime() <= end)
    .sort((a, b) => a.date - b.date);
}

function manoeuvreCardHTML(v, date, flag) {
  const isArr = v.movement === 'arrival';
  const portCls = v.port === 'BEC' ? 'port-bec' : 'port-trv';
  const moveCls = v.movement === 'shift' ? 'shift' : isArr ? 'arrival' : 'departure';
  const flagHTML =
    flag === 'new'
      ? '<span class="man-flag new">Nouveau</span>'
      : flag === 'changed'
        ? '<span class="man-flag changed">Heure changée</span>'
        : '';
  const oldTime = flag === 'changed' && manoeuvreDiff.timeChanged[v.id];
  return `<article class="glass man-card">
    <div class="man-top">
      <div>
        <div class="man-name-row">
          <span class="man-name">${v.name}</span>
          <span class="chip ${portCls}">${v.port}</span>
          <span class="chip ${moveCls}">${movementBadge(v)}</span>
        </div>
        <p class="man-time"><strong>${formatMovementTime(v.movementTime)}</strong> •
          <span class="man-countdown" data-time="${date.getTime()}">${countdownLabel(date)}</span></p>
      </div>
      ${flagHTML}
    </div>
    ${oldTime ? `<span class="man-old-time">Ancienne heure publiée : ${formatMovementTime(oldTime)}</span>` : ''}
    <div class="man-grid">
      <div><span class="lbl">Quai</span><strong>${v.berthCode} • ${v.berthDesc}</strong></div>
      <div><span class="lbl">Tirant d’eau</span><strong>${v.draft}</strong></div>
      <div><span class="lbl">Pilotes</span><strong>${pilotLabel(v)}</strong></div>
    </div>
    <div class="man-verify">${aisBadgeHTML(v)}${verifyLinksHTML(v)}</div>
  </article>`;
}

function renderManoeuvres() {
  const section = $('manoeuvresSection');
  if (!section) return;
  const all = getManoeuvres();
  const hasShift = all.some(({ v }) => v.movement === 'shift');
  $('manFilterShift').hidden = !hasShift;
  if (activeManoeuvreFilter === 'shift' && !hasShift) activeManoeuvreFilter = 'all';

  const filtered =
    activeManoeuvreFilter === 'all' ? all : all.filter(({ v }) => v.movement === activeManoeuvreFilter);

  $('manoeuvreCount').textContent =
    `${all.length} manœuvre${all.length > 1 ? 's' : ''} dans les prochaines 48 h` +
    (filtered.length !== all.length ? ` — ${filtered.length} affichée${filtered.length > 1 ? 's' : ''}` : '');

  // Honnêteté sur l'horizon : jusqu'où e-fiche publie vraiment.
  const allCommercial = vessels.filter((v) => !commercialOnly || v.isCommercial);
  const latestDates = allCommercial
    .map((v) => parseMovementDate(v))
    .filter(Boolean)
    .sort((a, b) => a - b);
  const latest = latestDates.length ? latestDates[latestDates.length - 1] : null;
  const windowEnd = Date.now() + MANOEUVRE_WINDOW_HOURS * 3600 * 1000;
  const horizonEl = $('manoeuvreHorizon');
  const warnEl = $('manoeuvreHorizonWarn');
  if (!latest) {
    horizonEl.textContent = 'Aucune heure de mouvement publiée par e-fiche pour le moment.';
    warnEl.hidden = true;
  } else {
    const latestLabel = latest.toLocaleDateString('fr-CA', { weekday: 'short', day: 'numeric', month: 'short' }) +
      ` • ${String(latest.getHours()).padStart(2, '0')}:${String(latest.getMinutes()).padStart(2, '0')}`;
    horizonEl.textContent = `e-fiche publiée jusqu’au ${latestLabel} (heure de Trois-Rivières).`;
    const covers = latest.getTime() >= windowEnd;
    warnEl.hidden = covers;
    if (!covers) {
      warnEl.textContent =
        `⚠️ L’e-fiche ne publie que jusqu’au ${latestLabel} : la vue ne couvre pas les 48 h complètes. ` +
        'Les manœuvres au-delà n’y sont pas encore publiées.';
    }
  }

  // État de la vérification AIS (une seule ligne, pas une par carte).
  const aisLine = $('aisStatusLine');
  if (!aisVerification) {
    aisLine.textContent = '';
    aisLine.hidden = true;
  } else if (aisVerification.status === 'ok') {
    aisLine.textContent =
      `Vérification AIS (AISStream) : ${aisVerification.checkedLabel || 'récente'} — ` +
      'les badges « Confirmé AIS » viennent du flux AIS en direct.';
    aisLine.hidden = false;
  } else if (aisVerification.status === 'not_configured') {
    aisLine.textContent =
      'Vérification AIS non configurée : ajoute le secret AISSTREAM_API_KEY au dépôt ' +
      'pour activer les badges « Confirmé AIS » (voir APPLIQUER.md). Les liens de vérification ci-dessous fonctionnent déjà.';
    aisLine.hidden = false;
  } else {
    aisLine.textContent = `Vérification AIS indisponible : ${aisVerification.statusReason || 'raison inconnue'}`;
    aisLine.hidden = false;
  }

  // Navires sans heure publiée : impossibles à placer dans les 48 h.
  const noTimeCount = vessels.filter(
    (v) => (!commercialOnly || v.isCommercial) && (activePort === 'ALL' || v.port === activePort) && !parseMovementDate(v)
  ).length;
  $('manoeuvresNoTime').textContent = noTimeCount
    ? `${noTimeCount} navire${noTimeCount > 1 ? 's' : ''} dans e-fiche sans heure publiée — ${noTimeCount > 1 ? 'ils' : 'il'} ne ${noTimeCount > 1 ? 'peuvent' : 'peut'} pas être placé${noTimeCount > 1 ? 's' : ''} dans les 48 h.`
    : '';

  const container = $('manoeuvresList');
  if (!filtered.length) {
    container.innerHTML =
      '<div class="glass empty-state">Aucune manœuvre dans les prochaines 48 h pour ce filtre.</div>';
  } else {
    let html = '';
    let currentDay = null;
    for (const { v, date } of filtered) {
      const key = dayKey(date);
      if (key !== currentDay) {
        currentDay = key;
        html += `<h3 class="man-day">${dayLabel(date)} · ${date.toLocaleDateString('fr-CA', { day: 'numeric', month: 'short' })}</h3>`;
      }
      const flag = manoeuvreDiff.newIds.includes(v.id)
        ? 'new'
        : manoeuvreDiff.timeChanged[v.id]
          ? 'changed'
          : null;
      html += manoeuvreCardHTML(v, date, flag);
    }
    container.innerHTML = html;
  }

  // Manœuvres disparues de l'e-fiche (heure encore à venir).
  const goneEl = $('manoeuvresGone');
  const gone = manoeuvreDiff.disappeared
    .map((v) => ({ v, date: parseMovementDate(v) }))
    .filter(({ date }) => date && date.getTime() >= Date.now());
  if (!gone.length) {
    goneEl.hidden = true;
    goneEl.innerHTML = '';
  } else {
    goneEl.hidden = false;
    goneEl.innerHTML =
      '<h3>Disparues de l’e-fiche</h3>' +
      '<p>Ces manœuvres étaient dans la dernière version d’e-fiche et n’y sont plus. ' +
      'Aucune raison connue — vérifie auprès du dispatch ou sur e-fiche direct.</p>' +
      gone
        .map(({ v, date }) => manoeuvreCardHTML({ ...v, name: v.name }, date, null))
        .join('');
  }
}

function updateCountdowns() {
  document.querySelectorAll('.man-countdown[data-time]').forEach((el) => {
    const date = new Date(Number(el.dataset.time));
    if (!Number.isNaN(date.getTime())) el.textContent = countdownLabel(date);
  });
}

/* ---------- Fraîcheur des données ---------- */

function minutesSince(iso) {
  if (!iso) return null;
  const diff = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(diff) || diff < 0) return null;
  return Math.floor(diff / 60000);
}

function freshnessLabel(iso) {
  const min = minutesSince(iso);
  if (min === null) return '';
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const hours = Math.floor(min / 60);
  return `il y a ${hours} h${min % 60 ? ` ${min % 60} min` : ''}`;
}

function updateFreshness() {
  const freshEl = $('freshLabel');
  const staleEl = $('staleBanner');
  const dot = $('liveDot');
  const min = minutesSince(feedMeta.updatedAt);
  freshEl.textContent = feedMeta.updatedLabel || '';
  if (min !== null) freshEl.textContent += ` • ${freshnessLabel(feedMeta.updatedAt)}`;
  const stale = min !== null && min > STALE_MINUTES;
  staleEl.classList.toggle('visible', stale);
  dot.classList.toggle('stale', stale);
  if (stale) {
    $('staleText').textContent =
      `Données de plus d’une heure — dernière mise à jour ${feedMeta.updatedLabel || 'inconnue'}. ` +
      'Le robot met à jour toutes les 15 minutes ; vérifie e-fiche direct si le problème persiste.';
  }
  $('footerUpdatedAt').textContent = feedMeta.updatedAt
    ? new Date(feedMeta.updatedAt).toLocaleString('fr-CA', { timeZone: 'America/Toronto' })
    : 'inconnue';
}

/* ---------- Chargement du flux ---------- */

function saveCache() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ vessels, meta: feedMeta, ais: serializeAis() }));
  } catch (e) { /* stockage indisponible : on continue sans cache */ }
}

function loadCache() {
  try {
    const parsed = JSON.parse(localStorage.getItem(CACHE_KEY) || 'null');
    if (parsed && Array.isArray(parsed.vessels) && parsed.vessels.length) {
      aisVerification = restoreAis(parsed.ais);
      return { vessels: parsed.vessels.map(normalizeVessel), meta: parsed.meta || {} };
    }
  } catch (e) { /* cache illisible : on l'ignore */ }
  return null;
}

async function tryFetchAutoFeed(silent) {
  try {
    const res = await fetch(FEED_URL, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!Array.isArray(data.vessels) || !data.vessels.length) throw new Error('flux vide');
    vessels = data.vessels.map(normalizeVessel);
    feedMeta = {
      updatedAt: data.updatedAt || null,
      updatedLabel: data.updatedLabel || '',
      source: data.source || 'e-fiche — Pilotage Saint-Laurent (APL)',
      offline: false,
      horizon: data.horizon || null,
    };
    applyNewFeed(vessels);
    await tryFetchAisVerification();
    $('offlineNote').classList.remove('visible');
    saveCache();
    updateFreshness();
    renderAll();
    if (!silent) showToast('Flux automatique synchronisé ✓');
    return true;
  } catch (e) {
    // Repli : dernières données connues, avec leur date — jamais de vide.
    const cached = loadCache();
    if (cached) {
      vessels = cached.vessels;
      feedMeta = { ...cached.meta, offline: true };
      manoeuvreDiff = loadDiff();
      $('offlineNote').classList.add('visible');
      $('offlineNoteText').textContent =
        `Hors-ligne : dernières données connues du ${feedMeta.updatedLabel || 'cache'}. ` +
        'Elles seront remplacées dès que le réseau revient.';
      updateFreshness();
      renderAll();
    }
    return false;
  }
}

/* ---------- Rendu ---------- */

function getFilteredVessels(portOverride) {
  const target = portOverride !== undefined ? portOverride : activePort;
  return vessels.filter((v) => {
    if (commercialOnly && !v.isCommercial) return false;
    if (target !== 'ALL' && v.port !== target) return false;
    if (activeFilter !== 'all' && v.movement !== activeFilter) return false;
    if (searchQuery) {
      const hay = `${v.name} ${v.berthCode} ${v.berthDesc} ${v.pilotClass}`.toUpperCase();
      if (!hay.includes(searchQuery.toUpperCase())) return false;
    }
    return true;
  });
}

function sortedVessels(list) {
  return [...list].sort((a, b) => movementTime(a).localeCompare(movementTime(b)));
}

function showToast(msg) {
  const banner = $('toastBanner');
  $('toastMessage').textContent = msg;
  banner.classList.add('visible');
  setTimeout(() => banner.classList.remove('visible'), 2800);
}

function renderAll() {
  renderManoeuvres();
  const visibleAll = vessels.filter((v) => !commercialOnly || v.isCommercial);
  const visiblePort = visibleAll.filter((v) => activePort === 'ALL' || v.port === activePort);
  const excludedCount = vessels.filter((v) => !v.isCommercial).length;

  $('countPortAll').textContent = visibleAll.length;
  $('countPortTrv').textContent = visibleAll.filter((v) => v.port === 'TRV').length;
  $('countPortBec').textContent = visibleAll.filter((v) => v.port === 'BEC').length;
  $('statArrivals').textContent = visiblePort.filter((v) => v.movement === 'arrival').length;
  $('statDepartures').textContent = visiblePort.filter((v) => v.movement === 'departure').length;
  $('excludedCountLabel').textContent = `${excludedCount} remorqueurs/taxis masqués`;

  const becList = sortedVessels(visibleAll.filter((v) => v.port === 'BEC'));
  const trvList = sortedVessels(visibleAll.filter((v) => v.port === 'TRV'));
  $('quickBecCount').textContent = `${becList.length} navires`;
  $('quickTrvCount').textContent = `${trvList.length} navires`;
  if (becList[0]) {
    $('quickBecName').textContent = becList[0].name;
    $('quickBecMeta').textContent = `${becList[0].berthCode} • ${String(becList[0].orderTime).slice(5)}`;
  }
  if (trvList[0]) {
    $('quickTrvName').textContent = trvList[0].name;
    $('quickTrvMeta').textContent = `${trvList[0].berthCode} • ${String(trvList[0].orderTime).slice(5)}`;
  }

  // Vedette : le navire épinglé par l'utilisateur d'abord, sinon le prochain
  // mouvement vérifié (heure la plus proche), jamais un choix arbitraire.
  const pinnedId = localStorage.getItem(PIN_KEY);
  const sortedPort = sortedVessels(visiblePort);
  const spot = (pinnedId && sortedPort.find((v) => v.id === pinnedId)) || sortedPort[0];
  if (spot) {
    $('spotlightSection').classList.remove('hidden');
    $('spotName').textContent = spot.name;
    const badge = $('spotBadge');
    badge.textContent = movementBadge(spot);
    badge.classList.toggle('departure', spot.movement === 'departure');
    $('spotPilotStatus').textContent = pilotLabel(spot);
    const route = [spot.origin, spot.waypoint, spot.berthCode].filter(Boolean).join(' → ');
    $('spotSub').textContent =
      `${spot.pilotClass !== '—' ? `Classe ${spot.pilotClass} • ` : ''}Tirant d’eau ${spot.draft}` +
      `${spot.transitDuration !== '—' ? ` • Transit ${spot.transitDuration}` : ''}`;
    $('spotBerth').textContent = spot.berthCode;
    $('spotBerthDesc').textContent = spot.berthDesc;
    $('spotOrigin').textContent = spot.origin || '—';
    $('spotWaypoint').textContent = spot.waypoint ? `📍 ${spot.waypoint}` : '📍 —';
    $('spotSpeed').textContent = spot.speed === '—' ? 'Vitesse —' : `${spot.speed}`;
    $('spotDest').textContent = route || spot.berthCode;
    $('spotVerifyRow').innerHTML = `${aisBadgeHTML(spot)}${verifyLinksHTML(spot)}`;
  } else {
    $('spotlightSection').classList.add('hidden');
    $('spotVerifyRow').innerHTML = '';
  }

  const list = sortedVessels(getFilteredVessels());
  const container = $('vesselListContainer');
  if (compactMode) {
    container.innerHTML = '';
    return;
  }
  if (!list.length) {
    container.innerHTML =
      '<div class="glass empty-state">Aucun navire commercial ne correspond à ce filtre.</div>';
    return;
  }
  container.innerHTML = list
    .map((v) => {
      const isArr = v.movement === 'arrival';
      const portCls = v.port === 'BEC' ? 'port-bec' : 'port-trv';
      const moveCls = isArr ? 'arrival' : 'departure';
      const pinned = localStorage.getItem(PIN_KEY) === v.id;
      return `<article class="glass vessel-card">
        <div class="vessel-head">
          <div>
            <div class="vessel-name-row">
              <span class="vessel-name">${v.name}</span>
              <span class="chip ${portCls}">${v.port}</span>
              ${v.pilotClass !== '—' ? `<span class="chip class">Classe ${v.pilotClass}</span>` : ''}
              <span class="chip ${moveCls}">${movementBadge(v)}</span>
            </div>
            <p class="vessel-sub">${v.berthDesc}${v.transitDuration !== '—' ? ` • Transit ${v.transitDuration}` : ''}</p>
          </div>
          <button type="button" data-pin="${v.id}" class="pin-btn${pinned ? ' pinned' : ''}" title="Épingler en vedette">
            ${pinned ? '★ Vedette' : '☆ Épingler'}
          </button>
        </div>
        <div class="vessel-grid">
          <div><span class="lbl">Quai</span><strong>${v.berthCode}</strong></div>
          <div><span class="lbl">Tirant / Vit.</span><strong>${v.draft} • ${v.speed}</strong></div>
          <div><span class="lbl">Pilotes</span><strong>${pilotLabel(v)}</strong></div>
        </div>
        <div class="vessel-verify">${aisBadgeHTML(v)}${verifyLinksHTML(v)}</div>
      </article>`;
    })
    .join('');

  container.querySelectorAll('.pin-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pin;
      if (localStorage.getItem(PIN_KEY) === id) localStorage.removeItem(PIN_KEY);
      else localStorage.setItem(PIN_KEY, id);
      renderAll();
      showToast('Vedette mise à jour ✓');
    });
  });
}

/* ---------- Import collé depuis e-fiche (même nettoyage que le robot) ---------- */

function parsePastedLine(line) {
  const berthMatch = line.match(/\b(TRV\d+|BEC\d+)\b/i);
  if (!berthMatch) return null;
  const berthCode = berthMatch[1].toUpperCase();
  if (['TUG', 'REMORQUEUR', 'TAXI', 'PILOT', 'BARGE', 'GCC', 'CCGS'].some((k) => line.toUpperCase().includes(k))) {
    return null;
  }
  const firstCell = line.split(/\t|\s{2,}/)[0].trim();
  const name = cleanName(firstCell);
  if (!name) return null;
  const pilotClass = ((firstCell.match(CLASS_RE) || [])[1] || '').toUpperCase() || '—';
  const pilotsMatch = line.match(PILOTS_RE);
  const timeMatch = line.match(DATE_TIME_RE);
  const draftMatch = line.match(/(\d{1,2}[.,]\d{1,2})\s*m\b/);
  const speedMatch = line.match(/(\d{1,2}[.,]\d{1,2})\s*(?:NDS|NŒUDS?|NOEUDS?|KN)\b/i);
  const durationMatch = line.match(DURATION_RE);
  let movement = 'arrival';
  if (/d[eé]placement|shift|changement de poste|mouvement interne/i.test(line)) movement = 'shift';
  else if (/d[eé]part|departure|sailing/i.test(line)) movement = 'departure';
  else if (/arriv[eé]e|arrival/i.test(line)) movement = 'arrival';
  return normalizeVessel({
    id: `paste-${berthCode.toLowerCase()}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    port: berthCode.startsWith('BEC') ? 'BEC' : 'TRV',
    name,
    pilotClass,
    pilotStatus: '—',
    pilots: pilotsMatch ? Number.parseInt(pilotsMatch[1], 10) : null,
    isCommercial: true,
    movement,
    draft: draftMatch ? `${Number.parseFloat(draftMatch[1].replace(',', '.'))} m` : '—',
    speed: speedMatch ? `${Number.parseFloat(speedMatch[1].replace(',', '.'))} nds` : '—',
    speedKnots: speedMatch ? Number.parseFloat(speedMatch[1].replace(',', '.')) : null,
    transitDuration: durationMatch ? `${durationMatch[1]}h ${durationMatch[2].padStart(2, '0')}m` : '—',
    orderTime: timeMatch ? `${timeMatch[1]} ${timeMatch[2]}` : 'En cours',
    origin: null,
    waypoint: null,
    berthCode,
    berthDesc: berthCode.startsWith('BEC') ? 'Port de Bécancour' : 'Port de Trois-Rivières',
  });
}

/* ---------- Démarrage ---------- */

document.addEventListener('DOMContentLoaded', () => {
  try {
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  } catch (e) { /* PWA facultative */ }

  let deferredPrompt = null;
  const pwaBtn = $('btnNativePwaInstall');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    pwaBtn.classList.add('visible');
  });
  pwaBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    pwaBtn.classList.remove('visible');
  });

  document.querySelectorAll('.port-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activePort = tab.dataset.port;
      document.querySelectorAll('.port-tab').forEach((t) => t.classList.toggle('active', t === tab));
      $('headerPortCodeLabel').textContent = activePort === 'ALL' ? 'TRV + BEC' : activePort;
      renderAll();
    });
  });

  document.querySelectorAll('.filter-pill[data-filter]').forEach((pill) => {
    pill.addEventListener('click', () => {
      activeFilter = pill.dataset.filter;
      document.querySelectorAll('.filter-pill[data-filter]').forEach((p) => p.classList.toggle('active', p === pill));
      renderAll();
    });
  });

  document.querySelectorAll('[data-mfilter]').forEach((pill) => {
    pill.addEventListener('click', () => {
      activeManoeuvreFilter = pill.dataset.mfilter;
      document.querySelectorAll('[data-mfilter]').forEach((p) => p.classList.toggle('active', p === pill));
      renderManoeuvres();
    });
  });

  $('toggleCommercialOnly').addEventListener('click', () => {
    commercialOnly = !commercialOnly;
    $('toggleCommercialOnly').classList.toggle('off', !commercialOnly);
    $('commercialBadgeState').textContent = commercialOnly ? 'ACTIF' : 'TOUS';
    renderAll();
  });

  $('btnToggleLayout').addEventListener('click', () => {
    compactMode = !compactMode;
    $('layoutModeLabel').textContent = compactMode ? 'Vue Complète' : 'Mode Widget';
    $('fullControlsBar').classList.toggle('hidden', compactMode);
    renderAll();
  });

  $('quickCardBec').addEventListener('click', () => document.querySelector('[data-port="BEC"]').click());
  $('quickCardTrv').addEventListener('click', () => document.querySelector('[data-port="TRV"]').click());
  $('searchInput').addEventListener('input', (e) => {
    searchQuery = e.target.value.trim();
    renderAll();
  });

  const importModal = $('importModal');
  const openImport = () => importModal.classList.add('open');
  $('btnOpenImportModal').addEventListener('click', openImport);
  $('dockBtnPaste').addEventListener('click', openImport);
  $('btnCloseImportModal').addEventListener('click', () => importModal.classList.remove('open'));

  $('btnApplyPaste').addEventListener('click', () => {
    const raw = $('pasteInput').value.trim();
    if (!raw) return;
    const parsed = raw
      .split(/\n+/)
      .map((line) => parsePastedLine(line))
      .filter(Boolean);
    if (parsed.length) {
      vessels = parsed;
      feedMeta = { updatedAt: new Date().toISOString(), updatedLabel: 'Import manuel', source: 'Importé depuis e-fiche — non vérifié par le robot', offline: false, horizon: null };
      applyNewFeed(vessels);
      saveCache();
      updateFreshness();
      renderAll();
      showToast(`${parsed.length} navires commerciaux mis à jour ✓`);
    } else {
      showToast('Aucun navire commercial TRV/BEC détecté dans le texte');
    }
    importModal.classList.remove('open');
  });

  $('btnResetSeed').addEventListener('click', () => {
    try {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(PIN_KEY);
      localStorage.removeItem(PREV_KEY);
      localStorage.removeItem(DIFF_KEY);
      manoeuvreDiff = { newIds: [], timeChanged: {}, disappeared: [] };
    } catch (e) { /* ignore */ }
    importModal.classList.remove('open');
    tryFetchAutoFeed(false).then((ok) => {
      if (!ok) showToast('Flux indisponible, réessaie plus tard');
    });
  });

  const installModal = $('installModal');
  $('btnOpenInstallModal').addEventListener('click', () => installModal.classList.add('open'));
  $('btnCloseInstallModal').addEventListener('click', () => installModal.classList.remove('open'));

  $('dockBtnRefresh').addEventListener('click', async () => {
    const icon = $('refreshSpinnerIcon');
    icon.classList.add('spin');
    const ok = await tryFetchAutoFeed(false);
    setTimeout(() => {
      icon.classList.remove('spin');
      if (!ok) showToast('Actualisé à partir des dernières données connues ✓');
    }, 500);
  });

  renderAll();
  tryFetchAutoFeed(true);
  setInterval(() => tryFetchAutoFeed(true), REFRESH_MS);
  setInterval(updateFreshness, 60_000);
  setInterval(updateCountdowns, 60_000);
});
