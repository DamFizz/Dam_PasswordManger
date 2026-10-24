/**
 * Key hierarchy
 *
 *   master password ──Argon2id(salt)──► 32-byte stretched secret ──HKDF("kek/password")──► KEK
 *   KEK ──AES-256-GCM──► wraps the random 256-bit Vault Key (VK)
 *   VK ──HKDF──► records key, security key, device-local key (independent subkeys)
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
import { bytesToBase64, randomBytes, utf8Encode, wipe } from '../lib/encoding';
import { base32Decode, base32Encode } from '../lib/totp';

export interface VaultKeys {
  vaultId: string;
  records: CryptoKey;
  security: CryptoKey;
  local: CryptoKey;
}

export type WrapPurpose = 'password' | 'recovery' | `device:${string}`;

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
