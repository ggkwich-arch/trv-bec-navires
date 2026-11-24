import { chromium } from 'playwright';
import fs from 'fs';

const NON_COMM = ['TUG', 'REMORQUEUR', 'TAXI', 'PILOT', 'BARGE', 'GCC', 'CCGS'];
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://efiche.live.pilotagestlaurent.gc.ca/', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => /TRV|BEC/i.test(document.body.innerText), { timeout: 25000 }).catch(() => {});
await page.waitForTimeout(3000);

const data = await page.evaluate(() => {
  const rowEls = Array.from(document.querySelectorAll('tr, [role="row"]'));
  const rows = rowEls.map((el) => {
    const cells = Array.from(el.querySelectorAll('td, [role="gridcell"], [role="cell"]'));
    return (cells.length ? cells : [el]).map((c) => (c.innerText || '').trim()).filter(Boolean);
  }).filter((r) => r.length >= 2);
  return { rows, text: document.body.innerText || '' };
});
await browser.close();

const seen = new Set();
const vessels = [];
const candidates = data.rows.length ? data.rows : data.text.split(/\n+/).map((l) => [l]);

for (const r of candidates) {
  const txt = r.join(' | ');
  const m = txt.match(/\b(TRV\d+|BEC\d+)\b/i);
  if (!m || NON_COMM.some((k) => txt.toUpperCase().includes(k))) continue;
  const berth = m[1].toUpperCase();
  const name = (r[0] || 'Navire').replace(/\s+/g, ' ').trim().slice(0, 36);
  const key = name + '-' + berth;
  if (seen.has(key)) continue;
  seen.add(key);

  const isBec = berth.startsWith('BEC');
  const dep = new RegExp(berth + '\\s*-', 'i').test(txt);
  const tm = txt.match(/\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/);
  const dr = txt.match(/\b(\d{1,2}\.\d{1,2})\b/);
  vessels.push({
    id: (isBec ? 'bec-' : 'trv-') + vessels.length,
    port: isBec ? 'BEC' : 'TRV',
    name: name.toUpperCase(),
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

console.log('Navires détectés:', vessels.length);
const now = new Date().toLocaleTimeString('fr-CA', { timeZone: 'America/Toronto', hour: '2-digit', minute: '2-digit' });
fs.mkdirSync('data', { recursive: true });
if (vessels.length || !fs.existsSync('data/vessels.json')) {
  fs.writeFileSync('data/vessels.json', JSON.stringify({ updatedAt: new Date().toISOString(), updatedLabel: 'Auto • ' + now, vessels }, null, 2));
}
