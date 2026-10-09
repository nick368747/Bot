const VERSION = "block-bande-pwa-v1";
const SHELL = ["/manifest.webmanifest", "/app-icon.svg"];
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(SHELL);
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== VERSION) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener("message", event => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET") return;
  // Login, Dashboard und API werden nie aus einem Cache ausgeliefert:
  // so bleiben Sitzungsschutz und aktuelle Server-Version erhalten.
  if (url.pathname === "/" || url.pathname === "/login" || url.pathname.startsWith("/api/")) {
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }
  if (SHELL.includes(url.pathname)) {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { cache: "no-store" });
        if (response.ok) {
          const cache = await caches.open(VERSION);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(request)) || Response.error();
      }
    })());
  }
});
