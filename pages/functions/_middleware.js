// Sitenin istek kayıtları (IP kaydı): her sayfa açılışı, sitede olmayan adres istekleri
// (saldırı taramaları genelde böyledir: /wp-login.php, /.env…) ve GET dışındaki istekler D1 veritabanına
// ("gerdun-log", tablo: worker/schema/log.sql) yazılır. Resim, stil ve kod dosyaları bu koddan hiç geçmez
// (_routes.json); veri dosyalarının dakikada bir yapılan başarılı istekleri de kaydedilmez.
// Eski kayıtlar yardımcı sunucunun (worker) günlük görevinde silinir. Bakmak için: node scripts/ip-log.mjs
export async function onRequest(context) {
  const { request: req, env } = context;
  let res, status;
  try {
    res = await context.next();
    status = res.status;
  } catch (e) {
    status = 500;
    throw e;
  } finally {
    const url = new URL(req.url);
    // Buraya sadece sayfa ve veri istekleri ile sitede olmayan adresler gelir (Pages bilinmeyen adreste de ana
    // sayfayı 200 ile döndürür; taramalar bu yüzden adresinden tanınır). Veri dosyalarının başarılı istekleri atlanır.
    const worth = !url.pathname.startsWith('/data/') || (status ?? 500) >= 400 || !['GET', 'HEAD'].includes(req.method);
    if (env.LOG && worth) context.waitUntil(write(env, req, url, status ?? 500));
  }
  return res;
}

async function write(env, req, url, status) {
  const cf = req.cf || {}, h = req.headers;
  const cut = (v, n) => (v ? String(v).slice(0, n) : null);
  try {
    await env.LOG.prepare('INSERT INTO log (t, ip, country, city, asn, org, method, host, path, status, ua, ref, src) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(Date.now(), h.get('CF-Connecting-IP'), cf.country || null, cf.city || null, cf.asn || null, cut(cf.asOrganization, 120),
        req.method, url.host, cut(url.pathname + url.search, 300), status, cut(h.get('User-Agent'), 300), cut(h.get('Referer'), 300), 'site')
      .run();
  } catch { /* kayıt yazılamazsa sayfa yine de açılır */ }
}
