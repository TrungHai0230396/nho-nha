// Before the page first draws: the look picked in Cài đặt → Giao diện, as
// src/lib/look.ts left it (bootOf). Without it the app opened in teal, or
// white under a dark theme, and turned a moment later. A plain script on
// purpose: a module would run only after that first draw.
try {
  var b = JSON.parse(localStorage.getItem("nho-nha-look-boot") || "null");
  if (b && b.css) {
    var s = document.createElement("style");
    s.id = "look";
    s.textContent = b.css;
    document.head.appendChild(s);
  }
  if (b && b.wall) document.documentElement.setAttribute("data-wall", b.wall);
  if (b && b.bars) {
    var bars = document.querySelectorAll('meta[name="theme-color"]');
    for (var i = 0; i < bars.length; i++) bars[i].content = (bars[i].media || "").indexOf("dark") >= 0 ? b.bars[1] : b.bars[0];
  }
  var cs = b && b.scheme && document.querySelector('meta[name="color-scheme"]');
  if (cs) cs.content = b.scheme;
} catch (e) {
  // Storage shut or the value unreadable: the app's own look, as before.
}
