// Service worker for the technician app (/crew). It keeps the app shell and photos available
// with no signal. Work itself is saved by the app in IndexedDB and synced when signal returns.
const CACHE = "cc-crew-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // The app page: network first so updates arrive, cached copy when offline.
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put("/crew", copy));
          }
          return res;
        })
        .catch(() => caches.match("/crew").then((hit) => hit || Response.error())),
    );
    return;
  }

  // Build assets and photos never change at a given address: cache first.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/p/") || /^\/(icon|apple-icon|manifest)/.test(url.pathname)) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});
