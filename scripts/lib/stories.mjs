// Aynı olayı anlatan haberleri tek kartta birleştirir: "8 kaynak bildirdi".
// Başlıklar karşılaştırılırken İngilizce çeviri (yoksa özgün başlık) kelimelerine bakılır; böylece Türkçe, Arapça,
// Kürtçe haberler de aynı olayın parçası olarak eşleşebilir. Eşleşme şartları: en az 3 ortak anlamlı kelime ve
// kısa başlığın kelimelerinin en az %60'ı ortak, en fazla 12 saat ara, konumlar birbirine 400 km'den yakın.
// Grubun "öncü" haberi kartta görünür (RSS/Telegram ve görselli olanlar önce), diğerleri also listesine girer.

const STOP = new Set(('the a an of in on to for and or at with from by is are was were be been after as its it his her their they says said ' +
  'say new news over into about than more this that these those will has have had not but who what when where why how up out amid near ' +
  'two three first last one also video photo live update latest breaking report reports').split(' '));
const MAX_GAP = 12 * 3600e3;
const MAX_KM = 400;
const COMMON = 60; // bu kadar çok haberde geçen kelime ayırt edici sayılmaz

function words(e) {
  const text = e.lang === 'en' ? e.title : e.tt?.en || e.title;
  const space = e.lang === 'en' || e.tt?.en ? 'en' : e.lang || '?';
  const set = new Set();
  for (let w of text.toLocaleLowerCase('en').split(/[^\p{L}\p{N}]+/u)) {
    if (w.length < 3 || STOP.has(w)) continue;
    if (w.length > 4 && w.endsWith('s')) w = w.slice(0, -1); // basit tekil hâl: attacks → attack
    set.add(`${space}:${w}`);
  }
  return set;
}

function km(a, b) {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function groupStories(events) {
  const list = events.filter((e) => e.title && e.kind !== 'usgs' && e.kind !== 'gdacs' && e.cat !== 'launch');
  for (const e of events) { delete e.also; delete e.dupOf; }
  const sets = list.map(words);
  const index = new Map();
  sets.forEach((s, i) => { for (const w of s) (index.get(w) || index.set(w, []).get(w)).push(i); });

  const parent = list.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < list.length; i++) {
    const shared = new Map();
    for (const w of sets[i]) {
      const posting = index.get(w);
      if (posting.length > COMMON) continue;
      for (const j of posting) if (j > i) shared.set(j, (shared.get(j) || 0) + 1);
    }
    for (const [j, n] of shared) {
      if (n < 3 || n / Math.min(sets[i].size, sets[j].size) < 0.6) continue;
      const a = list[i], b = list[j];
      if (Math.abs(a.t - b.t) > MAX_GAP || km(a, b) > MAX_KM) continue;
      parent[find(j)] = find(i);
    }
  }

  const groups = new Map();
  list.forEach((e, i) => { const r = find(i); (groups.get(r) || groups.set(r, []).get(r)).push(e); });
  const score = (e) => (e.kind !== 'gdelt' ? 4 : 0) + (e.img ? 2 : 0) + (e.tt ? 1 : 0);
  let merged = 0;
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    g.sort((a, b) => score(b) - score(a) || a.t - b.t);
    const [lead, ...rest] = g;
    // Aynı kaynaktan gelen tekrarlar listede bir kez görünür.
    const seen = new Set([lead.src]);
    lead.also = rest.sort((a, b) => a.t - b.t).filter((e) => !seen.has(e.src) && seen.add(e.src))
      .slice(0, 20).map((e) => ({ src: e.src, url: e.url, st: e.st }));
    for (const e of rest) e.dupOf = lead.id;
    merged += rest.length;
  }
  console.log(`Haber birleştirme: ${merged} haber ${[...groups.values()].filter((g) => g.length > 1).length} olayın altında toplandı`);
}
