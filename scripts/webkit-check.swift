// Opens the app in WebKit (Safari's engine) at iPhone size, signs in with a
// pairing code, types a line, opens a note, measures, and saves snapshots:
// what Chrome and jsdom cannot show (Safari layout, fonts, sticky, dvh).
//
//   swiftc -O scripts/webkit-check.swift -o /tmp/webkit-check -framework WebKit -framework AppKit
//   /tmp/webkit-check <8-character pairing code from Cài đặt> <folder for the PNGs>
//
// Needs `pnpm dev` running on 127.0.0.1:8787. `swift scripts/…` (the
// interpreter) cannot find WebKit's Swift symbols: compile it. The window is
// off screen, so CSS animations stand still on their first frame; the script
// turns them off before measuring, and numbers beat squinting at pictures.
import AppKit
import WebKit

let args = CommandLine.arguments
let code = args[1]
let out = URL(fileURLWithPath: args[2])
let base = URL(string: "http://127.0.0.1:8787/")!

final class Runner: NSObject, WKNavigationDelegate {
  let web: WKWebView
  var step = 0
  var loaded: (() -> Void)?
  init(frame: NSRect) {
    let cfg = WKWebViewConfiguration()
    cfg.websiteDataStore = .nonPersistent()
    web = WKWebView(frame: frame, configuration: cfg)
    web.customUserAgent = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1"
    super.init()
    web.navigationDelegate = self
  }
  func webView(_ w: WKWebView, didFinish n: WKNavigation!) { let l = loaded; loaded = nil; l?() }
  func load(_ url: URL, then: @escaping () -> Void) { loaded = then; web.load(URLRequest(url: url)) }
  func js(_ s: String, then: @escaping (Any?) -> Void) {
    web.callAsyncJavaScript(s, arguments: [:], in: nil, in: .page) { r in
      switch r { case .success(let v): then(v); case .failure(let e): print("JS error:", e); then(nil) }
    }
  }
  func snap(_ name: String, then: @escaping () -> Void) {
    let c = WKSnapshotConfiguration()
    web.takeSnapshot(with: c) { img, err in
      if let img = img, let tiff = img.tiffRepresentation, let rep = NSBitmapImageRep(data: tiff), let png = rep.representation(using: .png, properties: [:]) {
        try? png.write(to: out.appendingPathComponent(name)); print("saved", name)
      } else { print("snapshot failed", err as Any) }
      then()
    }
  }
}

let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let frame = NSRect(x: 0, y: 0, width: 390, height: 844)
let win = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
let r = Runner(frame: frame)
win.contentView = r.web
win.orderFrontRegardless()

let noAnim = "const s=document.createElement('style');s.textContent='*,*::before,*::after{animation:none!important;transition:none!important}';document.head.appendChild(s);"
let wait = "await new Promise(r=>setTimeout(r,900));"

r.load(base) {
  r.js("\(wait) const res = await fetch('/api/pair',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({code:'\(code)'})}); return res.status;") { st in
    print("pair status:", st ?? "nil")
    r.load(base) {
      r.js("\(noAnim) \(wait) await new Promise(r=>setTimeout(r,1200)); const q=s=>document.querySelector(s); const c=q('.composer').getBoundingClientRect(); const t=q('.top').getBoundingClientRect(); return JSON.stringify({main:!!q('.feed'), notes:document.querySelectorAll('.note').length, composerTop:Math.round(c.top), composerH:Math.round(c.height), vh:innerHeight, topH:Math.round(t.height), font:getComputedStyle(document.body).fontFamily.slice(0,30), fontsOk:document.fonts.check('16px \"Plus Jakarta Sans\"', 'Nhớ')});") { m in
        print("main:", m ?? "nil")
        r.snap("1-main.png") {
          r.js("\(noAnim) const ta=document.getElementById('compose'); const set=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set; set.call(ta,'thứ 6 tuần sau 9h nộp báo cáo quý cho phòng kế toán, nhớ in 2 bản!'); ta.dispatchEvent(new Event('input',{bubbles:true})); await new Promise(r=>setTimeout(r,400)); const b=ta.getBoundingClientRect(); return JSON.stringify({taH:Math.round(b.height), overflow:getComputedStyle(ta).overflowY, understood: document.querySelector('.understood')?.innerText});") { m in
            print("typing:", m ?? "nil")
            r.snap("2-typing.png") {
              r.js("\(noAnim) document.querySelector('.note .open').click(); await new Promise(r=>setTimeout(r,500)); const d=document.querySelector('.sheet').getBoundingClientRect(); return JSON.stringify({sheetTop:Math.round(d.top), sheetH:Math.round(d.height), bodyOverflow:getComputedStyle(document.body).overflow});") { m in
                print("sheet:", m ?? "nil")
                r.snap("3-sheet.png") { app.terminate(nil) }
              }
            }
          }
        }
      }
    }
  }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 40) { print("timeout"); app.terminate(nil) }
app.run()
