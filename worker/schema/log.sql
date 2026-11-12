-- Ziyaret/istek kayıtları (IP kaydı). Hem yardımcı sunucu (worker) hem site (Pages) buraya yazar.
-- Eski kayıtlar sunucunun günlük zamanlanmış görevinde silinir (LOG_DAYS gün).
CREATE TABLE IF NOT EXISTS log (
  t INTEGER NOT NULL,      -- zaman (ms)
  ip TEXT,                 -- ziyaretçinin IP adresi (CF-Connecting-IP)
  country TEXT, city TEXT, -- Cloudflare'in tahmini
  asn INTEGER, org TEXT,   -- ağ (internet sağlayıcısı / sunucu şirketi)
  method TEXT, host TEXT, path TEXT, status INTEGER,
  ua TEXT, ref TEXT,
  src TEXT                 -- 'site' ya da 'api'
);
CREATE INDEX IF NOT EXISTS log_t ON log(t);
CREATE INDEX IF NOT EXISTS log_ip ON log(ip, t);

-- İçerik bildirimleri (uygulamadaki "Bildir" düğmesi). Mağaza kuralı: uygunsuz içerik bildirilebilmeli.
CREATE TABLE IF NOT EXISTS report (
  t INTEGER NOT NULL,
  ip TEXT,
  eid TEXT,     -- haberin kimliği
  url TEXT,
  title TEXT,
  src TEXT
);
CREATE INDEX IF NOT EXISTS report_t ON report(t);
