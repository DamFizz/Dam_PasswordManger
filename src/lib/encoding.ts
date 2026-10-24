/** Byte/string encoding helpers. No external dependencies, no Node Buffer. */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder('utf-8', { fatal: true });

export function utf8Encode(value: string): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(value) as Uint8Array<ArrayBuffer>;
}

export function utf8Decode(bytes: Uint8Array): string {
  return textDecoder.decode(bytes);
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('Invalid base64 data');
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  return base64ToBytes(padded);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Cryptographically secure random bytes (Web Crypto). */
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
}

/** 128-bit random identifier, URL-safe. */
export function randomId(): string {
  return bytesToBase64Url(randomBytes(16));
}

/** Constant-time comparison for equal-length byte arrays. */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/** Best-effort wipe of sensitive key material held in a typed array. */
export function wipe(bytes: Uint8Array | null | undefined): void {
  if (bytes) bytes.fill(0);
}
