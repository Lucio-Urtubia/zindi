// GerdûnNews (canlı olay haritası) — tamamen statik; veriyi data/events.<dil>.js, data/places.js ve data/manual.json'dan okur.
// Harita: MapLibre GL (küre görünümü), OpenFreeMap altlığı.

// Sitenin adı her dilde aynıdır; dile göre değişen T.title ise ne olduğunu anlatır.
const BRAND = 'GerdûnNews';
// Her kategori: renkli daire içinde beyaz simge (Tabler Icons).
const CATS = {
  massviolence: { icon: 'skull',         color: '#6d28d9' },
  airstrike:    { icon: 'drone',         color: '#dc2626' },
  bombing:      { icon: 'bomb',          color: '#be185d' },
  artillery:    { icon: 'rocket',        color: '#ea580c' },
  clash:        { icon: 'swords',        color: '#b45309' },
  attack:       { icon: 'crosshair',     color: '#ca8a04' },
  security:     { icon: 'shield-lock',   color: '#1d4ed8' },
  military:     { icon: 'helmet',        color: '#15803d' },
  protest:      { icon: 'speakerphone',  color: '#0f766e' },
  politics:     { icon: 'building-bank', color: '#0284c7' },
  earthquake:   { icon: 'activity',      color: '#78716c' },
  disaster:     { icon: 'alert-triangle', color: '#e8590c' },
  launch:       { icon: 'rocket',        color: '#4c6ef5' },
  news:         { icon: 'news',          color: '#64748b' },
  manual:       { icon: 'pin',           color: '#111827' },
};
// Afetlerde simge türe, renk GDACS alarm düzeyine göre.
const DISASTER_ICONS = { flood: 'ripple', cyclone: 'tornado', volcano: 'volcano', wildfire: 'flame', drought: 'sun-high' };
const ALERT_COLORS = { green: '#2f9e44', orange: '#e8590c', red: '#c92a2a' };
const ISS_CAT = { icon: 'satellite', color: '#7048e8' };
const NIGHT_CAT = { icon: 'moon-stars', color: '#33407a' };
const HEAT_CAT = { icon: 'flame', color: '#e8590c' };
const NEWS_LANGS = ['tr', 'ku', 'ckb', 'ar', 'fa', 'en', 'other'];
const REFRESH_MS = 60e3;

// Haber akışındaki konu filtreleri.
const CONFLICT = new Set(['massviolence', 'airstrike', 'bombing', 'artillery', 'clash', 'attack', 'security', 'military']);
const KURD_WORDS = /kurd|kürt|kurdî|kurdistan|kürdistan|rojava|rojhilat|başûr|pkk|ypg|ypj|sdg|sdf|hsd|peşmerge|pêşmerge|peshmerga|کورد|كرد|كورد/i;
// Kürt nüfusun yoğun olduğu bölgeler, kaba kutular: [güney, batı, kuzey, doğu]
const KURD_AREAS = [[36.5, 37.5, 40.3, 44.8], [34.3, 42.3, 37.4, 46.4], [35.8, 36.5, 37.4, 42.4], [33.5, 44, 37.9, 48.5]];
const TOPICS = {
  all: () => true,
  kurdistan: (e) => KURD_AREAS.some(([s, w, n, east]) => e.lat >= s && e.lat <= n && e.lon >= w && e.lon <= east) ||
    KURD_WORDS.test(`${e.title} ${e.text || ''}`),
  conflict: (e) => CONFLICT.has(e.cat),
  politics: (e) => e.cat === 'politics',
  disaster: (e) => e.cat === 'earthquake' || e.cat === 'disaster',
  space: (e) => e.cat === 'launch',
};

// Üstteki bölge sekmeleri: [[batı, güney], [doğu, kuzey]]
const REGIONS = {
  all: [[25, 24], [63, 42.5]],
  kurdistan: [[35.4, 32], [50.6, 41.7]],
  tr: [[25.6, 35.8], [44.9, 42.2]],
  sy: [[35.6, 32.2], [42.5, 37.4]],
  iq: [[38.7, 29], [48.7, 37.4]],
  ir: [[44, 25], [63.4, 39.8]],
  il: [[34.1, 29.4], [36.7, 34.7]],
  imrali: [[28.505, 40.5], [28.565, 40.575]],
};
const IMRALI_CENTER = [28.534, 40.545];
// Üstte görünen bölge sekmeleri (Kürdistan ve İmralı sekmeleri kaldırıldı; sınırları bildirim ve haftalık özet için duruyor).
const REGION_TABS = ['all', 'tr', 'sy', 'iq', 'ir', 'il'];

// Bölge sınırları (data/regions.json, scripts/build-regions.mjs ile üretilir): bir bölge sekmesi seçiliyken
// harita ve haber akışı sadece o sınırların içindeki olayları gösterir.
let REGION_SHAPES = {};
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inRegionShape = (e, key) => (REGION_SHAPES[key] || []).some((r) => inRing(e.lon, e.lat, r));
const activeRegion = () => (state.region && state.region !== 'all' && REGION_SHAPES[state.region] ? state.region : null);

const $ = (id) => document.getElementById(id);
// Paylaşılabilir bağlantılar: ?lang=ckb&region=kurdistan&topic=kurdistan gibi.
const PARAMS = new URLSearchParams(location.search);
const state = {
  events: [], imrali: [], updated: 0, fresh: 0, off: new Set(), q: '', hours: 6, inView: true, activeId: null,
  lang: pickLang(), region: null, panel: null, topic: 'all',
  // Telefonda harita her açılışta uydu görüntüsüyle gelir.
  basemap: matchMedia('(max-width: 760px)').matches ? 'satellite'
    : (() => { try { return localStorage.getItem('basemap') || 'dark'; } catch { return 'dark'; } })(),
};
state.off.add('starlink'); // ~10.000 uydu: varsayılan kapalı, Katmanlar panelinden açılır
state.off.add('weather');  // hava durumu ve kesintiler: açılınca yüklenir
state.off.add('outages');
state.off.add('heat');     // yoğunluk haritası: varsayılan kapalı
const byId = new Map();
const PLACES = window.__PLACES__ || [];
let T = I18N[state.lang];

function pickLang() {
  if (I18N[PARAMS.get('lang')]) return PARAMS.get('lang');
  try { const saved = localStorage.getItem('lang'); if (I18N[saved]) return saved; } catch {}
  const nav = (navigator.language || 'tr').toLowerCase();
  if (nav.startsWith('ckb')) return 'ckb';
  if (nav.startsWith('ku') || nav.startsWith('kmr')) return 'ku';
  if (nav.startsWith('ar')) return 'ar';
  if (nav.startsWith('en')) return 'en';
  return 'tr';
}

// ---------------- Harita ----------------

// Arapça harfli (Soranî, Arapça, Farsça) harita yazılarının doğru birleşmesi için.
try { maplibregl.setRTLTextPlugin('https://cdn.jsdelivr.net/npm/@mapbox/mapbox-gl-rtl-text@0.3.0/dist/mapbox-gl-rtl-text.js', true); } catch {}

const map = new maplibregl.Map({
  container: 'map',
  style: 'https://tiles.openfreemap.org/styles/dark',
  center: [40, 36.5],
  zoom: 3.4,
  minZoom: 0.8,
  maxZoom: 17,
  attributionControl: {
    compact: true,
    customAttribution: 'GDELT, USGS, GDACS, Launch Library, wheretheiss.at, RSS, Telegram',
  },
});
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: false }), 'bottom-left');
map.addControl(new maplibregl.GlobeControl(), 'bottom-left');

// Sol alttaki katman düğmesi ve panel düzenini sıfırlama düğmesi.
class ButtonsControl {
  onAdd() {
    const el = document.createElement('div');
    el.className = 'maplibregl-ctrl maplibregl-ctrl-group';
    el.innerHTML = `<button id="layersBtn" type="button"><i class="ti ti-stack-2"></i></button>
      <button id="basemapBtn" type="button"><i class="ti ti-map-2"></i></button>
      <button id="streetBtn" type="button"><i class="ti ti-view-360"></i></button>
      <button id="timeBtn" type="button"><i class="ti ti-history"></i></button>
      <button id="spaceBtn" type="button"><i class="ti ti-planet"></i></button>
      <button id="resetPanelsBtn" type="button"><i class="ti ti-layout-off"></i></button>`;
    el.querySelector('#layersBtn').addEventListener('click', () => togglePanel('layers'));
    // Harita türü düğmesi: koyu → uydu → arazi → koyu
    el.querySelector('#basemapBtn').addEventListener('click', () => setBasemap(BASEMAPS[(BASEMAPS.indexOf(state.basemap) + 1) % BASEMAPS.length]));
    el.querySelector('#streetBtn').addEventListener('click', () => toggleStreetMode());
    el.querySelector('#spaceBtn').addEventListener('click', () => openSpaceView());
    el.querySelector('#timeBtn').addEventListener('click', () => toggleTimeline());
    el.querySelector('#resetPanelsBtn').addEventListener('click', resetPanels);
    return el;
  }
  onRemove() {}
}
map.addControl(new ButtonsControl(), 'bottom-left');

// ---------------- Uzay görünümü ----------------
// Küre en uzak hâlindeyken daha da uzaklaşmaya çalışınca (ya da gezegen düğmesiyle) Güneş Sistemi açılır.
// space.js ve three.js ilk açılışta yüklenir; harita açılışını ağırlaştırmaz.
let space = null, spaceLoading = false;
async function openSpaceView() {
  if (spaceLoading || space?.isSpaceOpen()) return;
  spaceLoading = true;
  try {
    space ||= await import('./space.js');
    space.openSpace({ lang: state.lang, onExit: () => map.easeTo({ zoom: 1.6, pitch: 0, duration: 1200 }) });
  } catch (err) {
    console.warn('Uzay görünümü açılamadı:', err);
  } finally {
    spaceLoading = false;
  }
}
let outPushes = 0, outTimer;
map.getContainer().addEventListener('wheel', (ev) => {
  if (ev.deltaY <= 0 || map.getZoom() > map.getMinZoom() + 0.05) { outPushes = 0; return; }
  // En uzaktayken birkaç kez daha geri kaydırınca uzaya çıkılır (yanlışlıkla açılmasın diye).
  clearTimeout(outTimer);
  outTimer = setTimeout(() => { outPushes = 0; }, 800);
  if (++outPushes >= 3) { outPushes = 0; openSpaceView(); }
}, { passive: true });

// Harita üzerindeki şehir/ülke adlarını seçili dilde göster; o dilde ad yoksa sıradaki dile düş.
const MAP_LANGS = { tr: ['tr', 'en'], ku: ['ku', 'kmr', 'en'], ckb: ['ckb', 'ar', 'fa'], en: ['en'], ar: ['ar', 'en'] };

// Kürtçe yer adları: OpenStreetMap'teki Kürtçe ad yoksa, Kürdistan sınırı içindeki yerler için
// Wikidata'dan derlenen tablodan (data/kurdish-names-ku.json / -ckb.json, scripts/build-kurdish-names.mjs) yerel ada bakılır.
// Her dilin tablosu ayrı dosyadadır: sadece seçili dilinki indirilir.
const kurdNames = {};
async function ensureKurdNames(lang) {
  kurdNames[lang] ||= (await loadJson(`data/kurdish-names-${lang}.json`)) || {};
}
function kurdishLookup(target, fallback) {
  const table = kurdNames?.[target];
  if (!table || !REGION_SHAPES.kurdistan) return fallback;
  const pairs = Object.entries(table).flat();
  if (!pairs.length) return fallback;
  const area = { type: 'MultiPolygon', coordinates: REGION_SHAPES.kurdistan.map((r) => [r]) };
  return ['case', ['within', area], ['match', ['get', 'name'], ...pairs, fallback], fallback];
}

function applyMapLanguage() {
  const style = map.getStyle();
  if (!style) return;
  let field = ['coalesce', ...MAP_LANGS[state.lang].map((l) => ['get', `name:${l}`]), ['get', 'name']];
  if (state.lang === 'ku' || state.lang === 'ckb') {
    if (!kurdNames[state.lang]) { ensureKurdNames(state.lang).then(applyMapLanguage); }
    else if (state.lang === 'ku') {
      field = ['coalesce', ['get', 'name:ku'], ['get', 'name:kmr'], kurdishLookup('ku', ['get', 'name:en']), ['get', 'name']];
    } else {
      field = ['coalesce', ['get', 'name:ckb'], kurdishLookup('ckb', ['get', 'name:ar']), ['get', 'name:fa'], ['get', 'name']];
    }
  }
  for (const l of style.layers) {
    if (l.type === 'symbol' && /^(place_|water_name)/.test(l.id)) {
      try { map.setLayoutProperty(l.id, 'text-field', field); } catch {}
    }
  }
}

let mapReady = false;
map.on('style.load', () => {
  map.setProjection({ type: 'globe' });
  // Uzaktan bakınca Dünya'nın çevresinde ince bir atmosfer parıltısı.
  try { map.setSky({ 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 5, 1, 7, 0] }); } catch {}
  // Hazır koyu tema neredeyse siyah; kara, deniz, sınır ve yazıları biraz açıyoruz.
  const set = (id, prop, val) => { if (map.getLayer(id)) map.setPaintProperty(id, prop, val); };
  set('background', 'background-color', '#262c37');
  set('water', 'fill-color', '#121821');
  set('waterway', 'line-color', '#121821');
  set('boundary_country_z0-4', 'line-color', '#6b7385');
  set('boundary_country_z5-', 'line-color', '#6b7385');
  set('boundary_state', 'line-color', '#454c5a');
  for (const l of map.getStyle().layers) if (l.id.startsWith('place_')) set(l.id, 'text-color', '#a9b0bf');
  applyMapLanguage();
  addEventLayers();
  addBaseLayers();
  addStreetLayers();
  mapReady = true;
  drawRegion();
  setBasemap(state.basemap);
  render();
  drawMovers();
  updateSatPositions();
});
// Kaynak bilgisi haritanın altını kaplamasın: başta kapalı, (i) düğmesiyle açılır.
map.once('load', () => document.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'));

// Seçili bölgenin haritada gösterimi: ülkeler ince çizgiyle. Kürdistan ve İmralı'da içi boyanmaz;
// kenar yerden yükselir, dışında kesk-sor-zer ışıltı döner ve çevre kararır. Sınırın içindeki harita olduğu gibi görünür.
const SPOT = ['kurdistan', 'imrali'];
function drawRegion() {
  if (!mapReady) return;
  const key = activeRegion();
  const plain = key && !SPOT.includes(key);
  const features = plain ? REGION_SHAPES[key].map((ring) => ({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } })) : [];
  map.getSource('region').setData({ type: 'FeatureCollection', features });
  startSpotlight(SPOT.includes(key) && REGION_SHAPES.edges?.[key] ? key : null);
  showImraliMark(key === 'imrali');
}

// ---------------- Kenar ışıltısı (Kürdistan, İmralı) ----------------
const WORLD_RING = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
const SPOT_WALLS = 10;                       // çıkıntıyı oluşturan, üst üste kaydırılmış çizgi sayısı
const SPOT_LIFT = { kurdistan: 20, imrali: 14 }; // kenarın ekranda yerden yükselmesi (piksel)
const SPOT_STRONG = 4, SPOT_SETTLE = 2;      // güçlü dönüş süresi, sakinleşme süresi (saniye)
const GLOW_COLORS = [[40, 170, 70], [225, 35, 30], [255, 200, 30]]; // kesk, sor, zer (beyaz yok)
const WALL_LOW = [30, 22, 16], WALL_HIGH = [150, 112, 66];          // kaya rengi çıkıntı: dipte koyu, üstte açık
const GLOWS = [['spot-glow-wide', 22, 12, -12, 0.85], ['spot-glow-mid', 9, 5, -5, 0.95], ['spot-glow-core', 3, 0.6, 0, 1]];
const spot = { key: null, start: 0, raf: 0, phase: 0, last: 0, painted: 0 };

// Renkler kenar boyunca üç kez tekrarlanır; faz kaydıkça ışık kenarda döner.
function glowGradient(phase) {
  const stops = ['interpolate', ['linear'], ['line-progress']];
  const N = 96, n = GLOW_COLORS.length;
  for (let k = 0; k <= N; k++) {
    let u = ((k / N) * 3 + phase) % 1; if (u < 0) u += 1;
    const f = u * n, a = Math.floor(f) % n, b = (a + 1) % n, w = f - Math.floor(f);
    stops.push(k / N, `rgb(${GLOW_COLORS[a].map((v, i) => Math.round(v + (GLOW_COLORS[b][i] - v) * w))})`);
  }
  return stops;
}

