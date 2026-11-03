// İmralı sekmesi: adanın kıyı çizgisi ve İmralı/süreç haberlerinin kalıcı arşivi.
// Arşiv 48 saat sınırına bağlı değildir: yeni haber olmasa da en son çıkan haberler her zaman gösterilir.
// Kaynaklar: sitenin kendi RSS/Telegram/GDELT haberlerinden eşleşenler + Google Haberler arama akışı (ücretsiz, anahtarsız).
import { get, decodeEntities, stripTags, hash } from './http.mjs';

// Ada kıyısı: OpenStreetMap "İmralı Adası" (relation 13765335), sadeleştirilmiş.
export const IMRALI = [[28.5397,40.5547],[28.5417,40.5545],[28.5419,40.5539],[28.5421,40.5544],[28.5425,40.5542],[28.5426,40.5534],[28.5422,40.5532],[28.5428,40.5533],[28.5431,40.5547],[28.5438,40.5552],[28.5459,40.5549],[28.5501,40.5566],[28.5505,40.5579],[28.5501,40.5588],[28.5503,40.5597],[28.5541,40.5639],[28.5546,40.5649],[28.5539,40.5654],[28.549,40.5656],[28.5485,40.5658],[28.5487,40.5662],[28.5405,40.5662],[28.5397,40.5666],[28.5392,40.5673],[28.5374,40.5674],[28.5337,40.5663],[28.5293,40.5658],[28.527,40.5644],[28.5267,40.5647],[28.5248,40.5648],[28.5241,40.5645],[28.5207,40.5648],[28.5207,40.5653],[28.5193,40.5658],[28.5183,40.5654],[28.5185,40.5652],[28.5182,40.5647],[28.5191,40.5637],[28.5217,40.5624],[28.5229,40.5609],[28.5247,40.5603],[28.5257,40.5586],[28.5259,40.5568],[28.5266,40.556],[28.5268,40.5548],[28.5257,40.5527],[28.527,40.5501],[28.5266,40.5473],[28.5262,40.5467],[28.5266,40.5439],[28.5246,40.5391],[28.5243,40.5345],[28.5226,40.5315],[28.5216,40.5303],[28.521,40.5282],[28.5195,40.5264],[28.5172,40.5228],[28.5159,40.5217],[28.5168,40.5193],[28.52,40.516],[28.5218,40.5133],[28.5232,40.5127],[28.5243,40.5113],[28.5247,40.5098],[28.524,40.5091],[28.5276,40.512],[28.5338,40.5135],[28.5361,40.5148],[28.5403,40.5151],[28.5419,40.5164],[28.5422,40.5175],[28.5422,40.5192],[28.5431,40.5201],[28.5428,40.5206],[28.5431,40.5228],[28.5438,40.5235],[28.5441,40.5258],[28.5452,40.5265],[28.5442,40.5283],[28.5441,40.5294],[28.5424,40.5312],[28.5422,40.5328],[28.5397,40.5365],[28.539,40.539],[28.539,40.5413],[28.5362,40.546],[28.5356,40.5486],[28.5367,40.5502],[28.5373,40.5522],[28.5387,40.554],[28.5397,40.5547]];
export const IMRALI_CENTER = [28.534, 40.545];

// Başlıkta ya da metinde geçerse haber İmralı arşivine girer (5 dil + Farsça yazımlar).
const KEYWORDS = /mral[ıiî]|[öo]calan|ئیمراڵ|ئیمرال|ئیمرالی|إيمرالي|امرالي|ئۆجەلان|أوجلان|اوجلان|terörsüz türkiye|barış ve demokratik toplum|peace and democratic society/i;
export const isImrali = (e) => KEYWORDS.test(`${e.title} ${e.text || ''}`.toLocaleLowerCase('tr'));

const SEARCHES = [
  { lang: 'tr', q: 'İmralı OR Öcalan', hl: 'tr', gl: 'TR', ceid: 'TR:tr' },
  { lang: 'en', q: 'Imrali OR Ocalan', hl: 'en-US', gl: 'US', ceid: 'US:en' },
  { lang: 'ar', q: 'أوجلان OR إيمرالي', hl: 'ar', gl: 'IQ', ceid: 'IQ:ar' },
];
const KEEP = 80;               // arşivde tutulacak en fazla haber
const SEARCH_EVERY = 2 * 3600e3; // Google Haberler en fazla 2 saatte bir sorulur

const tag = (xml, name) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'))?.[1] || '';

async function search({ lang, q, hl, gl, ceid }) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
  const xml = await (await get(url)).text();
  return xml.split(/<item>/).slice(1).map((b) => {
    const src = stripTags(tag(b, 'source'));
    // Google başlığın sonuna " - Kaynak" ekler; kaynak ayrıca gösterildiği için atılır.
    let title = stripTags(tag(b, 'title'));
    if (src && title.endsWith(` - ${src}`)) title = title.slice(0, -src.length - 3);
    const link = decodeEntities(tag(b, 'link')).trim();
    return {
      id: 'gn' + hash(link), t: Math.min(Date.parse(tag(b, 'pubDate')) || Date.now(), Date.now()),
      lat: IMRALI_CENTER[1], lon: IMRALI_CENTER[0], cat: 'politics', place: 'İmralı',
      title: title.slice(0, 220), url: link, src, lang, kind: 'gnews',
    };
  }).filter((e) => e.title && isImrali(e));
}

// Aynı haber farklı akışlardan gelebilir: adres ya da (küçük harfli) başlık aynıysa tek kayıt kalır.
const titleKey = (e) => e.title.toLocaleLowerCase('tr').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export async function updateImrali(prev = {}, events) {
  const items = new Map();
  const seenTitles = new Set();
  const add = (e) => {
    const k = e.url || e.id;
    if (items.has(k) || seenTitles.has(titleKey(e))) return;
    items.set(k, e);
    seenTitles.add(titleKey(e));
  };
  // Sitenin kendi kaynakları önce (konumu ve çevirisi hazır), sonra eski arşiv, en son Google Haberler.
  for (const e of events.filter(isImrali)) {
    const { id, t, lat, lon, cat, title, text, url, src, lang, kind, img, tt, place, pid } = e;
    add({ id, t, lat, lon, cat, title, text, url, src, lang, kind, img, tt, place, pid });
  }
  for (const e of prev.items || []) add(e);
  let checked = prev.checked || 0;
  if (Date.now() - checked > SEARCH_EVERY) {
    for (const s of SEARCHES) {
      try { (await search(s)).forEach(add); } catch (err) { console.warn(`  İmralı araması atlandı (${s.lang}):`, err.message); }
    }
    checked = Date.now();
  }
  const list = [...items.values()].sort((a, b) => b.t - a.t).slice(0, KEEP);
  console.log(`İmralı arşivi: ${list.length} haber`);
  return { checked, items: list };
}
