// Template for dist/sw.js: the plugin in vite.config.ts fills in the two
// placeholders below with a content hash and the list of built files.
const CACHE = "nho-nha-__VERSION__";
const PRECACHE = __PRECACHE__;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("nho-nha-") && k !== CACHE).map((k) => caches.delete(k)))),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Data always comes from the network: the app keeps its own offline copy.
  if (url.pathname.startsWith("/api/")) return;
  if (req.mode === "navigate") {
    // Only the app itself opens with no signal. Signing in, Google's return
    // and the privacy page are the Worker's own pages: answered with the
    // app's shell, Google's return would never reach the Worker.
    if (url.pathname !== "/" && !url.pathname.startsWith("/cai/")) return;
    event.respondWith(caches.match("/", { cacheName: CACHE }).then((hit) => hit || fetch(req)));
    return;
  }
  if (url.pathname.endsWith("/manifest.webmanifest")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          if (res.ok) void caches.open(CACHE).then((cache) => cache.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((hit) => hit || Response.error())),
    );
    return;
  }
  event.respondWith(caches.match(req, { cacheName: CACHE }).then((hit) => hit || fetch(req)));
});

// A reminder or the morning list (worker/cron.ts). Each is encrypted for
// this phone alone and carries its own words.
self.addEventListener("push", (event) => {
  let m = {};
  try {
    m = (event.data && event.data.json()) || {};
  } catch {
    // Unreadable: the plain words below still say something came.
  }
  const id = typeof m.id === "string" ? m.id : null;
  const tag = typeof m.tag === "string" && m.tag ? m.tag : "nho-nha";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const front = wins.some((w) => w.visibilityState === "visible");
      for (const w of wins) w.postMessage({ type: "push", id });
      // Shown every time, even with the app in front: a push that shows
      // nothing gets iPhone's "updated in the background", and after a few
      // of those it stops delivering. In front, it stays silent.
      const title = typeof m.title === "string" && m.title ? m.title : "Nhớ Nha";
      const options = {
        body: typeof m.body === "string" ? m.body : "",
        tag,
        renotify: true,
        silent: front,
        icon: "/icons/icon-192.png",
        badge: "/icons/badge-96.png",
        lang: "vi",
        data: { id },
      };
      // A reminder to answer gets "Xong" on it where the phone shows buttons (Android,
      // computers). iPhone shows none: a tap opens the note there. Should a browser refuse
      // the buttons outright, the plain notification still goes up: one must, every time.
      if (m.act !== true || !id) return self.registration.showNotification(title, options);
      return self.registration
        .showNotification(title, { ...options, actions: [{ action: "xong", title: "Xong" }] })
        .catch(() => self.registration.showNotification(title, options));
    }),
  );
});

// A tap on it: the app, with that note open to answer (Xong, +10 phút…).
// iPhone shows no buttons on a web app's notification, so this is the way.
// Its "Xong" button, where there is one: the app ticks the note off (only
// the app holds the note whole, to send it), with a toast to undo.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const id = event.notification.data && typeof event.notification.data.id === "string" ? event.notification.data.id : null;
  const xong = event.action === "xong" && id !== null;
  const target = id ? `/?n=${encodeURIComponent(id)}${xong ? "&xong=1" : ""}` : "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const win = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (win) {
        win.postMessage({ type: "open", id, xong });
        return win.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
