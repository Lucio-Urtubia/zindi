// Gemiler — AISStream (ücretsiz, anahtar gerekir). Anahtar GitHub'da gizli değişken olarak durur: AISSTREAM_API_KEY.
// Sitenin sürekli çalışan bir sunucusu olmadığı için gemiler canlı akmaz: her güncellemede bölgeyi
// LISTEN_MS boyunca dinleyip o anki görüntüyü data/ships.json'a yazarız.
import fs from 'node:fs/promises';
import path from 'node:path';
import { REGION } from './region.mjs';
import PORTS from './ports.json' with { type: 'json' };

// Varış yeri: AIS'te elle yazılır ("TRMER", "TR IST", "TRIST>EGPSD", "PAROS", "HADERA PORT").
// Önce UN/LOCODE kodu denenir, olmazsa liman adı; aynı adlı birden çok liman varsa gemiye en yakını seçilir.
const norm = (x) => x.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Z0-9 ]/g, ' ').replace(/s+/g, ' ').trim();
const BY_NAME = new Map();
for (const [code, [, , name]] of Object.entries(PORTS)) {
  // "El Iskandariya (Alexandria)" gibi adlarda parantez içindeki ad da aranır.
  for (const part of name.split(/[()]/).map(norm).filter(Boolean)) (BY_NAME.get(part) || BY_NAME.set(part, []).get(part)).push(code);
}
const NOISE = /(PORT|PORTO|ANCH|ANCHORAGE|OPL|ROADS?|FOR ORDERS|ORDERS|PILOT|STATION|OFF|HARBOU?R|TERMINAL|LIMANI)/g;
function findPort(dest, lat, lon) {
  let d = dest.toUpperCase();
  if (d.includes('>')) d = d.split('>').pop(); // "nereden>nereye"
  d = norm(d);
  const compact = d.replace(/ /g, '');
  if (/^[A-Z]{2}[A-Z0-9]{3}$/.test(compact) && PORTS[compact]) return compact;
  const name = d.replace(NOISE, ' ').replace(/s+/g, ' ').trim();
  // "GR RHODES" gibi başta ülke kodu olan yazımlar da denenir.
  const codes = BY_NAME.get(name) || BY_NAME.get(name.replace(/^[A-Z]{2} /, '')) || BY_NAME.get(name.split(' ')[0]);
  if (!codes) return null;
  const dist = (c) => (PORTS[c][0] - lat) ** 2 + (PORTS[c][1] - lon) ** 2;
  return codes.slice().sort((a, b) => dist(a) - dist(b))[0];
}
function setDestination(s) {
  delete s.destPort;
  if (!s.dest || s.lat == null) return;
  const code = findPort(s.dest, s.lat, s.lon);
  if (code) s.destPort = [PORTS[code][0], PORTS[code][1], PORTS[code][2], code];
}
// AIS tahmini varışı yıl içermez: ay/gün/saat/dakika (UTC). Geçmişte kalıyorsa bir sonraki yıldır.
function etaOf(e) {
  if (!e?.Month || !e?.Day || e.Month > 12 || e.Day > 31 || e.Hour > 23 || e.Minute > 59) return undefined;
  const now = new Date();
  let t = Date.UTC(now.getUTCFullYear(), e.Month - 1, e.Day, e.Hour, e.Minute);
  if (t < Date.now() - 30 * 86400e3) t = Date.UTC(now.getUTCFullYear() + 1, e.Month - 1, e.Day, e.Hour, e.Minute);
  return t;
}

const LISTEN_MS = Number(process.env.SHIPS_LISTEN_MS || 60000);
const KEEP_MS = 3 * 3600e3; // 3 saattir sinyal vermeyen gemi listeden düşer

