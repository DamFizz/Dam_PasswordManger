import { isSealed } from '../lib/crypto';
import { VAULT_FORMAT, type EncryptedRecord, type VaultHeader } from '../vault/types';

export const SYNC_FORMAT = 'myvault-sync';
export const SYNC_FORMAT_VERSION = 1;
export const SYNC_FILE_NAME = 'myvault.vault.json';

/**
 * The file stored in the user's Google Drive appDataFolder. It contains only ciphertext:
 * the header (KDF params, wrapped vault key, encrypted security config) and encrypted records.
 */
export interface SyncFile {
  format: typeof SYNC_FORMAT;
  version: number;
  writtenAt: number;
  /** random per-device id (not the device name) */
  writer: string;
  header: VaultHeader;
  records: EncryptedRecord[];
}

export class InvalidVaultFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidVaultFileError';
  }
}

export function validateHeader(h: unknown): asserts h is VaultHeader {
  const x = h as VaultHeader;
  if (!x || typeof x !== 'object') throw new InvalidVaultFileError('Missing vault header');
  if (x.format !== VAULT_FORMAT) throw new InvalidVaultFileError('Not a MyVault vault');
  if (typeof x.version !== 'number' || x.version > 1) throw new InvalidVaultFileError(`Unsupported vault format version ${x.version}`);
  if (typeof x.vaultId !== 'string' || typeof x.vtag !== 'string' || typeof x.rev !== 'number') {
    throw new InvalidVaultFileError('Vault header is incomplete');
  }
  if (!x.kdf || x.kdf.alg !== 'argon2id' || typeof x.kdf.salt !== 'string') throw new InvalidVaultFileError('Unsupported key derivation');
  if (!isSealed(x.passwordWrap) || !isSealed(x.security)) throw new InvalidVaultFileError('Vault header is incomplete');
  if (x.recoveryWrap != null && !isSealed(x.recoveryWrap)) throw new InvalidVaultFileError('Vault header is corrupted');
}

export function validateRecords(records: unknown): asserts records is EncryptedRecord[] {
  if (!Array.isArray(records)) throw new InvalidVaultFileError('Missing records');
  const seen = new Set<string>();
  for (const r of records as EncryptedRecord[]) {
    if (
      !r ||
      typeof r.id !== 'string' ||
      typeof r.vtag !== 'string' ||
      typeof r.rev !== 'number' ||
      !Number.isInteger(r.rev) ||
      r.rev < 1 ||
      !isSealed(r)
    ) {
      throw new InvalidVaultFileError('A record is corrupted');
    }
    if (seen.has(r.id)) throw new InvalidVaultFileError('Duplicate record id');
    seen.add(r.id);
  }
}

export function parseSyncFile(text: string): SyncFile {
  let data: SyncFile;
  try {
    data = JSON.parse(text) as SyncFile;
  } catch {
    throw new InvalidVaultFileError('Cloud vault file is not valid JSON (corrupted?)');
  }
  if (!data || data.format !== SYNC_FORMAT) throw new InvalidVaultFileError('Not a MyVault sync file');
  if (typeof data.version !== 'number' || data.version > SYNC_FORMAT_VERSION) {
    throw new InvalidVaultFileError('Cloud vault was written by a newer MyVault version. Please update this app.');
  }
  validateHeader(data.header);
  validateRecords(data.records);
  return data;
}

export function serializeSyncFile(header: VaultHeader, records: EncryptedRecord[], writer: string): string {
  const file: SyncFile = {
    format: SYNC_FORMAT,
    version: SYNC_FORMAT_VERSION,
    writtenAt: Date.now(),
    writer,
    header,
    records: [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  return JSON.stringify(file);
}
