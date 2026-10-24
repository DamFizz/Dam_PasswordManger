import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

/**
 * Content Security Policy used for production builds. It is injected as a <meta> tag
 * (works on any static host) and duplicated in public/_headers so hosts that support
 * custom headers (Cloudflare Pages, Netlify) also send it — plus frame-ancestors,
 * which can only be delivered as a real header.
 * 'wasm-unsafe-eval' is required by the Argon2id WebAssembly module; no JS eval is allowed.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https://www.googleapis.com https://oauth2.googleapis.com https://api.pwnedpasswords.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

function cspMetaPlugin(): Plugin {
  return {
    name: 'myvault-csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      return html.replace(
        '<!--CSP-->',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    tailwindcss(),
    cspMetaPlugin(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.svg', 'apple-touch-icon-180x180.png', 'oauth-callback.html', 'oauth-callback.js'],
      manifest: {
        name: 'MyVault',
        short_name: 'MyVault',
        description: 'Your private, end-to-end encrypted password vault.',
        theme_color: '#0b0d12',
        background_color: '#0b0d12',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/oauth-callback/],
        // Never cache Google or breach-check API traffic: only the static app shell is cached.
        runtimeCaching: [],
        cleanupOutdatedCaches: true,
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  build: {
    target: 'es2022',
    // Never inline fonts as data: URIs — the CSP only allows fonts from 'self'.
    // The whole app is precached for offline use, so one main chunk is acceptable.
    chunkSizeWarningLimit: 900,
    assetsInlineLimit: (file) => (/\.(woff2?|ttf|otf)$/.test(file) ? false : undefined),
    sourcemap: false,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
