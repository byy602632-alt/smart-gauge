const CACHE_NAME = 'smart-gauge-v2';
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './assets/app.css',
  './assets/xdf.js',
  './assets/core.js',
  './assets/dash.js',
  './assets/tune.js',
  './assets/flash.js',
  './assets/home.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => response || fetch(event.request))
  );
});
