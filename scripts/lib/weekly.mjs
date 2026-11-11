// Haftalık özet (data/weekly.json): olaylar 48 saatte silindiği için günlük sayılar ve en çok konuşulan haberler ayrıca saklanır.
// Her güncellemede eldeki olaylar güne göre sayılır; bir günün sayısı silinen olaylar yüzünden azalmasın diye büyük olan tutulur.
import fs from 'node:fs/promises';
import path from 'node:path';

const KEEP_DAYS = 8, TOP_PER_DAY = 5;
const CONFLICT = new Set(['attack', 'airstrike', 'bombing', 'artillery', 'clash', 'massviolence']);
const REGION_KEYS = ['kurdistan', 'tr', 'sy', 'iq', 'ir', 'il'];

const inRing = (ring, x, y) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
// Gün sınırı bölge saatine göre (UTC+3).
const dayOf = (t) => new Date(t + 3 * 3600e3).toISOString().slice(0, 10);
const weight = (e) => (e.also?.length || 0) * 20 + (e.mentions || 0);

export async function updateWeekly(events, dataDir) {
  const file = path.join(dataDir, 'weekly.json');
  const shapes = JSON.parse(await fs.readFile(path.join(dataDir, 'regions.json'), 'utf8'));
  const old = await fs.readFile(file, 'utf8').then(JSON.parse).catch(() => ({ days: {} }));
  const now = {};
  for (const e of events) {
    if (e.dupOf || e.cat === 'launch') continue;
    const d = (now[dayOf(e.t)] ||= { total: 0, conflict: 0, regions: {}, top: [] });
    const conflict = CONFLICT.has(e.cat);
    d.total++;
    if (conflict) d.conflict++;
    for (const k of REGION_KEYS) {
      if (!(shapes[k] || []).some((ring) => inRing(ring, e.lon, e.lat))) continue;
      const r = (d.regions[k] ||= { total: 0, conflict: 0 });
      r.total++;
      if (conflict) r.conflict++;
    }
    d.top.push({ id: e.id, title: e.title, lang: e.lang, tt: e.tt, src: e.src, url: e.url, t: e.t, w: weight(e) });
  }
  const days = { ...old.days };
  for (const [key, d] of Object.entries(now)) {
    const p = days[key] || { total: 0, conflict: 0, regions: {}, top: [] };
    const regions = { ...p.regions };
    for (const [k, r] of Object.entries(d.regions)) {
      regions[k] = { total: Math.max(r.total, regions[k]?.total || 0), conflict: Math.max(r.conflict, regions[k]?.conflict || 0) };
    }
    const top = new Map([...p.top, ...d.top].map((x) => [x.id, x]));
    days[key] = {
      total: Math.max(d.total, p.total), conflict: Math.max(d.conflict, p.conflict), regions,
      top: [...top.values()].sort((a, b) => b.w - a.w).slice(0, TOP_PER_DAY),
    };
  }
  const kept = Object.keys(days).sort().slice(-KEEP_DAYS);
  await fs.writeFile(file, JSON.stringify({ updated: Date.now(), days: Object.fromEntries(kept.map((k) => [k, days[k]])) }));
}
