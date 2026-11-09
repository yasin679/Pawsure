import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'assets/design-board.jpg'],
      manifest: {
        name: 'Pawsure', short_name: 'Pawsure', description: 'Be sure, whoever’s caring.',
        theme_color: '#FFC400', background_color: '#FFFDF0', display: 'standalone', start_url: '/', scope: '/',
        icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
      },
      workbox: { navigateFallback: '/index.html', runtimeCaching: [{ urlPattern: ({ url }) => url.pathname.startsWith('/v1/'), handler: 'NetworkFirst', options: { cacheName: 'api', networkTimeoutSeconds: 5 } }] }
    })
  ],
  server: { port: 5173 }
});
