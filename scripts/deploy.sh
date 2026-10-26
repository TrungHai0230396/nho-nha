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
# The original instance's database and values, as this repo carries them: a
# copy changes the values first (README, "Tự chạy bản của riêng bạn", step 2).
ORIGINAL_DB="e2a721e6-e221-47bd-a44a-c264a4a5a39b"
var() { node -e 'process.stdout.write(new RegExp(`"${process.argv[1]}":\\s*"([^"]*)"`).exec(require("fs").readFileSync("wrangler.jsonc","utf8"))?.[1]??"")' "$1"; }

step "1/4 Đăng nhập Cloudflare"
login

step "2/4 Cơ sở dữ liệu"
# The id in wrangler.jsonc must be the account's own database called nho-nha:
# a copy of this repo deployed from another account carries someone else's.
have="$(var database_id)"
original=""
if [ "$(var PUBLIC_ORIGIN)" = "https://nho-nha.pages.dev" ] || [ "$(var CONTACT_EMAIL)" = "trunghhai@gmail.com" ]; then
  original=1
fi
if ! id="$(db_id nho-nha)"; then
  # A copy that has its own values but not yet its own database id would
  # carry on with the original's, and fail at the migrations.
  if [ "$have" = "$PLACEHOLDER" ] || { [ -z "$original" ] && [ "$have" = "$ORIGINAL_DB" ]; }; then
    echo "Không đọc được danh sách database từ Cloudflare — chạy lại lệnh này."
    exit 1
  fi
  # Cloudflare does not always answer (error 7403); the id written there is right on every run but a fork's first.
  echo "Không đọc được danh sách database từ Cloudflare; dùng database_id trong wrangler.jsonc."
  id="$have"
fi
# The original's values on an account that does not hold the original's
# database: a copy about to run as the original (its address, its email).
# NHO_NHA_ORIGINAL=1 is for the original itself, once, after its database
# was made again (VAN-HANH.md, "Sao lưu").
if [ -n "$original" ] && [ "$id" != "$have" ] && [ "${NHO_NHA_ORIGINAL:-}" != 1 ]; then
  echo "wrangler.jsonc vẫn ghi địa chỉ và email của bản gốc (PUBLIC_ORIGIN, CONTACT_EMAIL)."
  echo "Sửa theo README, mục \"Tự chạy bản của riêng bạn\", bước 2, rồi chạy lại lệnh này."
  exit 1
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
out="$(mktemp)"
trap 'rm -f "$out"' EXIT
# The database first, then the code, never the code alone: new code on an
# old database breaks. Straight in this terminal, so wrangler can still ask
# its first-time questions ("apply migrations?").
if npx wrangler d1 migrations apply nho-nha --remote; then
  # wrangler writes what it did there, a JSON object a line: the deploy's
  # names the version it put live, and the Worker's own address if it has one.
  WRANGLER_OUTPUT_FILE_PATH="$out" npx wrangler deploy || true
fi
deployed="$(node -e '
const lines = require("fs").readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
const d = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).reverse().find((e) => e?.type === "deploy" && e.version_id);
const dev = (d?.targets ?? []).find((t) => { try { return new URL(t).hostname.endsWith(".workers.dev"); } catch { return false; } });
process.stdout.write(d ? `${d.version_id} ${dev ?? ""}` : "");
' "$out")"
if [ -z "$deployed" ]; then
  echo
  echo "Chưa thấy bản mới được đưa lên — xem lỗi ở trên rồi chạy lại lệnh này."
  exit 1
fi
url="${deployed#* }"
# PUBLIC_ORIGIN when it is set (a front door or a domain of one's own), the
# Worker's own address otherwise, which is there only with "workers_dev": true.
home="$(var PUBLIC_ORIGIN)"
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
