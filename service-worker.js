const CACHE_NAME = "wyte-v2";
const URLS_TO_CACHE = [
  "/",
  "/index.html",
  "/app.js",
  "/data.js",
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

  // Never intercept/cache API calls or GitHub API calls — always hit the network.
  // The Cache API also can't store non-GET requests (POST, etc.), so caching
  // these was throwing and could mask real network errors.
  if (url.pathname.includes("/api/") || url.hostname.includes("github.com")) {
    event.respondWith(fetch(request));
    return;
  }

  if (request.method !== "GET") {
    event.respondWith(fetch(request));
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