// AIS gemi tipi kodu -> kategori
function shipType(code) {
  if (code === 35) return 'military';
  if (code === 30) return 'fishing';
  if (code >= 60 && code <= 69) return 'passenger';
  if (code >= 70 && code <= 79) return 'cargo';
  if (code >= 80 && code <= 89) return 'tanker';
  return 'other';
}

export { setDestination };

export async function updateShips(dataDir) {
  // Kopyalarken yanına gelen boşluk ya da satır sonu anahtarı geçersiz kılar; temizlenir.
  const key = (process.env.AISSTREAM_API_KEY || '').trim().replace(/^["']|["']$/g, '');
  if (!key) return; // anahtar yoksa gemi katmanı boş kalır
  const file = path.join(dataDir, 'ships.json');
  const ships = new Map();
  try {
    const old = JSON.parse(await fs.readFile(file, 'utf8'));
    for (const s of old.ships) if (Date.now() - s.seen < KEEP_MS) ships.set(s.mmsi, s);
  } catch {}

  let messages = 0;
  // Bağlantının nasıl bittiği ships.json'a da yazılır: sorun olursa dışarıdan görülebilsin (anahtarın kendisi yazılmaz).
  const status = { opened: false, closeCode: null, error: '' };
  await new Promise((resolve) => {
    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    const done = () => { try { ws.close(); } catch {} resolve(); };
    const timer = setTimeout(done, LISTEN_MS);
    ws.addEventListener('open', () => (status.opened = true) && ws.send(JSON.stringify({
      APIKey: key,
      BoundingBoxes: [[[REGION.minLat, REGION.minLon], [REGION.maxLat, REGION.maxLon]]],
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    })));
    ws.addEventListener('message', async (ev) => {
      let m;
      try { m = JSON.parse(typeof ev.data === 'string' ? ev.data : await ev.data.text()); } catch { return; }
      if (m.error) { status.error = String(m.error).slice(0, 200); return; }
      const meta = m.MetaData || {};
      const mmsi = String(meta.MMSI || '');
      if (!mmsi) return;
      messages++;
      const s = ships.get(mmsi) || { mmsi, name: '', type: 'other' };
      if (meta.ShipName?.trim()) s.name = meta.ShipName.trim();
      if (m.MessageType === 'PositionReport') {
        const p = m.Message.PositionReport;
        s.lat = Math.round(p.Latitude * 1e4) / 1e4;
        s.lon = Math.round(p.Longitude * 1e4) / 1e4;
        s.sog = p.Sog;
        s.cog = p.Cog;
        s.hdg = p.TrueHeading !== 511 ? p.TrueHeading : p.Cog;
        s.seen = Date.now();
      } else if (m.MessageType === 'ShipStaticData') {
        const d = m.Message.ShipStaticData;
        s.type = shipType(d.Type);
        if (d.Destination?.trim()) s.dest = d.Destination.trim();
        if (d.ImoNumber) s.imo = d.ImoNumber;
        if (d.CallSign?.trim()) s.call = d.CallSign.trim();
        const len = (d.Dimension?.A || 0) + (d.Dimension?.B || 0), wid = (d.Dimension?.C || 0) + (d.Dimension?.D || 0);
        if (len) { s.len = len; s.wid = wid; }
        if (d.MaximumStaticDraught) s.draught = d.MaximumStaticDraught;
        s.eta = etaOf(d.Eta);
      }
      ships.set(mmsi, s);
    });
    ws.addEventListener('error', (e) => { status.error ||= `bağlantı hatası ${e.message || ''}`.trim(); clearTimeout(timer); done(); });
    ws.addEventListener('close', (e) => { status.closeCode = e.code; clearTimeout(timer); resolve(); });
  });

  const list = [...ships.values()].filter((s) => s.lat != null && s.seen);
  for (const s of list) setDestination(s);
  await fs.writeFile(file, JSON.stringify({ updated: Date.now(), messages, status, ships: list }));
  console.log(`Gemiler: ${messages} mesaj, ${list.length} gemi`, status.error || '');
}