function addSpotLayers() {
  const empty = { type: 'FeatureCollection', features: [] };
  map.addSource('spot-mask', { type: 'geojson', data: empty });
  map.addSource('spot-edge', { type: 'geojson', lineMetrics: true, data: empty });
  map.addLayer({ id: 'spot-mask', type: 'fill', source: 'spot-mask', paint: { 'fill-color': '#05070b', 'fill-opacity': 0 } });
  for (let i = 0; i < SPOT_WALLS; i++) {
    const c = WALL_LOW.map((v, k) => Math.round(v + (WALL_HIGH[k] - v) * (i / (SPOT_WALLS - 1))));
    map.addLayer({ id: `spot-wall-${i}`, type: 'line', source: 'spot-edge', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-color': `rgb(${c})`, 'line-width': 2.5, 'line-opacity': 0, 'line-translate-anchor': 'viewport' } });
  }
  // Işıltı: ince çekirdek çıkıntının üst kenarında, bulanık hale dışa doğru taşar (çıkıntı görünür kalsın diye).
  for (const [id, w, blur, off] of GLOWS) {
    map.addLayer({ id, type: 'line', source: 'spot-edge', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-width': w, 'line-blur': blur, 'line-offset': off, 'line-opacity': 0, 'line-gradient': glowGradient(0), 'line-translate-anchor': 'viewport' } });
  }
}

function startSpotlight(key) {
  if (key === spot.key) return;
  cancelAnimationFrame(spot.raf);
  spot.key = key;
  const edge = key ? REGION_SHAPES.edges[key] : null;
  const fc = (geometry) => ({ type: 'FeatureCollection', features: geometry ? [{ type: 'Feature', properties: {}, geometry }] : [] });
  map.getSource('spot-mask').setData(fc(edge && { type: 'Polygon', coordinates: [WORLD_RING, edge.slice().reverse()] }));
  map.getSource('spot-edge').setData(fc(edge && { type: 'LineString', coordinates: edge }));
  // İmralı küçük: ışıltı tamamen kıyının dışına taşar, adanın içi açık kalır.
  for (const [id, , , off] of GLOWS) map.setPaintProperty(id, 'line-offset', key === 'imrali' ? -off : off);
  if (!key) { paintSpotlight(0); return; }
  spot.start = performance.now(); spot.phase = 0; spot.last = 0; spot.painted = 0;
  const loop = (now) => {
    const t = (now - spot.start) / 1000;
    // Sakin evrede saniyede ~12 kare yeter; telefonda pil daha az harcanır.
    if (t < SPOT_STRONG + SPOT_SETTLE || now - spot.painted > 80) { paintSpotlight(t); spot.painted = now; }
    spot.raf = requestAnimationFrame(loop);
  };
  spot.raf = requestAnimationFrame(loop);
}

// t: bölgeye tıklandıktan sonra geçen saniye (0 = gizli).
function paintSpotlight(t) {
  const ease = (x) => 1 - Math.pow(1 - Math.min(Math.max(x, 0), 1), 3);
  const appear = ease(t / 0.8);
  const rise = ease((t - 0.8) / 1.4);                       // kamera yaklaşırken kenar yükselir
  const calm = ease((t - SPOT_STRONG) / SPOT_SETTLE);       // 0 = güçlü, 1 = sakin
  // Güçlü evrede ışık kenarı 1,4 saniyede, sakin evrede 14 saniyede bir tur döner.
  const speed = (1 / 1.4) * (1 - calm) + (1 / 14) * calm;
  spot.phase += (t - spot.last) * speed; spot.last = t;
  const breathe = 0.8 + 0.2 * Math.sin(t * 1.6) * calm;     // sakin evrede yavaş nefes alır
  const glow = t > 0 ? Math.min(1, t / 0.6) * breathe : 0;
  const lift = (SPOT_LIFT[spot.key] || 0) * rise;
  const set = (id, prop, v) => map.setPaintProperty(id, prop, v);

  set('spot-mask', 'fill-opacity', (spot.key === 'imrali' ? 0.55 : 0.68) * appear);
  for (let i = 0; i < SPOT_WALLS; i++) {
    set(`spot-wall-${i}`, 'line-translate', [0, -lift * (i / (SPOT_WALLS - 1))]);
    set(`spot-wall-${i}`, 'line-opacity', appear);
  }
  const g = glowGradient(-spot.phase);
  const width = 1 + 0.35 * (1 - calm);                       // güçlü evrede daha kalın
  for (const [id, w, , , o] of GLOWS) {
    set(id, 'line-gradient', g);
    set(id, 'line-translate', [0, -lift]);
    set(id, 'line-width', w * width);
    set(id, 'line-opacity', o * glow);
  }
}

// ---------------- Gece / gündüz ----------------
// Güneş'in tam tepede olduğu nokta (yaklaşık formül, harita için yeterli: birkaç dakikalık sapma).
function subsolarPoint(ms) {
  const d = ms / 86400000 - 10957.5; // J2000'den beri gün
  const rad = Math.PI / 180;
  const g = (357.529 + 0.98560028 * d) * rad;
  const L = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.00000036 * d) * rad;
  const dec = Math.asin(Math.sin(eps) * Math.sin(L));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(L), Math.cos(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24) * 15 * rad;
  let lon = (ra - gmst) / rad;
  lon = ((lon + 540) % 360) - 180;
  return { lat: dec / rad, lon };
}
// Güneş yüksekliği h'den düşük olan bölgenin sınırı: her boylam için o yüksekliğin enlemi bulunur,
// sonra gece tarafındaki kutupla kapatılır.
function nightPolygon(sun, h) {
  const rad = Math.PI / 180, dec = sun.lat * rad, sinH = Math.sin(h * rad);
  const ring = [];
  for (let lon = -180; lon <= 180; lon += 2) {
    const A = Math.sin(dec), B = Math.cos(dec) * Math.cos((lon - sun.lon) * rad);
    // A·sin(enlem) + B·cos(enlem) = sin(h) denkleminin iki çözümünden −90…90 arasında kalanı alınır.
    const R = Math.hypot(A, B), s = Math.asin(Math.max(-1, Math.min(1, sinH / R))), a = Math.atan2(B, A);
    const wrap = (x) => ((x / rad + 540) % 360) - 180;
    let lat = wrap(s - a);
    if (Math.abs(lat) > 90) lat = wrap(Math.PI - s - a);
    ring.push([lon, Math.max(-89.9, Math.min(89.9, lat))]);
  }
  const pole = sun.lat > 0 ? -89.9 : 89.9;
  ring.push([180, pole], [-180, pole], ring[0]);
  return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [ring] } };
}
function updateNight() {
  if (!map.getSource('night')) return;
  const sun = subsolarPoint(Date.now());
  map.getSource('night').setData({ type: 'FeatureCollection', features: [nightPolygon(sun, 0), nightPolygon(sun, -12)] });
  map.setLayoutProperty('night', 'visibility', state.off.has('night') ? 'none' : 'visible');
}

// İmralı yer imi: adanın üstündeki işarete tıklayınca önemli haberlerin listesi açılır.
let imraliMark = null;
function showImraliMark(on) {
  if (on && !imraliMark) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'imrali-mark';
    el.innerHTML = '<i class="ti ti-bookmark"></i>';
    el.addEventListener('click', (ev) => { ev.stopPropagation(); openInfo('imrali'); });
    imraliMark = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -16] }).setLngLat(IMRALI_CENTER).addTo(map);
  } else if (!on && imraliMark) {
    imraliMark.remove();
    imraliMark = null;
    if (infoOpenFor === 'imrali') closeInfo();
  }
  imraliMark?.getElement().setAttribute('title', T.imraliNews);
}

// ---------------- Harita türü: koyu / uydu / arazi ----------------
// Uydu: Esri World Imagery. Arazi: AWS açık yükseklik verisinden (Terrain Tiles) gölgelendirilmiş kabartma.
// İkisi de ücretsiz ve anahtarsız. Yollar, sınırlar ve yer adları her türde üstte kalır.
const BASEMAPS = ['dark', 'satellite', 'terrain'];
function addBaseLayers() {
  const style = map.getStyle();
  // Uydu/kabartma katmanları alan dolgularının üstüne, yolların ve yazıların altına girer.
  const before = style.layers.find((l) => l.type === 'line' || l.type === 'symbol')?.id;
  map.addSource('sat', {
    type: 'raster', tileSize: 256, maxzoom: 19,
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    attribution: 'Uydu: © Esri, Maxar, Earthstar Geographics',
  });
  map.addLayer({ id: 'sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } }, before);
  map.addSource('dem', {
    type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 14,
    tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
    attribution: 'Arazi: AWS Terrain Tiles (Mapzen)',
  });
  map.addLayer({
    id: 'hillshade', type: 'hillshade', source: 'dem', layout: { visibility: 'none' },
    paint: { 'hillshade-exaggeration': 0.6, 'hillshade-shadow-color': '#05070c', 'hillshade-highlight-color': '#c3cad6', 'hillshade-accent-color': '#3b4252' },
  }, before);
}
function setBasemap(mode) {
  state.basemap = BASEMAPS.includes(mode) ? mode : 'dark';
  try { localStorage.setItem('basemap', state.basemap); } catch {}
  if (mapReady) {
    map.setLayoutProperty('sat', 'visibility', state.basemap === 'satellite' ? 'visible' : 'none');
    map.setLayoutProperty('hillshade', 'visibility', state.basemap === 'terrain' ? 'visible' : 'none');
    // Uydu görüntüsü üzerinde yazılar koyu kenarla okunur kalsın.
    for (const l of map.getStyle().layers) {
      if (l.type === 'symbol' && /^(place_|water_name)/.test(l.id)) {
        map.setPaintProperty(l.id, 'text-color', state.basemap === 'satellite' ? '#ffffff' : '#a9b0bf');
        map.setPaintProperty(l.id, 'text-halo-color', state.basemap === 'satellite' ? 'rgba(0,0,0,0.85)' : 'rgba(0,0,0,0.5)');
        map.setPaintProperty(l.id, 'text-halo-width', state.basemap === 'satellite' ? 1.4 : 1);
      }
    }
  }
  renderBasemaps();
}
function renderBasemaps() {
  const el = $('basemaps');
  if (!el) return;
  el.innerHTML = `<span>${T.basemap}</span>` + BASEMAPS.map((m) =>
    `<button data-basemap="${m}" class="${m === state.basemap ? 'active' : ''}"><i class="ti ti-${{ dark: 'moon', satellite: 'satellite', terrain: 'mountain' }[m]}"></i>${T.basemaps[m]}</button>`).join('');
}

// Olaylar tek bir GeoJSON kaynağında; yakın olaylar sayılı kümeler hâlinde birleşir.
function addEventLayers() {
  // Gece: Güneş'in ufkun altında kaldığı yerler kararır; alacakaranlık (0°) hafif, gece (−12°) koyu.
  map.addSource('night', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'night', type: 'fill', source: 'night', paint: { 'fill-color': '#0a1030', 'fill-opacity': 0.2, 'fill-antialias': false } });
  updateNight();
  // Seçili bölge (en altta).
  map.addSource('region', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'region-fill', type: 'fill', source: 'region', paint: { 'fill-color': '#4dabf7', 'fill-opacity': 0.05 } });
  map.addLayer({ id: 'region-line', type: 'line', source: 'region', paint: { 'line-color': '#4dabf7', 'line-width': 1.5, 'line-opacity': 0.85 } });
  addSpotLayers();

  // Uydular olayların altında, küçük renkli noktalar.
  map.addSource('sats', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'sats', type: 'circle', source: 'sats',
    paint: {
      'circle-color': ['get', 'color'],
      'circle-radius': ['case', ['==', ['get', 'small'], 1], 1.6, 3],
      'circle-opacity': 0.9,
      'circle-stroke-width': ['case', ['==', ['get', 'small'], 1], 0, 0.5],
      'circle-stroke-color': '#000000',
    },
  });
  map.on('click', 'sats', (ev) => {
    const s = sats.get(String(ev.features[0].properties.norad));
    if (s) openInfo(s);
  });
  map.on('mouseenter', 'sats', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'sats', () => { map.getCanvas().style.cursor = ''; });

  // Seçili uçuşun rotası (uçak simgelerinin altında).
  map.addSource('route', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'route-done', type: 'line', source: 'route', filter: ['==', ['get', 'done'], 1],
    layout: { 'line-cap': 'round' }, paint: { 'line-color': '#f59f00', 'line-width': 2.5, 'line-opacity': 0.9 },
  });
  map.addLayer({
    id: 'route-todo', type: 'line', source: 'route', filter: ['==', ['get', 'done'], 0],
    paint: { 'line-color': '#f59f00', 'line-width': 2, 'line-opacity': 0.75, 'line-dasharray': [2, 2] },
  });

  // Uçaklar ve gemiler: rotalarına göre döndürülmüş simgeler.
  map.addSource('movers', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'movers', type: 'symbol', source: 'movers',
    layout: {
      'icon-image': ['get', 'icon'], 'icon-rotate': ['get', 'rot'], 'icon-rotation-alignment': 'map',
      'icon-allow-overlap': true, 'icon-ignore-placement': true,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 2, 0.55, 6, 0.8, 10, 1],
    },
  });
  map.on('click', 'movers', (ev) => {
    const p = ev.features[0].properties;
    if (p.kind === 'air') { const a = aircraft.get(p.id); if (a) openAir(a); }
  });
  map.on('mouseenter', 'movers', () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'movers', () => { map.getCanvas().style.cursor = ''; });

  map.addSource('events', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, cluster: true, clusterRadius: 42, clusterMaxZoom: 8 });
  // Yoğunluk haritası (Katmanlar panelinden açılır): olayların yoğun olduğu yerler kırmızımsı bir ısı olarak görünür.
  map.addSource('heat', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: 'heat', type: 'heatmap', source: 'heat', layout: { visibility: 'none' },
    paint: {
      'heatmap-weight': ['get', 'w'],
      'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 8, 1.6],
      'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 14, 6, 26, 10, 40],
      'heatmap-opacity': 0.75,
      'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.2, 'rgba(255,200,40,0.45)',
        0.45, 'rgba(255,140,20,0.7)', 0.7, 'rgba(230,40,30,0.85)', 1, 'rgba(160,0,30,0.95)'],
    },
  });
  map.addLayer({
    id: 'clusters', type: 'circle', source: 'events', filter: ['has', 'point_count'],
    paint: {
      'circle-color': 'rgba(229,72,77,0.88)',
      'circle-radius': ['step', ['get', 'point_count'], 13, 10, 16, 50, 20, 200, 25],
      'circle-stroke-width': 6,
      'circle-stroke-color': 'rgba(229,72,77,0.28)',
    },
  });
  map.addLayer({
    id: 'cluster-count', type: 'symbol', source: 'events', filter: ['has', 'point_count'],
    layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Regular'], 'text-size': 12, 'text-allow-overlap': true },
    paint: { 'text-color': '#ffffff' },
  });
  map.addLayer({
    id: 'active', type: 'circle', source: 'events', filter: ['==', ['get', 'id'], ''],
    paint: { 'circle-radius': 21, 'circle-color': 'rgba(255,255,255,0.18)', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 2 },
  });
  // Son 15 dakikanın olayları nabız gibi atar: işaretin çevresinde genişleyip sönen bir halka.
  map.addLayer({
    id: 'pulse', type: 'circle', source: 'events', filter: ['all', ['!', ['has', 'point_count']], ['==', ['get', 'fresh'], 1]],
    paint: { 'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'color'], 'circle-stroke-width': 3, 'circle-stroke-opacity': 0 },
  });
  map.addLayer({
    id: 'points', type: 'symbol', source: 'events', filter: ['!', ['has', 'point_count']],
    layout: { 'icon-image': ['get', 'icon'], 'icon-allow-overlap': true, 'icon-ignore-placement': true },
  });

  map.on('click', 'points', (ev) => {
    const e = byId.get(ev.features[0].properties.id);
    if (e) select(e, false);
  });
  map.on('click', 'clusters', async (ev) => {
    const f = ev.features[0];
    const zoom = await map.getSource('events').getClusterExpansionZoom(f.properties.cluster_id);
    map.easeTo({ center: f.geometry.coordinates, zoom: zoom + 0.2 });
  });
  for (const id of ['points', 'clusters']) {
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
}

// Haritadaki simgeler: renkli daire + beyaz Tabler simgesi, tuvalde bir kez çizilip haritaya eklenir.
// Simge yolları icons.js'ten gelir (scripts/build-icons.mjs); yazı tipi beklemeye gerek yoktur.
const iconPaths = new Map();
const pathOf = (name) => {
  if (!iconPaths.has(name)) iconPaths.set(name, new Path2D(window.ICONS?.[name] || window.ICONS?.news || ''));
  return iconPaths.get(name);
};
function ensureIcon(icon, color) {
  const key = `${icon}|${color}`;
  if (map.hasImage(key)) return key;
  const r = 2, size = 30 * r;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.shadowColor = 'rgba(0,0,0,0.55)';
  ctx.shadowBlur = 4 * r;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 12 * r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 2 * r;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  // 24 birimlik simge dairenin ortasına 15 piksel boyunda çizilir.
  const s = (15 * r) / 24;
  ctx.setTransform(s, 0, 0, s, size / 2 - 12 * s, size / 2 - 12 * s);
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke(pathOf(icon));
  map.addImage(key, ctx.getImageData(0, 0, size, size), { pixelRatio: r });
  return key;
}

// Aynı noktadaki olaylar (ör. şehir merkezi) üst üste binmesin diye küçük bir çembere dağıtılır.
function spread(list) {
  const groups = new Map();
  for (const e of list) {
    const k = `${e.lat.toFixed(3)},${e.lon.toFixed(3)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  const pos = new Map();
  for (const g of groups.values()) {
    g.forEach((e, i) => {
      if (g.length === 1) { pos.set(e.id, [e.lon, e.lat]); return; }
      const ring = 0.012 * Math.sqrt(g.length);
      const a = (i / g.length) * Math.PI * 2;
      pos.set(e.id, [e.lon + ring * Math.cos(a), e.lat + ring * Math.sin(a)]);
    });
  }
  return pos;
}

const PULSE_MS = 15 * 60e3;
// Yoğunluk haritasında ağır olaylar (saldırı, çatışma) daha çok ısıtır.
const HEAT_WEIGHT = { massviolence: 3, airstrike: 2.5, bombing: 2.5, artillery: 2, clash: 2, attack: 2, earthquake: 1.5, disaster: 1.5 };
function renderMarkers(list) {
  if (!mapReady) return;
  const pos = spread(list);
  const now = Date.now();
  let fresh = 0;
  map.getSource('events').setData({
    type: 'FeatureCollection',
    features: list.map((e) => {
      const isFresh = e.cat !== 'launch' && now - e.t < PULSE_MS && now >= e.t;
      if (isFresh) fresh++;
      return { type: 'Feature', geometry: { type: 'Point', coordinates: pos.get(e.id) },
        properties: { id: e.id, icon: ensureIcon(iconOf(e), colorOf(e)), fresh: isFresh ? 1 : 0, color: colorOf(e) } };
    }),
  });
  map.getSource('heat').setData({
    type: 'FeatureCollection',
    features: list.filter((e) => e.cat !== 'launch').map((e) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
      properties: { w: HEAT_WEIGHT[e.cat] || 1 } })),
  });
  map.setLayoutProperty('heat', 'visibility', state.off.has('heat') ? 'none' : 'visible');
  freshCount = fresh;
  if (fresh) startPulse();
}
// Nabız: saniyede ~25 kare yeter; yeni olay yoksa döngü durur.
let pulseRaf = 0, pulseLast = 0, freshCount = 0;
function startPulse() {
  if (pulseRaf) return;
  const loop = (now) => {
    pulseRaf = requestAnimationFrame(loop);
    if (now - pulseLast < 40) return;
    pulseLast = now;
    const k = (now % 1600) / 1600;
    map.setPaintProperty('pulse', 'circle-radius', 12 + k * 16);
    map.setPaintProperty('pulse', 'circle-stroke-opacity', 0.9 * (1 - k));
    if (!freshCount) { cancelAnimationFrame(pulseRaf); pulseRaf = 0; }
  };
  pulseRaf = requestAnimationFrame(loop);
}

// Uluslararası Uzay İstasyonu: tarayıcı 10 saniyede bir anlık konumunu çeker (wheretheiss.at, ücretsiz, anahtarsız).
let iss = null;
const issEl = document.createElement('div');
issEl.className = 'ico iss';
issEl.style.background = ISS_CAT.color;
issEl.innerHTML = '<i class="ti ti-satellite"></i>';
issEl.addEventListener('click', (ev) => { ev.stopPropagation(); openInfo('iss'); });
const issMarker = new maplibregl.Marker({ element: issEl });
async function updateIss() {
  if (state.off.has('iss')) { issMarker.remove(); return; }
  try {
    iss = await (await fetch('https://api.wheretheiss.at/v1/satellites/25544')).json();
    issMarker.setLngLat([iss.longitude, iss.latitude]).addTo(map);
    if (infoOpenFor === 'iss') openInfo('iss');
  } catch {}
}

// ---------------- Uydular ----------------
// Yörünge verisi data/sats.json'dan (CelesTrak, 6 saatte bir yenilenir); konumlar tarayıcıda
// SGP4 yörünge modeliyle 3 saniyede bir hesaplanır. Starlink (~10.000 uydu) ayrı dosyada, katmanı açılınca iner.
const SAT_COLORS = {
  stations: '#f59f00', visual: '#dee2e6', 'gps-ops': '#40c057', galileo: '#40c057', beidou: '#40c057',
  weather: '#22b8cf', science: '#be4bdb', geo: '#fab005', starlink: '#748ffc',
};
const SAT_CAT = { icon: 'satellite', color: '#495057' };
const STARLINK_CAT = { icon: 'satellite', color: '#748ffc' };
let satLib = null;
const sats = new Map(); // NORAD numarası -> uydu
const satFiles = new Set();

async function loadSats() {
  const want = ['data/sats.json'];
  if (!state.off.has('starlink')) want.push('data/sats-starlink.json');
  const todo = want.filter((f) => !satFiles.has(f));
  if (!todo.length) return;
  satLib ||= await import('https://cdn.jsdelivr.net/npm/satellite.js@7.1.0/+esm');
  for (const f of todo) {
    const j = await loadJson(f);
    if (!j) continue;
    satFiles.add(f);
    for (const [group, list] of Object.entries(j.groups)) {
      for (const [name, l1, l2] of list) {
        const norad = l1.slice(2, 7).trim();
        if (sats.has(norad)) continue;
        try { sats.set(norad, { norad, name, group, rec: satLib.twoline2satrec(l1, l2) }); } catch {}
      }
    }
  }
}

const satVisible = (s) => !state.off.has(s.group === 'starlink' ? 'starlink' : 'sats');

function updateSatPositions() {
  if (!mapReady || !satLib) return;
  const now = new Date();
  const gmst = satLib.gstime(now);
  const features = [];
  for (const s of sats.values()) {
    if (!satVisible(s)) continue;
    const pv = satLib.propagate(s.rec, now);
    if (!pv?.position) continue;
    const geo = satLib.eciToGeodetic(pv.position, gmst);
    s.lat = satLib.degreesLat(geo.latitude);
    s.lon = satLib.degreesLong(geo.longitude);
    s.alt = geo.height;
    s.vel = Math.hypot(pv.velocity.x, pv.velocity.y, pv.velocity.z) * 3600;
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [s.lon, s.lat] },
      properties: { norad: s.norad, color: SAT_COLORS[s.group] || '#dee2e6', small: s.group === 'starlink' ? 1 : 0 },
    });
  }
  map.getSource('sats').setData({ type: 'FeatureCollection', features });
  if (infoOpenFor?.startsWith('sat:')) openInfo(sats.get(infoOpenFor.slice(4)));
}

async function refreshSats() {
  if (state.off.has('sats') && state.off.has('starlink')) { if (mapReady) updateSatPositions(); return; }
  try { await loadSats(); } catch {}
  updateSatPositions();
  renderLayers();
}

// ---------------- Uçaklar ve gemiler ----------------

// Uçaklar: Cloudflare'deki küçük aracı servis (worker/) üzerinden adsb.lol / adsb.fi.
// Görünen bölgenin uçakları 20 saniyede, dünya genelindeki askeri uçuşlar 60 saniyede bir istenir;
// aradaki sürede her uçak son hızı ve rotasıyla ileri hesaplanır (ölü hesaplama), böylece akıcı hareket eder.
const AIR_API = window.CONFIG?.API || ''; // worker/src/index.js
const AIR_CAT = { icon: 'plane', color: '#f59f00' };
const MIL_CAT = { icon: 'plane', color: '#e03131' };
const aircraft = new Map(); // hex -> uçak
let lastMil = 0, airMove;

// Rotaya göre döndürülen simge: kuzeyi gösteren uçak silüeti, tuvalde çizilir.
function ensureShape(key, color, draw, stroke = 'rgba(0,0,0,0.75)') {
  if (map.hasImage(key)) return key;
  const r = 2, size = 26 * r;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  ctx.scale(r, r);
  ctx.translate(13, 13);
  ctx.beginPath();
  draw(ctx);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.4;
  ctx.fill();
  ctx.stroke();
  map.addImage(key, ctx.getImageData(0, 0, size, size), { pixelRatio: r });
  return key;
}
const planeShape = (ctx) => {
  for (const [x, y] of [[0, -11], [1.6, -8], [1.6, -2.5], [10, 2.5], [10, 4.5], [1.6, 2], [1.4, 7.5], [4, 9.5], [4, 11], [0, 10],
    [-4, 11], [-4, 9.5], [-1.4, 7.5], [-1.6, 2], [-10, 4.5], [-10, 2.5], [-1.6, -2.5], [-1.6, -8]]) ctx.lineTo(x, y);
};
function viewRadiusNm() {
  const b = map.getBounds(), c = map.getCenter();
  const km = c.distanceTo(b.getNorthEast()) / 1000;
  return Math.min(250, Math.max(25, km / 1.852));
}

async function updateAircraft() {
  if (!AIR_API || !mapReady || document.hidden) return;
  try {
    if (!state.off.has('aircraft') && map.getZoom() >= 3) {
      const c = map.getCenter();
      const j = await (await fetch(`${AIR_API}/area?lat=${c.lat.toFixed(2)}&lon=${c.lng.toFixed(2)}&dist=${Math.round(viewRadiusNm())}`)).json();
      for (const [hex, a] of aircraft) if (!a.mil) aircraft.delete(hex);
      for (const a of j.ac || []) aircraft.set(a.h, { ...a, seen: Date.now() });
    }
    if (!state.off.has('mil') && Date.now() - lastMil > 60e3) {
      lastMil = Date.now();
      const j = await (await fetch(`${AIR_API}/mil`)).json();
      for (const [hex, a] of aircraft) if (a.mil) aircraft.delete(hex);
      for (const a of j.ac || []) aircraft.set(a.h, { ...a, mil: 1, seen: Date.now() });
    }
  } catch {}
  drawMovers();
}

// Ölü hesaplama: son bilinen hız (knot) ve rotayla konumu ileri taşı.
function advance(o, speedKt, course, dtMs) {
  if (!speedKt || o.alt === 'ground') return;
  const km = speedKt * 1.852 * (dtMs / 3600e3);
  const rad = (course * Math.PI) / 180;
  o.lat += (km * Math.cos(rad)) / 111.32;
  o.lon += (km * Math.sin(rad)) / (111.32 * Math.cos((o.lat * Math.PI) / 180));
}
let lastTick = Date.now();
function tickMovers() {
  const now = Date.now(), dt = now - lastTick;
  lastTick = now;
  for (const a of aircraft.values()) advance(a, a.gs, a.trk, dt);
  drawMovers();
}

function drawMovers() {
  if (!mapReady) return;
  const civ = ensureShape('plane-civ', AIR_CAT.color, planeShape);
  const mil = ensureShape('plane-mil', MIL_CAT.color, planeShape);
  const planes = [...aircraft.values()].filter((a) => !state.off.has(a.mil ? 'mil' : 'aircraft'));
  map.getSource('movers').setData({
    type: 'FeatureCollection',
    features: [
      ...planes.map((a) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [a.lon, a.lat] },
        properties: { kind: 'air', id: a.h, icon: a.mil ? mil : civ, rot: a.trk || 0 } })),
    ],
  });
  // Açık uçak panelinde sadece değişen değerler yenilenir (fotoğraf her seferinde yeniden yüklenmesin).
  if (infoOpenFor?.startsWith('air:')) { const a = aircraft.get(infoOpenFor.slice(4)); if (a) updateAirLive(a); }
}

// ---- Uçak ayrıntıları ----
// Ücretsiz, anahtarsız ve tarayıcıdan doğrudan: adsbdb (kalkış/varış, havayolu, uçak bilgisi) ve
// planespotters.net (gerçek fotoğraf; fotoğrafçının adı ve bağlantısı gösterilmek şartıyla).
// Her uçak için bir kez istenir ve saklanır.
const airInfo = new Map();
const getJson = (u) => fetch(u).then((r) => (r.ok ? r.json() : null)).catch(() => null);
async function loadAirInfo(a) {
  const key = `${a.h}|${a.f}`;
  if (airInfo.has(key)) return airInfo.get(key);
  const info = { loading: true };
  airInfo.set(key, info);
  const cs = (a.f || '').trim();
  const [route, craft, photos] = await Promise.all([
    cs ? getJson(`https://api.adsbdb.com/v0/callsign/${encodeURIComponent(cs)}`) : null,
    getJson(`https://api.adsbdb.com/v0/aircraft/${a.h}`),
    getJson(`https://api.planespotters.net/pub/photos/hex/${a.h}`),
  ]);
  info.route = route?.response?.flightroute || null;
  info.craft = typeof craft?.response === 'object' ? craft.response.aircraft : null;
  info.photo = photos?.photos?.[0] || null;
  // adsbdb'nin rota verisi gönüllülerden geliyor ve bazen eski/yanlış (ör. Anadolu üzerindeki bir uçuş için
  // "İstanbul → Detroit"). Uçak kalkış–varış hattının çok dışındaysa rota gösterilmez.
  if (info.route && !routeFits(a, info.route)) info.route = null;
  // Rotası bilinmeyen uçuşta en azından havayolu: çağrı kodunun ilk üç harfi (IGO012 -> IndiGo).
  if (!info.route && /^[A-Z]{3}\d/.test(cs)) {
    const al = await getJson(`https://api.adsbdb.com/v0/airline/${cs.slice(0, 3)}`);
    info.airline = Array.isArray(al?.response) ? al.response[0] : null;
  }
  info.loading = false;
  return info;
}

