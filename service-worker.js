const CACHE_NAME = "forget-me-not-v53";
const NETWORK_FIRST = new Set(["./src/runtime-config.js"]);
const APP_SHELL = [
  "./",
  "./index.html",
  "./privacy.html",
  "./terms.html",
  "./manifest.webmanifest",
  "./assets/icon.svg",
  "./pics/magnifier.png",
  "./pics/gear.png",
  "./src/app.js",
  "./src/config.js",
  "./src/crypto.js",
  "./src/db.js",
  "./src/drive.js",
  "./src/drive-google.js",
  "./src/drive-mock.js",
  "./src/model.js",
  "./src/runtime-config.js",
  "./src/sync.js",
  "./src/xlsx.js",
  "./src/styles.css"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const requestUrl = new URL(event.request.url);
  const networkFirstUrls = [...NETWORK_FIRST].map((path) => new URL(path, self.location.href).href);
  if (networkFirstUrls.includes(requestUrl.href)) {
    event.respondWith(networkFirst(event.request));
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request).catch(() => caches.match("./index.html"));
    })
  );
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});
