// Sitenin kullandığı ikonları Tabler Icons'tan (MIT) indirip iki küçük dosya üretir:
//   icons.css — <i class="ti ti-ad"> için ikonlar (SVG maske olarak; renk metnin renginden gelir)
//   icons.js  — harita işaretlerinin tuvale çizilmesi için ikon yolları (window.ICONS)
// Tam ikon yazı tipi (~5.000 ikon, ~1 MB) yerine sadece kullanılan ~70 ikon yüklenir.
// Yeni bir ikon kullanınca adını aşağıya ekleyip çalıştırın: node scripts/build-icons.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VERSION = '3.19.0';
const ICONS = `view-360 activity alert-triangle arrow-back-up arrow-up bomb bookmark brand-telegram brand-whatsapp brand-x building
  building-bank camera car circle-dot clock compass crosshair drone external-link flag flame gauge gps hash helicopter helmet
  hexagon id info-circle language layout-off link list map-2 map-pin minus moon moon-stars mountain navigation news pin plane
  planet ripple rocket satellite search share shield-lock ship shoe skull snowflake speakerphone stack-2 sun sun-high swords
  tornado volcano world x player-play player-pause player-skip-back history chart-dots-3 flame-off sun-moon chevron-up
  chevron-down comet meteor galaxy telescope device-tv bell bell-ringing calendar-week wifi-off cloud cloud-rain cloud-snow cloud-storm cloud-fog hand-stop mail`.split(/\s+/).filter(Boolean);

// SVG şekillerini tek bir path "d" ifadesine çevir (tuval Path2D ve maske için).
const num = (s, k) => parseFloat((s.match(new RegExp(`\\b${k}="([^"]+)"`)) || [])[1] || 0);
function toPath(el) {
  const tag = el.match(/^<(\w+)/)[1];
  if (tag === 'path') return (el.match(/\bd="([^"]+)"/) || [])[1] || '';
  if (tag === 'circle' || tag === 'ellipse') {
    const cx = num(el, 'cx'), cy = num(el, 'cy'), rx = num(el, tag === 'circle' ? 'r' : 'rx'), ry = tag === 'circle' ? rx : num(el, 'ry');
    return `M${cx - rx} ${cy}a${rx} ${ry} 0 1 0 ${rx * 2} 0a${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
  }
  if (tag === 'line') return `M${num(el, 'x1')} ${num(el, 'y1')}L${num(el, 'x2')} ${num(el, 'y2')}`;
  if (tag === 'rect') {
    const x = num(el, 'x'), y = num(el, 'y'), w = num(el, 'width'), h = num(el, 'height');
    return `M${x} ${y}h${w}v${h}h${-w}z`;
  }
  if (tag === 'polyline' || tag === 'polygon') {
    const pts = (el.match(/\bpoints="([^"]+)"/) || [])[1].trim().split(/[\s,]+/);
    let d = '';
    for (let i = 0; i < pts.length; i += 2) d += `${i ? 'L' : 'M'}${pts[i]} ${pts[i + 1]}`;
    return tag === 'polygon' ? d + 'z' : d;
  }
  return '';
}

const paths = {};
const missing = [];
for (const name of ICONS) {
  const res = await fetch(`https://cdn.jsdelivr.net/npm/@tabler/icons@${VERSION}/icons/outline/${name}.svg`);
  if (!res.ok) { missing.push(name); continue; }
  const svg = await res.text();
  // İlk "M0 0h24v24H0z" (stroke="none") sadece çerçevedir, atılır.
  const d = [...svg.matchAll(/<(path|circle|ellipse|line|rect|polyline|polygon)\b[^>]*\/?>/g)]
    .map((m) => m[0]).filter((el) => !/stroke="none"/.test(el)).map(toPath).filter(Boolean).join(' ');
  paths[name] = d;
}

const svgOf = (d) => `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='${d}'/></svg>`;
const css = `/* scripts/build-icons.mjs ile üretilir — elle düzenlemeyin. Tabler Icons ${VERSION} (MIT). */
.ti { display: inline-block; width: 1em; height: 1em; flex: none; vertical-align: -0.125em; background-color: currentColor;
  -webkit-mask: var(--ti) center / contain no-repeat; mask: var(--ti) center / contain no-repeat; font-style: normal; }
${Object.entries(paths).map(([n, d]) => `.ti-${n} { --ti: url("data:image/svg+xml,${encodeURIComponent(svgOf(d)).replace(/'/g, '%27')}"); }`).join('\n')}
`;
await fs.writeFile(path.join(ROOT, 'icons.css'), css);
await fs.writeFile(path.join(ROOT, 'icons.js'), `// scripts/build-icons.mjs ile üretilir — Tabler Icons ${VERSION} (MIT). Harita işaretleri için ikon yolları.\nwindow.ICONS = ${JSON.stringify(paths)};\n`);
console.log(`${Object.keys(paths).length} ikon yazıldı`, missing.length ? `— bulunamayan: ${missing.join(', ')}` : '');
