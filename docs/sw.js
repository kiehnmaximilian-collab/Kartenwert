// Offline support: keep the app and the text recognition files on the phone.
const VERSION = "kartenwert-v3";
const FILES = [
  "./", "index.html", "manifest.webmanifest", "js/main.js", "js/vision.js", "js/cards.js", "js/grade.js", "js/store.js",
  "icons/icon-192.png", "icons/icon-512.png",
  "vendor/tesseract.min.js", "vendor/worker.min.js", "vendor/tesseract-core-simd-lstm.wasm.js",
  "vendor/tesseract-core-lstm.wasm.js", "vendor/eng.traineddata.gz",
];
self.addEventListener("install", e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(
  caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;   // card database etc. go to the network
  // App files: network first (so updates arrive), cache when offline.
  e.respondWith(fetch(e.request, { cache: "no-cache" }).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});
