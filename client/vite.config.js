import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ mode }) => {
  loadEnv(mode, process.cwd(), ''); // ensures VITE_* env vars are loaded for src/sw.js's own import.meta.env access

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false, // registered manually in main.jsx for a custom update toast
        // injectManifest (not generateSW) — the SW needs custom push /
        // notificationclick handlers (src/sw.js), which generateSW's fully
        // auto-generated service worker has no hook for.
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.js',
        injectManifest: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        },
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
        // Runtime-caching rules now live in src/sw.js itself (injectManifest
        // mode has no `workbox.runtimeCaching` option — that's generateSW-only).
      }),
    ],
    server: {
      port: 5160,
    },
  };
});
