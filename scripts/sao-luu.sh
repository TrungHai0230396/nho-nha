#!/usr/bin/env bash
# A copy of the database, encrypted, in a folder outside the repo: what D1's
# Time Travel (7 days on the free plan) cannot give back. The export blocks
# the database for a few seconds: run it at night, say once a week.
#
#   scripts/sao-luu.sh <folder> <age recipient (age1…), or a file of them>
#
# Needs age (brew install age). Only the public key is needed here; the
# private one, kept apart, is for restoring (VAN-HANH.md). The plaintext
# never stays on disk. The 8 newest copies are kept, the rest deleted.
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/chung.sh

dir="${1:-}" to="${2:-}"
if [ -z "$dir" ] || [ -z "$to" ]; then
  echo "Cách dùng: scripts/sao-luu.sh <thư mục> <khoá công khai age (age1…) hoặc file chứa khoá>"
  exit 1
fi
if ! command -v age >/dev/null; then
  echo "Cần age để mã hoá bản sao lưu: brew install age"
  exit 1
fi
mkdir -p "$dir"

login
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
npx wrangler d1 export nho-nha --remote --output "$tmp/nho-nha.sql" -y >/dev/null
if [ -f "$to" ]; then rcpt=(-R "$to"); else rcpt=(-r "$to"); fi
file="$dir/nho-nha-$(date +%Y-%m-%d-%H%M).sql.age"
age "${rcpt[@]}" -o "$file" "$tmp/nho-nha.sql"
ls -1t "$dir"/nho-nha-*.sql.age | tail -n +9 | while read -r old; do rm -f "$old"; done
echo "Đã sao lưu: $file"