function distKm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(a));
}
function bearing(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}

// Rota inandırıcı mı? Uçak kalkış–varış yolunun makul bir sapmayla üzerinde olmalı (toplam yol en fazla %25 uzar)
// ve havadaysa varıştan uzakken aşağı yukarı varışa doğru uçmalı.
function routeFits(a, r) {
  if (!r.origin || !r.destination) return false;
  const { latitude: dLat, longitude: dLon } = r.destination;
  const direct = distKm(r.origin.latitude, r.origin.longitude, dLat, dLon);
  const toDest = distKm(a.lat, a.lon, dLat, dLon);
  const via = distKm(r.origin.latitude, r.origin.longitude, a.lat, a.lon) + toDest;
  if (direct < 50 || via > direct * 1.25 + 150) return false;
  if (a.gs > 80 && toDest > 300) {
    const diff = Math.abs(((bearing(a.lat, a.lon, dLat, dLon) - (a.trk || 0)) + 540) % 360 - 180);
    if (diff > 100) return false;
  }
  return true;
}

function routeProgress(a, r) {
  const done = distKm(r.origin.latitude, r.origin.longitude, a.lat, a.lon);
  const left = distKm(a.lat, a.lon, r.destination.latitude, r.destination.longitude);
  return { pct: Math.round((100 * done) / (done + left || 1)), left: Math.round(left) };
}

const airAlt = (a) => (a.alt === 'ground' ? T.onGround : a.alt != null ? `${Math.round(a.alt * 0.3048).toLocaleString(T.locale)} m` : '—');
const airSpeed = (a) => (a.gs ? `${Math.round(a.gs * 1.852).toLocaleString(T.locale)} km/h` : '—');
const airport = (p) => `<div class="apt"><b>${esc(p.iata_code || p.icao_code)}</b><span>${esc(p.municipality || p.name)}</span><small>${esc(p.country_name || '')}</small></div>`;
const tile = (icon, label, value, live) => `<div class="tile"><i class="ti ti-${icon}"></i><span>${label}</span><b ${live ? `data-live="${live}"` : ''}>${value}</b></div>`;

function airHtml(a, info) {
  const r = info?.route;
  const airline = r?.airline || info?.airline;
  const craft = info?.craft;
  const color = a.mil ? MIL_CAT.color : AIR_CAT.color;
  let photo;
  if (info?.photo) {
    photo = `<a class="air-photo" href="${esc(info.photo.link)}" target="_blank" rel="noopener">${imgHtml(info.photo.thumbnail_large?.src || info.photo.thumbnail?.src, '')}</a>
      <div class="credit">© ${esc(info.photo.photographer)} · planespotters.net</div>`;
  } else if (craft?.url_photo) {
    photo = `<div class="air-photo">${imgHtml(craft.url_photo, '')}</div><div class="credit">airport-data.com</div>`;
  } else {
    photo = `<div class="air-photo empty" style="--c:${color}"><i class="ti ti-plane"></i></div>`;
  }
  let route;
  if (r?.origin && r?.destination) {
    const p = routeProgress(a, r);
    route = `<div class="route">${airport(r.origin)}
      <div class="route-mid"><div class="route-track"><div class="route-done" data-live="bar" style="width:${p.pct}%"></div>
        <i class="ti ti-plane" data-live="planepos" style="inset-inline-start:${p.pct}%"></i></div>
        <small data-live="left">${p.left.toLocaleString(T.locale)} km</small></div>
      ${airport(r.destination)}</div>`;
  } else {
    route = `<div class="route-unknown">${info?.loading ? '…' : T.routeUnknown}</div>`;
  }
  const typeName = craft ? `${craft.manufacturer} ${craft.type}` : a.t || '—';
  return `${photo}
    <div class="air-head" style="--c:${color}">
      <span class="air-badge">${a.mil ? T.cats.mil : airline ? esc(airline.name) : T.cats.aircraft}</span>
      <h3 dir="ltr">${esc(a.f || a.r || a.h)}${r?.callsign_iata ? ` <small>${esc(r.callsign_iata)}</small>` : ''}</h3>
    </div>
    ${route}
    <div class="tiles">
      ${tile('arrow-up', T.altitude, airAlt(a), 'alt')}
      ${tile('gauge', T.speed, airSpeed(a), 'speed')}
      ${tile('compass', T.heading, `${Math.round(a.trk || 0)}°`, 'trk')}
      ${tile('plane', T.acType, esc(typeName))}
      ${tile('id', T.reg, esc(craft?.registration || a.r || '—'))}
      ${tile('building', T.operator, esc(craft?.registered_owner || airline?.name || '—'))}
    </div>
    <div class="air-foot"><span dir="ltr">${a.sq ? `Squawk ${esc(a.sq)} · ` : ''}<span data-live="pos">${a.lat.toFixed(3)}°, ${a.lon.toFixed(3)}°</span></span>
      <a href="https://globe.adsb.lol/?icao=${esc(a.h)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> adsb.lol</a></div>`;
}

// Panel açıkken uçağın değişen değerlerini ve haritadaki rota çizgisini güncelle.
function updateAirLive(a) {
  const body = $('infoBody');
  const set = (k, v) => { const el = body.querySelector(`[data-live="${k}"]`); if (el) el.textContent = v; };
  set('alt', airAlt(a));
  set('speed', airSpeed(a));
  set('trk', `${Math.round(a.trk || 0)}°`);
  set('pos', `${a.lat.toFixed(3)}°, ${a.lon.toFixed(3)}°`);
  const r = airInfo.get(`${a.h}|${a.f}`)?.route;
  if (r?.origin && r?.destination) {
    const p = routeProgress(a, r);
    const bar = body.querySelector('[data-live="bar"]'), pl = body.querySelector('[data-live="planepos"]');
    if (bar) bar.style.width = `${p.pct}%`;
    if (pl) pl.style.insetInlineStart = `${p.pct}%`;
    set('left', `${p.left.toLocaleString(T.locale)} km`);
    drawRoute(a, r);
  }
}

// Haritada uçuşun rotası: kalkıştan uçağa düz, uçaktan varışa kesik çizgi.
function drawRoute(a, r) {
  if (!mapReady) return;
  const line = (from, to, done) => ({ type: 'Feature', properties: { done }, geometry: { type: 'LineString', coordinates: [from, to] } });
  map.getSource('route').setData({
    type: 'FeatureCollection',
    features: r ? [
      line([r.origin.longitude, r.origin.latitude], [a.lon, a.lat], 1),
      line([a.lon, a.lat], [r.destination.longitude, r.destination.latitude], 0),
    ] : [],
  });
}

async function openAir(a) {
  const key = `${a.h}|${a.f}`;
  openInfo({ air: a, info: airInfo.get(key) });
  drawRoute(a, null);
  const info = await loadAirInfo(a);
  if (infoOpenFor === `air:${a.h}`) {
    openInfo({ air: a, info });
    if (info.route?.origin && info.route?.destination) drawRoute(a, info.route);
  }
}

function dateTimeText(t) {
  try { return new Intl.DateTimeFormat(state.lang === 'ku' ? 'tr' : T.locale, { day: 'numeric', month: state.lang === 'ku' ? 'numeric' : 'short', hour: '2-digit', minute: '2-digit' }).format(t); }
  catch { return new Date(t).toLocaleString(); }
}
// ---------------- Sokak fotoğrafları (Mapillary) ----------------
// Gönüllülerin çektiği sokak fotoğrafları. Mod açıkken fotoğrafı olan sokaklar haritada yeşil çizilir;
// tıklanınca o noktaya en yakın fotoğraf, içinde yürünebilen bir panelde açılır. Anahtar config.js'de.
const MLY_TOKEN = (window.CONFIG?.MAPILLARY_TOKEN || '').trim();
let streetMode = false, mlyViewer = null, mlyLib = null;
const streetArrow = document.createElement('div');
streetArrow.className = 'street-arrow';
streetArrow.innerHTML = '<i class="ti ti-navigation"></i>';
const streetMarker = new maplibregl.Marker({ element: streetArrow, rotationAlignment: 'map' });

function addStreetLayers() {
  if (!MLY_TOKEN) return;
  map.addSource('mly', {
    type: 'vector', minzoom: 6, maxzoom: 14,
    tiles: [`https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${MLY_TOKEN}`],
    attribution: 'Sokak fotoğrafları: © Mapillary',
  });
  map.addLayer({
    id: 'mly-seq', type: 'line', source: 'mly', 'source-layer': 'sequence', layout: { visibility: 'none', 'line-cap': 'round' },
    paint: { 'line-color': '#2bd44a', 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1.2, 14, 3.5], 'line-opacity': 0.85 },
  }, 'clusters');
  map.addLayer({
    id: 'mly-img', type: 'circle', source: 'mly', 'source-layer': 'image', minzoom: 15, layout: { visibility: 'none' },
    paint: { 'circle-radius': 3.5, 'circle-color': '#2bd44a', 'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 },
  }, 'clusters');
  for (const id of ['mly-seq', 'mly-img']) {
    map.on('click', id, (ev) => {
      const imgId = ev.features[0].properties.id;
      id === 'mly-img' && imgId ? openStreet(String(imgId)) : openStreetAt(ev.lngLat);
    });
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
}

function toggleStreetMode(on = !streetMode) {
  streetMode = on;
  $('streetBtn')?.classList.toggle('active', on);
  if (!MLY_TOKEN) { if (on) showStreetMsg(T.streetNoKey); streetMode = false; return; }
  for (const id of ['mly-seq', 'mly-img']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  // Fotoğraflı sokaklar şehir ölçeğinde görünür: çok uzaktaysak yaklaş.
  if (on && map.getZoom() < 6) map.flyTo({ zoom: 7, duration: 900 });
  if (on) showStreetMsg(T.streetHint);
  else closeStreet();
}

function showStreetMsg(text) {
  const p = $('streetPanel');
  p.hidden = false;
  $('streetMsg').textContent = text;
  $('streetMsg').hidden = false;
  $('streetViewer').hidden = !mlyViewer;
}

function closeStreet() {
  $('streetPanel').hidden = true;
  streetMarker.remove();
}

// Tıklanan noktanın çevresindeki (yaklaşık 200 m) en yakın fotoğraf.
async function openStreetAt(ll) {
  const d = 0.002;
  const url = `https://graph.mapillary.com/images?access_token=${MLY_TOKEN}&fields=id,computed_geometry&limit=50` +
    `&bbox=${ll.lng - d},${ll.lat - d},${ll.lng + d},${ll.lat + d}`;
  const j = await getJson(url);
  const near = (j?.data || []).filter((x) => x.computed_geometry)
    .map((x) => ({ id: x.id, dist: distKm(ll.lat, ll.lng, x.computed_geometry.coordinates[1], x.computed_geometry.coordinates[0]) }))
    .sort((a, b) => a.dist - b.dist)[0];
  if (near) openStreet(near.id); else showStreetMsg(T.streetNone);
}

async function openStreet(imageId) {
  const p = $('streetPanel');
  p.hidden = false;
  p.classList.remove('collapsed');
  $('streetMsg').hidden = true;
  $('streetViewer').hidden = false;
  if (!mlyLib) {
    // Görüntüleyici (~1 MB) sadece ilk kullanımda indirilir.
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/mapillary-js@4.1.2/dist/mapillary.css';
    document.head.appendChild(css);
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/mapillary-js@4.1.2/dist/mapillary.js';
      s.onload = res;
      s.onerror = rej;
      document.head.appendChild(s);
    });
    mlyLib = window.mapillary;
  }
  if (!mlyViewer) {
    mlyViewer = new mlyLib.Viewer({ accessToken: MLY_TOKEN, container: 'streetViewer', imageId, component: { cover: false } });
    // Panelde yürüdükçe haritadaki ok da yürür ve bakılan yöne döner.
    const sync = async () => {
      try {
        const pos = await mlyViewer.getPosition();
        const bearing = await mlyViewer.getBearing();
        streetMarker.setLngLat([pos.lng, pos.lat]).setRotation(bearing).addTo(map);
      } catch {}
    };
    mlyViewer.on('position', sync);
    mlyViewer.on('bearing', sync);
    mlyViewer.on('image', sync);
  } else {
    mlyViewer.moveTo(imageId).catch(() => showStreetMsg(T.streetNone));
  }
  setTimeout(() => mlyViewer?.resize(), 50);
}

