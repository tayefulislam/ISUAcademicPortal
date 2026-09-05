import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiOrigin = (() => {
    try {
      return new URL(env.VITE_API_URL || 'http://localhost:7050/api').origin;
    } catch {
      return null;
    }
  })();

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false, // registered manually in main.jsx for a custom update toast
        includeAssets: ['favicon.png', 'icons/*.png'],
        manifest: {
          name: 'ISU Academic Portal',
          short_name: 'ISU Portal',
          description: 'Find and manage academic files by department, course, and batch.',
          theme_color: '#2848d6',
          background_color: '#ffffff',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          orientation: 'portrait-primary',
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          navigateFallbackDenylist: [/^\/uploads\//],
          runtimeCaching: [
            // API GET requests (departments/courses/files/search/etc) — serve
            // last-known-good instantly, refresh in the background. Never
            // caches non-GET requests (Workbox only intercepts GET by default).
            ...(apiOrigin
              ? [
                  {
                    urlPattern: ({ url }) => url.origin === apiOrigin,
                    handler: 'StaleWhileRevalidate',
                    options: {
                      cacheName: 'api-cache',
                      cacheableResponse: { statuses: [0, 200] },
                      expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 }, // 1 day
                    },
                  },
                ]
              : []),
            // Uploaded documents served from the backend's /uploads static route.
            ...(apiOrigin
              ? [
                  {
                    urlPattern: ({ url }) => url.origin === apiOrigin && url.pathname.startsWith('/uploads/'),
                    handler: 'CacheFirst',
                    options: {
                      cacheName: 'uploaded-files-cache',
                      cacheableResponse: { statuses: [0, 200] },
                      expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 }, // 7 days
                    },
                  },
                ]
              : []),
            // ImgBB / Uploadcare CDN images.
            {
              urlPattern: ({ url }) => url.hostname.endsWith('ibb.co') || url.hostname.endsWith('ucarecdn.com'),
              handler: 'CacheFirst',
              options: {
                cacheName: 'cdn-image-cache',
                cacheableResponse: { statuses: [0, 200] },
                expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 }, // 30 days
              },
            },
          ],
        },
      }),
    ],
    server: {
      port: 5160,
    },
  };
});
