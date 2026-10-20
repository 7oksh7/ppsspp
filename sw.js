// Offline cache + cross-origin isolation (the threaded emulator needs SharedArrayBuffer).
const VERSION = 'psp5-v1';
const SHELL = ['./', 'index.html', 'manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isolate(res) {
  if (!res || res.status === 0 || res.status === 206) return res;
  const h = new Headers(res.headers);
  h.set('Cross-Origin-Opener-Policy', 'same-origin');
  h.set('Cross-Origin-Embedder-Policy', 'require-corp');
  h.set('Cross-Origin-Resource-Policy', 'same-origin');
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const isEngine = req.url.includes('/build-wasm/');

    // Engine files never change between visits: cache-first. App shell: refresh in background.
    const refresh = fetch(req).then(res => {
      if (res.ok && res.status === 200) cache.put(req, res.clone());
      return res;
    });

    if (hit) {
      if (!isEngine) refresh.catch(() => {});
      return isolate(hit);
    }
    try {
      return isolate(await refresh);
    } catch (err) {
      const fallback = await cache.match('index.html');
      if (req.mode === 'navigate' && fallback) return isolate(fallback);
      return new Response('Offline and not cached yet.', { status: 503 });
    }
  })());
});
