const CACHE_VERSION = 'v3.0.6-offline-mime-guard';
const OFFLINE_BUILD_ENABLED = false;
const OFFLINE_FEATURE_ENABLED = OFFLINE_BUILD_ENABLED || ['localhost', '127.0.0.1', '::1', '[::1]'].includes(self.location.hostname);
const CACHE_NAME = `cpoint-hris-${CACHE_VERSION}`;
const matchCached = request => caches.open(CACHE_NAME).then(cache => cache.match(request));

// Pre-cached static assets
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.png',
  '/favicon.svg',
  '/logo.png',
  '/logo-crop.png',
  '/logo-icon.png',
  '/logo-dark.png',
  '/logo-icon-dark.png',
  '/pwa-192x192.png',
  '/pwa-512x512.png',
  '/pwa-maskable.png',
  '/apple-touch-icon.png',
];

// Fallback timeout helper for network-first strategy
const timeoutPromise = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('NETWORK_TIMEOUT')), ms));

// Install: Complete offline assets before activation; do not interrupt existing tabs.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL.slice(0, 3));
      await Promise.allSettled(APP_SHELL.slice(3).map(asset => cache.add(asset)));
      if (!OFFLINE_FEATURE_ENABLED) return;
      const response = await fetch('/offline-assets.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Offline asset manifest is unavailable.');
      const manifest = await response.clone().json();
      if (manifest.schema_version !== 1 || !Array.isArray(manifest.assets) || !manifest.assets.some(asset => typeof asset === 'string' && asset.endsWith('.js')) || !manifest.assets.some(asset => typeof asset === 'string' && asset.endsWith('.css')) || manifest.assets.length > 500 || manifest.assets.some(asset => typeof asset !== 'string' || !/^\/assets\/[A-Za-z0-9_./-]+$/.test(asset) || asset.includes('..'))) throw new Error('Invalid offline asset manifest.');
      for (let offset = 0; offset < manifest.assets.length; offset += 10) {
        await Promise.all(manifest.assets.slice(offset, offset + 10).map(async asset => {
          const file = await fetch(asset, { cache: 'no-store' });
          if (!file.ok || file.headers.get('content-type')?.includes('text/html')) throw new Error('Offline asset download failed or returned HTML.');
          await cache.put(asset, file);
        }));
      }
      // Write readiness only after all dependencies passed download and MIME checks.
      await cache.put('/offline-assets.json', response);
    })
  );
});

// Activate: Delete outdated caches and claim clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key.startsWith('cpoint-hris-') && key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    }).then(() => {
      return self.clients.claim();
    }).then(() => {
      return self.clients.matchAll({ type: 'window' }).then((clients) => {
        clients.forEach((client) => {
          client.postMessage({ type: 'SW_UPDATED', version: CACHE_VERSION });
        });
      });
    })
  );
});

// Fetch handler
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Bypass worker for dynamic APIs, Supabase, and external services
  if (
    request.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !url.protocol.startsWith('http') ||
    url.pathname.startsWith('/api') ||
    url.hostname.includes('onrender.com') ||
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('googleapis.com')
  ) {
    return;
  }

  // Keep installed fallback HTML paired with its precached bundle until the next worker activates.
  // HTML page navigation: Network-first with fast timeout fallback
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      Promise.race([
        fetch(request).then((networkResponse) => {
          if (!networkResponse || networkResponse.status >= 500) throw new Error('Application unavailable.');
          return networkResponse;
        }),
        timeoutPromise(1200)
      ]).catch(async () => {
        if (OFFLINE_FEATURE_ENABLED && !['/', '/scanner', '/attendance-terminal', '/attendance-terminal/'].includes(url.pathname)) return new Response('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline attendance</title></head><body><h1>This page requires a connection.</h1><p>Only provisioned attendance capture is available offline.</p><a href="/attendance-terminal">Open attendance terminal</a></body></html>', { status: 503, headers: { 'Content-Type': 'text/html' } });
        const cached = await matchCached('/index.html') || await matchCached('/');
        if (cached) return cached;
        return new Response(
          '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>C-Point HRIS</title></head><body><h1>Application unavailable offline</h1><p>This browser has not downloaded the required application. Use the paper attendance procedure until connected.</p></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      })
    );
    return;
  }

  // Immutable hashed assets: Cache-first with strict MIME guard
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      matchCached(request).then(async (cached) => {
        if (cached) {
          const cachedType = cached.headers.get('content-type') || '';
          // Purge corrupted HTML cached under JS/CSS URLs
          if (cachedType.includes('text/html') && /\.(js|css|wasm)$/i.test(url.pathname)) {
            console.warn('[SW] Purging corrupted HTML cache for asset:', url.pathname);
            const cache = await caches.open(CACHE_NAME);
            await cache.delete(request);
          } else {
            return cached;
          }
        }

        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200) {
            const contentType = networkResponse.headers.get('content-type') || '';
            // Reject HTML fallback for JS/CSS assets
            if (contentType.includes('text/html') && /\.(js|css|wasm)$/i.test(url.pathname)) {
              console.error('[SW] Received HTML for asset script:', url.pathname);
              return new Response('Asset not found (MIME mismatch)', {
                status: 404,
                statusText: 'Not Found',
                headers: { 'Content-Type': 'text/plain' }
              });
            }
            const clone = networkResponse.clone();
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, clone);
          }
          return networkResponse;
        } catch (err) {
          console.warn('[SW] Asset fetch error:', url.pathname, err);
          return new Response('Asset unavailable', { status: 408, statusText: 'Request Timeout' });
        }
      })
    );
    return;
  }

  // Other static assets: Stale-while-revalidate with MIME guard
  if (!APP_SHELL.includes(url.pathname)) return;
  event.respondWith(
    matchCached(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200 && !['/', '/index.html'].includes(url.pathname)) {
          const contentType = networkResponse.headers.get('content-type') || '';
          const isCodeOrMedia = /\.(js|css|json|wasm|png|jpg|jpeg|svg|webp|ico|woff2?)$/i.test(url.pathname);
          if (!(isCodeOrMedia && contentType.includes('text/html'))) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// Skip waiting message listener
self.addEventListener('message', (event) => {
  if (event.data?.type === 'OFFLINE_STATUS' && event.ports?.[0]) {
    event.waitUntil(matchCached('/offline-assets.json').then(manifest => {
      event.ports[0].postMessage({ ready: OFFLINE_FEATURE_ENABLED && Boolean(manifest) });
    }));
  }
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// Web Push notifications
self.addEventListener('push', (event) => {
  let data = {
    title: 'C-Point HRIS',
    body: 'You have a new update in your HR portal.',
    icon: '/pwa-192x192.png',
    badge: '/logo-icon.png',
    url: '/employee/dashboard',
    tag: 'cpoint-notification'
  };

  if (event.data) {
    try {
      data = { ...data, ...event.data.json() };
    } catch {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon || '/pwa-192x192.png',
    badge: data.badge || '/logo-icon.png',
    vibrate: [100, 50, 100],
    data: {
      url: data.url || '/employee/dashboard',
      timestamp: data.timestamp || Date.now()
    },
    actions: [
      { action: 'open', title: 'Open Portal' }
    ],
    tag: data.tag || 'cpoint-notification',
    renotify: true,
    requireInteraction: false
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Notification click handler
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl);
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
