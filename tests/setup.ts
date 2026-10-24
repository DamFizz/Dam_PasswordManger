import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';
import { setKdfCostForTesting } from '../src/lib/crypto';

// jsdom does not ship SubtleCrypto; use Node's standards-compliant Web Crypto implementation.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
}

// Keep Argon2id real but cheap in tests (production default is 64 MiB / 3 passes).
setKdfCostForTesting({ alg: 'argon2id', memoryKiB: 1024, iterations: 1, parallelism: 1 });

// jsdom lacks <dialog> modal support.
if (typeof HTMLDialogElement !== 'undefined') {
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
}

if (typeof window !== 'undefined') {
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
  window.scrollTo ??= (() => undefined) as typeof window.scrollTo;
  Element.prototype.scrollIntoView ??= () => undefined;
}
