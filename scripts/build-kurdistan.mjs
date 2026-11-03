// Kürdistan sınırını gerçek il/ilçe sınırlarından üretir ve scripts/lib/kurdistan.mjs'e yazar.
// Kaynak: geoBoundaries (açık lisans) — Türkiye, Irak, İran, Suriye il (ADM1) ve ilçe (ADM2) sınırları.
// Yöntem (bağımlılıksız): seçilen parçaları ince bir ızgaraya boya → ülke sınırlarındaki ince boşlukları kapat →
// dış kenarı izle → yumuşat ve sadeleştir. Afrin, Ezaz–Cerablus–Girê Spî şeridiyle Kobanî ve Cizîr'e bağlanır.
// Kullanım: node scripts/build-kurdistan.mjs && node scripts/build-regions.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Seçim, kullanıcının verdiği Kurmancî Kürdistan haritasına göre (Sêwas, Erzîncan, Erdexan'dan Xoremmabad'a).
const PICK = {
  'TUR/ADM1': ['Adıyaman', 'Ağrı', 'Ardahan', 'Batman', 'Bingöl', 'Bitlis', 'Diyarbakır', 'Elazığ', 'Erzincan', 'Erzurum', 'Gaziantep',
    'Hakkâri', 'Iğdır', 'Kahramanmaraş', 'Kars', 'Kilis', 'Malatya', 'Mardin', 'Muş', 'Siirt', 'Sivas', 'Şanlıurfa', 'Şırnak',
    'Tunceli', 'Van'],
  'IRQ/ADM1': ['Dohuk', 'Erbil', 'Al-Sulaimaniyah', 'Kirkuk', 'Ninawa'],
  'IRQ/ADM2': ['Khanaqin', 'Tooz Khurmato', 'Kifri'],
  'IRN/ADM1': ['Kurdistan', 'Kermanshah', 'Ilam', 'West Azerbaijan', 'Hamadan', 'Lorestan'],
  'SYR/ADM1': ['Al-Hasakeh'],
  'SYR/ADM2': ['Afrin', "A'zaz", 'Al Bab', 'Jarablus', 'Menbij', 'Ain Al Arab', 'Tell Abiad'],
};

const polys = [];
for (const [key, names] of Object.entries(PICK)) {
  const meta = await (await fetch(`https://www.geoboundaries.org/api/current/gbOpen/${key}/`)).json();
  const geo = await (await fetch(meta.simplifiedGeometryGeoJSON)).json();
  for (const name of names) {
    const f = geo.features.find((x) => x.properties.shapeName === name);
    if (!f) throw new Error(`${key}: "${name}" bulunamadı`);
    const g = f.geometry;
    for (const p of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) {
      let [w, s, e, n] = [180, 90, -180, -90];
      for (const [x, y] of p[0]) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
      polys.push({ rings: p, bbox: [w, s, e, n] });
    }
  }
  console.log(key, names.length, 'parça');
}

const STEP = 0.02, W0 = 34.5, S0 = 31, E0 = 51.5, N0 = 42.5;
const NX = Math.round((E0 - W0) / STEP), NY = Math.round((N0 - S0) / STEP);
const inRing = (x, y, r) => {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const [xi, yi] = r[i], [xj, yj] = r[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const inside = (x, y) => polys.some(({ rings, bbox: [w, s, e, n] }) =>
  x >= w && x <= e && y >= s && y <= n && inRing(x, y, rings[0]) && !rings.slice(1).some((h) => inRing(x, y, h)));

let grid = new Uint8Array(NX * NY);
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++)
  grid[j * NX + i] = inside(W0 + (i + 0.5) * STEP, S0 + (j + 0.5) * STEP) ? 1 : 0;

// Kapatma (genişlet + daralt): ülke sınırlarındaki ince boşlukları kapatır.
const morph = (g, r, val) => {
  const o = new Uint8Array(g.length);
  for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
    let hit = !val;
    for (let dj = -r; dj <= r && hit !== val; dj++) for (let di = -r; di <= r; di++) {
      if (di * di + dj * dj > r * r) continue;
      const a = i + di, b = j + dj;
      const v = a >= 0 && b >= 0 && a < NX && b < NY ? g[b * NX + a] : 0;
      if (!!v === val) { hit = val; break; }
    }
    o[j * NX + i] = hit ? 1 : 0;
  }
  return o;
};
grid = morph(morph(grid, 3, true), 3, false);
const at = (i, j) => (i >= 0 && j >= 0 && i < NX && j < NY ? grid[j * NX + i] : 0);

