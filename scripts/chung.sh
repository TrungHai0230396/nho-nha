# Shared by the scripts that act on Cloudflare; sourced, not run.

# This Mac's default shell runs Node 16; wrangler needs 20 or newer.
NODE24="$HOME/.nvm/versions/node/v24.14.1/bin"
[ -d "$NODE24" ] && export PATH="$NODE24:$PATH"
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  echo "Cần Node 20 trở lên (đang có $(node -v))."
  exit 1
fi

step() { printf '\n\033[1m== %s\033[0m\n' "$1"; }

login() {
  if ! npx wrangler whoami --json >/dev/null 2>&1; then
    echo "Trình duyệt sẽ mở ra: chọn tài khoản Cloudflare sẽ chạy app rồi bấm Allow."
    npx wrangler login
  fi
  echo "Đã đăng nhập."
}

# Prints the id of the D1 database called $1 in the account signed in, or
# nothing when there is none. Fails when Cloudflare cannot be asked, which
# must never read as "there is none": a second database would be made.
db_id() {
  npx wrangler d1 list --json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const l=JSON.parse(s);if(!Array.isArray(l))throw 0;process.stdout.write(l.find(d=>d.name===process.argv[1])?.uuid??"")}catch{process.exit(1)}})' "$1"
}

# The Worker's secrets, one name a line. Fails when Cloudflare cannot be
# asked (it does now and then: error 7403), and that must never read as
# "not there": a new VAPID_KEY silences every phone that turned
# notifications on.
secret_names() {
  npx wrangler secret list --format json 2>/dev/null |
    node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const l=JSON.parse(s);if(!Array.isArray(l))throw 0;process.stdout.write(l.map(x=>x.name).join("\n"))}catch{process.exit(1)}})'
}

# A new VAPID key, as the JWK the Worker reads, on stdout only: piped
# straight into `wrangler secret put`, never printed, never in a file.
new_vapid_key() {
  node -e 'crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},true,["sign"]).then(k=>crypto.subtle.exportKey("jwk",k.privateKey)).then(j=>process.stdout.write(JSON.stringify({kty:j.kty,crv:j.crv,x:j.x,y:j.y,d:j.d})))'
}
