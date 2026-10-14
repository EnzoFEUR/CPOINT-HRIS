const CACHE_VERSION = 'v3.0.5-mime-guard';
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
  'https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@2.44.0/tabler-icons.min.css'
];

// Fallback timeout helper for network-first strategy
const timeoutPromise = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('NETWORK_TIMEOUT')), ms));

// Install: Cache app shell and activate immediately
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(APP_SHELL).catch((err) => {
        console.warn('[SW] Pre-caching asset issue:', err);
      });
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
          return networkResponse;
        }),
        timeoutPromise(1200)
      ]).catch(async () => {
        const cached = await caches.match('/index.html') || await caches.match('/');
        if (cached) return cached;
        return new Response(
          '<!DOCTYPE html><html><head><meta charset="utf-8"><title>C-Point HRIS</title></head><body style="background:#090d16;color:#fff;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;"><p>Reconnecting to C-Point HRIS...</p><script>setTimeout(()=>window.location.reload(), 2000);</script></body></html>',
          { headers: { 'Content-Type': 'text/html' } }
        );
      })
    );
    return;
  }

  // Immutable hashed assets: Cache-first with strict MIME guard
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(async (cached) => {
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
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      const fetchPromise = fetch(request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
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
