// GerdûnNews — küçük yardımcı sunucu (Cloudflare Workers, ücretsiz plan).
//
// 1) Uçak verisi aracısı. adsb.lol ve adsb.fi (gönüllü ADS-B alıcı ağları) tarayıcıdan doğrudan erişime (CORS)
//    izin vermiyor; bu servis isteği iletir ve sadece haritanın ihtiyaç duyduğu alanları döndürür.
//      /area?lat=37.5&lon=43.7&dist=250   bir noktanın çevresindeki uçaklar (en fazla 250 deniz mili)
//      /mil                               dünya genelindeki askeri uçuşlar
//
// 2) Bildirim abonelikleri (site kapalıyken de bildirim). Abonelik ve tercihleri KV'de saklanır;
//    bildirimleri GitHub Actions gönderir (scripts/push.mjs), listeyi buradan gizli anahtarla alır.
//      POST /push/subscribe     { sub, regions, groups, lang }       aboneliği kaydeder veya günceller
//      POST /push/unsubscribe   { endpoint }                         aboneliği siler
//      GET  /push/list          (Authorization: Bearer PUSH_TOKEN)   tüm abonelikler
//      POST /push/remove        (Authorization: Bearer PUSH_TOKEN)   { ids }  süresi dolmuş abonelikleri siler
//
// 3) Haber çevirisi. Hazır çevirisi olmayan başlık ve metinler buradan çevrilir (Google Çeviri'nin ücretsiz ucu).
//    Her metin her dil için bir kez çevrilir ve 30 gün saklanır: sonraki ziyaretçiler hazır çeviriyi alır,
//    Google'a çok az istek gider. Sadece sitenin kendi adreslerinden gelen isteklere cevap verir.
//      POST /tr   { sl, tl, q: [metin, …] }   →   { out: [çeviri, …] }   (en çok 40 satır)

const SOURCES = ['https://api.adsb.lol/v2', 'https://opendata.adsb.fi/api/v2'];
const REGIONS = ['kurdistan', 'imrali', 'tr', 'sy', 'iq', 'ir', 'il'];
const GROUPS = ['conflict', 'quake', 'disaster'];
const LANGS = ['tr', 'ku', 'ckb', 'en', 'ar'];

function corsHeaders(req, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const origin = req.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0] || '',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}
const json = (body, cors, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

// İlk kaynak yanıt vermezse ikincisi denenir.
async function upstream(path) {
  let last;
  for (const base of SOURCES) {
    try {
      const res = await fetch(base + path, { headers: { 'User-Agent': 'zindi' }, cf: { cacheTtl: 15 } });
      if (res.ok) return await res.json();
      last = new Error(`${res.status} ${base}`);
    } catch (e) { last = e; }
  }
  throw last;
}

// Haritaya sadece gereken alanlar gider: veri küçülür, ziyaretçinin interneti yorulmaz.
const slim = (a) => ({
  h: a.hex, f: (a.flight || '').trim(), r: a.r || '', t: a.t || '',
  lat: a.lat, lon: a.lon, alt: a.alt_baro, gs: a.gs, trk: a.track ?? a.true_heading ?? 0,
  sq: a.squawk || '', mil: (a.dbFlags & 1) ? 1 : 0,
});

async function aircraft(url, cors) {
  let path;
  if (url.pathname === '/mil') {
    path = '/mil';
  } else {
    const lat = Number(url.searchParams.get('lat'));
    const lon = Number(url.searchParams.get('lon'));
    const dist = Math.min(250, Math.max(25, Number(url.searchParams.get('dist')) || 250));
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      return new Response('lat/lon geçersiz', { status: 400, headers: cors });
    }
    // Yuvarlanmış koordinatlar: yakın istekler aynı önbellek kaydını kullanır.
    path = `/lat/${lat.toFixed(1)}/lon/${lon.toFixed(1)}/dist/${Math.round(dist / 25) * 25}`;
  }
  try {
    const j = await upstream(path);
    const ac = (j.ac || j.aircraft || []).filter((a) => a.lat != null && a.lon != null).map(slim);
    return new Response(JSON.stringify({ now: j.now || Date.now(), ac }), {
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=15' },
    });
  } catch (e) {
    return json({ error: String(e.message || e) }, cors, 502);
  }
}

