// Sitenin kendi dosyalarını tarayıcıda saklar: ikinci açılış neredeyse beklemesiz olur, internet yokken son hâl görünür.
//   - Site dosyaları (html, css, js, ikonlar, gezegen dokuları): önce saklanan gösterilir, arkada yenisi indirilir.
//   - Haber verisi (data/): önce internetten; olmazsa saklanan son hâl.
//   - Sürümü sabit dış kütüphaneler (maplibre, three.js): bir kez indirilip saklanır.
// Harita karoları ve haber resimleri saklanmaz (çok yer kaplarlar).
const CACHE = 'zindi-v2';
const LIBS = /^https:\/\/cdn\.jsdelivr\.net\/npm\/(maplibre-gl|three|satellite\.js|@mapbox\/mapbox-gl-rtl-text|mapillary-js)@\d/;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['./', 'index.html', 'style.css', 'icons.css', 'icons.js', 'config.js', 'i18n.js', 'app.js', 'manifest.webmanifest', 'assets/logo/zindi.svg'])).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (same && url.pathname.includes('/data/')) {
    // Veri dosyaları ?v=… ile istenir; saklarken sorgu kısmı atılır, yoksa her istek ayrı kayıt olurdu.
    const key = url.origin + url.pathname;
    e.respondWith(fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(key, copy)); }
      return res;
    }).catch(() => caches.match(key).then((r) => r || Response.error())));
  } else if (same) {
    e.respondWith(caches.open(CACHE).then(async (c) => {
      const hit = await c.match(req);
      const fresh = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
      return hit || fresh;
    }));
  } else if (LIBS.test(req.url)) {
    e.respondWith(caches.open(CACHE).then(async (c) => (await c.match(req)) || fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; })));
  }
});

// Bildirime tıklanınca haberin bağlantısı açılır.
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(self.clients.openWindow(e.notification.data?.url || './'));
});

// Site kapalıyken gelen bildirim (gönderen: scripts/push.mjs).
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data?.json() || {}; } catch {}
  e.waitUntil(self.registration.showNotification(d.title || 'Zindî', {
    body: d.body || '', tag: d.tag, data: { url: d.url || './' }, icon: 'assets/logo/zindi-192.png', badge: 'assets/logo/zindi-192.png',
  }));
});