// Dolu hücrelerin kenarlarını yönlü kenar olarak topla ve halkalara bağla; en büyük halka dış sınırdır.
const next = new Map();
const key = (i, j) => i * 100000 + j;
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  if (!at(i, j)) continue;
  if (!at(i, j - 1)) next.set(key(i, j), [i + 1, j]);
  if (!at(i + 1, j)) next.set(key(i + 1, j), [i + 1, j + 1]);
  if (!at(i, j + 1)) next.set(key(i + 1, j + 1), [i, j + 1]);
  if (!at(i - 1, j)) next.set(key(i, j + 1), [i, j]);
}
const rings = [];
while (next.size) {
  const [k0] = next.keys();
  let [i, j] = [Math.floor(k0 / 100000), k0 % 100000];
  const ring = [];
  while (next.has(key(i, j))) {
    const n = next.get(key(i, j));
    next.delete(key(i, j));
    ring.push([W0 + i * STEP, S0 + j * STEP]);
    [i, j] = n;
  }
  ring.push(ring[0]);
  rings.push(ring);
}
const area = (r) => r.reduce((a, [x, y], k) => (k ? a + (r[k - 1][0] * y - x * r[k - 1][1]) : a), 0) / 2;
rings.sort((a, b) => Math.abs(area(b)) - Math.abs(area(a)));

const chaikin = (r) => {
  const o = [];
  for (let k = 0; k < r.length - 1; k++) {
    const [a, b] = [r[k], r[k + 1]];
    o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
  }
  o.push(o[0]);
  return o;
};
const dp = (pts, tol) => {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let best = 0, idx = 0;
  for (let k = 1; k < pts.length - 1; k++) {
    const [x, y] = pts[k], dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    const d = L ? Math.abs(dy * x - dx * y + b[0] * a[1] - b[1] * a[0]) / L : Math.hypot(x - a[0], y - a[1]);
    if (d > best) { best = d; idx = k; }
  }
  return best > tol ? [...dp(pts.slice(0, idx + 1), tol).slice(0, -1), ...dp(pts.slice(idx), tol)] : [a, b];
};
// Kapalı halkada ilk ve son nokta aynı: iki yarıya bölerek sadeleştir.
const ringDp = (r, tol) => { const h = Math.floor(r.length / 2); return [...dp(r.slice(0, h + 1), tol).slice(0, -1), ...dp(r.slice(h), tol)]; };
const round = (r) => r.map(([x, y]) => [+x.toFixed(3), +y.toFixed(3)]);

// Izgara basamaklarını yumuşat: önce kaba sadeleştir, sonra Chaikin ile köşeleri yuvarla.
let outer = ringDp(chaikin(chaikin(chaikin(ringDp(rings[0], 0.045)))), 0.004);
if (area(outer) < 0) outer.reverse();
// Işıltı çizgisi için daha da sade kenar: küçük zikzaklar bulanık çizgide diken gibi görünür.
const edge = chaikin(chaikin(chaikin(ringDp(outer, 0.06))));

const head = `// Kürdistan sınırı: scripts/build-kurdistan.mjs tarafından gerçek il/ilçe sınırlarından üretilir (elle düzenlemeyin).
// Resmî bir sınır yoktur; sadece haritada bölgeyi göstermek ve haberleri süzmek içindir. Koordinatlar [boylam, enlem].
`;
await fs.writeFile(path.join(ROOT, 'scripts', 'lib', 'kurdistan.mjs'),
  `${head}export const KURDISTAN = [${JSON.stringify(round(outer))}];\n// Kenar ışıltısı için yumuşatılmış çizgi.\nexport const KURDISTAN_EDGE = ${JSON.stringify(round(edge))};\n`);
console.log('Kürdistan:', outer.length, 'nokta; kenar çizgisi:', edge.length, 'nokta');