// ---------------- Yardımcılar ----------------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const cat = (e) => CATS[e.cat] || CATS.news;
const iconOf = (e) => DISASTER_ICONS[e.sub] || cat(e).icon;
const colorOf = (e) => ALERT_COLORS[e.alert] || cat(e).color;
const icoHtml = (e) => `<div class="ico" style="background:${colorOf(e)}"><i class="ti ti-${iconOf(e)}"></i></div>`;
// Haber resimleri ücretsiz images.weserv.nl üzerinden küçültülür (1–2 MB'lık fotoğraf → birkaç KB).
// Küçültme servisi açamazsa orijinal resim denenir, o da olmazsa resim kaldırılır.
const IMG_SIZE = { thumb: [168, 128], 'info-img': [700, 360] };
function imgHtml(src, cls) {
  const [w, h] = IMG_SIZE[cls] || [400, 300];
  const small = /^https?:\/\//.test(src) ? `https://images.weserv.nl/?url=${encodeURIComponent(src)}&w=${w}&h=${h}&fit=cover&output=webp&q=70` : src;
  return `<img class="${cls}" src="${esc(small)}" data-orig="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"
    onerror="if(this.dataset.orig&&this.src!==this.dataset.orig){this.src=this.dataset.orig}else{this.remove()}">`;
}
const newsLangOf = (e) => (NEWS_LANGS.includes(e.lang) ? e.lang : 'other');

function placeName(e) {
  const names = e.pid != null ? PLACES[e.pid] : null;
  if (!names) return e.place || '';
  return names[PLACE_INDEX[state.lang]] || names[1] || names[0];
}

function ago(t) {
  const m = Math.round((Date.now() - t) / 60e3);
  if (m < 1) return T.now;
  if (m < 60) return T.min(m);
  const h = Math.floor(m / 60);
  if (h < 24) return T.hour(h);
  // Bir haftadan eski haberlerde (İmralı arşivi) tarih yazılır.
  return h < 24 * 7 ? T.day(Math.floor(h / 24)) : dateText(t);
}

// Tarayıcılar Kürtçe ay adlarını bilmediği için Kurmancî ve Soranî'de ay adları i18n.js'den gelir.
function dateText(t) {
  const d = new Date(t);
  if (T.months) return `${d.getDate()} ${T.months[d.getMonth()]} ${d.getFullYear()}`;
  try { return new Intl.DateTimeFormat(T.locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(d); }
  catch { return d.toLocaleDateString(); }
}

// Fırlatmalar ileri tarihli: "2 gün 5 saat sonra" gibi geri sayım gösterilir.
function untilText(t) {
  const m = Math.max(0, Math.round((t - Date.now()) / 60e3));
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60);
  return T.inTime(d ? `${d} ${T.dayWord} ${h} ${T.hourWord}` : h ? `${h} ${T.hourWord} ${m % 60} ${T.minWord}` : `${m} ${T.minWord}`);
}
const whenOf = (e) => (e.cat === 'launch' ? (e.t > Date.now() ? untilText(e.t) : T.launched) : ago(e.t));
const catLabel = (e) => (e.cat === 'disaster' ? `${T.subs[e.sub] || T.cats.disaster} · ${T.alerts[e.alert] || ''}` : T.cats[e.cat] || '');

// Başlık seçili dilde: haberin kendi dili buysa özgün başlık, değilse hazır çeviri, o da yoksa özgün başlık.
const isTranslated = (e) => e.lang !== state.lang && !!e.tt?.[state.lang];
const titleOf = (e) => (isTranslated(e) ? e.tt[state.lang] : e.title);
const origNote = (e) => (isTranslated(e) ? T.orig(T.langs[newsLangOf(e)] || '') : '');

// Hazır çevirisi olmayan başlıklar ve haber metinleri ziyaretçinin tarayıcısında seçili dile çevrilir
// (Google Çeviri'nin ücretsiz, anahtarsız ucu; veri betiğindeki çeviriyle aynı). Her metin bir kez denenir.
// Çeviri olmazsa özgün metin görünür ve haber kartında "Çevir" bağlantısı kalır.
const textOf = (e) => (e.lang !== state.lang && e.ttx?.[state.lang]) || e.text || '';
const GT_CODE = { he: 'iw' };
const trTried = new Set();
let shownNow = [], trPauseUntil = 0;
const AUTO_TR = 30;
const needsTr = (e) => e.title && e.cat !== 'launch' && e.kind !== 'usgs' && e.lang !== state.lang && !e.tt?.[state.lang];
// Haberin altındaki "Çevir" düğmesi: başlığı (varsa metni de) yeni sekme açmadan, olduğu yerde çevirir.
async function translateOne(e, btn) {
  const tl = state.lang;
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const out = await gtranslate([e.title.replace(/\s+/g, ' ')], e.lang, tl);
    if (!out?.[0]) throw new Error('boş');
    (e.tt ||= {})[tl] = out[0];
    if (state.lang === tl) { tickerKey = ''; render(); if (infoOpenFor === e.id) openInfo(e); }
  } catch {
    // Çeviri şu an alınamıyorsa Google Çeviri sayfası yeni sekmede açılır.
    window.open(`https://translate.google.com/?sl=auto&tl=${tl}&text=${encodeURIComponent(e.title)}&op=translate`, '_blank', 'noopener');
    btn.disabled = false;
    btn.textContent = T.translate;
  }
}
let trBusy = false;
async function gtranslate(lines, sl, tl) {
  const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${GT_CODE[sl] || sl || 'auto'}&tl=${tl}`, {
    method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
    body: 'q=' + encodeURIComponent(lines.join('\n')),
  });
  if (!res.ok) throw new Error(res.status);
  const all = (await res.json())[0].map((x) => x[0]).join('');
  if (lines.length === 1) return [all.replace(/\s*\n\s*/g, ' ').trim()]; // tek satır: araya giren satır sonu önemsiz
  const out = all.split('\n').map((x) => x.trim());
  return out.length === lines.length ? out : null;
}
async function fillTranslations(list) {
  const tl = state.lang;
  if (trBusy || Date.now() < trPauseUntil) return;
  // Kendiliğinden sadece listenin başındaki haberler çevrilir (Google'ın ücretsiz ucunu yormamak için);
  // geri kalanlar haberin altındaki "Çevir" düğmesiyle, olduğu yerde çevrilir.
  const todo = shownNow.slice(0, AUTO_TR).filter(needsTr).filter((e) => !trTried.has(`${tl}|${e.id}`));
  if (!todo.length) return;
  trBusy = true;
  for (const e of todo) trTried.add(`${tl}|${e.id}`);
  // Aynı dildeki başlıklar gruplar halinde (en çok 40 satır); dili bilinmeyenler tek tek.
  const groups = new Map();
  for (const e of todo) { const k = e.lang || `?${e.id}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(e); }
  let changed = false, failed = false;
  // Çeviri satır sayısını tutturamazsa (bazen iki başlığı birleştiriyor) grup ikiye bölünüp yeniden denenir.
  const run = async (part) => {
    const out = await gtranslate(part.map((e) => e.title.replace(/\s+/g, ' ')), part[0].lang, tl);
    await new Promise((r) => setTimeout(r, 300)); // ücretsiz uç çok sık istekte geçici olarak engelliyor
    if (state.lang !== tl) return;
    if (out) part.forEach((e, k) => { if (out[k]) { (e.tt ||= {})[tl] = out[k]; changed = true; } });
    else if (part.length > 1) { const h = Math.ceil(part.length / 2); await run(part.slice(0, h)); await run(part.slice(h)); }
  };
  try {
    for (const items of groups.values()) {
      for (let i = 0; i < items.length; i += 40) await run(items.slice(i, i + 40));
      if (state.lang !== tl) return;
    }
  } catch {
    // Geçici hata (bağlantı, çok sık istek): çevrilemeyenler yarım dakika sonra yeniden denenir.
    failed = true;
    trPauseUntil = Date.now() + 29e3;
    for (const e of todo) if (!e.tt?.[tl]) trTried.delete(`${tl}|${e.id}`);
    setTimeout(() => fillTranslations(filtered()), 30e3);
  } finally {
    trBusy = false;
    // Bu arada dil değiştiyse yeni dilin çevirisi hemen başlar.
    if (state.lang !== tl) {
      for (const e of todo) if (!e.tt?.[tl]) trTried.delete(`${tl}|${e.id}`); // yarım kalanlar o dile dönülünce çevrilir
      fillTranslations(filtered());
    }
    else if (changed) { tickerKey = ''; render(); }
    else if (!failed) fillTranslations(filtered()); // sıradaki grup (hata olduysa yarım dakika beklenir)
  }
}
async function translateInfo(e) {
  const tl = state.lang;
  if (!e.text || e.lang === tl || e.ttx?.[tl]) return;
  try {
    const out = await gtranslate([e.text.replace(/\s+/g, ' ').slice(0, 1500)], e.lang, tl);
    if (!out?.[0] || state.lang !== tl) return;
    (e.ttx ||= {})[tl] = out[0];
    const p = infoOpenFor === e.id && document.querySelector('#infoBody .info-text');
    if (p) p.textContent = out[0].slice(0, 600) + (out[0].length > 600 ? '…' : '');
  } catch { /* özgün metin kalır */ }
}

function translateLink(e) {
  if (e.lang === state.lang || isTranslated(e) || e.cat === 'launch') return '';
  const url = `https://translate.google.com/?sl=auto&tl=${state.lang}&text=${encodeURIComponent(e.title)}&op=translate`;
  return `<a href="${esc(url)}" target="_blank" rel="noopener">${T.translate}</a>`;
}

function sourceLink(e) {
  return e.url ? `<a href="${esc(e.url)}" target="_blank" rel="noopener">${esc(e.src || T.source)}</a>` : esc(e.src || '');
}

// ---------------- Bilgi paneli ----------------

