// Bilgisayarda çalıştırmak için küçük sunucu:  node scripts/serve.mjs  ->  http://localhost:8080
// Haber verisi (data/…) GitHub'daki "data" dalından canlı gelir: GitHub Actions 15 dakikada bir toplayıp
// başlıkları 5 dile çevirir, yani yerel site de yayındaki siteyle aynı, çevrilmiş haberleri gösterir.
// Dal yanıt vermezse bilgisayardaki data/ klasörü kullanılır.
// Veriyi bu bilgisayarda toplamak için:  LOCAL_FETCH=1 node scripts/serve.mjs  (Google bu bilgisayardan
// gelen çeviri isteklerini engellediği için o zaman başlıklar çevrilmeden kalabilir).
import http from 'node:http';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };
const LOCAL_FETCH = process.env.LOCAL_FETCH === '1';
const LIVE_DATA = 'https://raw.githubusercontent.com/Lucio-Urtubia/zindi/data/data/';

async function liveData(rel) {
  const name = rel.slice('/data/'.length);
  if (LOCAL_FETCH || !/^[\w.-]+$/.test(name)) return null;
  try {
    const res = await fetch(LIVE_DATA + name, { signal: AbortSignal.timeout(15000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  } catch {
    return null;
  }
}

http.createServer(async (req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(ROOT, rel.endsWith('/') ? rel + 'index.html' : rel);
  if (!file.startsWith(ROOT)) return res.writeHead(403).end();
  const type = (TYPES[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8';
  const live = rel.startsWith('/data/') ? await liveData(rel) : null;
  if (live) return res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store' }).end(live);
  try {
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': type }).end(body);
  } catch {
    res.writeHead(404).end('Bulunamadı');
  }
}).listen(PORT, () => console.log(`Site açık: http://localhost:${PORT}  (kapatmak için bu pencereyi kapatın)`));

if (LOCAL_FETCH) {
  const UPDATE_MIN = Number(process.env.UPDATE_MIN || 5);
  let running = false;
  const update = () => {
    if (running) return;
    running = true;
    console.log(`[${new Date().toLocaleTimeString('tr-TR')}] Haberler güncelleniyor…`);
    spawn(process.execPath, [path.join(ROOT, 'scripts', 'fetch.mjs')], { stdio: 'inherit' })
      .on('exit', () => { running = false; });
  };
  update();
  setInterval(update, UPDATE_MIN * 60e3);
}
