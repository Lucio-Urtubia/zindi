// Site kapalıyken bildirim: veri güncellemesinden sonra GitHub Actions'ta çalışır.
// Yeni olayları (son kayıtta olmayanlar) bulur, her abonenin seçtiği bölge ve türe uyanları ona gönderir.
// Abonelikler GerdûnNews sunucusundan (worker/) gelir; süresi dolanlar oradan silinir.
// Ortam değişkenleri: PUSH_API, PUSH_TOKEN, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SITE_URL, PREV_EVENTS
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import webpush from 'web-push';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { PUSH_API, PUSH_TOKEN, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, SITE_URL = '' } = process.env;
// Tarayıcıdaki bildirim ayarlarıyla aynı gruplar (app.js NOTIFY_GROUPS).
const GROUPS = { conflict: ['attack', 'airstrike', 'bombing', 'artillery', 'clash', 'massviolence'], quake: ['earthquake'], disaster: ['disaster'] };
const MAX_PER_SUB = 3; // bir güncellemede bir aboneye en çok bu kadar bildirim
const BRAND = 'GerdûnNews';

// Önceki veri: Actions'ta güncellemeden önce kopyalanan dosya (PREV_EVENTS), bilgisayarda son kayıttaki hâli.
const now = JSON.parse(await fs.readFile(path.join(ROOT, 'data/events.json'), 'utf8'));
let before;
try {
  before = JSON.parse(process.env.PREV_EVENTS
    ? await fs.readFile(process.env.PREV_EVENTS, 'utf8')
    : execFileSync('git', ['show', 'HEAD:data/events.json'], { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 }));
} catch {
  console.log('Önceki veri yok; ilk çalıştırmada bildirim gönderilmez.');
  process.exit(0);
}
// Sadece son 6 saatin olayları bildirilir: sonradan eklenen eski haberler bildirim olmaz.
const recentFrom = Date.now() - 6 * 3600e3;
const seen = new Set([...(before.events || []), ...(before.imrali?.items || [])].map((e) => e.id));
const fresh = (now.events || []).filter((e) => !seen.has(e.id) && e.t >= recentFrom);
const freshImrali = (now.imrali?.items || []).filter((e) => !seen.has(e.id));
if (!fresh.length && !freshImrali.length) { console.log('Yeni olay yok.'); process.exit(0); }

const shapes = JSON.parse(await fs.readFile(path.join(ROOT, 'data/regions.json'), 'utf8'));
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inRegion = (e, k) => (shapes[k] || []).some((ring) => inRing(e.lon, e.lat, ring));

const res = await fetch(`${PUSH_API}/push/list`, { headers: { Authorization: `Bearer ${PUSH_TOKEN}` } });
if (!res.ok) throw new Error(`Abonelik listesi alınamadı: ${res.status}`);
const { subs } = await res.json();
webpush.setVapidDetails(SITE_URL || 'https://example.org', VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const gone = [];
let sent = 0;
for (const s of subs) {
  const hits = [
    ...(s.r.includes('imrali') ? freshImrali : []),
    ...fresh.filter((e) => s.g.some((g) => GROUPS[g]?.includes(e.cat)) && s.r.some((k) => k !== 'imrali' && inRegion(e, k))),
  ].slice(0, MAX_PER_SUB);
  for (const e of hits) {
    const payload = JSON.stringify({
      title: BRAND, body: e.tt?.[s.l] || e.title, tag: e.id,
      url: `${SITE_URL}?event=${encodeURIComponent(e.id)}&lang=${s.l}`,
    });
    try {
      await webpush.sendNotification(s.sub, payload, { TTL: 6 * 3600, urgency: 'high' });
      sent++;
    } catch (err) {
      // 404/410: tarayıcı aboneliği bırakmış; kayıt silinir.
      if (err.statusCode === 404 || err.statusCode === 410) { gone.push(s.id); break; }
      console.warn('Gönderilemedi:', err.statusCode || err.message);
    }
  }
}
if (gone.length) {
  await fetch(`${PUSH_API}/push/remove`, {
    method: 'POST', headers: { Authorization: `Bearer ${PUSH_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: gone }),
  });
}
console.log(`${fresh.length + freshImrali.length} yeni olay, ${subs.length} abone, ${sent} bildirim gönderildi, ${gone.length} abonelik silindi.`);
