/* ===================================================================
   BINGO — service worker
   Makes the app installable (desktop + mobile) and keeps it usable if
   the connection drops mid-event, since all real game state already
   lives in localStorage and doesn't depend on the network at all.

   There's no build step / bundler here, so cache-busting is manual:
   bump CACHE_NAME whenever index.html/css/js/icons change, so
   activate() below throws out the old precached copies.
=================================================================== */

const CACHE_NAME = 'bingo-shell-v1';

const APP_SHELL = [
  './',
  './index.html',
  './display.html',
  './manifest.webmanifest',
  './css/styles.css',
  './js/state.js',
  './js/ocr.js',
  './js/ui.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon-180.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/**
 * Network-first, falling back to whatever was last cached: an operator
 * running a live bingo game always gets the freshest deploy while
 * online, and a dropped connection mid-event still serves the last
 * good copy instead of a browser error page. Only same-origin GET
 * requests are intercepted — third-party requests (the OCR library
 * from its CDN) are left to the browser's own handling.
 */
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        return res;
      })
      .catch(() => caches.match(req).then((cached) => cached || caches.match('./index.html')))
  );
});
