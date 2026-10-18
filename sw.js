/* Work Clock service worker: the app works fully offline.
   - Same-origin only. Cross-origin requests (e.g. the Sheets sync) never touch the cache.
   - Pages, scripts, styles and the manifest are network-first, so pushed updates apply on the next
     online open with no reinstall. Offline falls back to the cached copy.
   - Only successful, same-origin responses are ever cached (no error pages, no opaque responses). */
const CACHE = "workclock-v97";
const ASSETS = [
  "./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest",
  "./icon-192.png", "./icon-512.png", "./apple-touch-icon.png",
  "./icon-maskable-192.png", "./icon-maskable-512.png"
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function store(req, res) {
  if (res && res.ok && res.type === "basic") {
    const copy = res.clone();
    caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
  }
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;          // never intercept cross-origin traffic

  const networkFirst = req.mode === "navigate" || url.pathname.endsWith("/") ||
                       /\.(?:html|js|css|webmanifest)$/.test(url.pathname);
  if (networkFirst) {
    e.respondWith(
      fetch(req, { cache: "no-cache" }).then((res) => store(req, res))
        .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match("./index.html")))
    );
  } else {
    e.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => store(req, res)))
    );
  }
});
