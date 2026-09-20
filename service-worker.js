const CACHE_NAME = "forget-me-not-v181";
const NETWORK_FIRST = new Set(["./src/runtime-config.js"]);
const APP_SHELL = [
  "./",
  "./index.html",
  "./privacy.html",
  "./terms.html",
  "./data-deletion.html",
  "./manifest.webmanifest",
  "./assets/icon-192.png",
  "./assets/icon-512.png",
  "./pics/magnifier.png",
  "./pics/gear.png",
  "./pics/brand/banner.png",
  "./src/app.js",
  "./src/account-deletion.js",
  "./src/native-file-export.js",
  "./src/config.js",
  "./src/crypto.js",
  "./src/native-trusted-session.js",
  "./src/native-oauth.js",
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
  event.waitUntil(precacheVersionedAppShell());
});

async function precacheVersionedAppShell() {
  const cache = await caches.open(CACHE_NAME);
  try {
    await Promise.all(APP_SHELL.map(async (path) => {
      const canonicalUrl = new URL(path, self.location.href);
      const fetchUrl = new URL(canonicalUrl);
      fetchUrl.searchParams.set("sw-version", CACHE_NAME);
      const response = await fetch(fetchUrl, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error(`app-shell-fetch-failed:${path}:${response.status}`);
      if (path === "./src/config.js") {
        const source = await response.clone().text();
        if (!source.includes(`cacheName: "${CACHE_NAME}"`)) throw new Error("app-shell-version-mismatch");
      }
      await cache.put(new Request(canonicalUrl, { credentials: "same-origin" }), response);
    }));
  } catch (error) {
    await caches.delete(CACHE_NAME);
    throw error;
  }
}

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
