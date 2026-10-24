import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { 'virtual:pwa-register': fileURLToPath(new URL('./tests/pwa-register-stub.ts', import.meta.url)) },
  },
  define: {
    __APP_VERSION__: JSON.stringify('test'),
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    testTimeout: 30000,
    css: false,
  },
});
