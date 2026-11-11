/**
 * Key hierarchy
 *
 *   master password ──Argon2id(salt)──► 32-byte stretched secret ──HKDF("kek/password")──► KEK
 *   KEK ──AES-256-GCM──► wraps the random 256-bit Vault Key (VK)
 *   VK ──HKDF──► records key, security key, device-local key (independent subkeys)
 *
 * Format v2 (opt-in Secret Key): KEK = HKDF(ikm = Secret Key, salt = Argon2id(password), info) —
 * the cloud file alone, or the cloud file + master password, is no longer enough to unwrap VK.
 *
 * Optional extra wraps of the same VK: emergency recovery key, device passkey (WebAuthn PRF).
 * Changing the master password only re-wraps VK; item ciphertexts stay valid.
 */
import {
  deriveAesKey,
  deriveFromPassword,
  importHkdfBase,
  KEY_BYTES,
  open,
  seal,
  sha256,
  type KdfParams,
  type Sealed,
} from '../lib/crypto';
import { bytesToBase64, bytesToBase64Url, randomBytes, utf8Encode, wipe } from '../lib/encoding';
import { base32Decode, base32Encode } from '../lib/totp';

export interface VaultKeys {
  vaultId: string;
  records: CryptoKey;
  security: CryptoKey;
  local: CryptoKey;
}

/** 'password-sk' = master password + Secret Key (format v2). */
export type WrapPurpose = 'password' | 'password-sk' | 'recovery' | `device:${string}`;

export const aad = {
  wrap: (vaultId: string, purpose: WrapPurpose) => `myvault/v1/wrap/${purpose}/${vaultId}`,
  security: (vaultId: string, rev: number, vtag: string) => `myvault/v1/security/${vaultId}/${rev}/${vtag}`,
  record: (vaultId: string, id: string, rev: number, vtag: string) => `myvault/v1/record/${vaultId}/${id}/${rev}/${vtag}`,
  local: (vaultId: string, key: string) => `myvault/v1/local/${vaultId}/${key}`,
  backup: (createdAt: number) => `myvault/v1/backup/${createdAt}`,
};

export function generateVaultKey(): Uint8Array<ArrayBuffer> {
  return randomBytes(KEY_BYTES);
}

export async function deriveVaultKeys(vkRaw: Uint8Array<ArrayBuffer>, vaultId: string): Promise<VaultKeys> {
  const base = await importHkdfBase(vkRaw);
  const [records, security, local] = await Promise.all([
    deriveAesKey(base, 'myvault/v1/subkey/records', vaultId),
    deriveAesKey(base, 'myvault/v1/subkey/security', vaultId),
    deriveAesKey(base, 'myvault/v1/subkey/local', vaultId),
  ]);
  return { vaultId, records, security, local };
}

/**
 * HMAC key that signs this device's "trusted for two-step" token. It is derived from the
 * vault key, so a token can only be created or checked after the master password is correct.
 */
export async function deviceTrustKey(vkRaw: Uint8Array<ArrayBuffer>, vaultId: string): Promise<CryptoKey> {
  const base = await importHkdfBase(vkRaw);
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8Encode(vaultId), info: utf8Encode('myvault/v1/device-trust') },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  );
}

/** Derive the key-encryption key from the master password (slow by design). */
export async function passwordKek(password: string, kdf: KdfParams, vaultId: string): Promise<CryptoKey> {
  const stretched = await deriveFromPassword(password, kdf);
  try {
    const base = await importHkdfBase(stretched);
    return await deriveAesKey(base, 'myvault/v1/kek/password', vaultId);
  } finally {
    wipe(stretched);
  }
}

/** KEK from a high-entropy secret (recovery key or WebAuthn PRF output). No Argon2 needed. */
export async function secretKek(secret: Uint8Array<ArrayBuffer>, info: string, vaultId: string): Promise<CryptoKey> {
  const base = await importHkdfBase(secret);
  return deriveAesKey(base, `myvault/v1/kek/${info}`, vaultId);
}

export async function wrapVaultKey(kek: CryptoKey, vkRaw: Uint8Array<ArrayBuffer>, vaultId: string, purpose: WrapPurpose): Promise<Sealed> {
  return seal(kek, vkRaw, aad.wrap(vaultId, purpose));
}

export async function unwrapVaultKey(kek: CryptoKey, wrapped: Sealed, vaultId: string, purpose: WrapPurpose): Promise<Uint8Array<ArrayBuffer>> {
  const vk = await open(kek, wrapped, aad.wrap(vaultId, purpose));
  if (vk.length !== KEY_BYTES) throw new Error('Invalid vault key length');
  return vk;
}

// ---------------------------------------------------------------------------
// Emergency recovery key: 160 random bits shown once as 32 base32 characters.
// It can unwrap the vault key and is used to set a new master password.

export function generateRecoveryKey(): { display: string; raw: Uint8Array<ArrayBuffer> } {
  const raw = randomBytes(20);
  const b32 = base32Encode(raw); // 32 chars
  const display = b32.match(/.{1,4}/g)!.join('-');
  return { display, raw };
}

export function parseRecoveryKey(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, '');
  if (clean.length !== 32) throw new Error('A recovery key has 32 characters');
  return base32Decode(clean);
}

// ---------------------------------------------------------------------------
// Single-use recovery codes for the second factor (Authenticator) — 10 codes, 50 bits each.