// Abonelik anahtarı uç noktanın özetidir; aynı tarayıcı tekrar abone olursa kaydı güncellenir.
async function subId(endpoint) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(endpoint));
  return [...new Uint8Array(hash)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const pick = (list, allowed) => [...new Set((Array.isArray(list) ? list : []).filter((x) => allowed.includes(x)))];

const TR_TARGETS = ['tr', 'ku', 'ckb', 'en', 'ar'];
const GOOGLE_CODE = { he: 'iw' };
async function sha(text) {
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].slice(0, 20).map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function translate(req, env, ctx, cors) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((x) => x.trim()).filter(Boolean);
  if (!allowed.includes(req.headers.get('Origin') || '')) return json({ error: 'yetki yok' }, cors, 403);
  if (req.method !== 'POST') return json({ error: 'POST bekleniyor' }, cors, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'geçersiz istek' }, cors, 400); }
  const tl = body.tl, sl = typeof body.sl === 'string' && /^[a-z]{2,3}$/.test(body.sl) ? body.sl : 'auto';
  const q = Array.isArray(body.q) ? body.q.filter((t) => typeof t === 'string').map((t) => t.replace(/\s+/g, ' ').trim().slice(0, 1500)) : [];
  if (!TR_TARGETS.includes(tl) || !q.length || q.length > 40 || q.join('').length > 8000) return json({ error: 'geçersiz istek' }, cors, 400);

  const cache = caches.default;
  const keys = await Promise.all(q.map(async (t) => new Request(`https://ceviri.onbellek/${tl}/${sl}/${await sha(t)}`)));
  const out = await Promise.all(keys.map(async (k) => { const r = await cache.match(k); return r ? r.text() : null; }));
  const miss = out.map((x, i) => (x == null ? i : -1)).filter((i) => i >= 0);
  if (miss.length) {
    let parts = null;
    try {
      const res = await fetch(`https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=${GOOGLE_CODE[sl] || sl}&tl=${tl}`, {
        method: 'POST', redirect: 'manual',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: 'q=' + encodeURIComponent(miss.map((i) => q[i]).join('\n')),
      });
      if (res.ok) {
        const all = (await res.json())[0].map((x) => x[0]).join('');
        parts = miss.length === 1 ? [all.replace(/\s*\n\s*/g, ' ').trim()] : all.split('\n').map((x) => x.trim());
      }
    } catch { /* aşağıda hata döner */ }
    // Satır sayısı tutmazsa site grubu bölüp yeniden sorar.
    if (!parts || parts.length !== miss.length) return json({ error: 'çeviri alınamadı' }, cors, 502);
    miss.forEach((i, k) => {
      out[i] = parts[k];
      ctx.waitUntil(cache.put(keys[i], new Response(parts[k], { headers: { 'Cache-Control': 'public, max-age=2592000' } })));
    });
  }
  return json({ out }, cors);
}

async function push(req, env, url, cors) {
  const authorized = env.PUSH_TOKEN && req.headers.get('Authorization') === `Bearer ${env.PUSH_TOKEN}`;
  if (url.pathname === '/push/list' && req.method === 'GET') {
    if (!authorized) return json({ error: 'yetki yok' }, cors, 401);
    // Abonelik ve tercihler anahtarın ek bilgisinde durur: listelemek, tek tek okumaktan çok daha ucuzdur.
    const subs = [];
    let cursor;
    do {
      const page = await env.SUBS.list({ cursor });
      for (const k of page.keys) if (k.metadata) subs.push({ id: k.name, ...k.metadata });
      cursor = page.list_complete ? null : page.cursor;
    } while (cursor);
    return json({ subs }, cors);
  }
  if (req.method !== 'POST') return json({ error: 'POST bekleniyor' }, cors, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'geçersiz istek' }, cors, 400); }
  if (url.pathname === '/push/remove') {
    if (!authorized) return json({ error: 'yetki yok' }, cors, 401);
    await Promise.all((body.ids || []).slice(0, 500).map((id) => env.SUBS.delete(String(id))));
    return json({ ok: true }, cors);
  }
  const endpoint = body.sub?.endpoint || body.endpoint;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 600) return json({ error: 'abonelik geçersiz' }, cors, 400);
  const id = await subId(endpoint);
  if (url.pathname === '/push/unsubscribe') {
    await env.SUBS.delete(id);
    return json({ ok: true }, cors);
  }
  if (url.pathname === '/push/subscribe') {
    const keys = body.sub?.keys || {};
    if (typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return json({ error: 'abonelik geçersiz' }, cors, 400);
    const meta = {
      sub: { endpoint, keys: { p256dh: keys.p256dh.slice(0, 120), auth: keys.auth.slice(0, 40) } },
      r: pick(body.regions, REGIONS), g: pick(body.groups, GROUPS), l: LANGS.includes(body.lang) ? body.lang : 'tr',
    };
    // Bir yıl hiç yenilenmeyen abonelik kendiliğinden silinir; site her açılışta aboneliği yeniler.
    await env.SUBS.put(id, '', { metadata: meta, expirationTtl: 365 * 86400 });
    return json({ ok: true }, cors);
  }
  return json({ error: 'bilinmeyen adres' }, cors, 404);
}

