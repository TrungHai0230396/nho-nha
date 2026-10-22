#!/usr/bin/env bash
# Puts the Google OAuth client secret on Cloudflare as the Worker's
# GOOGLE_CLIENT_SECRET, which turns on "Đăng nhập bằng Google" (the client
# id is already in wrangler.jsonc). The secret is pasted into wrangler's own
# masked prompt, here, in Hải's own terminal: it never passes through a
# chat, a file, a command line (shell history, `ps`) or anything this
# script prints.
#
#   scripts/google-secret.sh
#
# No arguments, on purpose: a secret typed after the command name stays in
# the shell's history. And only from a terminal: piped in, it came from a
# file or an echo, which is a copy left somewhere. Running it again replaces
# the secret (after "Reset secret" in Google Cloud Console, say).
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/chung.sh

if [ "$#" -ne 0 ]; then
  # Never echo "$@": the argument may well be the secret.
  echo "Cách dùng: scripts/google-secret.sh (không kèm gì, khoá bí mật dán vào ô wrangler hỏi)."
  echo "Đừng gõ khoá bí mật lên dòng lệnh: nó nằm lại trong lịch sử Terminal. Chưa đổi gì."
  exit 1
fi
# Both ends a terminal: then wrangler asks with a masked prompt. With either
# one redirected it would not prompt at all, or read the paste unmasked.
if [ ! -t 0 ] || [ ! -t 1 ]; then
  echo "Chạy lệnh này trong Terminal của chính bạn (không qua tệp hay ống |), rồi dán khoá bí mật vào ô wrangler hỏi. Chưa đổi gì."
  exit 1
fi
login

echo
echo "Mở file JSON đã tải về từ Google (client_secret_….json), chép giá trị \"client_secret\" (bắt đầu bằng GOCSPX-),"
echo "dán vào ô dưới đây rồi Enter. Khi dán chỉ thấy dấu *."
npx wrangler secret put GOOGLE_CLIENT_SECRET
echo
echo "Đã lưu khoá bí mật lên Cloudflare: đăng nhập Google bật ngay, không cần deploy lại."
echo "Thử: mở app, bấm Đăng nhập bằng Google."
