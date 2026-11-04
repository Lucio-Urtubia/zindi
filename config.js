// Sitenin ayarları.
window.CONFIG = {
  // Sokak fotoğrafları için Mapillary "Client Token" (MLY| ile başlar). Bu anahtar herkese açık kullanım içindir,
  // sitenin kodunda görünmesi sorun değildir. Almak için: https://www.mapillary.com/dashboard/developers
  // Tırnak işaretlerinin arasına yapıştırın:
  MAPILLARY_TOKEN: '',
  // Zindî yardımcı sunucusunun adresi (worker/, Cloudflare). Uçaklar ve site kapalıyken bildirim buradan gelir.
  // Boş bırakılırsa uçak katmanı ve kapalıyken bildirim gizlenir. Kurulum: YAYIN.md
  API: 'https://zindi.zindi.workers.dev',
  // Bildirimlerin herkese açık VAPID anahtarı (gizli olanı GitHub'da VAPID_PRIVATE_KEY olarak durur).
  VAPID_PUBLIC_KEY: 'BDPkWxJ4TOzveTQxjku6dAUlQDUTYPaw5XLvXEppgxZ_6vqR_COxP7pq7aexq0TPs5N2fPVM5zqIc7zHKOJXp7M',
  // Hakkında sayfasında görünen iletişim e-postası (isteğe bağlı; kişisel adres yazmayın).
  CONTACT: '',
};