let infoOpenFor = null;
function infoHtml(e) {
  return `${e.img ? imgHtml(e.img, 'info-img') : ''}
    <div class="info-cat">${icoHtml(e)}<span>${esc(catLabel(e))}</span></div>
    <h3 class="info-title" dir="auto">${esc(titleOf(e))}</h3>
    ${isTranslated(e) ? `<div class="info-orig" dir="auto"><b>${esc(origNote(e))}:</b> ${esc(e.title)}</div>` : ''}
    ${e.text ? `<p class="info-text" dir="auto">${esc(textOf(e).slice(0, 600))}${textOf(e).length > 600 ? '…' : ''}</p>` : ''}
    <dl class="info-facts">
      <dt><i class="ti ti-map-pin"></i></dt><dd>${esc(placeName(e))}</dd>
      <dt><i class="ti ti-clock"></i></dt><dd>${whenOf(e)}</dd>
      <dt><i class="ti ti-world"></i></dt><dd>${sourceLink(e)}${translateLink(e) ? ' · ' + translateLink(e) : ''}</dd>
      <dt><i class="ti ti-gps"></i></dt><dd>${e.lat.toFixed(3)}°, ${e.lon.toFixed(3)}°</dd>
    </dl>
    ${e.url ? `<a class="info-open" href="${esc(e.url)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> ${T.source}</a>` : ''}
    ${e.kind === 'usgs' && e.url ? `<a class="info-open felt-btn" href="${esc(e.url)}/tellus" target="_blank" rel="noopener"><i class="ti ti-hand-stop"></i> ${esc(T.x.felt)}</a>${e.felt ? `<p class="fin-note">${esc(T.x.feltN(e.felt))}</p>` : ''}` : ''}
    ${sourcesHtml(e)}
    ${shareHtml(e)}`;
}

// Kaynağın türü: resmî, Kürt medyası, bağımsız, ana akım, uluslararası.
const typeTag = (st) => (st && T.srcTypes[st] ? ` <span class="st st-${st}">${esc(T.srcTypes[st])}</span>` : '');
const moreSources = (e) => (e.also?.length ? `<span class="more-src" title="${esc(e.also.map((s) => s.src).join(', '))}"><i class="ti ti-stack-2"></i>${esc(T.sources(e.also.length + 1))}</span>` : '');
// Aynı olayı bildiren bütün kaynaklar, bağlantıları ve türleriyle.
function sourcesHtml(e) {
  if (!e.also?.length) return '';
  const all = [{ src: e.src, url: e.url, st: e.st }, ...e.also];
  return `<div class="info-sources"><b><i class="ti ti-stack-2"></i> ${esc(T.sources(all.length))}</b>
    <ul>${all.map((s) => `<li>${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener" dir="auto">${esc(s.src)}</a>` : esc(s.src)}${typeTag(s.st)}</li>`).join('')}</ul></div>`;
}
// Paylaşma: her haberin kendi bağlantısı (?event=…) WhatsApp, Telegram, X ile ya da kopyalanarak paylaşılır.
function shareHtml(e) {
  const link = `${location.origin}${location.pathname}?event=${encodeURIComponent(e.id)}&lang=${state.lang}`;
  const text = titleOf(e), u = encodeURIComponent(link), t = encodeURIComponent(text);
  const a = (href, icon, name) => `<a href="${href}" target="_blank" rel="noopener" title="${name}"><i class="ti ti-${icon}"></i></a>`;
  return `<div class="share"><span>${esc(T.share)}</span>
    ${a(`https://wa.me/?text=${encodeURIComponent(`${text} ${link}`)}`, 'brand-whatsapp', 'WhatsApp')}
    ${a(`https://t.me/share/url?url=${u}&text=${t}`, 'brand-telegram', 'Telegram')}
    ${a(`https://twitter.com/intent/tweet?url=${u}&text=${t}`, 'brand-x', 'X')}
    <button type="button" data-copy="${esc(link)}" title="${esc(T.copyLink)}"><i class="ti ti-link"></i></button>
    ${navigator.share ? `<button type="button" data-native="${esc(link)}" title="${esc(T.share)}"><i class="ti ti-share"></i></button>` : ''}</div>`;
}
$('infoBody').addEventListener('click', async (ev) => {
  const copy = ev.target.closest('[data-copy]');
  const native = ev.target.closest('[data-native]');
  if (copy) {
    try { await navigator.clipboard.writeText(copy.dataset.copy); copy.classList.add('done'); copy.title = T.copied; } catch {}
  } else if (native) {
    try { await navigator.share({ title: document.title, text: $('infoBody').querySelector('.info-title')?.textContent || '', url: native.dataset.native }); } catch {}
  }
});
function issHtml() {
  if (!iss) return T.cats.iss;
  return `<div class="info-cat"><div class="ico" style="background:${ISS_CAT.color}"><i class="ti ti-satellite"></i></div><span>${T.cats.iss}</span></div>
    <dl class="info-facts">
      <dt><i class="ti ti-arrow-up"></i></dt><dd>${T.altitude}: ${Math.round(iss.altitude)} km</dd>
      <dt><i class="ti ti-gauge"></i></dt><dd>${T.speed}: ${Math.round(iss.velocity).toLocaleString(T.locale)} km/h</dd>
      <dt><i class="ti ti-gps"></i></dt><dd>${iss.latitude.toFixed(2)}°, ${iss.longitude.toFixed(2)}°</dd>
    </dl>`;
}
function satHtml(s) {
  return `<div class="info-cat"><div class="ico" style="background:${SAT_COLORS[s.group] || SAT_CAT.color}"><i class="ti ti-satellite"></i></div><span>${esc(T.satGroups[s.group] || T.cats.sats)}</span></div>
    <h3 class="info-title" dir="ltr">${esc(s.name)}</h3>
    <dl class="info-facts">
      <dt><i class="ti ti-hash"></i></dt><dd>NORAD ${esc(s.norad)}</dd>
      <dt><i class="ti ti-arrow-up"></i></dt><dd>${T.altitude}: ${Math.round(s.alt ?? 0).toLocaleString(T.locale)} km</dd>
      <dt><i class="ti ti-gauge"></i></dt><dd>${T.speed}: ${Math.round(s.vel ?? 0).toLocaleString(T.locale)} km/h</dd>
      <dt><i class="ti ti-gps"></i></dt><dd>${(s.lat ?? 0).toFixed(2)}°, ${(s.lon ?? 0).toFixed(2)}°</dd>
    </dl>
    <a class="info-open" href="https://celestrak.org/satcat/table-satcat.php?CATNR=${esc(s.norad)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i> CelesTrak</a>`;
}
// İmralı yer iminin listesi: arşivdeki en yeni haberler (48 saatten eski olsalar da).
function imraliHtml() {
  return `<div class="info-cat"><div class="ico imrali-ico"><i class="ti ti-bookmark"></i></div><span>${esc(T.imraliNews)}</span></div>
    <ol class="imrali-list">${state.imrali.slice(0, 15).map((e) => `<li>
      <a href="${esc(e.url)}" target="_blank" rel="noopener" dir="auto">${esc(titleOf(e))}</a>
      <small>${whenOf(e)}${e.src ? ' · ' + esc(e.src) : ''}</small></li>`).join('')}</ol>
    <p class="imrali-more">${esc(T.imraliMore)}</p>`;
}
function openInfo(target) {
  if (!target) return;
  stopTv();
  $('infoPanel').classList.toggle('page-mode', !!PAGES[target]);
  if (PAGES[target]) {
    infoOpenFor = target;
    drawRoute(null, null);
    $('infoTitle').textContent = PAGES[target].title();
    $('infoPanel').classList.remove('air-mode');
    $('infoBody').innerHTML = PAGES[target].html();
    $('infoPanel').hidden = false;
    $('infoPanel').classList.remove('collapsed');
    // Telefonda haber akışı kapanır; sayfa (TV, Hakkında…) ekranın tamamını kullanır.
    if (isMobile()) setSheet('closed');
    markNav();
    PAGES[target].opened?.();
    renderFinanceBar();
    return;
  }
  if (target === 'imrali') {
    infoOpenFor = 'imrali';
    drawRoute(null, null);
    $('infoTitle').textContent = T.regions.imrali;
    $('infoPanel').classList.remove('air-mode');
    $('infoBody').innerHTML = imraliHtml();
    $('infoPanel').hidden = false;
    $('infoPanel').classList.remove('collapsed');
    return;
  }
  infoOpenFor = target === 'iss' ? 'iss' : target.rec ? `sat:${target.norad}` : target.air ? `air:${target.air.h}` : target.id;
  $('infoTitle').textContent = T.details;
  if (!target.air) drawRoute(null, null);
  $('infoPanel').classList.toggle('air-mode', !!target.air);
  $('infoBody').innerHTML = target === 'iss' ? issHtml() : target.rec ? satHtml(target) : target.air ? airHtml(target.air, target.info) : infoHtml(target);
  if (target !== 'iss' && !target.rec && !target.air) translateInfo(target);
  const panel = $('infoPanel');
  panel.hidden = false;
  panel.classList.remove('collapsed');
  renderFinanceBar();
}
function closeInfo() {
  drawRoute(null, null);
  $('infoPanel').hidden = true;
  setMaxed($('infoPanel'), false);
  stopTv();
  $('infoBody').innerHTML = '';
  infoOpenFor = null;
  setActive(null);
  renderFinanceBar();
  markNav();
}

// ---------------- Finans: canlı kurlar ----------------
// Fiyatları ziyaretçinin tarayıcısı doğrudan çeker. Dolar, euro ve sterlin CoinGecko'daki Tether (USDT)
// fiyatından hesaplanır (piyasayı dakikalık izler, resmî kur değildir); altın ve Brent Binance vadelisinden gelir.
// open.er-api yedek kurdur; Irak, İran ve Suriye parası da oradan gelir (günde bir güncellenir).
const FIN_POLL = 60000, FIN_RATES_POLL = 3600000, GRAMS_PER_OUNCE = 31.1035;
const FIN_GROUPS = [['fx', ['usd', 'eur', 'gbp', 'eurusd']], ['metals', ['gold', 'brent']], ['crypto', ['btc', 'eth']], ['regional', ['iqd', 'irr', 'syp']]];
const fin = { q: {}, updated: 0, ratesAt: 0, rates: null };
const fetchJson = (url) => fetch(url, { signal: AbortSignal.timeout(12000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);

async function loadFinance() {
  if (document.hidden && fin.updated) return;
  const stale = Date.now() - fin.ratesAt > FIN_RATES_POLL;
  const [cg, gold, brent, rates] = await Promise.all([
    fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=tether,tether-gold,bitcoin,ethereum&vs_currencies=try,usd,eur,gbp&include_24hr_change=true'),
    fetchJson('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=XAUUSDT'),
    fetchJson('https://fapi.binance.com/fapi/v1/ticker/24hr?symbol=BZUSDT'),
    stale ? fetchJson('https://open.er-api.com/v6/latest/USD') : null,
  ]);
  if (rates?.rates) { fin.rates = rates.rates; fin.ratesAt = Date.now(); }
  const r = fin.rates || {}, q = {};
  const t = cg?.tether;
  // Tether'in TL fiyatı ile X para birimi fiyatının oranı, X'in TL karşılığını verir.
  const cross = (cur) => (t?.[cur] ? { v: t.try / t[cur], ch: t.try_24h_change - t[`${cur}_24h_change`] } : r[cur.toUpperCase()] && r.TRY ? { v: r.TRY / r[cur.toUpperCase()] } : null);
  q.usd = cross('usd');
  q.eur = cross('eur');
  q.gbp = cross('gbp');
  if (t?.eur) q.eurusd = { v: t.usd / t.eur, ch: t.usd_24h_change - t.eur_24h_change };
  else if (r.EUR) q.eurusd = { v: 1 / r.EUR };
  const ounce = +gold?.lastPrice || cg?.['tether-gold']?.usd;
  if (ounce && q.usd) q.gold = { v: (ounce * q.usd.v) / GRAMS_PER_OUNCE, ch: gold ? +gold.priceChangePercent : cg['tether-gold'].try_24h_change };
  if (brent?.lastPrice) q.brent = { v: +brent.lastPrice, ch: +brent.priceChangePercent };
  if (cg?.bitcoin) q.btc = { v: cg.bitcoin.usd, ch: cg.bitcoin.usd_24h_change };
  if (cg?.ethereum) q.eth = { v: cg.ethereum.usd, ch: cg.ethereum.usd_24h_change };
  for (const k of ['iqd', 'irr', 'syp']) if (r[k.toUpperCase()]) q[k] = { v: r[k.toUpperCase()] };
  // Bir kaynak geçici olarak yanıt vermezse son bilinen fiyat ekranda kalır.
  fin.q = { ...fin.q, ...Object.fromEntries(Object.entries(q).filter(([, x]) => x)) };
  if (cg || gold || brent || rates) fin.updated = Date.now();
  renderFinanceBar();
  if (infoOpenFor === 'finance') $('infoBody').innerHTML = financeHtml();
}

const FIN_UNIT = { usd: '₺', eur: '₺', gbp: '₺', gold: '₺', brent: '$', btc: '$', eth: '$' };
function finValue(k) {
  const { v } = fin.q[k];
  const digits = k === 'eurusd' ? 4 : k === 'btc' || k === 'irr' || k === 'iqd' ? 0 : 2;
  return `${v.toLocaleString(T.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits })}${FIN_UNIT[k] ? ` ${FIN_UNIT[k]}` : ''}`;
}
function finChange(k) {
  const { ch } = fin.q[k];
  if (ch == null || !Number.isFinite(ch)) return '';
  const up = ch >= 0;
  return `<span class="fin-ch ${up ? 'up' : 'down'}"><i class="ti ti-chevron-${up ? 'up' : 'down'}"></i>${Math.abs(ch).toLocaleString(T.locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%</span>`;
}
function financeHtml() {
  if (!fin.updated) return `<p class="fin-note">${esc(T.fin.error)}</p>`;
  const groups = FIN_GROUPS.map(([g, keys]) => {
    const rows = keys.filter((k) => fin.q[k]).map((k) => `<tr><th scope="row">${esc(T.fin.items[k])}</th><td>${finValue(k)}</td><td>${finChange(k)}</td></tr>`).join('');
    return rows ? `<h4 class="fin-group">${esc(T.fin.groups[g])}</h4><table class="fin-table"><tbody>${rows}</tbody></table>` : '';
  }).join('');
  const time = new Date(fin.updated).toLocaleTimeString(T.locale, { hour: '2-digit', minute: '2-digit' });
  return `${groups}<p class="fin-note">${esc(T.fin.updated)}: ${time}. ${esc(T.fin.note)}</p>`;
}
// Üst çubuk: Finans sekmesinin yanında dolar ve euro hep görünür.
function renderFinanceBar() {
  for (const b of document.querySelectorAll('[data-page]')) b.classList.toggle('active', infoOpenFor === b.dataset.page);
  $('notifyBtn').querySelector('i').className = `ti ti-bell${notify.on ? '-ringing' : ''}`;
  const el = $('finTicker');
  const keys = ['usd', 'eur', 'gold'].filter((k) => fin.q[k]);
  el.hidden = !keys.length;
  el.innerHTML = keys.map((k) => `<span class="fin-item"><b>${esc(T.fin.items[k])}</b> ${finValue(k)} ${finChange(k)}</span>`).join('');
  fitFinanceBar();
}
// Tek fiyat bile sığmıyorsa yarım görünmesin.
function fitFinanceBar() {
  const el = $('finTicker');
  el.style.visibility = el.scrollWidth > el.clientWidth ? 'hidden' : '';
}
addEventListener('resize', fitFinanceBar);
function togglePage(name) {
  if (infoOpenFor === name) closeInfo();
  else openInfo(name);
}

// ---------------- Canlı TV ----------------
// Kanalların kendi doğrudan yayınları (HLS) sitenin oynatıcısında açılır; YouTube'un "bot" engeline takılmaz.
const TV_CHANNELS = {
  ku: [['Kurdistan24', 'https://hlspackager.akamaized.net/live/DB/K24/HLS/K24.m3u8'], ['Kurdsat News', 'https://hlspackager.akamaized.net/live/DB/KURDSAT_NEWS/HLS/KURDSAT_NEWS.m3u8'],
    ['Ronahî TV', 'https://hlspackager.akamaized.net/live/DB/RONAHI_TV/HLS/RONAHI_TV.m3u8'], ['Stêrk TV', 'https://hlspackager.akamaized.net/live/DB/STERK_TV/HLS/STERK_TV.m3u8'],
    ['Waar TV', 'https://hlspackager.akamaized.net/live/DB/WAAR_HD/HLS/WAAR_HD.m3u8'], ['Zagros TV', 'https://hlspackager.akamaized.net/live/DB/ZAGROS_TV/HLS/ZAGROS_TV.m3u8']],
  tr: [['Medya Haber', 'https://hlspackager.akamaized.net/live/DB/MEDYA_HABER/HLS/MEDYA_HABER.m3u8'], ['NTV', 'https://dogus.daioncdn.net/ntv/ntv.m3u8?app=ntv_web'], ['Halk TV', 'https://halktv-live.daioncdn.net/halktv/halktv.m3u8'], ['Tele1', 'https://tele1-live.ercdn.net/tele1/tele1.m3u8']],
  ar: [['Al Jazeera', 'https://live-hls-apps-aja-fa.getaj.net/AJA/index.m3u8'], ['Al Arabiya', 'https://live.alarabiya.net/alarabiapublish/alarabiya.smil/playlist.m3u8'], ['Al Hadath', 'https://live.alarabiya.net/alarabiapublish/alhadath.smil/playlist.m3u8'],
    ['Sky News Arabia', 'https://stream.skynewsarabia.com/hls/sna.m3u8'], ['Asharq News', 'https://live-news.asharq.com/asharq.m3u8'], ['France 24', 'https://live.france24.com/hls/live/2037222/F24_AR_HI_HLS/master_2300.m3u8']],
  fa: [['Iran International', 'https://hlspackager.akamaized.net/live/DB/IRAN_INTERNATIONAL/HLS/IRAN_INTERNATIONAL.m3u8'], ['BBC Persian', 'https://vs-hls-pushb-ww-live.akamaized.net/x=4/i=urn:bbc:pips:service:bbc_persian_tv/pc_hd_abr_v2.m3u8']],
  en: [['Al Jazeera', 'https://live-hls-apps-aje-fa.getaj.net/AJE/index.m3u8'], ['TRT World', 'https://tv-trtworld.medya.trt.com.tr/master.m3u8'], ['France 24', 'https://live.france24.com/hls/live/2037218/F24_EN_HI_HLS/master_2300.m3u8'], ['DW News', 'https://dwamdstream102.akamaized.net/hls/live/2015525/dwstream102/master.m3u8'], ['Euronews', 'https://cdn-euronews.akamaized.net/live/eds/euronews-en/25002/index.m3u8']],
};
const TV_DEFAULT = { tr: 'tr', ku: 'ku', ckb: 'ku', ar: 'ar', en: 'en' };
let tvChannel = null, tvPlayer = null;
function stopTv() {
  tvPlayer?.destroy();
  tvPlayer = null;
}
// hls.js sadece TV ilk açıldığında yüklenir; Safari HLS'i kendisi oynatır.
function loadHls() {
  if (window.Hls) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js';
    el.onload = resolve;
    el.onerror = reject;
    document.head.appendChild(el);
  });
}
async function playTv() {
  stopTv();
  const box = $('tvBox'), url = tvChannel;
  const fail = () => { if (tvChannel === url && $('tvBox')) { stopTv(); $('tvBox').innerHTML = `<div class="tv-frame tv-fail">${esc(T.x.tvFail)}</div>`; } };
  box.innerHTML = '<div class="tv-frame"><video controls muted autoplay playsinline></video></div>';
  const video = box.querySelector('video');
  video.addEventListener('error', fail);
  try { await loadHls(); } catch { fail(); return; }
  if (tvChannel !== url || !video.isConnected) return;
  if (window.Hls.isSupported()) {
    tvPlayer = new window.Hls({ maxBufferLength: 20 });
    tvPlayer.on(window.Hls.Events.ERROR, (e, d) => { if (d.fatal) fail(); });
    tvPlayer.loadSource(url);
    tvPlayer.attachMedia(video);
  } else video.src = url;
  video.play().catch(() => {});
}
function tvHtml() {
  tvChannel ||= TV_CHANNELS[TV_DEFAULT[state.lang]][0][1];
  return `<div id="tvBox"></div>
    <p class="fin-note">${esc(T.x.tvNote)}</p>
    ${Object.entries(TV_CHANNELS).map(([g, list]) => `<h4 class="fin-group">${esc(T.x.tvGroups[g])}</h4><div class="tv-list">${list.map(([name, url]) =>
      `<button type="button" data-tv="${esc(url)}" class="${url === tvChannel ? 'active' : ''}">${esc(name)}</button>`).join('')}</div>`).join('')}`;
}

// ---------------- Haftalık özet ----------------
let weekly = null;
const WEEK_REGIONS = ['kurdistan', 'tr', 'sy', 'iq', 'ir', 'il'];
function weekHtml() {
  if (!weekly) return `<p class="fin-note">${esc(T.loading || '…')}</p>`;
  const keys = Object.keys(weekly.days || {}).sort().slice(-7);
  if (!keys.length) return `<p class="fin-note">${esc(T.x.weekEmpty)}</p>`;
  const days = keys.map((k) => [k, weekly.days[k]]);
  const max = Math.max(1, ...days.map(([, d]) => d.conflict));
  const sum = (k, f) => days.reduce((n, [, d]) => n + (d.regions[k]?.[f] || 0), 0);
  const num = (n) => n.toLocaleString(T.locale);
  const dayName = (k) => new Date(`${k}T12:00:00Z`).toLocaleDateString(T.locale, { weekday: 'short', day: 'numeric' });
  const top = days.flatMap(([, d]) => d.top).sort((a, b) => b.w - a.w).slice(0, 8);
  const link = `${location.origin}${location.pathname}?page=week&lang=${state.lang}`;
  return `<h4 class="fin-group">${esc(T.x.weekDays)}</h4>
    <div class="week-bars">${days.map(([k, d]) => `<div class="week-bar" title="${esc(dayName(k))}: ${num(d.conflict)}"><b>${num(d.conflict)}</b><span style="height:${Math.max(2, (d.conflict / max) * 64)}px"></span><small>${esc(dayName(k))}</small></div>`).join('')}</div>
    <h4 class="fin-group">${esc(T.x.weekRegions)}</h4>
    <table class="fin-table"><thead><tr>${T.x.weekCol.map((c, i) => (i ? `<td class="week-head">${esc(c)}</td>` : `<th class="week-head">${esc(c)}</th>`)).join('')}</tr></thead>
      <tbody>${WEEK_REGIONS.map((k) => `<tr><th scope="row">${esc(T.regions[k])}</th><td>${num(sum(k, 'total'))}</td><td>${num(sum(k, 'conflict'))}</td></tr>`).join('')}</tbody></table>
    <h4 class="fin-group">${esc(T.x.weekTop)}</h4>
    <ol class="imrali-list">${top.map((e) => `<li><a href="${esc(e.url || '#')}" target="_blank" rel="noopener" dir="auto">${esc(e.title)}</a><small>${esc(e.src || '')}</small></li>`).join('')}</ol>
    <p class="fin-note">${esc(T.x.weekNote(keys.length))}</p>
    <div class="share"><span>${esc(T.share)}</span><button type="button" data-copy="${esc(link)}" title="${esc(T.copyLink)}"><i class="ti ti-link"></i></button></div>`;
}
async function weekOpened() {
  if (weekly) return;
  weekly = (await loadJson('data/weekly.json')) || { days: {} };
  if (infoOpenFor === 'week') $('infoBody').innerHTML = weekHtml();
}

// ---------------- Bildirimler ----------------
// Tarayıcı bildirimi: yeni olay geldiğinde, seçilen bölge ve türe uyuyorsa gösterilir.
// GerdûnNews sunucusu (CONFIG.API) ve VAPID anahtarı varsa tarayıcı ona abone olur: bildirim site kapalıyken de gelir
// (gönderen: scripts/push.mjs). Yoksa sadece site bir sekmede açıkken çalışır.
const NOTIFY_REGIONS = ['kurdistan', 'imrali', 'tr', 'sy', 'iq', 'ir', 'il'];
const NOTIFY_GROUPS = { conflict: ['attack', 'airstrike', 'bombing', 'artillery', 'clash', 'massviolence'], quake: ['earthquake'], disaster: ['disaster'] };
const NOTIFY_MAX = 3; // bir güncellemede en çok bu kadar bildirim
const notify = (() => {
  const base = { on: false, regions: ['kurdistan', 'imrali'], groups: ['conflict', 'quake', 'disaster'] };
  try { return { ...base, ...JSON.parse(localStorage.getItem('notify') || '{}') }; } catch { return base; }
})();
const saveNotify = () => { try { localStorage.setItem('notify', JSON.stringify(notify)); } catch {} };
function notifyHtml() {
  const check = (attr, k, on, label) => `<label class="check"><input type="checkbox" ${attr}="${k}" ${on ? 'checked' : ''}> <span>${esc(label)}</span></label>`;
  const denied = 'Notification' in window && Notification.permission === 'denied';
  return `<button type="button" class="notify-toggle ${notify.on ? 'on' : ''}" data-nact="toggle"><i class="ti ti-bell${notify.on ? '-ringing' : ''}"></i> ${esc(notify.on ? T.x.nOff : T.x.nOn)}</button>
    ${denied ? `<p class="fin-note">${esc(T.x.nDenied)}</p>` : ''}
    <h4 class="fin-group">${esc(T.x.nRegions)}</h4>${NOTIFY_REGIONS.map((k) => check('data-nreg', k, notify.regions.includes(k), T.regions[k])).join('')}
    <h4 class="fin-group">${esc(T.x.nTypes)}</h4>${Object.keys(NOTIFY_GROUPS).map((k) => check('data-ngrp', k, notify.groups.includes(k), T.x.nGroups[k])).join('')}
    <p class="fin-note">${esc(notify.on && notify.push ? T.x.nPush : T.x.nNote)}</p>`;
}
const PUSH_KEY = (window.CONFIG?.VAPID_PUBLIC_KEY || '').trim();
// Hizmet çalışanı (sw.js) sadece https'te kaydedilir; bildirim aboneliği de ona bağlıdır.
const pushReady = () => !!(AIR_API && PUSH_KEY && location.protocol === 'https:' && 'PushManager' in window && navigator.serviceWorker);
const b64ToBytes = (s) => Uint8Array.from(atob((s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const pushPost = (route, body) => fetch(`${AIR_API}/push/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
// Aboneliği sunucuya yazar; tercih veya dil değişince, ayrıca her açılışta tekrar gönderilir.
async function syncPush() {
  if (!notify.on || !pushReady()) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(PUSH_KEY) });
    const res = await pushPost('subscribe', { sub: sub.toJSON(), regions: notify.regions, groups: notify.groups, lang: state.lang });
    return res.ok;
  } catch (err) {
    console.warn('Bildirim aboneliği yapılamadı:', err);
    return false;
  }
}
async function stopPush() {
  if (!pushReady()) return;
  try {
    const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription();
    if (!sub) return;
    await pushPost('unsubscribe', { endpoint: sub.endpoint }).catch(() => {});
    await sub.unsubscribe();
  } catch {}
}
async function showNotice(title, body, url, tag) {
  const opts = { body, tag, data: { url } };
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => null);
  if (reg) reg.showNotification(title, opts);
  else new Notification(title, opts).onclick = () => window.open(url);
}
const inShape = (ring, x, y) => {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
function notifyMatches(e) {
  if (!notify.groups.some((g) => NOTIFY_GROUPS[g].includes(e.cat))) return false;
  return notify.regions.some((k) => k !== 'imrali' && (REGION_SHAPES[k] || []).some((ring) => inShape(ring, e.lon, e.lat)));
}
function notifyNew(events, imraliItems) {
  // Sunucudan bildirim geliyorsa sekmedeki kopyası gösterilmez.
  if (notify.push || !notify.on || !('Notification' in window) || Notification.permission !== 'granted') return;
  const hits = [...(notify.regions.includes('imrali') ? imraliItems : []), ...events.filter(notifyMatches)];
  const link = (e) => `${location.origin}${location.pathname}?event=${encodeURIComponent(e.id)}&lang=${state.lang}`;
  for (const e of hits.slice(0, NOTIFY_MAX)) showNotice(BRAND, titleOf(e), link(e), e.id);
}
$('infoBody').addEventListener('change', (ev) => {
  const reg = ev.target.dataset.nreg, grp = ev.target.dataset.ngrp;
  if (!reg && !grp) return;
  const list = reg ? notify.regions : notify.groups, k = reg || grp;
  if (ev.target.checked) list.push(k);
  else list.splice(list.indexOf(k), 1);
  saveNotify();
  syncPush();
});
$('infoBody').addEventListener('click', async (ev) => {
  const tv = ev.target.closest('[data-tv]');
  if (tv) {
    tvChannel = tv.dataset.tv;
    playTv();
    for (const b of document.querySelectorAll('[data-tv]')) b.classList.toggle('active', b === tv);
    return;
  }
  if (!ev.target.closest('[data-nact="toggle"]')) return;
  if (notify.on) {
    notify.on = notify.push = false;
    stopPush();
  } else if ('Notification' in window && (await Notification.requestPermission()) === 'granted') {
    notify.on = true;
    notify.push = await syncPush();
    showNotice(T.x.nTest, T.x.nTestBody, location.href, 'notify-on');
  }
  saveNotify();
  openInfo('notify');
});

// Hakkında: sitenin ne olduğu, haberlerin nasıl okunacağı, kaynaklar ve gizlilik. İletişim adresi CONFIG.CONTACT'tan gelir.
function aboutHtml() {
  const contact = (window.CONFIG?.CONTACT || '').trim();
  return T.about.s.map(([h, p]) => `<h4 class="fin-group">${esc(h)}</h4><p class="about-text">${esc(p)}</p>`).join('')
    + (contact ? `<p class="about-text"><i class="ti ti-mail"></i> <a href="mailto:${esc(contact)}">${esc(contact)}</a></p>` : '')
    // Telefonda haritadaki kaynak yazısı (i) gizli; aynı yazı burada gösterilir.
    + (isMobile() ? `<h4 class="fin-group">${esc(T.m.sources)}</h4><p class="about-text map-sources">${document.querySelector('.maplibregl-ctrl-attrib-inner')?.innerHTML || ''}</p>` : '');
}

const PAGES = {
  about: { title: () => T.about.title, html: aboutHtml },
  finance: { title: () => T.fin.title, html: financeHtml },
  tv: { title: () => T.x.tv, html: tvHtml, opened: playTv },
  week: { title: () => T.x.week, html: weekHtml, opened: weekOpened },
  notify: { title: () => T.x.notify, html: notifyHtml },
  weather: { title: () => T.m.weather, html: weatherHtml, opened: weatherOpened },
};

// ---------------- Hava durumu ve hava kirliliği ----------------
// Open-Meteo (anahtarsız): bölgedeki büyük şehirlerin sıcaklığı, gökyüzü ve Avrupa hava kalitesi endeksi. Katman açılınca yüklenir.
const WX_CAT = { icon: 'cloud', color: '#1c7ed6' };
const OUT_CAT = { icon: 'wifi-off', color: '#c92a2a' };
const WX_CITIES = [[37.91, 40.23], [41.01, 28.97], [39.93, 32.86], [38.42, 27.14], [36.89, 30.71], [37, 35.32], [37.07, 37.38], [38.5, 43.38], [39.9, 41.27], [41, 39.72],
  [36.19, 44.01], [35.56, 45.44], [36.87, 43], [35.47, 44.39], [36.34, 43.13], [33.31, 44.37], [30.51, 47.78], [37.05, 41.22], [36.89, 38.35], [36.2, 37.16], [33.51, 36.29],
  [33.89, 35.5], [31.77, 35.21], [31.95, 35.93], [24.71, 46.68], [29.38, 47.99], [35.69, 51.39], [37.55, 45.07], [35.31, 47], [34.31, 47.07], [38.08, 46.29], [32.65, 51.67], [29.59, 52.58], [30.04, 31.24]];
const wxIcon = (c) => (c <= 1 ? 'sun-high' : c <= 3 ? 'cloud' : c <= 48 ? 'cloud-fog' : c >= 95 ? 'cloud-storm' : (c >= 71 && c <= 77) || c === 85 || c === 86 ? 'cloud-snow' : 'cloud-rain');
const aqLevel = (v) => [20, 40, 60, 80, 100].findIndex((x) => v <= x);
const AQ_COLORS = ['#2f9e44', '#74b816', '#f08c00', '#e8590c', '#c92a2a', '#7b1fa2'];
let wxMarkers = [], wxAt = 0, wxData = null;
function drawWeather() {
  for (const m of wxMarkers) m.remove();
  wxMarkers = [];
  if (state.off.has('weather') || !wxData) return;
  wxMarkers = wxData.map(([lat, lon, w, a]) => {
    const lv = a ? (aqLevel(a.european_aqi) + 6) % 6 : -1;
    const text = `${T.x.wxWind}: ${Math.round(w.wind_speed_10m)} km/h${a ? ` · ${T.x.wxAir}: ${a.european_aqi} (${T.x.wxAq[lv]}) · PM2.5: ${a.pm2_5}` : ''}`;
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'wx-chip';
    el.title = text;
    el.innerHTML = `<i class="ti ti-${wxIcon(w.weather_code)}"></i><b>${Math.round(w.temperature_2m)}°</b>${a ? `<span style="background:${AQ_COLORS[lv]}"></span>` : ''}`;
    el.addEventListener('click', (ev) => { ev.stopPropagation(); new maplibregl.Popup({ offset: 14 }).setLngLat([lon, lat]).setText(text).addTo(map); });
    return new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
  });
}
async function updateWeather() {
  if (state.off.has('weather')) { drawWeather(); return; }
  if (Date.now() - wxAt > 1800e3) {
    const lat = WX_CITIES.map((c) => c[0]).join(), lon = WX_CITIES.map((c) => c[1]).join();
    const [w, a] = await Promise.all([
      fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m`),
      fetchJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=european_aqi,pm2_5`),
    ]);
    if (w) { wxData = WX_CITIES.map(([la, lo], i) => [la, lo, w[i].current, a?.[i]?.current]); wxAt = Date.now(); }
  }
  drawWeather();
}

// ---------------- Hava durumu sayfası ----------------
// Şehir şehir anlık hava: Open-Meteo (anahtarsız; ölçüm 15 dakikada bir yenilenir), sayfa açıkken 10 dakikada bir sorulur.
// Üstte Windy'nin canlı rüzgâr / yağmur haritası (ücretsiz gömme, anahtar gerekmez). Şehre dokununca Windy ve harita oraya gider.
// Ad sırası: [tr, en, ku, ckb, ar, enlem, boylam]. Kürdistan her zaman ilk grup.
const WX_GROUPS = {
  kurdistan: [['Diyarbakır', 'Diyarbakir', 'Amed', 'ئامەد', 'ديار بكر', 37.91, 40.23], ['Erbil', 'Erbil', 'Hewlêr', 'هەولێر', 'أربيل', 36.19, 44.01],
    ['Süleymaniye', 'Sulaymaniyah', 'Silêmanî', 'سلێمانی', 'السليمانية', 35.56, 45.44], ['Duhok', 'Duhok', 'Duhok', 'دهۆک', 'دهوك', 36.87, 43],
    ['Kerkük', 'Kirkuk', 'Kerkûk', 'کەرکووک', 'كركوك', 35.47, 44.39], ['Kamışlı', 'Qamishli', 'Qamişlo', 'قامیشلۆ', 'القامشلي', 37.05, 41.22],
    ['Kobani', 'Kobani', 'Kobanê', 'کۆبانێ', 'كوباني', 36.89, 38.35], ['Haseke', 'Hasakah', 'Hesekê', 'حەسەکە', 'الحسكة', 36.5, 40.75],
    ['Van', 'Van', 'Wan', 'وان', 'وان', 38.5, 43.38], ['Urfa', 'Urfa', 'Riha', 'ڕەها', 'أورفة', 37.16, 38.79],
    ['Mardin', 'Mardin', 'Mêrdîn', 'مێردین', 'ماردين', 37.31, 40.74], ['Hakkari', 'Hakkari', 'Colemêrg', 'جۆلەمێرگ', 'هكاري', 37.57, 43.74],
    ['Dersim', 'Dersim', 'Dêrsim', 'دێرسیم', 'ديرسم', 39.11, 39.55], ['Mahabad', 'Mahabad', 'Mehabad', 'مەهاباد', 'مهاباد', 36.76, 45.72],
    ['Urmiye', 'Urmia', 'Ûrmiye', 'ورمێ', 'أرومية', 37.55, 45.07], ['Sine', 'Sanandaj', 'Sine', 'سنە', 'سنندج', 35.31, 47],
    ['Kirmanşah', 'Kermanshah', 'Kirmaşan', 'کرماشان', 'كرمانشاه', 34.31, 47.07]],
  tr: [['İstanbul', 'Istanbul', 'Stenbol', 'ئەستەنبوڵ', 'إسطنبول', 41.01, 28.97], ['Ankara', 'Ankara', 'Enqere', 'ئەنقەرە', 'أنقرة', 39.93, 32.86],
    ['İzmir', 'Izmir', 'Îzmîr', 'ئیزمیر', 'إزمير', 38.42, 27.14], ['Antalya', 'Antalya', 'Antalya', 'ئەنتاڵیا', 'أنطاليا', 36.89, 30.71],
    ['Adana', 'Adana', 'Edene', 'ئەدەنە', 'أضنة', 37, 35.32], ['Gaziantep', 'Gaziantep', 'Dîlok', 'دیلۆک', 'غازي عنتاب', 37.07, 37.38],
    ['Erzurum', 'Erzurum', 'Erzirom', 'ئەرزەڕۆم', 'أرضروم', 39.9, 41.27], ['Trabzon', 'Trabzon', 'Trabzon', 'ترابزۆن', 'طرابزون', 41, 39.72]],
  sy: [['Şam', 'Damascus', 'Şam', 'دیمەشق', 'دمشق', 33.51, 36.29], ['Halep', 'Aleppo', 'Heleb', 'حەلەب', 'حلب', 36.2, 37.16],
    ['Humus', 'Homs', 'Hims', 'حومس', 'حمص', 34.73, 36.72], ['Lazkiye', 'Latakia', 'Lazqiye', 'لازقیە', 'اللاذقية', 35.52, 35.79],
    ['Rakka', 'Raqqa', 'Reqa', 'ڕەققە', 'الرقة', 35.95, 39.01], ['Deyrizor', 'Deir ez-Zor', 'Dêrezor', 'دێرەزوور', 'دير الزور', 35.33, 40.14]],
  iq: [['Bağdat', 'Baghdad', 'Bexda', 'بەغدا', 'بغداد', 33.31, 44.37], ['Musul', 'Mosul', 'Mûsil', 'موسڵ', 'الموصل', 36.34, 43.13],
    ['Basra', 'Basra', 'Besra', 'بەسرە', 'البصرة', 30.51, 47.78], ['Necef', 'Najaf', 'Necef', 'نەجەف', 'النجف', 32, 44.33]],
  ir: [['Tahran', 'Tehran', 'Tehran', 'تاران', 'طهران', 35.69, 51.39], ['Tebriz', 'Tabriz', 'Tebrîz', 'تەورێز', 'تبريز', 38.08, 46.29],
    ['İsfahan', 'Isfahan', 'Isfahan', 'ئەسفەهان', 'أصفهان', 32.65, 51.67], ['Şiraz', 'Shiraz', 'Şîraz', 'شیراز', 'شيراز', 29.59, 52.58],
    ['Meşhed', 'Mashhad', 'Meşhed', 'مەشهەد', 'مشهد', 36.3, 59.6]],
  il: [['Kudüs', 'Jerusalem', 'Qudis', 'قودس', 'القدس', 31.77, 35.21], ['Tel Aviv', 'Tel Aviv', 'Tel Avîv', 'تەل ئەڤیڤ', 'تل أبيب', 32.08, 34.78],
    ['Gazze', 'Gaza', 'Xeze', 'غەززە', 'غزة', 31.5, 34.47]],
};
const WX_NAME = { tr: 0, en: 1, ku: 2, ckb: 3, ar: 4 };
const WX_COUNTRIES = new Set(['TR', 'IQ', 'SY', 'IR', 'IL', 'PS', 'LB', 'JO', 'AM', 'AZ', 'GE', 'CY', 'SA', 'KW', 'EG']);
let wxNow = null, wxNowAt = 0, wxPoint = [36.5, 42, 5], wxTimer = null, wxQuery = '', wxFound = [], wxSearchTimer = null;
// Aramada büyük/küçük harf ve şapka/nokta farkı sayılmaz (Erzurum = erzurum, Êlih = elih).
const wxNorm = (t) => String(t).toLocaleLowerCase('tr').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ı/g, 'i');
const wxMatch = (c) => !wxQuery || c.slice(0, 5).some((n) => n && wxNorm(n).includes(wxQuery));
const windySrc = ([lat, lon, zoom]) => `https://embed.windy.com/embed.html?type=map&location=coordinates&metricRain=mm&metricTemp=%C2%B0C&metricWind=km%2Fh&zoom=${zoom}&overlay=wind&product=ecmwf&level=surface&lat=${lat}&lon=${lon}&marker=true`;
function weatherHtml() {
  return `<div id="wxPage" class="wx-page"><div class="feed-search wx-search"><i class="ti ti-search"></i><input id="wxSearch" type="search" autocomplete="off" placeholder="${esc(T.m.wx.search)}" value="${esc(wxQuery)}"></div>
    <p class="about-text wx-note">${esc(T.m.wx.windy)}</p><iframe id="wxWindy" class="wx-windy" src="${windySrc(wxPoint)}" loading="lazy" title="Windy" allowfullscreen></iframe>
    <p id="wxStamp" class="about-text wx-note"></p><div id="wxCities"></div></div>`;
}
function renderWxCities() {
  if (infoOpenFor !== 'weather' || !$('wxCities')) return;
  const i = WX_NAME[state.lang] ?? 1, wx = T.m.wx;
  // Arama yapılırken sonuçlar arama kutusunun hemen altına gelir (Windy haritasının üstüne).
  $('wxPage').classList.toggle('searching', !!wxQuery);
  $('wxStamp').textContent = wx.pick + (wxNowAt ? ` · ${wx.upd}: ${new Date(wxNowAt).toLocaleTimeString(T.locale, { hour: '2-digit', minute: '2-digit' })}` : '');
  const card = (name, lat, lon, w, data, sub = '') => `<button type="button" class="wx-city${wxPoint[0] === lat && wxPoint[1] === lon ? ' active' : ''}" ${data}><span class="wx-name" dir="auto">${esc(name)}${sub ? ` <em>${esc(sub)}</em>` : ''}</span>${w
      ? `<i class="ti ti-${wxIcon(w.weather_code)}"></i><b>${Math.round(w.temperature_2m)}°</b><small>${esc(wx.feels)} ${Math.round(w.apparent_temperature)}° · ${Math.round(w.wind_speed_10m)} km/h · ${esc(wx.hum)} %${w.relative_humidity_2m}${w.precipitation ? ` · ${esc(wx.rain)} ${w.precipitation} mm` : ''}</small>`
      : '<small>…</small>'}</button>`;
  const groups = Object.entries(WX_GROUPS).map(([g, cities]) => {
    const shown = cities.map((c, n) => [c, n]).filter(([c]) => wxMatch(c));
    return shown.length ? `<h4 class="fin-group">${esc(T.regions[g])}</h4><div class="wx-list">${shown.map(([c, n]) =>
      card(c[i] || c[1], c[5], c[6], wxNow?.[g]?.[n], `data-g="${g}" data-n="${n}"`)).join('')}</div>` : '';
  }).join('');
  const other = wxQuery && wxFound.length ? `<h4 class="fin-group">${esc(wx.other)}</h4><div class="wx-list">${wxFound.map((p, k) =>
    card(p.name, p.lat, p.lon, p.w, `data-found="${k}"`, [p.admin, p.country].filter(Boolean).join(', '))).join('')}</div>` : '';
  $('wxCities').innerHTML = groups + other || `<p class="about-text wx-note">${esc(wxQuery.length < 2 ? '…' : wx.none)}</p>`;
}
async function loadWxNow() {
  if (Date.now() - wxNowAt < 600e3) return;
  const all = Object.entries(WX_GROUPS).flatMap(([g, cs]) => cs.map((c, n) => [g, n, c]));
  const r = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${all.map((x) => x[2][5]).join()}&longitude=${all.map((x) => x[2][6]).join()}`
    + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation');
  if (!Array.isArray(r)) return;
  wxNow = {};
  all.forEach(([g, n], k) => { (wxNow[g] ||= [])[n] = r[k]?.current; });
  wxNowAt = Date.now();
}
async function weatherOpened() {
  renderWxCities();
  await loadWxNow();
  renderWxCities();
  clearInterval(wxTimer);
  wxTimer = setInterval(async () => {
    if (infoOpenFor !== 'weather') { clearInterval(wxTimer); return; }
    await loadWxNow();
    renderWxCities();
  }, 600e3);
}
async function searchWxPlaces(q) {
  const lang = ['tr', 'en', 'ar'].includes(state.lang) ? state.lang : 'en';
  const geo = await fetchJson(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=${lang}&format=json`);
  if (wxNorm(q) !== wxQuery) return;
  const ours = Object.values(WX_GROUPS).flat();
  // Bölgedeki ülkeler önce: oradan sonuç varsa uzak ülkelerdeki benzer adlar gösterilmez. Aynı yer iki kez çıkmaz.
  const near = (p) => WX_COUNTRIES.has(p.country_code);
  // Sadece yerleşim yerleri (havalimanı, dağ vb. değil). Listemizde eşleşen şehir varsa uzak ülkeler hiç gösterilmez.
  let found = (geo?.results || []).filter((p) => /^(PPL|ADM)/.test(p.feature_code || 'PPL')
    && !ours.some((c) => Math.abs(c[5] - p.latitude) < 0.15 && Math.abs(c[6] - p.longitude) < 0.15));
  if (found.some(near) || ours.some(wxMatch)) found = found.filter(near);
  const seen = new Set();
  const list = found.map((p) => ({ name: p.name, admin: p.admin1 !== p.name ? p.admin1 : '', country: p.country, lat: +p.latitude.toFixed(2), lon: +p.longitude.toFixed(2) }))
    .filter((p) => { const k = `${Math.round(p.lat * 10)},${Math.round(p.lon * 10)}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 5);
  if (list.length) {
    const w = await fetchJson(`https://api.open-meteo.com/v1/forecast?latitude=${list.map((p) => p.lat).join()}&longitude=${list.map((p) => p.lon).join()}`
      + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation');
    const arr = Array.isArray(w) ? w : [w];
    list.forEach((p, k) => { p.w = arr[k]?.current; });
  }
  if (wxNorm(q) !== wxQuery) return;
  wxFound = list;
  renderWxCities();
}
document.addEventListener('input', (ev) => {
  if (ev.target.id !== 'wxSearch') return;
  wxQuery = wxNorm(ev.target.value.trim());
  wxFound = [];
  renderWxCities();
  clearTimeout(wxSearchTimer);
  if (wxQuery.length >= 2) wxSearchTimer = setTimeout(() => searchWxPlaces(ev.target.value.trim()), 400);
});
// Enter: ilk sonuca gider.
document.addEventListener('keydown', (ev) => {
  if (ev.target.id === 'wxSearch' && ev.key === 'Enter') { ev.preventDefault(); document.querySelector('#wxCities .wx-city')?.click(); }
});
function wxGoTo(lat, lon) {
  wxPoint = [lat, lon, 8];
  $('wxWindy').src = windySrc(wxPoint);
  renderWxCities();
  map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 7), duration: 1200 });
  $('wxWindy').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
document.addEventListener('click', (ev) => {
  const b = ev.target.closest('.wx-city');
  if (!b) return;
  if (b.dataset.found != null) { const p = wxFound[+b.dataset.found]; if (p) wxGoTo(p.lat, p.lon); return; }
  const c = WX_GROUPS[b.dataset.g][+b.dataset.n];
  wxGoTo(c[5], c[6]);
});

// ---------------- İnternet kesintileri ----------------
// IODA (Georgia Tech, anahtarsız): son 24 saatte ülke çapında internet kesintisi algılanan ülkeler. Elektrik kesintisi verisi içermez.
const OUT_COUNTRIES = { TR: [39, 35], IQ: [33, 43.7], IR: [32.5, 54], SY: [35, 38.5], LB: [33.9, 35.9], IL: [31.5, 34.9], PS: [31.9, 35.25], JO: [31.2, 36.6], SA: [24, 45], YE: [15.6, 48], EG: [26.5, 30], AZ: [40.3, 47.7], AM: [40.3, 44.9], GE: [42.2, 43.5], KW: [29.3, 47.6], AF: [33.8, 66] };
let outMarkers = [], outAt = 0, outList = [];
function drawOutages() {
  for (const m of outMarkers) m.remove();
  outMarkers = [];
  if (state.off.has('outages')) return;
  outMarkers = outList.map((o) => {
    const el = document.createElement('a');
    el.className = 'out-chip';
    el.href = `https://ioda.inetintel.cc.gatech.edu/country/${o.code}`;
    el.target = '_blank';
    el.rel = 'noopener';
    el.title = `${T.x.outTitle} · ${T.x.outSince}: ${new Date(o.start * 1000).toLocaleString(T.locale, { dateStyle: 'short', timeStyle: 'short' })}`;
    el.innerHTML = '<i class="ti ti-wifi-off"></i>';
    const [lat, lon] = OUT_COUNTRIES[o.code];
    return new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
  });
}
async function updateOutages() {
  if (!state.off.has('outages') && Date.now() - outAt > 600e3) {
    const now = Math.floor(Date.now() / 1000);
    const res = await fetchJson(`https://api.ioda.inetintel.cc.gatech.edu/v2/outages/events?entityType=country&from=${now - 86400}&until=${now}&limit=300`);
    if (res?.data) {
      const best = new Map();
      for (const e of res.data) {
        const code = e.location?.split('/')[1];
        if (OUT_COUNTRIES[code] && e.start + e.duration > now - 86400 && !(best.get(code)?.start > e.start)) best.set(code, { code, start: e.start });
      }
      outList = [...best.values()];
      outAt = Date.now();
      renderLayers();
    }
  }
  drawOutages();
}

// Bir olayı seç: haritada işaretle, bilgi panelini aç, listede göster; istenirse haritayı oraya götür.
function select(e, fly) {
  setActive(e.id);
  openInfo(e);
  // Telefonda listeden seçilen haber haritada görünsün diye akış kapanır.
  if (fly && isMobile()) setSheet('closed');
  if (fly) map.flyTo({ center: [e.lon, e.lat], zoom: Math.max(map.getZoom(), 9), duration: 1200 });
}
function setActive(id) {
  state.activeId = id;
  if (mapReady) map.setFilter('active', ['==', ['get', 'id'], id || '']);
  document.querySelectorAll('.item.active').forEach((el) => el.classList.remove('active'));
  const el = id && document.querySelector(`.item[data-id="${CSS.escape(id)}"]`);
  if (el) { el.classList.add('active'); el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
}

// ---------------- Sürüklenebilir paneller ----------------
// Başlıktan tutup taşınır, kenara yaklaşınca kenara yapışır, katlanır; yerleri tarayıcıda hatırlanır.

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

function placePanel(panel, left, top) {
  const box = panel.parentElement.getBoundingClientRect();
  const w = panel.offsetWidth, h = panel.querySelector('.panel-head').offsetHeight;
  const SNAP = 16, M = 8;
  left = Math.min(Math.max(left, M), box.width - w - M);
  top = Math.min(Math.max(top, M), box.height - h - M);
  if (left < SNAP + M) left = M;
  if (box.width - (left + w) < SNAP + M) left = box.width - w - M;
  if (top < SNAP + M) top = M;
  panel.style.inset = 'auto';
  panel.style.left = `${left}px`;
  panel.style.top = `${top}px`;
}

function makePanel(panel) {
  const head = panel.querySelector('.panel-head');
  const saved = store.get(`panel:${panel.id}`);
  if (saved?.collapsed) panel.classList.add('collapsed');
  const restore = () => { if (saved?.left != null && !panel.hidden) placePanel(panel, saved.left, saved.top); };
  new MutationObserver(restore).observe(panel, { attributes: true, attributeFilter: ['hidden'] });

  head.addEventListener('pointerdown', (ev) => {
    if (ev.target.closest('.panel-btn')) return;
    const start = panel.getBoundingClientRect();
    const box = panel.parentElement.getBoundingClientRect();
    const dx = ev.clientX - start.left, dy = ev.clientY - start.top;
    head.setPointerCapture(ev.pointerId);
    panel.classList.add('dragging');
    const move = (m) => placePanel(panel, m.clientX - box.left - dx, m.clientY - box.top - dy);
    const up = () => {
      head.removeEventListener('pointermove', move);
      head.removeEventListener('pointerup', up);
      panel.classList.remove('dragging');
      const r = panel.getBoundingClientRect();
      store.set(`panel:${panel.id}`, { left: r.left - box.left, top: r.top - box.top, collapsed: panel.classList.contains('collapsed') });
    };
    head.addEventListener('pointermove', move);
    head.addEventListener('pointerup', up);
  });

  head.addEventListener('click', (ev) => {
    const act = ev.target.closest('.panel-btn')?.dataset.act;
    if (act === 'collapse') {
      panel.classList.toggle('collapsed');
      store.set(`panel:${panel.id}`, { ...(store.get(`panel:${panel.id}`) || {}), collapsed: panel.classList.contains('collapsed') });
    }
    if (act === 'max') setMaxed(panel, !panel.classList.contains('maxed'));
    if (act === 'close') panel.id === 'infoPanel' ? closeInfo() : panel.id === 'streetPanel' ? closeStreet() : togglePanel('layers');
  });
}

// Tam ekran: panel harita alanının tamamını kaplar; düğme simgesi küçült olur. Küçültülmüşse önce açılır.
function setMaxed(panel, on) {
  panel.classList.toggle('maxed', on);
  if (on) panel.classList.remove('collapsed');
  const i = panel.querySelector('[data-act="max"] i');
  if (i) i.className = on ? 'ti ti-minimize' : 'ti ti-maximize';
}

function resetPanels() {
  for (const p of document.querySelectorAll('.panel')) {
    store.del(`panel:${p.id}`);
    p.removeAttribute('style');
    p.classList.remove('collapsed');
  }
}

// ---------------- Özet şeridi ----------------
// Haritanın üstünde son 24 saatin sayaçları: "14 saldırı · 3 çatışma · 2 deprem". Tıklayınca o tür süzülür.
const SUMMARY = {
  attack: ['airstrike', 'bombing', 'artillery', 'attack', 'massviolence'], clash: ['clash'], security: ['security', 'military'],
  protest: ['protest'], quake: ['earthquake'], disaster: ['disaster'],
};
const SUMMARY_ICONS = { attack: 'crosshair', clash: 'swords', security: 'shield-lock', protest: 'speakerphone', quake: 'activity', disaster: 'alert-triangle' };
function renderSummary() {
  const el = $('summary');
  if (state.region === 'imrali') { el.hidden = true; return; }
  const since = (state.updated || Date.now()) - 24 * 3600e3;
  const reg = activeRegion();
  const counts = {};
  for (const e of state.events) {
    if (e.t < since || e.dupOf || (reg && !inRegionShape(e, reg))) continue;
    for (const [g, cats] of Object.entries(SUMMARY)) if (cats.includes(e.cat)) counts[g] = (counts[g] || 0) + 1;
  }
  const groups = Object.keys(SUMMARY).filter((g) => counts[g]);
  el.hidden = !groups.length;
  el.innerHTML = `<span class="sum-title">${esc(T.last24)}</span>` + groups.map((g) =>
    `<button type="button" data-sum="${g}" class="${state.sumFilter === g ? 'active' : ''}"><i class="ti ti-${SUMMARY_ICONS[g]}"></i><b>${counts[g].toLocaleString(T.locale)}</b> ${esc(T.sum[g])}</button>`).join('');
}
$('summary').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-sum]');
  if (!b) return;
  state.sumFilter = state.sumFilter === b.dataset.sum ? null : b.dataset.sum;
  // Sayaçlar son 24 saati gösterir: süzülünce liste de en az 24 saati kapsasın.
  if (state.sumFilter && state.hours < 24) { state.hours = 24; renderPanels(); }
  render();
});

