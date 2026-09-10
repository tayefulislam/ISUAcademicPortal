import { precacheAndRoute, createHandlerBoundToURL } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { StaleWhileRevalidate, CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';

// injectManifest mode: vite-plugin-pwa injects the precache list here at
// build time — this is the one thing generateSW used to do for us for free.
precacheAndRoute(self.__WB_MANIFEST);

// generateSW auto-added an index.html SPA navigation fallback (denylisting
// /uploads/ so a direct link to an uploaded file never gets swapped for the
// app shell) — injectManifest doesn't do this for free, so it's ported
// explicitly to keep offline SPA-routing behavior identical.
registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/uploads\//] }));

// Ported 1:1 from the previous generateSW `workbox.runtimeCaching` config in
// vite.config.js (same cache names/limits, same cross-origin-aware API
// matching via VITE_API_URL) — moving to a custom SW source is only to add
// the push/notificationclick handlers below; existing offline caching
// behavior must stay identical.
const API_ORIGIN = (() => {
  try {
    return new URL(import.meta.env.VITE_API_URL || 'http://localhost:7050/api').origin;
  } catch {
    return null;
  }
})();

registerRoute(
  ({ url, request }) => request.method === 'GET' && API_ORIGIN && url.origin === API_ORIGIN,
  new StaleWhileRevalidate({
    cacheName: 'api-cache',
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] }), new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 })],
  })
);

registerRoute(
  ({ url }) => API_ORIGIN && url.origin === API_ORIGIN && url.pathname.startsWith('/uploads/'),
  new CacheFirst({
    cacheName: 'uploaded-files-cache',
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] }), new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 })],
  })
);

registerRoute(
  ({ url }) => url.hostname.endsWith('ibb.co') || url.hostname.endsWith('ucarecdn.com'),
  new CacheFirst({
    cacheName: 'cdn-image-cache',
    plugins: [new CacheableResponsePlugin({ statuses: [0, 200] }), new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })],
  })
);

// ----- Push notifications (spec §24) -----
// No secrets ever reach this file — only whatever the server chose to put
// in the push payload (title/body/url/type), which is already meant for
// the recipient's own eyes.

self.addEventListener('push', (event) => {
  let payload = { title: 'Notification', body: '', url: '/notifications' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch {
    // Non-JSON push payload — fall back to the defaults above.
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: payload.url },
      tag: payload.type || undefined,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/notifications';

  event.waitUntil(
    (async () => {
      const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = allClients.find((c) => new URL(c.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: 'notification-click', url: targetUrl });
      } else {
        await self.clients.openWindow(targetUrl);
      }
    })()
  );
});

self.skipWaiting();
