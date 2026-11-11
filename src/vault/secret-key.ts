/**
 * Secret Key (vault format v2) — device storage and KEK selection.
 *
 * When `header.secretKey` is set, the master-password wrap of the vault key needs BOTH the master
 * password and a 128-bit Secret Key that is never written to the synced file. Each device keeps the
 * Secret Key locally as a NON-EXTRACTABLE CryptoKey (IndexedDB), and the encrypted SecurityConfig
 * keeps a copy so an unlocked device can show it again (QR / Emergency Kit).
 *
 * Protects: the cloud file or a backup, even together with the master password.
 * Does not protect: a device that is already compromised (it holds the Secret Key).
 */
import type { VaultRepository } from './db';
import {
  importSecretKey,
  parseSecretKey,
  passwordKek,
  passwordSecretKek,
  secretKeyFromStored,
  secretKeyId,
  type WrapPurpose,
} from './keys';
import type { VaultHeader } from './types';

export class SecretKeyRequiredError extends Error {
  constructor(readonly vaultId: string) {
    super('This vault needs its Secret Key on this device. Scan the QR code from another device or type it from your Emergency Kit.');
    this.name = 'SecretKeyRequiredError';
  }
}

export class WrongSecretKeyError extends Error {
  constructor() {
    super('This Secret Key does not belong to this vault.');
    this.name = 'WrongSecretKeyError';
  }
}

export class RecoveryKeyRequiredError extends Error {
  constructor() {
    super('Create an emergency recovery key before turning on the Secret Key, so the vault can never be lost.');
    this.name = 'RecoveryKeyRequiredError';
  }
}

interface StoredSecretKey {
  id: string;
  key: CryptoKey;
}

const localKey = (vaultId: string) => `secretKey:${vaultId}`;

/** Keep the Secret Key on this device (non-extractable). */
export async function rememberSecretKey(repo: VaultRepository, vaultId: string, raw: Uint8Array<ArrayBuffer>): Promise<void> {
  const value: StoredSecretKey = { id: await secretKeyId(raw, vaultId), key: await importSecretKey(raw) };
  await repo.setLocal(localKey(vaultId), value);
}

export async function forgetSecretKey(repo: VaultRepository, vaultId: string): Promise<void> {
  await repo.deleteLocal(localKey(vaultId));
}

/** The device's Secret Key for this header, or null (a stale key from before a rotation is discarded). */
async function deviceSecretKey(repo: VaultRepository, header: VaultHeader): Promise<CryptoKey | null> {
  const stored = await repo.getLocal<StoredSecretKey>(localKey(header.vaultId));
  if (!stored || !header.secretKey) return null;
  if (stored.id !== header.secretKey.id) {
    await repo.deleteLocal(localKey(header.vaultId));
    return null;
  }
  return stored.key;
}

export async function hasSecretKeyOnDevice(repo: VaultRepository, header: VaultHeader): Promise<boolean> {
  return !header.secretKey || (await deviceSecretKey(repo, header)) !== null;
}

/** How to obtain the Secret Key when the vault needs one. */
export interface SecretKeySource {
  /** typed or scanned by the user (display form or QR payload) */
  secretKey?: string;
  /** keep a typed key on this device after a successful unlock (default true) */
  rememberSecretKey?: boolean;
  /** 26-char copy from an unlocked session's SecurityConfig (re-authentication) */
  stored?: string | null;
}

export interface ResolvedKek {
  kek: CryptoKey;
  purpose: WrapPurpose;
  /** raw Secret Key the user just supplied (to remember after the password is verified) */
  supplied?: Uint8Array<ArrayBuffer>;
}

/** Pick the KEK for `header.passwordWrap`: password only (v1) or password + Secret Key (v2). */
export async function kekForHeader(repo: VaultRepository, header: VaultHeader, password: string, src: SecretKeySource = {}): Promise<ResolvedKek> {
  if (!header.secretKey) return { kek: await passwordKek(password, header.kdf, header.vaultId), purpose: 'password' };
  let key: CryptoKey | null = null;
  let supplied: Uint8Array<ArrayBuffer> | undefined;
  if (src.secretKey) {
    const parsed = await parseSecretKey(src.secretKey);
    if (parsed.vaultId && parsed.vaultId !== header.vaultId) throw new WrongSecretKeyError();
    if ((await secretKeyId(parsed.raw, header.vaultId)) !== header.secretKey.id) throw new WrongSecretKeyError();
    supplied = parsed.raw;
    key = await importSecretKey(parsed.raw);
  } else if (src.stored) {
    const raw = secretKeyFromStored(src.stored);
    if ((await secretKeyId(raw, header.vaultId)) !== header.secretKey.id) throw new WrongSecretKeyError();
    key = await importSecretKey(raw);
  } else {
    key = await deviceSecretKey(repo, header);
  }
  if (!key) throw new SecretKeyRequiredError(header.vaultId);
  return { kek: await passwordSecretKek(password, header.kdf, header.vaultId, key), purpose: 'password-sk', supplied };
}