// ---------------- Zaman kaydırıcısı ----------------
// Son 48 saati haritada oynatmak: kaydırıcı bir ana gelir, harita o andan geriye seçili saat aralığını gösterir.
let tlTimer = 0;
const tlSpan = () => { const end = state.updated || Date.now(); return [end - 48 * 3600e3, end]; };
function toggleTimeline(on = $('timeline').hidden) {
  $('timeline').hidden = !on;
  $('timeBtn')?.classList.toggle('active', on);
  if (!on) setTimeAt(null);
  else renderTimeline();
}
function setTimeAt(t) {
  state.timeAt = t;
  renderTimeline();
  render();
}
function renderTimeline() {
  const [a, b] = tlSpan();
  const t = state.timeAt ?? b;
  $('tlRange').value = Math.round(((t - a) / (b - a)) * 1000);
  $('tlLabel').textContent = state.timeAt == null ? T.liveNow : dateTimeText(t);
  $('tlLive').classList.toggle('active', state.timeAt == null);
  $('tlPlay').innerHTML = `<i class="ti ti-${tlTimer ? 'player-pause' : 'player-play'}"></i>`;
}
// Oynat: 48 saat yaklaşık 24 saniyede geçer; sona gelince canlıya döner.
function playTimeline() {
  if (tlTimer) { clearInterval(tlTimer); tlTimer = 0; renderTimeline(); return; }
  const [a, b] = tlSpan();
  let t = state.timeAt == null || state.timeAt >= b ? a : state.timeAt;
  tlTimer = setInterval(() => {
    t += 20 * 60e3;
    if (t >= b) { clearInterval(tlTimer); tlTimer = 0; setTimeAt(null); return; }
    setTimeAt(t);
  }, 170);
  renderTimeline();
}
$('tlRange').addEventListener('input', (ev) => {
  const [a, b] = tlSpan();
  const v = +ev.target.value;
  setTimeAt(v >= 1000 ? null : a + ((b - a) * v) / 1000);
});
$('tlPlay').addEventListener('click', playTimeline);
$('tlLive').addEventListener('click', () => { clearInterval(tlTimer); tlTimer = 0; setTimeAt(null); });

