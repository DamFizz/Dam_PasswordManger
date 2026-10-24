/**
 * Encrypted backups (.myvault files).
 *
 * Layer 1 (outer): the whole payload is encrypted with AES-256-GCM using a key derived with
 *   Argon2id from the backup password (which may equal the master password), fresh salt.
 *   This hides record counts and revision metadata and detects any corruption/tampering.
 * Layer 2 (inner): the payload is the vault exactly as stored — header + encrypted records —
 *   so restoring additionally requires the vault's master password as of the backup date.
 */
import {
  DecryptionError,
  deriveAesKey,
  deriveFromPassword,
  importHkdfBase,
  newKdfParams,
  openJson,
  sealJson,
  type KdfParams,
  type Sealed,
} from '../lib/crypto';
import { randomId, wipe } from '../lib/encoding';
import { validateHeader, validateRecords, InvalidVaultFileError } from '../sync/format';
import { unwrapWithPasswordForImport } from './import-keys';
import { aad } from './keys';
import type { VaultRepository } from './db';
import type { VaultSession } from './session';
import type { Collection, EncryptedRecord, RecordPayload, VaultHeader, VaultItem } from './types';

export const BACKUP_FORMAT = 'myvault-backup';
export const BACKUP_FORMAT_VERSION = 1;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: number;
  appVersion: string;
  kdf: KdfParams;
  payload: Sealed;
}

interface BackupPayload {
  vaultId: string;
  header: VaultHeader;
  records: EncryptedRecord[];
}

export interface OpenedBackup {
  createdAt: number;
  appVersion: string;
  version: number;
  header: VaultHeader;
  records: EncryptedRecord[];
}

export class CorruptBackupError extends Error {
  constructor(message = 'This file is not a valid MyVault backup or it is damaged.') {
    super(message);
    this.name = 'CorruptBackupError';
  }
}

export class BackupPasswordError extends Error {
  constructor() {
    super('Wrong backup password, or the backup file was modified/corrupted.');
    this.name = 'BackupPasswordError';
  }
}

async function backupKey(password: string, kdf: KdfParams): Promise<CryptoKey> {
  const stretched = await deriveFromPassword(password, kdf);
  try {
    return await deriveAesKey(await importHkdfBase(stretched), 'myvault/v1/backup', '');
  } finally {
    wipe(stretched);
  }
}

export async function createBackup(session: VaultSession, backupPassword: string, appVersion: string): Promise<string> {
  const createdAt = Date.now();
  const kdf = newKdfParams();
  const key = await backupKey(backupPassword, kdf);
  const payload: BackupPayload = { vaultId: session.vaultId, header: session.header, records: session.encryptedRecords() };
  const file: BackupFile = {
    format: BACKUP_FORMAT,
    version: BACKUP_FORMAT_VERSION,
    createdAt,
    appVersion,
    kdf,
    payload: await sealJson(key, payload, aad.backup(createdAt)),
  };
  await session.updateDeviceSecrets((s) => {
    s.lastBackupAt = createdAt;
  });
  return JSON.stringify(file);
}

/** Structural validation without a password (format, version, timestamps). */
export function inspectBackup(text: string): BackupFile {
  let data: BackupFile;
  try {
    data = JSON.parse(text) as BackupFile;
  } catch {
    throw new CorruptBackupError();
  }
  if (!data || data.format !== BACKUP_FORMAT) throw new CorruptBackupError('This file is not a MyVault backup.');
  if (typeof data.version !== 'number' || data.version > BACKUP_FORMAT_VERSION) {
    throw new CorruptBackupError('This backup was made by a newer version of MyVault. Please update the app.');
  }
  if (typeof data.createdAt !== 'number' || !data.kdf || !data.payload?.iv || !data.payload?.ct) {
    throw new CorruptBackupError();
  }
  return data;
}