export function generateRecoveryCodes(count = 10): string[] {
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    const b32 = base32Encode(randomBytes(7)).slice(0, 10);
    codes.push(`${b32.slice(0, 5)}-${b32.slice(5)}`);
  }
  return codes;
}

export function normalizeRecoveryCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z2-7]/g, '');
}

export async function hashRecoveryCode(vaultId: string, code: string): Promise<string> {
  const digest = await sha256(utf8Encode(`myvault/v1/recovery-code/${vaultId}/${normalizeRecoveryCode(code)}`));
  return bytesToBase64(digest);
}

// ---------------------------------------------------------------------------
// Secret Key (format v2): 128 random bits held on devices and in the printed Emergency Kit, never in
// the synced file. Display: "MV2-" + 26 base32 chars of the key + 2 checksum chars, in groups of 4.

export const SECRET_KEY_BYTES = 16;
const SECRET_KEY_PREFIX = 'MV2';
const SECRET_KEY_CHARS = 26;

export class InvalidSecretKeyError extends Error {
  constructor(message = 'That does not look like a valid Secret Key') {
    super(message);
    this.name = 'InvalidSecretKeyError';
  }
}

async function secretKeyChecksum(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  const prefix = utf8Encode('myvault/v2/secret-key-check/');
  const msg = new Uint8Array(prefix.length + raw.length);
  msg.set(prefix);
  msg.set(raw, prefix.length);
  return base32Encode(await sha256(msg)).slice(0, 2);
}

/** Human-readable form with checksum, e.g. MV2-ABCD-EFGH-… (7 groups of 4). */
export async function formatSecretKey(raw: Uint8Array<ArrayBuffer>): Promise<string> {
  if (raw.length !== SECRET_KEY_BYTES) throw new InvalidSecretKeyError();
  const body = base32Encode(raw) + (await secretKeyChecksum(raw));
  return `${SECRET_KEY_PREFIX}-${body.match(/.{1,4}/g)!.join('-')}`;
}

export async function generateSecretKey(): Promise<{ display: string; raw: Uint8Array<ArrayBuffer> }> {
  const raw = randomBytes(SECRET_KEY_BYTES);
  return { display: await formatSecretKey(raw), raw };
}

/** QR payload for moving the Secret Key to another device. No checksum (QR codes self-correct). */
export function secretKeyQrPayload(vaultId: string, raw: Uint8Array): string {
  return `myvault-sk:2:${vaultId}:${base32Encode(raw)}`;
}

/** The 26-char form stored inside the encrypted SecurityConfig. */
export function secretKeyToStored(raw: Uint8Array): string {
  return base32Encode(raw);
}

export function secretKeyFromStored(stored: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Z2-7]{26}$/.test(stored)) throw new InvalidSecretKeyError('Stored Secret Key is corrupted');
  return base32Decode(stored);
}

/** Accepts the display form (any case, spaces/dashes ignored, with or without "MV2") or a QR payload. */
export async function parseSecretKey(input: string): Promise<{ raw: Uint8Array<ArrayBuffer>; vaultId?: string }> {
  const trimmed = input.trim();
  const qr = /^myvault-sk:2:([A-Za-z0-9_-]+):([A-Z2-7]{26})$/.exec(trimmed);
  if (qr) return { raw: base32Decode(qr[2]), vaultId: qr[1] };
  let clean = trimmed.toUpperCase().replace(/[\s-]/g, '');
  if (clean.length === SECRET_KEY_CHARS + 2 + SECRET_KEY_PREFIX.length && clean.startsWith(SECRET_KEY_PREFIX)) {
    clean = clean.slice(SECRET_KEY_PREFIX.length);
  }
  if (!/^[A-Z2-7]{28}$/.test(clean)) throw new InvalidSecretKeyError();
  const raw = base32Decode(clean.slice(0, SECRET_KEY_CHARS));
  if (raw.length !== SECRET_KEY_BYTES || (await secretKeyChecksum(raw)) !== clean.slice(SECRET_KEY_CHARS)) {
    throw new InvalidSecretKeyError('Secret Key has a typo (checksum mismatch)');
  }
  return { raw };
}

/** Public identifier of a Secret Key for one vault (a verifier for a 128-bit key; reveals nothing about the password). */
export async function secretKeyId(raw: Uint8Array<ArrayBuffer>, vaultId: string): Promise<string> {
  const base = await importHkdfBase(raw);
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: utf8Encode(vaultId), info: utf8Encode('myvault/v2/secret-key-id') },
    base,
    72,
  );
  return bytesToBase64Url(new Uint8Array(bits));
}

/** Non-extractable HKDF key holding the Secret Key (safe to keep in IndexedDB as a CryptoKey). */
export async function importSecretKey(raw: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return importHkdfBase(raw);
}

/** KEK for format v2: needs the master password (Argon2id) AND the Secret Key. */
export async function passwordSecretKek(password: string, kdf: KdfParams, vaultId: string, secretKey: CryptoKey): Promise<CryptoKey> {
  const stretched = await deriveFromPassword(password, kdf);
  try {
    return await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: stretched, info: utf8Encode(`myvault/v2/kek/password+secret-key/${vaultId}`) },
      secretKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
  } finally {
    wipe(stretched);
  }
}