// ---------------- Filtreler ve liste ----------------

// Zaman aralığı son veri güncellemesine göre hesaplanır; veri eskiyse harita yine boş kalmaz.
function sinceMs() {
  return (state.updated || Date.now()) - state.hours * 3600e3;
}

function inRange() {
  // Zaman kaydırıcısı kullanılıyorsa (state.timeAt) pencere o ana göre kayar; yoksa son veri güncellemesine göre.
  const end = state.timeAt ?? Infinity;
  const since = state.timeAt != null ? state.timeAt - state.hours * 3600e3 : sinceMs();
  return state.events.filter((e) => e.t >= since && e.t <= end);
}

function filtered() {
  const q = state.q.toLowerCase();
  const found = (e) => !q || `${e.title} ${titleOf(e)} ${e.text || ''} ${placeName(e)} ${e.place || ''} ${e.src || ''}`.toLowerCase().includes(q);
  // İmralı: zaman aralığına bağlı olmayan arşiv; son 48 saatte haber olmasa da en son haberler görünür.
  if (state.region === 'imrali') return state.imrali.filter(found);
  const reg = activeRegion();
  const sum = state.sumFilter && SUMMARY[state.sumFilter];
  const list = inRange().filter((e) => !state.off.has(e.cat) && TOPICS[state.topic](e) && (!sum || sum.includes(e.cat)) &&
    (!reg || e.cat === 'launch' || inRegionShape(e, reg)) && found(e));
  // Aynı olayı anlatan diğer haberler: öncü haber listedeyse gizlenir, onun kartında "N kaynak" yazar.
  const ids = new Set(list.map((e) => e.id));
  return list.filter((e) => !e.dupOf || !ids.has(e.dupOf));
}

function renderTopics() {
  $('topics').innerHTML = Object.keys(TOPICS).map((k) =>
    `<button class="${state.topic === k ? 'active' : ''}" data-topic="${k}">${T.topics[k]}</button>`).join('');
}

// Katmanlar paneli: her kategori için açma/kapama kutusu ve olay sayısı.
function renderLayers() {
  const counts = {};
  for (const e of inRange()) counts[e.cat] = (counts[e.cat] || 0) + 1;
  const row = (k, c, n) =>
    `<label class="layer"><input type="checkbox" data-cat="${k}" ${state.off.has(k) ? '' : 'checked'}>
      <span class="ico sm" style="background:${c.color}"><i class="ti ti-${c.icon}"></i></span>${T.cats[k]}<span class="n">${n}</span></label>`;
  let satCount = 0, starlinkCount = 0;
  for (const s of sats.values()) s.group === 'starlink' ? starlinkCount++ : satCount++;
  $('chips').innerHTML = Object.entries(CATS).filter(([k]) => counts[k]).map(([k, c]) => row(k, c, counts[k])).join('') +
    row('night', NIGHT_CAT, '') + row('heat', HEAT_CAT, '') + row('weather', WX_CAT, '') + row('outages', OUT_CAT, state.off.has('outages') ? '' : outList.length) + row('iss', ISS_CAT, '') + row('sats', SAT_CAT, satCount || '') + row('starlink', STARLINK_CAT, starlinkCount || '') +
    (AIR_API ? row('aircraft', AIR_CAT, [...aircraft.values()].filter((a) => !a.mil).length || '') +
      row('mil', MIL_CAT, [...aircraft.values()].filter((a) => a.mil).length || '') : '');
}

function renderList(list) {
  const b = mapReady ? map.getBounds() : null;
  // Fırlatmalar dünyanın her yerinde ve ileri tarihli: sadece "Uzay" konusunda, en yakını üstte listelenir.
  const shown = state.topic === 'space'
    ? list.slice().sort((x, y) => x.t - y.t)
    : list.filter((e) => e.cat !== 'launch' && (!state.inView || !b || state.region === 'imrali' || b.contains([e.lon, e.lat])));
  $('status').textContent = [
    T.listed(shown.length),
    state.updated ? `${T.updated}: ${ago(state.updated)}` : T.noData,
    state.fresh ? T.fresh(state.fresh) : '',
  ].filter(Boolean).join(' · ');
  shownNow = shown.slice(0, 400);
  $('list').innerHTML = shownNow.map((e) => `
    <li class="item ${e.id === state.activeId ? 'active' : ''} ${e.isNew ? 'new' : ''}" data-id="${esc(e.id)}">
      <div class="head">
        ${icoHtml(e)}
        <span class="when">${whenOf(e)}</span>
        ${moreSources(e)}
        ${e.url ? `<a class="src" href="${esc(e.url)}" target="_blank" rel="noopener"><i class="ti ti-external-link"></i>${T.source}</a>` : ''}
      </div>
      <div class="row">
        <div class="title" dir="auto" ${isTranslated(e) ? `title="${esc(e.title)}"` : ''}>${e.isNew ? `<span class="badge">${T.badge}</span>` : ''}${esc(titleOf(e))}</div>
        ${e.img ? imgHtml(e.img, 'thumb') : ''}
      </div>
      <div class="meta">${esc(placeName(e))} · ${esc(e.src || '')}${typeTag(e.st)}${e.cat === 'disaster' ? ' · ' + esc(catLabel(e)) : ''}${origNote(e) ? ' · ' + esc(origNote(e)) : ''}${needsTr(e) ? ` <button type="button" class="tr-btn" data-tr="${esc(e.id)}"><i class="ti ti-language"></i>${esc(T.translate)}</button>` : ''}</div>
    </li>`).join('');
}

// ---------------- Son dakika şeridi ----------------
// Sayfanın altında en yeni haberler sağdan sola kayar; fare üzerine gelince durur, tıklanınca haberin kendisi açılır.
let tickerKey = '';
function renderTicker(list) {
  const items = list.filter((e) => e.cat !== 'launch' && e.url && e.kind !== 'usgs').slice(0, 30);
  const key = state.lang + items.map((e) => e.id).join(',');
  if (key === tickerKey) return;
  tickerKey = key;
  const html = items.map((e) => `<a class="tick" href="${esc(e.url)}" target="_blank" rel="noopener">
      <span class="dot" style="background:${colorOf(e)}"></span><span class="when">${whenOf(e)}</span>
      <span dir="auto">${esc(titleOf(e))}</span><span class="where">${esc(placeName(e))}</span></a>`).join('');
  const track = $('tickerTrack');
  // İçerik iki kez yazılır: ilk kopya bitince ikincisi devraldığı için şerit kesintisiz döner.
  track.innerHTML = html + html;
  const width = track.scrollWidth / 2;
  track.style.animationDuration = `${Math.max(40, width / 70)}s`; // yaklaşık saniyede 70 piksel
}

function render() {
  const list = filtered();
  renderLayers();
  renderSummary();
  // İmralı'da ada güneş gibi parlasın diye haberler haritada işaretlenmez; liste ve yer imi gösterir.
  renderMarkers(state.region === 'imrali' ? [] : list);
  renderList(list);
  renderTicker(list);
  fillTranslations(list);
  if (infoOpenFor === 'imrali') openInfo('imrali');
  if (infoOpenFor === 'finance') openInfo('finance');
  else if (infoOpenFor && infoOpenFor !== 'iss' && byId.has(infoOpenFor)) openInfo(byId.get(infoOpenFor));
}

function renderRegions() {
  $('regions').innerHTML = REGION_TABS.map((k) =>
    `<button class="region ${state.region === k ? 'active' : ''}" data-region="${k}">${T.regions[k]}</button>`).join('')
    + [['tv', 'device-tv', T.x.tv], ['week', 'calendar-week', T.x.week], ['weather', 'cloud', T.m.weather]].map(([p, icon, label]) =>
      `<button class="region fin-btn" type="button" data-page="${p}"><i class="ti ti-${icon}"></i>${esc(label)}</button>`).join('');
  renderFinanceBar();
}

// Sağ sütundaki Dil / Zaman sekmeleri ve harita üstündeki Katmanlar paneli.
function togglePanel(name) {
  state.panel = state.panel === name ? null : name;
  $('langPanel').hidden = state.panel !== 'lang';
  $('timePanel').hidden = state.panel !== 'time';
  $('layersPanel').hidden = state.panel !== 'layers';
  $('layersBtn')?.classList.toggle('active', state.panel === 'layers');
  for (const b of document.querySelectorAll('.ftab')) b.classList.toggle('active', (b.dataset.panel || null) === state.panel);
}

