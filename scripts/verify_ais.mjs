// Vérification AIS automatique — AISStream.io (gratuit, côté serveur seulement).
//
// Principe : on écoute le flux AIS en direct pendant ~75 secondes sur la zone
// Trois-Rivières / Bécancour, et on note lesquels des navires d'e-fiche
// (data/vessels.json) sont réellement vus par AIS, avec leur dernière
// position, vitesse et cap. Le résultat va dans data/ais_verification.json,
// que l'appli lit pour afficher « Confirmé AIS » ou « Non confirmé par AIS ».
//
// SÉCURITÉ :
// - La clé se lit UNIQUEMENT dans la variable d'environnement
//   AISSTREAM_API_KEY. Elle n'est JAMAIS dans ce fichier, JAMAIS dans un
//   .env commité, JAMAIS affichée dans les journaux (on ne log que des
//   compteurs). Dans GitHub Actions, elle arrive par le secret
//   ${{ secrets.AISSTREAM_API_KEY }} — voir APPLIQUER.md.
// - Ce script ne s'exécute que côté serveur (GitHub Actions). Le navigateur
//   ne se connecte jamais à AISStream : la clé ne doit pas quitter le serveur.
//
// ÉCHEC TOLÉRANT : clé absente, connexion impossible, aucun navire vu, ou
// vessels.json illisible — dans tous les cas on écrit un fichier
// data/ais_verification.json avec un statut et une raison, et on quitte
// avec le code 0. Le workflow ne doit JAMAIS échouer à cause de la
// vérification : l'e-fiche reste la source principale.
//
// Usage : AISSTREAM_API_KEY=... node scripts/verify_ais.mjs
// Sortie : data/ais_verification.json

import WebSocket from 'ws';
import fs from 'node:fs';
import path from 'node:path';

const VESSELS_FILE = path.join('data', 'vessels.json');
const OUT_FILE = path.join('data', 'ais_verification.json');
const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
// Durée d'écoute : 60 à 90 s. 75 s laisse le temps à chaque navire
// d'émettre au moins une position (les navires commerciaux émettent
// toutes les quelques secondes en mouvement, toutes les 3 minutes à quai).
const LISTEN_MS = 75_000;

// Bounding box autour de Trois-Rivières / Bécancour.
// Trois-Rivières ≈ 46,35 / -72,55 ; Bécancour ≈ 46,33 / -72,43.
// La boîte 46,1 – 46,6 en latitude (≈ 55 km nord-sud) et -73,0 – -72,1
// en longitude (≈ 65 km est-ouest à cette latitude) couvre les deux ports
// PLUS les secteurs d'approche sur le fleuve (amont vers Louiseville,
// aval vers Deschaillons), là où les navires ralentissent ou attendent
// avant le pilotage — tout en restant assez petite pour que le débit de
// messages AIS reste raisonnable pour un seul robot toutes les 15 minutes.
const BBOX = [
  [46.1, -73.0],
  [46.6, -72.1],
];

