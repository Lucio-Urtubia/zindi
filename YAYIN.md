# GerdûnNews'i yayına alma

Sırayla yapılır. **Hesap açma, şifre ve anahtar girme adımlarını sen yaparsın**; kod tarafını Claude hazırlar.
Hiçbir adımda gerçek adını, kişisel e-postanı ya da eski hesaplarını kullanma.

## 1. Tarafsız e-posta
- Proton Mail'de (proton.me) adınla bağlantısız yeni bir adres aç. Bütün hesaplar bu adresle açılacak.
- Telefon numarası istenirse, ana numaranı vermemeyi tercih et.

## 2. Yeni GitHub hesabı
- github.com'da bu e-postayla yeni hesap aç. Kullanıcı adı tarafsız olsun (örnek: `zindi-map`).
- Ayarlar → Password and authentication → iki adımlı doğrulamayı (2FA) aç.
- Ayarlar → Emails → "Keep my email addresses private" işaretli olsun.
- Claude'a yeni kullanıcı adını söyle: kodu **temiz geçmişle** (eski kayıtlar olmadan) yeni bir herkese açık depoya hazırlar.

## 3. Cloudflare hesabı ve alan adı
- dash.cloudflare.com'da aynı e-postayla hesap aç.
- Domain Registration → Register Domains → alan adını al (ör. zindi.net, zindi.news). Cloudflare kişisel bilgileri
  WHOIS'te otomatik gizler.

## 4. GerdûnNews sunucusu (uçaklar + site kapalıyken bildirim)
Bilgisayarda, proje klasöründe terminalde:

```
cd worker
npx wrangler login
npx wrangler kv namespace create SUBS
```
- Son komutun yazdığı `id` değerini `worker/wrangler.toml` içindeki `BURAYA_KV_KIMLIGI` yerine yaz.
- `wrangler.toml` içinde `ALLOWED_ORIGINS` başına alan adını ekle: `"https://ALANADIN, http://localhost:8080"`
- Uzun, rastgele bir parola üret (ör. bir parola yöneticisiyle, 40+ karakter). Bu **PUSH_TOKEN**'dır:
```
npx wrangler secret put PUSH_TOKEN
npx wrangler deploy
```
- `deploy` sonunda yazan adres (…workers.dev) sunucunun adresidir → `config.js` içinde `API:` satırına yazılır.

## 5. Bildirim anahtarları (VAPID)
```
npx web-push generate-vapid-keys
```
- **Public Key** → `config.js` içinde `VAPID_PUBLIC_KEY` ve GitHub'da `VAPID_PUBLIC_KEY` gizli değişkeni.
- **Private Key** → sadece GitHub'da `VAPID_PRIVATE_KEY` gizli değişkeni. Hiçbir dosyaya yazma.

## 6. Diğer anahtarlar
- **Mapillary** (sokak fotoğrafları): mapillary.com/dashboard/developers'ta tarafsız hesapla yeni uygulama →
  Client Token → `config.js` içinde `MAPILLARY_TOKEN`. Şimdiki anahtar eski hesaba ait.
- İsteğe bağlı: Hakkında sayfasında görünecek iletişim adresi → `config.js` içinde `CONTACT`.

## 7. GitHub deposunun ayarları
Depo → Settings:
- **Secrets and variables → Actions → Secrets**: `PUSH_API` (4. adımdaki adres),
  `PUSH_TOKEN`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- **Secrets and variables → Actions → Variables**: `SITE_URL` = `https://ALANADIN/`
- **Pages → Source**: GitHub Actions
- **Secrets and variables → Actions → Variables**: `PAGES_ON` = `true` (bu olmadan yayın adımı atlanır; site yayına çıkmaz)
- **Pages → Custom domain**: alan adın; Cloudflare DNS'te GitHub'ın gösterdiği kayıtları ekle, "Enforce HTTPS"i aç.

## 8. Son kontrol
- `node scripts/build-site.mjs` hatasız bitmeli (`.yayin-yasak` dosyasındaki bir sözcük yayın dosyalarında geçerse durur).
- Actions sekmesinde "Verileri güncelle ve yayınla" elle bir kez çalıştırılır; yeşil biterse site yayındadır.

## Bilinmesi gerekenler
- Canlı TV yayınlarının çoğu yayıncıların izni olmadan kullanılıyor; şikâyet gelirse ilgili kanal listeden çıkarılır
  (`app.js` → `TV_CHANNELS`).
- Veri her 15 dakikada bir `data` dalına tek kayıt olarak yazılır; ana dalın geçmişi büyümez.

## IP kaydı (istek kayıtları)
- Yardımcı sunucu (worker) ve Cloudflare Pages'teki site, gelen istekleri Cloudflare D1 veritabanına (`gerdun-log`)
  yazar: zaman, IP, ülke/şehir, internet sağlayıcısı, adres, tarayıcı. Tablo: `worker/schema/log.sql`.
- Site tarafı `pages/functions/_middleware.js`: sayfa açılışları, sitede olmayan adres istekleri (taramalar) ve GET dışı
  istekler. Resim/kod dosyaları ve dakikada bir yapılan veri istekleri kaydedilmez.
- Kayıtlar `LOG_DAYS` gün (şimdilik 30) saklanır, daha eskisini sunucu her gün siler (`worker/wrangler.toml`).
- Bakmak için: `node scripts/ip-log.mjs` (son kayıtlar), `ozet`, `supheli`, `ip <adres>`, `saat <sayı>`.
- GitHub Pages IP kaydı tutmaz; site GitHub Pages'te yayınlanırsa sadece sunucu tarafı kaydedilir. Site kaydı için
  site Cloudflare Pages'te yayınlanmalı (`bash pages/deploy.sh`, test sitesi böyle çalışıyor).
- Ücretsiz D1 sınırı günde 100.000 kayıttır; aşılırsa kayıt yazılmaz ama site çalışmaya devam eder.