function renderPanels() {
  $('uiLangs').innerHTML = Object.entries(I18N).map(([k, v]) =>
    `<button data-lang="${k}" class="${k === state.lang ? 'active' : ''}">${v.name}</button>`).join('');
  $('ranges').innerHTML = [1, 6, 24, 48].map((h) =>
    `<button data-hours="${h}" class="${h === state.hours ? 'active' : ''}">${T.range(h)}</button>`).join('');
}

// Arayüz dilini uygula: metinler, yön (sağdan sola), tarih, harita adları.
function applyLanguage() {
  T = I18N[state.lang];
  const root = document.documentElement;
  root.lang = state.lang;
  root.dir = T.dir;
  document.title = `${BRAND} · ${T.title}`;
  $('brandText').innerHTML = '<span class="brand-a">Gerdûn</span><span class="brand-b">News</span>';
  $('search').placeholder = T.search;
  $('today').textContent = dateText(Date.now());
  for (const [id, key] of [['tabFeed', 'feed'], ['tabLang', 'lang'], ['tabTime', 'time'], ['tabLayers', 'layers']]) {
    $(id).querySelector('span').textContent = T.tabs[key];
  }
  $('layersTitle').textContent = T.tabs.layers;
  $('infoTitle').textContent = T.details;
  $('layersBtn')?.setAttribute('title', T.tabs.layers);
  $('resetPanelsBtn')?.setAttribute('title', T.resetPanels);
  $('basemapBtn')?.setAttribute('title', T.basemap);
  $('streetBtn')?.setAttribute('title', T.street);
  $('spaceBtn')?.setAttribute('title', T.space);
  $('timeBtn')?.setAttribute('title', T.timeline);
  $('themeBtn').setAttribute('title', T.theme);
  $('tlLive').textContent = T.liveNow;
  renderTimeline();
  space?.setSpaceLang(state.lang);
  $('streetTitle').textContent = T.street;
  renderBasemaps();
  $('inViewLabel').textContent = T.inView;
  renderRegions();
  renderPanels();
  renderMobile();
  renderTopics();
  applyMapLanguage();
  drawRegion();
  $('tickerLabel').textContent = T.breaking;
  tickerKey = '';
  render();
}

// ---------------- Veri ----------------

async function loadJson(url) {
  try {
    const r = await fetch(`${url}?v=${Date.now()}`);
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

// Olaylar <script> ile yüklenir: dosyaya çift tıklayıp açınca (file://) da çalışır.
function loadScript(file, name) {
  return new Promise((resolve) => {
    const s = document.createElement('script');
    s.src = `${file}?v=${Date.now()}`;
    s.onload = () => { s.remove(); const v = window[name] || null; delete window[name]; resolve(v); };
    s.onerror = () => { s.remove(); resolve(null); };
    document.head.appendChild(s);
  });
}

// Veri iki parça: son 6 saat (events.<dil>.js) hemen gösterilir, daha eskisi (events-old.<dil>.js) arkadan gelir.
// Dosyalar arayüz diline göredir: içlerinde sadece o dilin başlık çevirileri vardır. Dil değişince yeniden yüklenir.
// Her dakika sadece küçük sürüm dosyasına bakılır; veri değişmediyse büyük dosyalar yeniden indirilmez.
let loadedVersion = null, loadedLang = null;
async function load() {
  const [ver, manual] = await Promise.all([loadJson('data/updated.json'), loadJson('data/manual.json')]);
  const lang = state.lang;
  if (ver && ver.updated === loadedVersion && lang === loadedLang) return;
  const auto = await loadScript(`data/events.${lang}.js`, '__EVENTS__');
  const first = !state.events.length;
  if (first) applyEvents(auto, [], manual, true);
  const old = await loadScript(`data/events-old.${lang}.js`, '__EVENTS_OLD__');
  applyEvents(auto, old?.events || [], manual, first);
  loadedVersion = auto?.updated ?? null;
  loadedLang = lang;
  // ?event=… ile açılan paylaşılmış haber: veri gelince seçilir.
  if (first && PARAMS.get('event') && byId.has(PARAMS.get('event'))) select(byId.get(PARAMS.get('event')), true);
}

// initial: sayfanın ilk yüklemesi (iki parça da gelene kadar hiçbir haber "YENİ" sayılmaz).
function applyEvents(auto, older, manual, initial) {
  const extra = (manual?.events || []).map((e, i) => ({
    id: 'm' + i, cat: 'manual', src: '', ...e, t: new Date(e.time ?? e.t).getTime(),
  }));
  const launches = (auto?.launches || []).map((l) => ({
    id: l.id, cat: 'launch', kind: 'launch', t: l.net, lat: l.lat, lon: l.lon, title: l.name,
    place: l.place, src: l.provider, img: l.img, text: l.pad, lang: 'en',
  }));
  const events = [...extra, ...(auto?.events || []), ...older, ...launches].sort((a, b) => b.t - a.t);
  // İlk yüklemeden sonra gelen olaylar "YENİ" olarak işaretlenir.
  const first = initial || !state.events.length;
  const before = new Map(state.events.map((e) => [e.id, e]));
  let fresh = 0;
  for (const e of events) {
    e.isNew = !first && (!before.has(e.id) || before.get(e.id).isNew);
    if (e.isNew) fresh++;
  }
  const newImrali = (auto?.imrali?.items || []).filter((e) => !first && !byId.has(e.id));
  notifyNew(first ? [] : events.filter((e) => !before.has(e.id)), newImrali);
  state.events = events;
  state.imrali = auto?.imrali?.items || [];
  byId.clear();
  for (const e of [...state.imrali, ...events]) byId.set(e.id, e);
  state.updated = auto?.updated || 0;
  state.fresh = fresh;
  render();
  if (initial && state.region === 'imrali') openInfo('imrali');
}

// ---------------- Olay dinleyicileri ----------------

$('uiLangs').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-lang]');
  if (b) setLang(b.dataset.lang);
});
function setLang(lang) {
  state.lang = lang;
  try { localStorage.setItem('lang', state.lang); } catch {}
  applyLanguage();
  load();
  $('notifyBtn').title = T.x.notify;
  $('aboutBtn').title = T.about.title;
  if (PAGES[infoOpenFor]) openInfo(infoOpenFor);
  syncPush();
  drawWeather();
  drawOutages();
}
$('ranges').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-hours]');
  if (b) setHours(+b.dataset.hours);
});
function setHours(h) {
  state.hours = h;
  renderPanels();
  renderMobile();
  render();
}
$('finTicker').addEventListener('click', () => togglePage('finance'));
$('notifyBtn').addEventListener('click', () => togglePage('notify'));
$('aboutBtn').addEventListener('click', () => togglePage('about'));
$('regions').addEventListener('click', (ev) => {
  const page = ev.target.closest('[data-page]');
  if (page) { togglePage(page.dataset.page); return; }
  const b = ev.target.closest('[data-region]');
  // Seçili sekmeye tekrar tıklamak seçimi kaldırır (tüm bölge).
  if (b) chooseRegion(state.region === b.dataset.region ? 'all' : b.dataset.region);
});
function chooseRegion(key) {
  state.region = key;
  renderRegions();
  renderMobile();
  drawRegion();
  render();
  flyToRegion(1200);
  if (state.region === 'imrali') openInfo('imrali');
}
// Kürdistan ve İmralı'da harita hafifçe eğilir: kenarın yükselmesi yandan görünsün.
function flyToRegion(duration) {
  const tilt = SPOT.includes(state.region);
  map.fitBounds(REGIONS[state.region], { padding: mapPadding(tilt ? 60 : 30), duration, pitch: tilt ? 45 : 0, bearing: 0 });
}
// Telefonda haritanın altı haber paneliyle kaplı: bölge panelin üstünde kalan alana sığdırılır.
const isMobile = () => matchMedia('(max-width: 760px)').matches;
function mapPadding(p) {
  return isMobile() ? { top: 20, left: 16, right: 16, bottom: ($('feed').classList.contains('hidden') ? 0 : $('feed').offsetHeight) + 10 } : p;
}
document.querySelector('.feed-tabs').addEventListener('click', (ev) => {
  const b = ev.target.closest('.ftab');
  if (b) togglePanel(b.dataset.panel || null);
});
$('chips').addEventListener('change', (ev) => {
  const k = ev.target.dataset.cat;
  if (!k) return;
  ev.target.checked ? state.off.delete(k) : state.off.add(k);
  if (k === 'iss') updateIss();
  if (k === 'sats' || k === 'starlink') refreshSats();
  if (k === 'aircraft' || k === 'mil') { lastMil = 0; updateAircraft(); }
  if (k === 'night') updateNight();
  if (k === 'weather') updateWeather();
  if (k === 'outages') updateOutages();
  if (k === 'heat') map.setLayoutProperty('heat', 'visibility', state.off.has('heat') ? 'none' : 'visible');
  render();
});
$('basemaps').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-basemap]');
  if (b) setBasemap(b.dataset.basemap);
});
$('topics').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-topic]');
  if (!b) return;
  state.topic = b.dataset.topic;
  renderTopics();
  render();
  // Fırlatma rampaları dünyanın her yerinde: Uzay seçilince küre bütün olarak gösterilir.
  if (state.topic === 'space') map.flyTo({ center: [20, 25], zoom: 1.2, duration: 1200 });
});
$('list').addEventListener('click', (ev) => {
  const trb = ev.target.closest('.tr-btn');
  if (trb) { const e = byId.get(trb.dataset.tr); if (e) translateOne(e, trb); return; }
  if (ev.target.closest('a')) return;
  const li = ev.target.closest('.item');
  const e = li && byId.get(li.dataset.id);
  // İmralı arşivindeki haberlerde harita adada kalır.
  if (e) select(e, state.region !== 'imrali');
});
let typing;
$('search').addEventListener('input', (ev) => { clearTimeout(typing); typing = setTimeout(() => { state.q = ev.target.value.trim(); render(); }, 200); });
$('inView').addEventListener('change', (ev) => { state.inView = ev.target.checked; renderList(filtered()); });
$('toggleFeed').addEventListener('click', () => { $('feed').classList.toggle('hidden'); map.resize(); });
// Açık / koyu tema düğmesi; seçim tarayıcıda hatırlanır.
$('themeBtn').addEventListener('click', () => {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch {}
});
// Telefonda haber paneli: tutamağa dokununca bir kademe değişir (kapalı → yarım → tam), sürükleyince yöne göre.
const SHEET = ['peek', 'half', 'full'];
let sheetStart = null;
function setSheet(level) {
  const feed = $('feed');
  feed.classList.remove('peek', 'full', 'hidden');
  if (level === 'closed') feed.classList.add('hidden');
  else if (level !== 'half') feed.classList.add(level);
  markNav();
}
const sheetLevel = () => ($('feed').classList.contains('peek') ? 0 : $('feed').classList.contains('full') ? 2 : 1);
$('feedHandle').addEventListener('pointerdown', (ev) => { sheetStart = ev.clientY; $('feedHandle').setPointerCapture(ev.pointerId); });
$('feedHandle').addEventListener('pointerup', (ev) => {
  if (sheetStart == null) return;
  const dy = ev.clientY - sheetStart;
  sheetStart = null;
  const now = sheetLevel();
  const next = Math.abs(dy) < 8 ? (now + 1) % 3 : Math.max(0, Math.min(2, now + (dy < 0 ? 1 : -1)));
  setSheet(SHEET[next]);
});

// ---------------- Telefon görünümü ----------------
// Üstte logo ve bölge seçici, altta uygulama gibi gezinme çubuğu (Harita, Akış, TV, İmralı, Daha fazla).
// Bilgisayar görünümü bunlardan etkilenmez; bu öğeler sadece dar ekranda görünür.
function closeMenus() { $('regionMenu').hidden = true; $('moreMenu').hidden = true; }
function renderMobile() {
  $('regionPick').querySelector('span').textContent = T.regions[state.region || 'all'];
  const labels = { map: T.m.map, feed: T.tabs.feed, tv: T.x.tv, weather: T.m.wxShort || T.m.weather, more: T.m.more };
  for (const b of $('bottomNav').querySelectorAll('[data-nav]')) b.querySelector('span').textContent = labels[b.dataset.nav];
  $('mLayersBtn').title = T.tabs.layers;
  $('mSpaceBtn').title = T.m.space;
  $('regionMenu').innerHTML = REGION_TABS.map((k) =>
    `<button type="button" data-region="${k}" class="${(state.region || 'all') === k ? 'active' : ''}">${esc(T.regions[k])}</button>`).join('');
  const item = (act, icon, label) => `<button type="button" data-act="${act}"><i class="ti ti-${icon}"></i>${esc(label)}</button>`;
  $('moreMenu').innerHTML = item('week', 'calendar-week', T.x.week)
    + item('notify', 'bell', T.x.notify) + item('finance', 'coin', T.m.finance) + item('theme', 'sun-moon', T.m.theme)
    + item('about', 'info-circle', T.about.title)
    + `<div class="m-sub">${esc(T.m.lang)}</div><div class="seg">${Object.entries(I18N).map(([k, v]) =>
      `<button type="button" data-lang="${k}" class="${k === state.lang ? 'active' : ''}">${v.name}</button>`).join('')}</div>`
    + `<div class="m-sub">${esc(T.m.time)}</div><div class="seg">${[1, 6, 24, 48].map((h) =>
      `<button type="button" data-hours="${h}" class="${h === state.hours ? 'active' : ''}">${T.range(h)}</button>`).join('')}</div>`;
  markNav();
}
// Alt çubukta hangi bölümün açık olduğu
function markNav() {
  const feed = $('feed');
  const now = !$('moreMenu').hidden ? 'more' : infoOpenFor === 'tv' ? 'tv'
    : infoOpenFor === 'weather' ? 'weather' : !feed.classList.contains('peek') && !feed.classList.contains('hidden') ? 'feed' : 'map';
  for (const b of $('bottomNav').querySelectorAll('[data-nav]')) b.classList.toggle('active', b.dataset.nav === now);
}
$('regionPick').addEventListener('click', (ev) => {
  ev.stopPropagation();
  $('moreMenu').hidden = true;
  $('regionMenu').hidden = !$('regionMenu').hidden;
  markNav();
});
$('regionMenu').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-region]');
  if (!b) return;
  closeMenus();
  if (infoOpenFor === 'imrali') closeInfo();
  chooseRegion(b.dataset.region);
});
$('moreMenu').addEventListener('click', (ev) => {
  ev.stopPropagation();
  const b = ev.target.closest('button');
  if (!b) return;
  if (b.dataset.lang) { setLang(b.dataset.lang); return; }
  if (b.dataset.hours) { setHours(+b.dataset.hours); return; }
  closeMenus();
  const act = b.dataset.act;
  if (act === 'space') openSpaceView();
  else if (act === 'theme') $('themeBtn').click();
  else togglePage(act);
  markNav();
});
$('bottomNav').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-nav]');
  if (!b) return;
  ev.stopPropagation();
  const nav = b.dataset.nav;
  if (nav !== 'more') closeMenus();
  if (nav === 'map') {
    if (infoOpenFor) closeInfo();
    setSheet('closed');
    // İmralı'dan haritaya dönünce Kürdistan ortalanır.
    if (state.region === 'imrali') {
      chooseRegion('all');
      map.fitBounds(REGIONS.kurdistan, { padding: mapPadding(0), duration: 1200, pitch: 0, bearing: 0 });
    }
  }
  else if (nav === 'feed') {
    // Akış sadece bu düğmeyle açılır; açıkken tekrar basınca tamamen kapanır (TV gibi).
    if (!$('feed').classList.contains('hidden')) setSheet('closed');
    else { if (infoOpenFor && PAGES[infoOpenFor]) closeInfo(); setSheet('full'); }
  }
  else if (nav === 'tv') togglePage('tv');
  else if (nav === 'weather') { setSheet('closed'); togglePage('weather'); }
  else { $('regionMenu').hidden = true; $('moreMenu').hidden = !$('moreMenu').hidden; }
  markNav();
});
$('mLayersBtn').addEventListener('click', () => togglePanel('layers'));
$('mSpaceBtn').addEventListener('click', () => { closeMenus(); openSpaceView(); });
// Menünün dışına dokununca menü kapanır.
document.addEventListener('click', (ev) => {
  if (!ev.target.closest('.m-menu, #regionPick, #bottomNav')) { closeMenus(); markNav(); }
});
map.on('moveend', () => { if (state.inView) renderList(filtered()); });
window.addEventListener('resize', () => {
  for (const p of document.querySelectorAll('.panel')) if (p.style.left) placePanel(p, parseFloat(p.style.left), parseFloat(p.style.top));
});

// ---------------- Başlangıç ----------------

makePanel($('infoPanel'));
makePanel($('layersPanel'));
makePanel($('streetPanel'));
if (TOPICS[PARAMS.get('topic')]) state.topic = PARAMS.get('topic');
// Telefonda haber akışı kapalı başlar (Canlı akış düğmesiyle açılır), harita Kürdistan'ı ortalar.
if (isMobile()) setSheet('closed');
if (REGION_TABS.includes(PARAMS.get('region'))) {
  state.region = PARAMS.get('region');
  flyToRegion(0);
} else if (state.topic === 'space') {
  map.jumpTo({ center: [20, 25], zoom: 1.2 });
} else if (isMobile()) {
  map.fitBounds(REGIONS.kurdistan, { padding: mapPadding(0), duration: 0 });
}
// ?at=enlem,boylam,yakınlık — haritayı belli bir noktada açan paylaşılabilir bağlantı.
const at = (PARAMS.get('at') || '').split(',').map(Number);
if (at.length >= 2 && at.every(Number.isFinite)) map.jumpTo({ center: [at[1], at[0]], zoom: at[2] || 10 });
if (BASEMAPS.includes(PARAMS.get('map'))) state.basemap = PARAMS.get('map');
if (['lang', 'time', 'layers'].includes(PARAMS.get('panel'))) togglePanel(PARAMS.get('panel'));
// ?view=space — sayfayı doğrudan uzay görünümünde açan paylaşılabilir bağlantı.
if (PAGES[PARAMS.get('page')]) setTimeout(() => openInfo(PARAMS.get('page')));
if (PARAMS.get('view') === 'space') map.once('load', openSpaceView);
loadFinance();
setInterval(loadFinance, FIN_POLL);
setInterval(() => { updateWeather(); updateOutages(); }, 600e3);
$('notifyBtn').title = T.x.notify;
$('aboutBtn').title = T.about.title;
loadJson('data/regions.json').then((r) => { REGION_SHAPES = r || {}; drawRegion(); applyMapLanguage(); render(); });
// Site dosyalarını tarayıcıda saklayan yardımcı (sw.js): ikinci açılış hızlanır, internet yokken son hâl görünür.
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  // Yeni sürüm yüklenince sayfa bir kez yenilenir: eski sürümün sakladığı dosyalarla karışık açılmasın.
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (hadController) location.reload(); });
  navigator.serviceWorker.register('sw.js').then(() => syncPush()).catch(() => {});
}
// Simgeler icons.js'ten hazır geldiği için yazı tipi beklenmeden başlanır.
{
  applyLanguage();
  load();
  updateIss();
  refreshSats();
  setInterval(load, REFRESH_MS);
  setInterval(updateIss, 10000);
  setInterval(updateNight, 5 * 60e3);
  setInterval(updateSatPositions, 3000);
  updateAircraft();
  setInterval(updateAircraft, 20000);
  setInterval(tickMovers, 2000);
  map.on('moveend', () => { clearTimeout(airMove); airMove = setTimeout(updateAircraft, 800); });
}
