import { chromium } from 'playwright';
import fs from 'fs';

const NON_COMM = ['TUG', 'REMORQUEUR', 'TAXI', 'PILOT', 'BARGE', 'GCC', 'CCGS'];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://efiche.live.pilotagestlaurent.gc.ca/', { waitUntil: 'networkidle', timeout: 60000 });
await page.waitForTimeout(4000);

const rows = await page.evaluate(() =>
  Array.from(document.querySelectorAll('tr'))
    .map((tr) => Array.from(tr.querySelectorAll('td')).map((td) => td.innerText.trim()))
    .filter((r) => r.length >= 4)
);
await browser.close();

const vessels = [];
for (const r of rows) {
  const txt = r.join(' | ');
  const m = txt.match(/\b(TRV\d+|BEC\d+)\b/i);
  if (!m || NON_COMM.some((k) => txt.toUpperCase().includes(k))) continue;
  const berth = m[1].toUpperCase();
  const isBec = berth.startsWith('BEC');
  const dep = new RegExp(berth + '\\s*-', 'i').test(txt);
  const tm = txt.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/);
  const dr = txt.match(/\b(\d{1,2}\.\d{1,2})\b/);
  vessels.push({
    id: (isBec ? 'bec-' : 'trv-') + vessels.length,
    port: isBec ? 'BEC' : 'TRV',
    name: (r[0] || 'Navire').toUpperCase(),
    pilotClass: 'Commercial',
    isCommercial: true,
    cargoLabel: 'e-fiche APL • En direct',
    movement: dep ? 'departure' : 'arrival',
    movementBadge: (dep ? '↑ Départ ' : '↓ Arrivée ') + (tm ? tm[0].slice(11) : ''),
    pilotStatus: r[1] || 'e-fiche',
    draft: dr ? dr[1] + ' m' : '—',
    speed: r[4] ? r[4] + ' nds' : '—',
    transit: r[5] || '—',
    orderTime: tm ? tm[0] : 'En cours',
    origin: dep ? berth : 'Secteur',
    waypoint: r[6] || 'En transit',
    berthCode: berth,
    berthDesc: isBec ? 'Port de Bécancour' : 'Port de Trois-Rivières',
    progress: 55,
    pinned: vessels.length === 0
  });
}

if (vessels.length) {
  const now = new Date().toLocaleTimeString('fr-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });
  fs.mkdirSync('data', { recursive: true });
  fs.writeFileSync('data/vessels.json', JSON.stringify({ updatedAt: new Date().toISOString(), updatedLabel: 'Auto • ' + now, vessels }, null, 2));
}
