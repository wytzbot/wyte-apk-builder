const CACHE_NAME = "wyte-v1";
const URLS_TO_CACHE = [
  "/",
  "/index.html",
  "/app.js",
  "/data.js",
  "/tracker.js",
  "/store.js",
  "/ui.js",
  "/settings.js",
  "/history.js",
  "/manifest.json",
  "/service-worker.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(URLS_TO_CACHE).catch(() => {
        console.warn("Some files could not be cached during install");
      });
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((n) => n !== CACHE_NAME)
          .map((n) => caches.delete(n))
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);

  if (url.pathname.includes("/api/") || url.hostname.includes("github.com")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((c) => c.put(request, response.clone()));
          }
          return response;
        })
        .catch(() =>
          caches
            .match(request)
            .then((cached) => cached || new Response("Offline", { status: 503 }))
        )
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request)
        .then((response) => {
          if (!response || response.status !== 200) return response;
          caches.open(CACHE_NAME).then((c) => c.put(request, response.clone()));
          return response;
        })
        .catch(() => new Response("Offline", { status: 503 }));
    })
  );
});
