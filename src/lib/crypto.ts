/**
 * Authenticated encryption and key derivation built only on reviewed primitives:
 *  - AES-256-GCM (Web Crypto) with a fresh random 96-bit IV per operation
 *  - HKDF-SHA-256 (Web Crypto) for key separation
 *  - Argon2id (hash-wasm, WebAssembly) for password-based key derivation
 * No custom ciphers. Every ciphertext is bound to its context via associated data (AAD),
 * so records cannot be swapped between vaults, ids or revisions without detection.
 */
import { argon2id } from 'hash-wasm';
import { base64ToBytes, bytesToBase64, randomBytes, utf8Decode, utf8Encode, wipe } from './encoding';

export const CRYPTO_FORMAT_VERSION = 1;
export const KEY_BYTES = 32;
const IV_BYTES = 12;

export interface Sealed {
  /** base64 96-bit IV */
  iv: string;
  /** base64 AES-GCM ciphertext including the 128-bit auth tag */
  ct: string;
}

export interface KdfParams {
  alg: 'argon2id';
  /** base64 random salt (16 bytes) */
  salt: string;
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

/** Thrown when authenticated decryption fails: wrong key, tampered data or wrong context. */
export class DecryptionError extends Error {
  constructor(message = 'Decryption failed: wrong key or data was modified') {
    super(message);
    this.name = 'DecryptionError';
  }
}

/**
 * Default Argon2id cost. 64 MiB / 3 passes is in line with current OWASP guidance
 * (minimum 19 MiB / 2 passes) while staying usable on phones (~0.5–1.5 s).
 */
export const DEFAULT_KDF: Omit<KdfParams, 'salt'> = {
  alg: 'argon2id',
  memoryKiB: 64 * 1024,
  iterations: 3,
  parallelism: 1,
};

let kdfOverride: Omit<KdfParams, 'salt'> | null = null;

/** Test-only hook to keep unit tests fast. Never called by application code. */
export function setKdfCostForTesting(params: Omit<KdfParams, 'salt'> | null): void {
  kdfOverride = params;
}

export function newKdfParams(): KdfParams {
  const base = kdfOverride ?? DEFAULT_KDF;
  return { ...base, salt: bytesToBase64(randomBytes(16)) };
}

export function validateKdfParams(p: KdfParams): void {
  if (p.alg !== 'argon2id') throw new Error('Unsupported key derivation algorithm');
  if (!Number.isInteger(p.memoryKiB) || p.memoryKiB < 1024 || p.memoryKiB > 1024 * 1024) {
    throw new Error('Invalid Argon2id memory parameter');
  }
  if (!Number.isInteger(p.iterations) || p.iterations < 1 || p.iterations > 50) {
    throw new Error('Invalid Argon2id iteration parameter');
  }
  if (!Number.isInteger(p.parallelism) || p.parallelism < 1 || p.parallelism > 16) {
    throw new Error('Invalid Argon2id parallelism parameter');
  }
  if (base64ToBytes(p.salt).length < 16) throw new Error('Invalid salt');
}

/** Argon2id(password) → 32 raw bytes. The caller must wipe() the result when done. */
export async function deriveFromPassword(password: string, params: KdfParams): Promise<Uint8Array<ArrayBuffer>> {
  validateKdfParams(params);
  const pw = utf8Encode(password.normalize('NFC'));
  try {
    const out = await argon2id({
      password: pw,
      salt: base64ToBytes(params.salt),
      iterations: params.iterations,
      memorySize: params.memoryKiB,
      parallelism: params.parallelism,
      hashLength: KEY_BYTES,
      outputType: 'binary',
    });
    return new Uint8Array(out);
  } finally {
    wipe(pw);
  }
}

/** Import raw key material as a non-extractable HKDF base key. */
export async function importHkdfBase(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits']);
}

/** HKDF-SHA-256 → non-extractable AES-256-GCM key, separated by `info`. */
export async function deriveAesKey(base: CryptoKey, info: string, salt = ''): Promise<CryptoKey> {
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8Encode(salt), info: utf8Encode(info) },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** HKDF-SHA-256 → raw bits (used for non-encryption purposes such as code verification). */
export async function deriveBits(base: CryptoKey, info: string, salt = '', bits = 256): Promise<Uint8Array<ArrayBuffer>> {
  const out = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8Encode(salt), info: utf8Encode(info) },
    base,
    bits,
  );
  return new Uint8Array(out);
}

export async function seal(key: CryptoKey, plaintext: Uint8Array<ArrayBuffer>, aad: string): Promise<Sealed> {
  const iv = randomBytes(IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8Encode(aad), tagLength: 128 },
    key,
    plaintext,
  );
  return { iv: bytesToBase64(iv), ct: bytesToBase64(new Uint8Array(ct)) };
}

export async function open(key: CryptoKey, sealed: Sealed, aad: string): Promise<Uint8Array<ArrayBuffer>> {
  let iv: Uint8Array<ArrayBuffer>;
  let ct: Uint8Array<ArrayBuffer>;
  try {
    iv = base64ToBytes(sealed.iv);
    ct = base64ToBytes(sealed.ct);
  } catch {
    throw new DecryptionError('Encrypted data is malformed');
  }
  if (iv.length !== IV_BYTES || ct.length < 16) throw new DecryptionError('Encrypted data is malformed');
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData: utf8Encode(aad), tagLength: 128 },
      key,
      ct,
    );
    return new Uint8Array(pt);
  } catch {
    throw new DecryptionError();
  }
}

export async function sealJson(key: CryptoKey, value: unknown, aad: string): Promise<Sealed> {
  const bytes = utf8Encode(JSON.stringify(value));
  try {
    return await seal(key, bytes, aad);
  } finally {
    wipe(bytes);
  }
}

export async function openJson<T>(key: CryptoKey, sealed: Sealed, aad: string): Promise<T> {
  const bytes = await open(key, sealed, aad);
  try {
    return JSON.parse(utf8Decode(bytes)) as T;
  } finally {
    wipe(bytes);
  }
}

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', data));
}

export function isSealed(value: unknown): value is Sealed {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Sealed).iv === 'string' &&
    typeof (value as Sealed).ct === 'string'
  );
}
