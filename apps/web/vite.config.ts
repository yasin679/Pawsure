import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig(({ mode }) => {
  /**
   * `vite build --mode demo` builds the shareable in-browser demo: the API and database run inside the page,
   * paths are relative (it is served from a sub-path), and there is no service worker (artifact frames forbid them).
   */
  if (mode === 'demo') return {
    base: './',
    plugins: [react()],
    // The demo's data lives only in each visitor's browser, so its code-card key is a fixed, non-secret demo key.
    define: { 'process.env.CODE_CARD_KEY': JSON.stringify(Buffer.alloc(32, 'pawsure-demo').toString('base64')), 'process.env': '{}' },
    resolve: {
      alias: {
        'node:crypto': here('./src/demo/shims/crypto.ts'),
        'node:fs': here('./src/demo/shims/node.ts'),
        'node:path': here('./src/demo/shims/node.ts'),
        'node:url': here('./src/demo/shims/node.ts'),
        pg: here('./src/demo/shims/node.ts'),
        'virtual:pwa-register': here('./src/demo/shims/pwa.ts')
      }
    },
    optimizeDeps: { exclude: ['@electric-sql/pglite'] },
    build: { outDir: 'dist-demo', target: 'es2022', rollupOptions: { input: here('./demo.html') } },
    worker: { format: 'es' }
  };
  return {
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
  };
});
