// Ücretsiz veri toplayıcı. Hiçbir API anahtarı ya da ücretli servis gerektirmez; sadece Node 18+.
//   - GDELT 2.0: dünya basını, İngilizce + 65 dilden çeviri (15 dakikada bir), sadece odak bölge
//   - RSS: Türkçe, Kurmancî, Soranî, Arapça, Farsça, İngilizce haber siteleri (scripts/sources.json)
//   - Telegram: herkese açık kanallar (scripts/sources.json)
//   - USGS: depremler; GDACS: sel, kasırga, yanardağ, orman yangını, kuraklık
//   - Launch Library 2: yaklaşan roket fırlatmaları; CelesTrak: uydu yörüngeleri (6 saatte bir)
//   - GDELT olaylarının gerçek başlığı ve haber görselleri haber sayfasının kendisinden alınır
//   - Başlıklar sitenin 5 diline çevrilir (Türkçe, Kurmancî, Soranî, İngilizce, Arapça)
//
// Kullanım:  node scripts/fetch.mjs
// Ortam değişkenleri (isteğe bağlı):
//   HOURS=6        İlk çalıştırmada kaç saat geriye gidilsin
//   KEEP_HOURS=48  Haritada kaç saatlik olay tutulsun
//   MAX_EVENTS=6000

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchGdelt } from './lib/gdelt.mjs';
import { fetchFeeds } from './lib/feeds.mjs';
import { placeNames } from './lib/geo.mjs';
import { get } from './lib/http.mjs';
import { translateTitles } from './lib/translate.mjs';
import { enrich } from './lib/enrich.mjs';
import { fetchDisasters, fetchLaunches } from './lib/hazards.mjs';
import { inRegion } from './lib/region.mjs';
import { updateSats } from './lib/sats.mjs';
import { updateImrali } from './lib/imrali.mjs';
import { makeSourceTyper } from './lib/sources-meta.mjs';
import { groupStories } from './lib/stories.mjs';
import { updateWeekly } from './lib/weekly.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = path.join(ROOT, 'data');
const HOURS = Number(process.env.HOURS || 6);
const KEEP_HOURS = Number(process.env.KEEP_HOURS || 48);
const MAX_EVENTS = Number(process.env.MAX_EVENTS || 6000);
const MAX_TRANSLATE = Number(process.env.MAX_TRANSLATE || 800); // bir çalıştırmada çevrilecek en fazla başlık
const MAX_PAGES = Number(process.env.MAX_PAGES || 200); // bir çalıştırmada başlık/görsel için açılacak en fazla haber sayfası
const RECENT_HOURS = 6; // sitenin ilk yüklediği parça (varsayılan zaman aralığı da 6 saat)
const SITE_LANGS = ['tr', 'ku', 'ckb', 'en', 'ar']; // site dosyaları her arayüz dili için ayrı yazılır

const SEVERITY = ['news', 'politics', 'protest', 'military', 'security', 'attack', 'clash', 'artillery', 'bombing', 'airstrike', 'massviolence'];

// Aynı haber birden çok kez gelirse tek olaya indir: RSS/Telegram başlığı GDELT'inkinden iyidir,
// GDELT kayıtları arasında en ağır kategori kalır. Daha önce görülen haberin ilk görülme zamanı korunur.
function merge(oldEvents, newEvents) {
  const byKey = new Map();
  const firstSeen = new Map(oldEvents.map((e) => [e.id, e.t]));
  for (const e of [...oldEvents, ...newEvents]) {
    if (firstSeen.has(e.id)) e.t = Math.min(e.t, firstSeen.get(e.id));
    const key = e.url || e.id;
    const prev = byKey.get(key);
    if (!prev) { byKey.set(key, e); continue; }
    const better = prev.kind === 'gdelt' && e.kind !== 'gdelt' ? true
      : prev.kind !== 'gdelt' && e.kind === 'gdelt' ? false
      : prev.kind === 'gdelt' ? SEVERITY.indexOf(e.cat) > SEVERITY.indexOf(prev.cat)
      : true;
    if (!better) continue;
    // Haber sayfasından alınmış bilgiler (gerçek başlık, görsel, dil) ve hazır çeviriler korunur.
    const keepTitle = e.kind === prev.kind && prev.enriched;
    byKey.set(key, {
      ...e,
      t: Math.min(e.t, prev.t),
      title: keepTitle ? prev.title : e.title,
      lang: e.lang || prev.lang,
      img: e.img || prev.img,
      enriched: e.enriched || prev.enriched,
      tt: e.tt || (keepTitle || e.title === prev.title ? prev.tt : undefined),
    });
  }
  return [...byKey.values()];
}

async function fetchQuakes() {
  const json = await (await get('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson')).json();
  return json.features.map((f) => ({
    id: 'q' + f.id,
    t: f.properties.time,
    lat: f.geometry.coordinates[1],
    lon: f.geometry.coordinates[0],
    cat: 'earthquake',
    title: `M${f.properties.mag.toFixed(1)} — ${f.properties.place}`,
    place: f.properties.place,
    url: f.properties.url,
    src: 'USGS',
    lang: 'en',
    kind: 'usgs',
    mentions: Math.round(f.properties.mag * 10),
    felt: f.properties.felt || undefined,
  }));
}

