// İstek kayıtlarına (IP kaydı) bakar. Kayıtlar Cloudflare'deki D1 veritabanında ("gerdun-log") durur;
// bu betik wrangler ile sorgular (bilgisayarda wrangler'a doğru Cloudflare hesabıyla giriş yapılmış olmalı).
//
//   node scripts/ip-log.mjs               son 40 kayıt
//   node scripts/ip-log.mjs ozet          son 24 saat: en çok istek yapan IP'ler, ülkeler, taranan adresler
//   node scripts/ip-log.mjs supheli       son 24 saatte sitede olmayan adresleri tarayan ya da çok sık istek yapan IP'ler
//   node scripts/ip-log.mjs ip 1.2.3.4    bir IP'nin bütün kayıtları
//   node scripts/ip-log.mjs saat 6        son 6 saatin kayıtları (en çok 500)
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'worker');
const DAY = Date.now() - 86400000;
// Sitede olmayan adres istekleri (taramalar). Pages ve yardımcı sunucu bilinmeyen adreste de 200 döndürdüğü için
// taramalar durum kodundan değil adresinden tanınır.
const SCAN = "((src = 'site' AND path NOT LIKE '/data/%' AND path != '/' AND path NOT LIKE '/?%' AND path NOT LIKE '/index.html%')"
  + " OR (src = 'api' AND path NOT LIKE '/area%' AND path NOT LIKE '/mil%' AND path NOT LIKE '/tr%' AND path NOT LIKE '/push/%')"
  + ' OR status >= 400)';

function query(sql) {
  // SQL tek komut olarak, çift tırnak içinde verilir (SQL'de çift tırnak kullanılmaz).
  const out = execSync(`npx --yes wrangler@4 d1 execute gerdun-log --remote --json --command "${sql}"`,
    { cwd: WORKER, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
  return JSON.parse(out.slice(out.indexOf('[')))[0].results;
}
const time = (t) => new Date(t).toLocaleString('tr-TR');
const show = (title, rows) => {
  console.log(`\n== ${title}`);
  if (!rows.length) return console.log('  (kayıt yok)');
  console.table(rows.map((r) => (r.t ? { ...r, t: time(r.t) } : r)));
};
const COLS = 't, ip, country, city, org, method, path, status, src, ua';

const [mode = 'son', arg] = process.argv.slice(2);
if (mode === 'son') {
  show('Son 40 kayıt', query(`SELECT ${COLS} FROM log ORDER BY t DESC LIMIT 40`));
} else if (mode === 'ozet') {
  show("Son 24 saat: en çok istek yapan IP'ler", query(`SELECT ip, country, org, COUNT(*) AS istek, SUM(${SCAN}) AS tarama FROM log WHERE t > ${DAY} GROUP BY ip ORDER BY istek DESC LIMIT 25`));
  show('Son 24 saat: ülkeler', query(`SELECT country, COUNT(*) AS istek, COUNT(DISTINCT ip) AS ip_sayisi FROM log WHERE t > ${DAY} GROUP BY country ORDER BY istek DESC LIMIT 20`));
  show('Son 24 saat: sitede olmayan, en çok istenen adresler (taramalar)', query(`SELECT path, src, COUNT(*) AS istek, COUNT(DISTINCT ip) AS ip_sayisi FROM log WHERE t > ${DAY} AND ${SCAN} GROUP BY path, src ORDER BY istek DESC LIMIT 20`));
} else if (mode === 'supheli') {
  show("Son 24 saat: sitede olmayan adresleri tarayan ya da çok sık istek yapan IP'ler", query(`SELECT ip, country, org, SUM(${SCAN}) AS tarama, COUNT(*) AS istek, MAX(CASE WHEN ${SCAN} THEN path END) AS ornek_adres FROM log WHERE t > ${DAY} GROUP BY ip HAVING tarama >= 3 OR istek > 300 ORDER BY tarama DESC, istek DESC LIMIT 50`));
} else if (mode === 'ip' && /^[0-9a-fA-F:.]{3,45}$/.test(arg || '')) {
  show(`${arg} kayıtları`, query(`SELECT ${COLS}, ref FROM log WHERE ip = '${arg}' ORDER BY t DESC LIMIT 500`));
} else if (mode === 'saat' && /^\d{1,3}$/.test(arg || '')) {
  show(`Son ${arg} saat`, query(`SELECT ${COLS} FROM log WHERE t > ${Date.now() - Number(arg) * 3600000} ORDER BY t DESC LIMIT 500`));
} else {
  console.log('Kullanım: node scripts/ip-log.mjs [son | ozet | supheli | ip <adres> | saat <sayı>]');
}
