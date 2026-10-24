// Test stub for the vite-plugin-pwa virtual module (no service worker in jsdom).
export function registerSW(): (reload?: boolean) => Promise<void> {
  return async () => undefined;
}