export async function openBackup(text: string, backupPassword: string): Promise<OpenedBackup> {
  const file = inspectBackup(text);
  let key: CryptoKey;
  try {
    key = await backupKey(backupPassword, file.kdf);
  } catch {
    throw new CorruptBackupError('Backup key-derivation parameters are invalid.');
  }
  let payload: BackupPayload;
  try {
    payload = await openJson<BackupPayload>(key, file.payload, aad.backup(file.createdAt));
  } catch (e) {
    if (e instanceof DecryptionError) throw new BackupPasswordError();
    throw new CorruptBackupError();
  }
  try {
    validateHeader(payload.header);
    validateRecords(payload.records);
  } catch (e) {
    throw new CorruptBackupError(e instanceof InvalidVaultFileError ? e.message : undefined);
  }
  return { createdAt: file.createdAt, appVersion: file.appVersion, version: file.version, header: payload.header, records: payload.records };
}

/**
 * Replace the local vault with the backup. A safety snapshot of the current vault is taken
 * first. The app must then lock; the user unlocks with the backup's master password.
 */
export async function restoreReplace(repo: VaultRepository, backup: OpenedBackup): Promise<void> {
  const current = await repo.getHeader();
  if (current) await repo.createSnapshot('before-restore', randomId());
  const clear = current ? [`sync:${current.vaultId}`, `secrets:${current.vaultId}`, `quickUnlock:${current.vaultId}`] : [];
  if (current?.vaultId === backup.header.vaultId) {
    // Same vault: keep device secrets (cloud connection) but reset sync bookkeeping so the
    // next sync performs a full, conflict-preserving merge instead of trusting stale bases.
    clear.splice(0, clear.length, `sync:${current.vaultId}`);
  }
  await repo.replaceVault(backup.header, backup.records, clear);
}

export interface MergeImportResult {
  added: number;
  copies: number;
  skipped: number;
  collectionsAdded: number;
}

/**
 * Merge a backup into the unlocked vault. The backup's master password is needed to read its
 * records. Items that do not exist are added; identical ones are skipped; differing versions
 * are added as "(restored copy)" so nothing is overwritten.
 */
export async function restoreMerge(session: VaultSession, backup: OpenedBackup, backupMasterPassword: string): Promise<MergeImportResult> {
  const payloads = await unwrapWithPasswordForImport(backup, backupMasterPassword);
  const existingItems = new Map(session.items().map((i) => [i.id, i]));
  const existingCollections = new Map(session.collections().map((c) => [c.id, c]));
  const existingCollectionNames = new Map(session.collections().map((c) => [`${c.kind}:${c.name.toLowerCase()}`, c.id]));
  const now = Date.now();
  const toSaveItems: VaultItem[] = [];
  const toSaveCollections: Collection[] = [];
  const idMap = new Map<string, string>();
  const result: MergeImportResult = { added: 0, copies: 0, skipped: 0, collectionsAdded: 0 };

  for (const p of payloads) {
    if (p.kind !== 'collection') continue;
    const c = p.collection;
    if (existingCollections.has(c.id)) continue;
    const byName = existingCollectionNames.get(`${c.kind}:${c.name.toLowerCase()}`);
    if (byName) {
      idMap.set(c.id, byName);
      continue;
    }
    toSaveCollections.push({ ...c, updatedAt: now });
    result.collectionsAdded++;
  }
  const remap = (id: string | null | undefined) => (id ? idMap.get(id) ?? id : id ?? null);

  for (const p of payloads) {
    if (p.kind !== 'item') continue;
    const item = { ...p.item, categoryId: remap(p.item.categoryId), sectionId: remap(p.item.sectionId) };
    const existing = existingItems.get(item.id);
    if (!existing) {
      toSaveItems.push({ ...item, updatedAt: now });
      result.added++;
    } else if (sameItem(existing, item)) {
      result.skipped++;
    } else {
      toSaveItems.push({ ...item, id: randomId(), title: `${item.title || 'Untitled'} (restored copy)`, updatedAt: now });
      result.copies++;
    }
  }
  if (toSaveCollections.length) await session.saveCollections(toSaveCollections);
  if (toSaveItems.length) await session.saveItems(toSaveItems);
  return result;
}

function sameItem(a: VaultItem, b: VaultItem): boolean {
  const strip = ({ updatedAt: _u, ...rest }: VaultItem) => JSON.stringify(rest);
  return strip(a) === strip(b);
}

export type { RecordPayload };
