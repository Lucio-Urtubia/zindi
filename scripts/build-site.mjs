// Yayınlanacak siteyi _site klasörüne toplar: sadece ziyaretçinin tarayıcısının yüklediği dosyalar.
// Betikler, sunucu kodu, notlar ve sadece veri toplamanın kullandığı dosyalar (data/events.json) yayına gitmez.
// Bilgisayarda .yayin-yasak dosyası varsa (her satırda bir sözcük, depoya girmez), o sözcüklerden biri
// yayın dosyalarında geçerse yayını durdurur: eski hesap adları ve kişisel bilgiler yanlışlıkla yayına çıkmasın.
//   node scripts/build-site.mjs
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, '_site');
const FILES = ['index.html', 'manifest.webmanifest', 'sw.js', 'config.js', 'i18n.js', 'app.js', 'style.css', 'icons.css', 'icons.js',
  'space.js', 'space-data.js', 'space-extras.js', '_headers'];
const DIRS = ['assets', 'data'];
const SKIP = new Set(['data/events.json']);
const FORBIDDEN = await fs.readFile(path.join(ROOT, '.yayin-yasak'), 'utf8')
  .then((t) => t.split(/\r?\n/).map((s) => s.trim()).filter(Boolean))
  .catch(() => []);

await fs.rm(OUT, { recursive: true, force: true });
const copied = [];
async function copy(rel) {
  if (SKIP.has(rel)) return;
  const src = path.join(ROOT, rel);
  if ((await fs.stat(src)).isDirectory()) {
    for (const name of await fs.readdir(src)) await copy(`${rel}/${name}`);
    return;
  }
  await fs.mkdir(path.dirname(path.join(OUT, rel)), { recursive: true });
  await fs.copyFile(src, path.join(OUT, rel));
  copied.push(rel);
}
for (const f of [...FILES, ...DIRS]) await copy(f);

const problems = [];
for (const rel of copied.filter((f) => /\.(html|js|css|json|webmanifest)$/.test(f))) {
  const text = await fs.readFile(path.join(OUT, rel), 'utf8');
  const lower = text.toLowerCase();
  for (const word of FORBIDDEN) if (lower.includes(word.toLowerCase())) problems.push(`${rel}: ${word}`);
}
if (problems.length) {
  console.error('Yayında olmaması gereken izler bulundu:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`${copied.length} dosya _site klasörüne hazırlandı.`);
