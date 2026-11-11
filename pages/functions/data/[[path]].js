// Test sitesi: data/ dosyalarını GitHub'daki "data" dalından (her 15 dakikada güncellenir) canlı getirir.
// Dal yanıt vermezse yüklenen kopyaya düşer.
const RAW = 'https://raw.githubusercontent.com/Lucio-Urtubia/zindi/data/data/';
const TYPES = { js: 'application/javascript; charset=utf-8', json: 'application/json; charset=utf-8' };

export async function onRequestGet(context) {
  const path = [].concat(context.params.path || []).join('/');
  if (!/^[\w.-]+$/.test(path)) return context.env.ASSETS.fetch(context.request);
  try {
    const res = await fetch(RAW + path, { cf: { cacheTtl: 60, cacheEverything: true } });
    if (res.ok) {
      const ext = path.split('.').pop();
      return new Response(res.body, {
        headers: { 'Content-Type': TYPES[ext] || 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=60' },
      });
    }
  } catch {}
  return context.env.ASSETS.fetch(context.request);
}