// 4) İstek kayıtları (IP kaydı), D1 veritabanı "gerdun-log" (tablo: schema/log.sql, bakmak için: node scripts/ip-log.mjs).
//    Uçak verisinin başarılı istekleri sayfa açıkken birkaç saniyede bir tekrarlandığı için kaydedilmez;
//    geri kalan her istek (bildirim, çeviri, hatalı ya da reddedilen istekler, bilinmeyen adresler) kaydedilir.
//    LOG_DAYS günden eski kayıtlar her gün zamanlanmış görevle silinir.
async function logRequest(env, req, status, src) {
  if (!env.LOG) return;
  const url = new URL(req.url), cf = req.cf || {}, h = req.headers;
  if (logLimit(h.get('CF-Connecting-IP'))) return; // aynı IP'den dakikalık log sınırı aşıldıysa yazma
  const cut = (v, n) => (v ? String(v).slice(0, n) : null);
  try {
    await env.LOG.prepare('INSERT INTO log (t, ip, country, city, asn, org, method, host, path, status, ua, ref, src) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(Date.now(), h.get('CF-Connecting-IP'), cf.country || null, cf.city || null, cf.asn || null, cut(cf.asOrganization, 120),
        req.method, url.host, cut(url.pathname + url.search, 300), status, cut(h.get('User-Agent'), 300), cut(h.get('Referer'), 300), src)
      .run();
  } catch { /* kayıt yazılamazsa istek yine de cevaplanır */ }
}

// Basit kötüye kullanım sınırı: aynı IP kısa sürede çok istek atarsa (sel/tarama) engellenir.
// Worker belleğinde tutulur (veri merkezi başına, kalıcı depo ya da ek maliyet yok). Gerçek kullanıcıyı
// etkilemeyecek kadar geniş; asıl koruma Cloudflare panelindeki Rate Limiting + Bot Fight Mode, bu ona ek emniyettir.
function limiter(max, windowMs) {
  const m = new Map();
  return (ip) => {
    if (!ip) return false;
    const now = Date.now();
    if (m.size > 20000) for (const [k, v] of m) if (v.reset < now) m.delete(k); // belleği temiz tut
    let h = m.get(ip);
    if (!h || h.reset < now) { h = { n: 0, reset: now + windowMs }; m.set(ip, h); }
    return ++h.n > max;
  };
}
const floodLimit = limiter(120, 10000); // IP başına 10 saniyede 120 istek: aşınca 429
const logLimit = limiter(15, 60000);    // IP başına dakikada en çok 15 log satırı: D1 kotası şişmesin

// İçerik bildirimi: uygulamadaki "Bildir" düğmesi buraya gönderir, kayıt "report" tablosuna düşer.
// Sel sınırı zaten üstte uygulanıyor; burada sadece boyut sınırlanır.
async function report(req, env, cors) {
  if (req.method !== 'POST') return json({ error: 'POST bekleniyor' }, cors, 405);
  if (!env.LOG) return json({ error: 'kayıt deposu kurulmamış' }, cors, 503);
  let b;
  try { b = await req.json(); } catch { return json({ error: 'geçersiz istek' }, cors, 400); }
  const cut = (v, n) => (typeof v === 'string' ? v.slice(0, n) : null);
  try {
    await env.LOG.prepare('INSERT INTO report (t, ip, eid, url, title, src) VALUES (?,?,?,?,?,?)')
      .bind(Date.now(), req.headers.get('CF-Connecting-IP'), cut(b.id, 80), cut(b.url, 300), cut(b.title, 300), cut(b.src, 120))
      .run();
  } catch { return json({ error: 'kaydedilemedi' }, cors, 500); }
  return json({ ok: true }, cors);
}

async function route(req, env, ctx, cors) {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  const url = new URL(req.url);
  if (url.pathname === '/mil' || url.pathname === '/area') return aircraft(url, cors);
  if (url.pathname === '/tr') return translate(req, env, ctx, cors);
  if (url.pathname === '/report') return report(req, env, cors);
  if (url.pathname.startsWith('/push/')) {
    if (!env.SUBS) return json({ error: 'bildirim deposu kurulmamış' }, cors, 503);
    return push(req, env, url, cors);
  }
  return new Response('GerdûnNews servisi: /area?lat=&lon=&dist=, /mil, /push/…, /tr', { headers: cors });
}

export default {
  async fetch(req, env, ctx) {
    const cors = corsHeaders(req, env);
    // Sel koruması: aşırı istek atan IP, upstream'e ve loga hiç gitmeden 429 alır.
    if (req.method !== 'OPTIONS' && floodLimit(req.headers.get('CF-Connecting-IP'))) {
      return json({ error: 'çok fazla istek' }, cors, 429);
    }
    let res;
    try {
      res = await route(req, env, ctx, cors);
    } catch (e) {
      res = json({ error: 'sunucu hatası' }, cors, 500);
    }
    const path = new URL(req.url).pathname;
    const routine = (path === '/mil' || path === '/area' || req.method === 'OPTIONS') && res.status < 400;
    if (!routine) ctx.waitUntil(logRequest(env, req, res.status, 'api'));
    return res;
  },
  // Her gün: LOG_DAYS günden eski istek kayıtlarını sil.
  async scheduled(event, env) {
    if (!env.LOG) return;
    const days = Number(env.LOG_DAYS || 30);
    await env.LOG.prepare('DELETE FROM log WHERE t < ?').bind(Date.now() - days * 864e5).run();
  },
};
