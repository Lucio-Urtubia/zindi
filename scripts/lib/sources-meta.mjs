// Haber kaynağının türü: okuyucu "bunu kim söylüyor" sorusunun cevabını kartta görsün diye.
// RSS/Telegram kaynaklarının türü scripts/sources.json'daki "type" alanından gelir; GDELT haberlerinde
// kaynak bir alan adıdır ve aşağıdaki tablodan bulunur. Tabloda olmayan yabancı siteler "uluslararası" sayılır,
// tabloda olmayan Türkiye siteleri (.tr) etiketsiz kalır.
//   official: resmî / devlet medyası · kurdish: Kürt medyası · independent: bağımsız
//   mainstream: Türkiye ana akım · international: uluslararası

const DOMAINS = {
  official: ['aa.com.tr', 'trthaber.com', 'trtworld.com', 'trt.net.tr', 'irna.ir', 'presstv.ir', 'presstv.co.uk', 'tasnimnews.com',
    'sana.sy', 'ina.iq', 'wafa.ps', 'spa.gov.sa', 'wam.ae', 'idf.il'],
  kurdish: ['kurdistan24.net', 'rudaw.net', 'anfenglish.com', 'anfturkce.com', 'anfkurdi.com', 'anfarabic.com', 'hawarnews.com',
    'npasyria.com', 'basnews.com', 'kurdpress.com', 'medyanews.net', 'yeniyasamgazetesi9.com', 'jinhaagency.com', 'mezopotamyaajansi.com',
    'kurdistanchronicle.com', 'thenewregion.com', 'channel8.com', 'knnc.net'],
  independent: ['bianet.org', 'enabbaladi.net', 'medyascope.tv', 't24.com.tr'],
  mainstream: ['hurriyet.com.tr', 'hurriyetdailynews.com', 'milliyet.com.tr', 'sozcu.com.tr', 'haberturk.com', 'cnnturk.com', 'ntv.com.tr',
    'sabah.com.tr', 'dailysabah.com', 'haber7.com', 'haberler.com', 'cumhuriyet.com.tr', 'ensonhaber.com', 'yenisafak.com', 'star.com.tr'],
};
const BY_DOMAIN = new Map(Object.entries(DOMAINS).flatMap(([type, list]) => list.map((d) => [d, type])));

export function makeSourceTyper(sources) {
  const byName = new Map([...sources.rss, ...sources.telegram].map((f) => [f.name, f.type]));
  return (e) => {
    if (e.kind === 'rss' || e.kind === 'telegram') return byName.get(e.src);
    if (e.kind !== 'gdelt' || !e.src) return undefined;
    // Alt alan adları da eşleşir: english.aawsat.com → aawsat.com gibi.
    const host = e.src.toLowerCase().replace(/^www\./, '');
    for (let h = host; h.includes('.'); h = h.slice(h.indexOf('.') + 1)) if (BY_DOMAIN.has(h)) return BY_DOMAIN.get(h);
    return /\.tr$/.test(host) ? undefined : 'international';
  };
}