function normaliseName(name) {
  return String(name || '')
    .toUpperCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function nowLabel() {
  return new Date().toLocaleTimeString('fr-CA', {
    timeZone: 'America/Toronto',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// Lit la liste des navires attendus (e-fiche). Ne fait jamais échouer.
function readExpectedVessels() {
  try {
    const data = JSON.parse(fs.readFileSync(VESSELS_FILE, 'utf8'));
    if (!Array.isArray(data.vessels)) return [];
    return data.vessels.map((v) => ({
      id: v.id || normaliseName(v.name),
      name: v.name || 'NAVIRE',
      mmsi: typeof v.mmsi === 'number' ? v.mmsi : null,
    }));
  } catch {
    return [];
  }
}

function writeResult(result) {
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(result, null, 2));
}

function buildResult(status, reason, expected, seenByKey) {
  const vessels = expected.map((exp) => {
    const seen = seenByKey.get(exp.id) || null;
    return {
      id: exp.id,
      name: exp.name,
      mmsi: exp.mmsi,
      confirmed: Boolean(seen),
      // Position / vitesse / cap AIS — seulement quand le navire a été vu.
      // Jamais de valeur inventée : null quand non confirmé.
      lastSeenAt: seen ? seen.lastSeenAt : null,
      lastSeenLabel: seen ? seen.lastSeenLabel : null,
      latitude: seen ? seen.latitude : null,
      longitude: seen ? seen.longitude : null,
      speedKnots: seen ? seen.speedKnots : null,
      course: seen ? seen.course : null,
    };
  });
  return {
    checkedAt: new Date().toISOString(),
    checkedLabel: `Auto • ${nowLabel()}`,
    status,
    statusReason: reason,
    bbox: { latMin: BBOX[0][0], lonMin: BBOX[0][1], latMax: BBOX[1][0], lonMax: BBOX[1][1] },
    confirmedCount: vessels.filter((v) => v.confirmed).length,
    expectedCount: expected.length,
    vessels,
  };
}

async function main() {
  const expected = readExpectedVessels();
  const apiKey = process.env.AISSTREAM_API_KEY || '';

  // 1. Pas de clé : on écrit le statut et on s'arrête, sans erreur.
  //    (C'est le cas normal tant que Gordon n'a pas ajouté le secret —
    //    voir APPLIQUER.md. Les liens MarineTraffic / VesselFinder, eux,
    //    fonctionnent sans clé.)
  if (!apiKey) {
    const result = buildResult(
      'not_configured',
      'Clé AISStream absente : ajoute le secret AISSTREAM_API_KEY au dépôt (voir APPLIQUER.md).',
      expected,
      new Map()
    );
    writeResult(result);
    console.log('AISStream : clé absente — vérification non configurée, fichier écrit avec le statut.');
    return;
  }

  // 2. Connexion au flux. L'abonnement doit être envoyé dans les 3 secondes
  //    après l'ouverture, sinon AISStream coupe la connexion.
  const seenByKey = new Map(); // clé = id e-fiche -> dernière observation
  const byName = new Map(expected.map((v) => [normaliseName(v.name), v]));
  const byMmsi = new Map(expected.filter((v) => v.mmsi).map((v) => [v.mmsi, v]));
  let seenTotal = 0; // navires AIS vus dans la boîte, même hors e-fiche
  let messageCount = 0;

  const done = await new Promise((resolve) => {
    let socket;
    try {
      socket = new WebSocket(AISSTREAM_URL);
    } catch (error) {
      console.error('AISStream : connexion impossible :', error.message);
      resolve('connection_failed');
      return;
    }

    const finish = (status) => {
      try {
        socket.close();
      } catch {
        /* déjà fermé */
      }
      resolve(status);
    };

    // Sécurité : si rien ne se passe, on ne bloque pas le workflow.
    const hardTimeout = setTimeout(() => finish('ok'), LISTEN_MS + 15_000);
    const listenTimer = setTimeout(() => finish('ok'), LISTEN_MS);

    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          APIKey: apiKey,
          BoundingBoxes: [BBOX],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
        })
      );
    });

    socket.on('message', (data) => {
      messageCount += 1;
      let parsed;
      try {
        parsed = JSON.parse(data.toString());
      } catch {
        return; // trame non JSON : on l'ignore
      }
      const meta = parsed.MetaData || {};
      const mmsi = typeof meta.MMSI === 'number' ? meta.MMSI : null;
      const shipName = meta.ShipName || parsed.Message?.ShipStaticData?.Name || '';
      const key = (mmsi && byMmsi.get(mmsi)) || byName.get(normaliseName(shipName));
      if (!key) return; // navire hors e-fiche : on compte, on ne le garde pas
      seenTotal += 1;

      const report = parsed.Message?.PositionReport || {};
      const latitude = typeof meta.latitude === 'number' ? meta.latitude : report.Latitude ?? null;
      const longitude = typeof meta.longitude === 'number' ? meta.longitude : report.Longitude ?? null;
      const speedKnots =
        typeof report.Sog === 'number' ? Math.round(report.Sog * 10) / 10 : null;
      const course = typeof report.Cog === 'number' ? Math.round(report.Cog) : null;
      const observedAt = meta.time_utc || new Date().toISOString();
      const previous = seenByKey.get(key.id);
      // On ne garde que l'observation la plus récente par navire.
      if (!previous || new Date(observedAt).getTime() >= new Date(previous.lastSeenAt).getTime()) {
        seenByKey.set(key.id, {
          lastSeenAt: observedAt,
          lastSeenLabel: new Date(observedAt).toLocaleString('fr-CA', { timeZone: 'America/Toronto' }),
          latitude,
          longitude,
          speedKnots,
          course,
        });
      }
    });

    socket.on('error', (error) => {
      console.error('AISStream : erreur de connexion :', error.message);
      clearTimeout(listenTimer);
      clearTimeout(hardTimeout);
      finish('connection_failed');
    });

    socket.on('close', () => {
      clearTimeout(listenTimer);
      clearTimeout(hardTimeout);
      resolve('ok');
    });
  });

  // 3. Résultat — toujours écrit, jamais d'échec du workflow.
  if (done === 'connection_failed' && seenByKey.size === 0) {
    const result = buildResult(
      'connection_failed',
      'Connexion à AISStream impossible (réseau ou clé invalide). Vérifie le secret AISSTREAM_API_KEY.',
      expected,
      seenByKey
    );
    writeResult(result);
    console.log('AISStream : connexion impossible — fichier écrit avec le statut.');
    return;
  }
  const status = seenByKey.size > 0 ? 'ok' : 'no_data';
  const reason =
    status === 'ok'
      ? `${seenByKey.size} navire(s) d'e-fiche confirmé(s) par AIS dans la zone TRV / BEC.`
      : 'Aucun navire d’e-fiche vu par AIS pendant l’écoute (75 s) — ils sont peut-être hors de portée AIS, à quai sans émission, ou l’e-fiche a changé.';
  const result = buildResult(status, reason, expected, seenByKey);
  writeResult(result);
  console.log(
    `AISStream : ${messageCount} messages reçus, ${seenTotal} observation(s) de navires d’e-fiche, ` +
      `${seenByKey.size}/${expected.length} confirmé(s) — fichier écrit.`
  );
}

try {
  await main();
} catch (error) {
  // Dernier filet de sécurité : on écrit quand même un fichier, on ne
  // fait jamais échouer le workflow à cause de la vérification AIS.
  console.error('AISStream : erreur inattendue :', error.message);
  try {
    const expected = readExpectedVessels();
    writeResult(
      buildResult(
        'connection_failed',
        `Erreur inattendue pendant la vérification AIS : ${error.message}`,
        expected,
        new Map()
      )
    );
  } catch {
    /* même l'écriture a échoué : on ne bloque pas le workflow */
  }
}
process.exit(0);
