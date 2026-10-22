#!/usr/bin/env bash
# How many devices run Nhớ Nha as the installed app, and how many in a
# browser tab, by kind of device: those seen in the last 30 days
# (worker/devices.ts). One read-only query; nothing is changed.
#
#   scripts/dem-may.sh
set -euo pipefail
cd "$(dirname "$0")/.."
. scripts/chung.sh

login
# The 30 days by the database's clock, not this Mac's.
sql="SELECT platform, standalone, COUNT(*) AS n FROM devices
  WHERE last_seen >= (CAST(strftime('%s', 'now') AS INTEGER) - 30 * 86400) * 1000
  GROUP BY platform, standalone"
err="$(mktemp)"
trap 'rm -f "$err"' EXIT
# Not judged by the exit code: wrangler puts what went wrong in its JSON too, read below.
out="$(npx wrangler d1 execute nho-nha --remote --json --command "$sql" 2>"$err" || true)"
if ! printf '%s' "$out" | node -e '
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let res;
  try {
    res = JSON.parse(s.slice(Math.max(0, s.search(/^[\[{]/m))));
  } catch {
    console.log("Không đọc được kết quả từ Cloudflare.");
    process.exit(1);
  }
  const error = res?.error?.text;
  if (error) {
    console.log(/no such table: devices/.test(error) ? "Trên Cloudflare chưa có bảng đếm máy: chạy scripts/deploy.sh trước." : `Cloudflare báo lỗi: ${error}`);
    process.exit(1);
  }
  const rows = Array.isArray(res) ? res[0]?.results : null;
  if (!Array.isArray(rows)) {
    console.log("Không đọc được kết quả từ Cloudflare.");
    process.exit(1);
  }
  const NAMES = { iphone: "iPhone", ipad: "iPad", android: "Android", mac: "Mac", windows: "Windows", other: "Khác" };
  const order = Object.keys(NAMES);
  const part = (standalone) => rows
    .filter((r) => Number(r.standalone) === standalone)
    .map((r) => ({ name: NAMES[r.platform] ?? String(r.platform), at: order.indexOf(r.platform), n: Number(r.n) }))
    .sort((a, b) => b.n - a.n || a.at - b.at);
  const sum = (list) => list.reduce((t, r) => t + r.n, 0);
  const installed = part(1);
  const tab = part(0);
  const day = new Date().toLocaleDateString("vi-VN");
  if (!sum(installed) && !sum(tab)) {
    console.log(`Chưa có máy nào mở Nhớ Nha trong 30 ngày qua (tính đến ${day}).`);
    return;
  }
  const lines = (list) => list.map((r) => `  ${r.name.padEnd(9)}${String(r.n).padStart(4)}`);
  console.log([
    `Máy mở Nhớ Nha trong 30 ngày qua (tính đến ${day}): ${sum(installed) + sum(tab)}`,
    "",
    `Đã cài app (mở từ màn hình chính, Dock hay cửa sổ riêng): ${sum(installed)}`,
    ...lines(installed),
    "",
    `Chỉ dùng trong trình duyệt: ${sum(tab)}`,
    ...lines(tab),
    "",
    "Mỗi trình duyệt, mỗi app là một máy. App cài từ Safari (iPhone, iPad, Mac) không dùng chung dữ liệu với Safari, nên người dùng ở Safari rồi mới cài được đếm ở cả hai phần.",
  ].join("\n"));
});
'; then
  # Whatever wrangler said besides, for when Cloudflare could not be asked at all.
  cat "$err"
  exit 1
fi
