// Sitenin ayarları.
window.CONFIG = {
  // Sokak fotoğrafları için Mapillary "Client Token" (MLY| ile başlar). Bu anahtar herkese açık kullanım içindir,
  // sitenin kodunda görünmesi sorun değildir. Almak için: https://www.mapillary.com/dashboard/developers
  // Tırnak işaretlerinin arasına yapıştırın:
  MAPILLARY_TOKEN: '',
  // Zindî yardımcı sunucusunun adresi (worker/, Cloudflare). Uçaklar ve site kapalıyken bildirim buradan gelir.
  // Boş bırakılırsa uçak katmanı ve kapalıyken bildirim gizlenir. Kurulum: YAYIN.md
  // Sunucu kurulunca adresi buraya yazılır (…workers.dev).
  API: '',
  // Bildirimlerin herkese açık VAPID anahtarı (gizli olanı GitHub'da VAPID_PRIVATE_KEY olarak durur).
  VAPID_PUBLIC_KEY: '',
  // Hakkında sayfasında görünen iletişim e-postası (isteğe bağlı; kişisel adres yazmayın).
  CONTACT: '',
};
