#!/usr/bin/env bash
# One command to put the app online, and the same command for every update.
# Each step skips what is already done: log in, create the database, test,
# build and deploy, then make the notifications key the first time only.
#
#   scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/chung.sh

PLACEHOLDER="00000000-0000-0000-0000-000000000000"

step "1/4 Đăng nhập Cloudflare"
login

step "2/4 Cơ sở dữ liệu"
# The id in wrangler.jsonc must be the account's own database called nho-nha:
# a copy of this repo deployed from another account carries someone else's.
have="$(node -e 'process.stdout.write(/"database_id":\s*"([^"]*)"/.exec(require("fs").readFileSync("wrangler.jsonc","utf8"))?.[1]??"")')"
if ! id="$(db_id nho-nha)"; then
  if [ "$have" = "$PLACEHOLDER" ]; then
    echo "Không đọc được danh sách database từ Cloudflare — chạy lại lệnh này."
    exit 1
  fi
  # Cloudflare does not always answer (error 7403); the id written there is right on every run but a fork's first.
  echo "Không đọc được danh sách database từ Cloudflare; dùng database_id trong wrangler.jsonc."
  id="$have"
fi
if [ -z "$id" ]; then
  # --no-update-config: the config already has this binding, only its id is
  # missing; letting wrangler "add" it would write a second, clashing entry.
  npx wrangler d1 create nho-nha --location apac --no-update-config
  id="$(db_id nho-nha || true)"
  if [ -z "$id" ]; then
    echo "Không lấy được database_id. Chạy: npx wrangler d1 list"
    exit 1
  fi
fi
if [ "$id" != "$have" ]; then
  node -e 'const fs=require("fs");const f="wrangler.jsonc";fs.writeFileSync(f,fs.readFileSync(f,"utf8").replace(/("database_id":\s*")[^"]*"/,(_,a)=>`${a}${process.argv[1]}"`))' "$id"
  echo "Đã ghi database_id vào wrangler.jsonc — nhớ commit file này."
else
  echo "Cơ sở dữ liệu: đã có từ trước."
fi

step "3/4 Kiểm tra, build"
pnpm install --frozen-lockfile >/dev/null
pnpm test
npx vite build

step "4/4 Đưa lên mạng"
log="$(mktemp)"
# The database first, then the code, never the code alone: new code on an
# old database breaks.
run=(sh -c 'npx wrangler d1 migrations apply nho-nha --remote && npx wrangler deploy')
if [ -t 0 ] && [ -t 1 ]; then
  # `script` keeps a real terminal, so wrangler can still ask its first-time
  # questions ("apply migrations?"), while the output is saved to read the address from.
  script -q "$log" "${run[@]}" || true
else
  "${run[@]}" 2>&1 | tee "$log" || true
fi
# Success is judged by wrangler naming the version it put live, not by exit
# codes: script(1) does not reliably pass the child's status through.
live="$(grep -c "Current Version ID" "$log" || true)"
url="$(grep -Eo "https://[A-Za-z0-9-]+\.[A-Za-z0-9-]+\.workers\.dev" "$log" | head -1 || true)"
rm -f "$log"
if [ "$live" = 0 ]; then
  echo
  echo "Chưa thấy bản mới được đưa lên — xem lỗi ở trên rồi chạy lại lệnh này."
  exit 1
fi
# PUBLIC_ORIGIN when it is set (a front door or a domain of one's own), the
# Worker's own address otherwise, which is there only with "workers_dev": true.
home="$(node -e 'process.stdout.write(/"PUBLIC_ORIGIN":\s*"([^"]*)"/.exec(require("fs").readFileSync("wrangler.jsonc","utf8"))?.[1]??"")')"
if [ -n "$home" ]; then
  echo "App đang chạy ở: $home"
elif [ -n "$url" ]; then
  echo "App đang chạy ở: $url"
else
  echo
  echo "App đã lên nhưng chưa có địa chỉ: để PUBLIC_ORIGIN trống thì đặt \"workers_dev\": true trong wrangler.jsonc, rồi chạy lại lệnh này."
  exit 1
fi

names="" listed=""
for _ in 1 2 3; do
  if names="$(secret_names)"; then
    listed=1
    break
  fi
  sleep 3
done
if [ -z "$listed" ]; then
  echo
  echo "Không đọc được danh sách khoá từ Cloudflare. App đã lên bản mới; chạy lại lệnh này để làm nốt phần khoá."
  exit 1
fi

# Every phone's subscription is tied to it: made once, never again.
if printf '%s\n' "$names" | grep -qx VAPID_KEY; then
  echo "Khoá gửi thông báo: đã có từ trước."
elif new_vapid_key | npx wrangler secret put VAPID_KEY >/dev/null; then
  echo "Khoá gửi thông báo: vừa tạo, lưu thẳng vào Cloudflare (không in ra)."
else
  echo "Chưa tạo được khoá gửi thông báo — chạy lại lệnh này."
  exit 1
fi

if printf '%s\n' "$names" | grep -qx GOOGLE_CLIENT_SECRET; then
  echo "Đăng nhập Google: đã bật."
else
  echo "Đăng nhập Google: chưa bật. Làm theo README, mục \"Đăng nhập Google\", rồi chạy: scripts/google-secret.sh"
fi
