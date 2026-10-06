/* Update VERSION whenever any app-shell file changes. TXT lives in IndexedDB,
   not this cache; an app update must never clear the bookshelf database. */
'use strict';
const VERSION = '2.3.2-r2';
const SCOPE = self.registration.scope;
const PREFIX = 'offline-txt-shell:' + encodeURIComponent(SCOPE) + ':';
const CACHE = PREFIX + VERSION;
const FILES = ['index.html', 'styles.css', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
const URLS = FILES.map(path => new URL(path, SCOPE).href);
const HOME = new URL('index.html', SCOPE).href;

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Installation fails as a whole when a required asset cannot be downloaded.
    await cache.addAll(URLS.map(url => new Request(url, { cache: 'reload' })));
    // Do not skipWaiting: an update should not mix old UI and new resources.
    // First install activates automatically; updates activate after old tabs close.
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(PREFIX) && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(SCOPE)) return;
  const canonical = url.origin + url.pathname;
  const isHome = request.mode === 'navigate' &&
    (canonical === HOME || canonical === SCOPE);
  if (!isHome && !URLS.includes(canonical)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    let key = canonical;
    if (isHome) key = HOME;
    const cached = await cache.match(key);
    if (cached) return cached;
    // Recovery if a single cache entry was removed while online.
    try {
      const response = await fetch(new Request(key, { cache: 'reload' }));
      if (response.ok && response.type !== 'opaque') await cache.put(key, response.clone());
      return response;
    } catch {
      return new Response('오프라인 앱 파일이 없습니다. 인터넷 연결 후 다시 열어 주세요.', {
        status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' }
      });
    }
  })());
});

self.addEventListener('message', event => {
  if (event.data?.type !== 'CHECK_OFFLINE' || !event.ports[0]) return;
  const port = event.ports[0];
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(CACHE);
      let checks = await Promise.all(URLS.map(url => cache.match(url)));
      if (event.data.repair) {
        const missingURLs = URLS.filter((_, index) => !checks[index]);
        if (missingURLs.length) await cache.addAll(missingURLs.map(url => new Request(url, { cache: 'reload' })));
        checks = await Promise.all(URLS.map(url => cache.match(url)));
      }
      const missing = FILES.filter((_, index) => !checks[index]);
      port.postMessage({ ready: missing.length === 0, version: VERSION, missing });
    } catch (error) {
      port.postMessage({ ready: false, version: VERSION, error: String(error) });
    }
  })());
});
