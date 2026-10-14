const CACHE_VERSION = 'v3.0.2-client-update';
const CACHE_NAME = `cpoint-hris-${CACHE_VERSION}`;

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

// Install: Complete the offline shell before activation; existing tabs retain their worker.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      await cache.addAll(APP_SHELL.slice(0, 3));
      await Promise.allSettled(APP_SHELL.slice(3).map(asset => cache.add(asset)));
      const response = await fetch('/offline-assets.json', { cache: 'no-store' });
      if (!response.ok) throw new Error('Offline asset manifest is unavailable.');
      const manifest = await response.clone().json();
      if (manifest.schema_version !== 1 || !Array.isArray(manifest.assets) || !manifest.assets.some(asset => typeof asset === 'string' && asset.endsWith('.js')) || !manifest.assets.some(asset => typeof asset === 'string' && asset.endsWith('.css')) || manifest.assets.length > 500 || manifest.assets.some(asset => typeof asset !== 'string' || !asset.startsWith('/assets/') || asset.includes('..'))) throw new Error('Invalid offline asset manifest.');
      await cache.addAll(manifest.assets);
      // This marker is written only after every required dependency is cached.
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

  // HTML page navigation: Network-first with fast timeout fallback
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      Promise.race([
        fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put('/index.html', clone));
          }
          if (!networkResponse || networkResponse.status >= 500) throw new Error('Application unavailable.');
          return networkResponse;
        }),
        timeoutPromise(1200)
      ]).catch(async () => {
        if (!['/', '/scanner', '/attendance-terminal', '/attendance-terminal/'].includes(url.pathname)) return new Response('<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Offline attendance</title></head><body><h1>This page requires a connection.</h1><p>Only provisioned attendance capture is available offline.</p><a href="/attendance-terminal">Open attendance terminal</a></body></html>', { status: 503, headers: { 'Content-Type': 'text/html' } });
        const cached = await caches.match('/index.html') || await caches.match('/');
        if (cached) return cached;
        return new Response(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>C-Point HRIS</title></head><body><h1>Attendance terminal unavailable</h1><p>This device has not downloaded the offline application. Use the paper attendance procedure until connected.</p></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      })
    );
    return;
  }

  // Immutable hashed assets: Cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return networkResponse;
        }).catch((err) => {
          console.warn('[SW] Asset fetch error:', url.pathname, err);
          return cached;
        });
      })
    );
    return;
  }

  // Other static assets: Stale-while-revalidate
  if (!APP_SHELL.includes(url.pathname)) return;
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});

// Skip waiting message listener
self.addEventListener('message', (event) => {
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
    } catch (e) {
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