async function main() {
  let prev = { events: [], gdeltLast: null };
  try { prev = JSON.parse(await fs.readFile(path.join(DATA, 'events.json'), 'utf8')); } catch {}
  const sources = JSON.parse(await fs.readFile(path.join(ROOT, 'scripts', 'sources.json'), 'utf8'));
  const cutoff = Date.now() - KEEP_HOURS * 3600e3;

  const skip = (name, fallback) => (e) => { console.warn(`${name} atlandı:`, e.message); return fallback; };
  const [gdelt, feeds, quakes, disasters, launches] = await Promise.all([
    fetchGdelt(prev.gdeltLast, HOURS).catch(skip('GDELT', { events: [], latest: prev.gdeltLast })),
    fetchFeeds(sources, cutoff),
    fetchQuakes().catch(skip('USGS', [])),
    fetchDisasters().catch(skip('GDACS', [])),
    fetchLaunches().catch(skip('Fırlatmalar', prev.launches || [])), // servis saatte 15 istekle sınırlı; olmazsa eskisi kalır
  ]);

  // Eski kayıtlardan: depremler her seferinde yeniden gelir; bölge dışındaki eski GDELT kayıtları atılır.
  const old = prev.events.filter((e) => e.kind !== 'usgs' && e.cat !== 'earthquake' && (e.kind !== 'gdelt' || inRegion(e.lat, e.lon)));
  const events = [...merge(old, [...gdelt.events, ...feeds, ...disasters]), ...quakes]
    .filter((e) => e.t >= cutoff && e.title)
    .sort((a, b) => b.t - a.t)
    .slice(0, MAX_EVENTS);

  // Gemileri dinlemek 1 dakika sürüyor; bu sırada uydular ve haber sayfaları da işlenir.
  await Promise.all([updateSats(DATA), enrich(events, MAX_PAGES)]);
  await translateTitles(events, MAX_TRANSLATE);
  // İmralı sekmesinin arşivi 48 saat sınırına bağlı değildir; eski haberler de kalır.
  const imrali = await updateImrali(prev.imrali, events);
  await translateTitles(imrali.items, 60);
  // Kaynağın türü (resmî, Kürt medyası…) ve aynı olayı anlatan haberlerin tek kartta toplanması.
  const sourceType = makeSourceTyper(sources);
  for (const e of [...events, ...imrali.items]) e.st = sourceType(e);
  groupStories(events);
  await updateWeekly(events, DATA).catch(skip('Haftalık özet'));

  const updated = Date.now();
  await fs.mkdir(DATA, { recursive: true });
  await fs.writeFile(path.join(DATA, 'events.json'), JSON.stringify({ updated, gdeltLast: gdelt.latest, events, launches, imrali }));
  // Site için iki parça: son 6 saat (açılışta hemen gösterilir) ve daha eskisi (arkadan yüklenir).
  // Sitenin kullanmadığı alanlar atılır. Site bu dosyaları <script> olarak yükler; dosyaya çift tıklayınca da çalışır.
  const slim = events.map(({ enriched, mentions, country, ...e }) => e);
  const recentFrom = updated - RECENT_HOURS * 3600e3;
  const recent = slim.filter((e) => e.t >= recentFrom), older = slim.filter((e) => e.t < recentFrom);
  // Başlık çevirileri (tt) her dil dosyasında sadece o dilinkidir: ziyaretçi diğer dört dilin çevirilerini indirmez.
  for (const lang of SITE_LANGS) {
    const only = (list) => list.map(({ tt, ...e }) => (tt?.[lang] ? { ...e, tt: { [lang]: tt[lang] } } : e));
    const im = { ...imrali, items: only(imrali.items || []) };
    await fs.writeFile(path.join(DATA, `events.${lang}.js`), `window.__EVENTS__ = ${JSON.stringify({ updated, events: only(recent), launches, imrali: im })};\n`);
    await fs.writeFile(path.join(DATA, `events-old.${lang}.js`), `window.__EVENTS_OLD__ = ${JSON.stringify({ updated, events: only(older) })};\n`);
  }
  // Site her dakika sadece bu küçük dosyaya bakar; veri değişmediyse büyük dosyaları yeniden indirmez.
  await fs.writeFile(path.join(DATA, 'updated.json'), JSON.stringify({ updated }));
  await fs.writeFile(path.join(DATA, 'places.js'), `window.__PLACES__ = ${JSON.stringify(placeNames())};\n`);
  const counts = {};
  for (const e of events) counts[e.kind] = (counts[e.kind] || 0) + 1;
  console.log(`Tamam: ${events.length} olay yazıldı`, counts);
}

main().catch((e) => { console.error(e); process.exit(1); });
