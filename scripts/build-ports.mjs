// Dünya limanları: BM'nin UN/LOCODE listesinden (ücretsiz) liman işlevi ve koordinatı olan yerler;
// UN/LOCODE'da koordinatı olmayan büyük limanlar (Aşdod, Varna, Port Said…) açık sea-ports listesinden (MIT) tamamlanır.
// Gemilerin AIS'te yazdığı varış yerini ("TRMER", "TR IST", "PAROS", "HADERA PORT") koordinata çevirmek için.
// Çıktı: scripts/lib/ports.json — { kod: [enlem, boylam, ad] } (sadece veri betiği kullanır, siteye gitmez).
// Kullanım: node scripts/build-ports.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const csv = await (await fetch('https://raw.githubusercontent.com/datasets/un-locode/main/data/code-list.csv')).text();

// Basit CSV ayrıştırıcı (tırnak içindeki virgülleri korur).
function parseLine(line) {
  const out = [];
  let cur = '', q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
// "4230N 00131E" → [42.5, 1.5167]
function coord(s) {
  const m = s.match(/^(\d{2})(\d{2})([NS])\s+(\d{3})(\d{2})([EW])$/);
  if (!m) return null;
  const lat = (+m[1] + m[2] / 60) * (m[3] === 'S' ? -1 : 1);
  const lon = (+m[4] + m[5] / 60) * (m[6] === 'W' ? -1 : 1);
  return [Math.round(lat * 1e3) / 1e3, Math.round(lon * 1e3) / 1e3];
}

const ports = {};
const lines = csv.split(/\r?\n/);
const head = parseLine(lines[0]);
const col = (n) => head.indexOf(n);
for (const line of lines.slice(1)) {
  if (!line) continue;
  const f = parseLine(line);
  if (f[col('Function')]?.[0] !== '1') continue; // 1 = liman
  const c = coord(f[col('Coordinates')] || '');
  if (!c) continue;
  ports[f[col('Country')] + f[col('Location')]] = [...c, f[col('NameWoDiacritics')] || f[col('Name')]];
}
// sea-ports: { "ILASH": { name, coordinates: [boylam, enlem] } } — eksikleri doldurur, kesin konumuyla öncelik alır.
const sea = await (await fetch('https://raw.githubusercontent.com/marchah/sea-ports/master/lib/ports.json')).json();
for (const [code, p] of Object.entries(sea)) {
  if (!/^[A-Z]{2}[A-Z0-9]{3}$/.test(code) || !Array.isArray(p.coordinates)) continue;
  const [lon, lat] = p.coordinates;
  ports[code] = [Math.round(lat * 1e3) / 1e3, Math.round(lon * 1e3) / 1e3, ports[code]?.[2] || p.name];
}
await fs.writeFile(path.join(ROOT, 'scripts', 'lib', 'ports.json'), JSON.stringify(ports));
console.log(Object.keys(ports).length, 'liman yazıldı');
