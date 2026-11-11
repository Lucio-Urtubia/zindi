#!/usr/bin/env bash
# Test sitesini Cloudflare Pages'e yükler: siteyi kurar, test ayarlarını (arama motorlarına kapalı, IP kaydı) ekler.
# Önce hangi Cloudflare hesabında olunduğu gösterilir; pages/.hesap dosyasındaki (depoya girmez) adresle
# aynı değilse yükleme yapılmaz.
set -euo pipefail
cd "$(dirname "$0")/.."
node scripts/build-site.mjs >/dev/null
rm -rf pages/public && cp -r _site pages/public && cp pages/static/_routes.json pages/static/_headers pages/static/robots.txt pages/public/
cd pages
WHO=$(npx.cmd --yes wrangler@4 whoami 2>&1 | grep -o "email [^ ]*" || true)
echo "Cloudflare: $WHO"
WANT=$(tr -d '[:space:]' < .hesap 2>/dev/null || true)
if [ -z "$WANT" ] || [[ "$WHO" != *"$WANT"* ]]; then echo "Hesap pages/.hesap ile aynı değil, yükleme yapılmadı."; exit 1; fi
for i in 1 2 3; do
  OUT=$(npx.cmd --yes wrangler@4 pages deploy --branch main --commit-dirty=true 2>&1 || true)
  if grep -q "complete" <<<"$OUT"; then grep "complete" <<<"$OUT"; exit 0; fi
  grep -E "ERROR|Failed" <<<"$OUT" || true
  echo "Yükleme olmadı, yeniden deneniyor…"
done
exit 1
