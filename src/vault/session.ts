import { openJson, sealJson, type Sealed } from '../lib/crypto';
import { randomId } from '../lib/encoding';
import type { VaultRepository } from './db';
import { aad, type VaultKeys } from './keys';
import {
  DEFAULT_VAULT_SETTINGS,
  SETTINGS_RECORD_ID,
  type Collection,
  type EncryptedRecord,
  type RecordPayload,
  type SecurityConfig,
  type VaultHeader,
  type VaultItem,
  type VaultSettings,
} from './types';

/** Device-only secrets, encrypted with the vault's local subkey. Never synced. */
export interface DeviceSecrets {
  /** per-item last-used timestamps (private, device-local activity) */
  usage: Record<string, number>;
  google?: {
    email?: string;
    name?: string;
    accessToken?: string;
    tokenExpiresAt?: number;
    clientId?: string;
  } | null;
  /** unresolved sync conflict notices */
  conflicts: ConflictNotice[];
  lastBackupAt?: number | null;
}

export interface ConflictNotice {
  id: string;
  at: number;
  kind: 'item' | 'collection' | 'settings' | 'header';
  title: string;
  /** id of the record that won */
  keptId?: string;
  /** id of the conflict copy that preserves the other version */
  copyId?: string;
  message: string;
}

const DEFAULT_DEVICE_SECRETS: DeviceSecrets = { usage: {}, google: null, conflicts: [] };

export interface DecryptedRecord {
  record: EncryptedRecord;
  payload: RecordPayload;
}

type Listener = (change: SessionChange) => void;
export interface SessionChange {
  type: 'records' | 'header' | 'device' | 'lock';
  /** true when the change came from this device's user (used to trigger auto-sync) */
  local: boolean;
}

/**
 * An unlocked vault. Holds the derived (non-extractable) subkeys and the decrypted records in
 * memory only. lock() drops every reference so the data can be garbage collected.
 */
export class VaultSession {
  private keys: VaultKeys | null;
  private decrypted = new Map<string, DecryptedRecord>();
  private listeners = new Set<Listener>();
  private deviceSecretsCache: DeviceSecrets | null = null;
  /** ids whose ciphertext failed authentication (tampered/corrupted) */
  readonly corruptedIds: string[] = [];
  header: VaultHeader;
  security: SecurityConfig;

  private constructor(
    readonly repo: VaultRepository,
    keys: VaultKeys,
    header: VaultHeader,
    security: SecurityConfig,
    readonly device: { id: string; name: string },
  ) {
    this.keys = keys;
    this.header = header;
    this.security = security;
  }

  static async open(
    repo: VaultRepository,
    keys: VaultKeys,
    header: VaultHeader,
    security: SecurityConfig,
    device: { id: string; name: string },
  ): Promise<VaultSession> {
    const session = new VaultSession(repo, keys, header, security, device);
    await session.reload();
    return session;
  }

  get vaultId(): string {
    return this.header.vaultId;
  }

  get isLocked(): boolean {
    return this.keys === null;
  }

  private requireKeys(): VaultKeys {
    if (!this.keys) throw new Error('Vault is locked');
    return this.keys;
  }

  /** Expose keys for modules that need them (sync, backup). Throws when locked. */
  getKeys(): VaultKeys {
    return this.requireKeys();
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(change: SessionChange): void {
    for (const fn of this.listeners) fn(change);
  }

  /** Re-read and decrypt every record from IndexedDB (e.g. after another tab changed data). */
  async reload(): Promise<void> {
    const records = await this.repo.allRecords();
    const next = new Map<string, DecryptedRecord>();
    this.corruptedIds.length = 0;
    for (const record of records) {
      try {
        next.set(record.id, { record, payload: await this.decryptRecord(record) });
      } catch {
        this.corruptedIds.push(record.id);
      }
    }
    this.decrypted = next;
    const header = await this.repo.getHeader();
    if (header && header.vtag !== this.header.vtag && header.vaultId === this.header.vaultId) {
      try {
        this.security = await this.openSecurity(header);
        this.header = header;
      } catch {
        /* keep the in-memory header if the stored one cannot be authenticated */
      }
    }
    this.emit({ type: 'records', local: false });
  }

  async decryptRecord(record: EncryptedRecord): Promise<RecordPayload> {
    const keys = this.requireKeys();
    return openJson<RecordPayload>(keys.records, record, aad.record(keys.vaultId, record.id, record.rev, record.vtag));
  }

  async sealRecord(id: string, rev: number, payload: RecordPayload): Promise<EncryptedRecord> {
    const keys = this.requireKeys();
    const vtag = randomId();
    const sealed = await sealJson(keys.records, payload, aad.record(keys.vaultId, id, rev, vtag));
    return { id, rev, vtag, ...sealed };
  }

  async openSecurity(header: VaultHeader): Promise<SecurityConfig> {
    const keys = this.requireKeys();
    return openJson<SecurityConfig>(keys.security, header.security, aad.security(header.vaultId, header.rev, header.vtag));
  }

  // ------------------------------------------------------------------ reads

  allDecrypted(): DecryptedRecord[] {
    return [...this.decrypted.values()];
  }

  encryptedRecords(): EncryptedRecord[] {
    return [...this.decrypted.values()].map((d) => d.record);
  }

  items(): VaultItem[] {
    const out: VaultItem[] = [];
    for (const d of this.decrypted.values()) if (d.payload.kind === 'item') out.push(d.payload.item);
    return out;
  }

  collections(): Collection[] {
    const out: Collection[] = [];
    for (const d of this.decrypted.values()) if (d.payload.kind === 'collection') out.push(d.payload.collection);
    return out.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }

  settings(): VaultSettings {
    const d = this.decrypted.get(SETTINGS_RECORD_ID);
    return d?.payload.kind === 'settings' ? { ...DEFAULT_VAULT_SETTINGS, ...d.payload.settings } : DEFAULT_VAULT_SETTINGS;
  }

  getItem(id: string): VaultItem | undefined {
    const d = this.decrypted.get(id);
    return d?.payload.kind === 'item' ? d.payload.item : undefined;
  }

  // ------------------------------------------------------------------ writes

  private async writePayloads(entries: { id: string; payload: RecordPayload }[], local = true): Promise<void> {
    const sealed: DecryptedRecord[] = [];
    for (const { id, payload } of entries) {
      const prev = this.decrypted.get(id);
      const record = await this.sealRecord(id, (prev?.record.rev ?? 0) + 1, payload);
      sealed.push({ record, payload });
    }
    await this.repo.putRecords(sealed.map((s) => s.record));
    for (const s of sealed) this.decrypted.set(s.record.id, s);
    this.emit({ type: 'records', local });
  }

  async saveItems(items: VaultItem[]): Promise<void> {
    const now = Date.now();
    await this.writePayloads(
      items.map((item) => ({ id: item.id, payload: { kind: 'item', item, updatedAt: now, device: this.device.name } })),
    );
  }

  async saveItem(item: VaultItem): Promise<void> {
    await this.saveItems([item]);
  }

  /** Permanently delete: replaces the record with an encrypted tombstone so deletion syncs. */
  async purgeItems(ids: string[]): Promise<void> {
    const now = Date.now();
    await this.writePayloads(ids.map((id) => ({ id, payload: { kind: 'tombstone', updatedAt: now, device: this.device.name } })));
    const secrets = await this.getDeviceSecrets();
    let changed = false;
    for (const id of ids) {
      if (id in secrets.usage) {
        delete secrets.usage[id];
        changed = true;
      }
    }
    if (changed) await this.setDeviceSecrets(secrets);
  }

  async saveCollections(collections: Collection[]): Promise<void> {
    const now = Date.now();
    await this.writePayloads(
      collections.map((collection) => ({
        id: collection.id,
        payload: { kind: 'collection', collection, updatedAt: now, device: this.device.name },
      })),
    );
  }

  /**
   * Delete a category/section without deleting its items: affected items are moved to
   * `moveTo` (another collection id) or left unassigned (null). Child sections are re-parented.
   */
  async deleteCollection(id: string, moveTo: string | null): Promise<void> {
    const target = this.collections().find((c) => c.id === id);
    if (!target) return;
    const now = Date.now();
    const field = target.kind === 'category' ? 'categoryId' : 'sectionId';
    const affected = this.items()
      .filter((i) => i[field] === id)
      .map((i) => ({ ...i, [field]: moveTo, updatedAt: now }));
    const children = this.collections()
      .filter((c) => c.parentId === id)
      .map((c) => ({ ...c, parentId: target.parentId ?? null, updatedAt: now }));
    const entries: { id: string; payload: RecordPayload }[] = [
      ...affected.map((item) => ({ id: item.id, payload: { kind: 'item', item, updatedAt: now, device: this.device.name } as RecordPayload })),
      ...children.map((collection) => ({
        id: collection.id,
        payload: { kind: 'collection', collection, updatedAt: now, device: this.device.name } as RecordPayload,
      })),
      { id, payload: { kind: 'tombstone', updatedAt: now, device: this.device.name } },
    ];
    const settings = this.settings();
    if (settings.defaultCategoryId === id) {
      entries.push({
        id: SETTINGS_RECORD_ID,
        payload: { kind: 'settings', settings: { ...settings, defaultCategoryId: null, updatedAt: now }, updatedAt: now, device: this.device.name },
      });
    }
    await this.writePayloads(entries);
  }

  async saveSettings(patch: Partial<VaultSettings>): Promise<void> {
    const now = Date.now();
    const settings = { ...this.settings(), ...patch, updatedAt: now };
    await this.writePayloads([{ id: SETTINGS_RECORD_ID, payload: { kind: 'settings', settings, updatedAt: now, device: this.device.name } }]);
  }

  /** Used by sync/restore: store already-encrypted records (verified by decrypting first). */
  async applyEncryptedRecords(records: EncryptedRecord[], deleteIds: string[] = [], emitLocal = false): Promise<void> {
    const verified: DecryptedRecord[] = [];
    for (const record of records) verified.push({ record, payload: await this.decryptRecord(record) });
    await this.repo.putRecords(verified.map((v) => v.record));
    await this.repo.deleteRecords(deleteIds);
    for (const v of verified) this.decrypted.set(v.record.id, v);
    for (const id of deleteIds) this.decrypted.delete(id);
    this.emit({ type: 'records', local: emitLocal });
  }

  /** Re-encrypt a payload under a fresh id (conflict copies) or bump an existing record's revision. */
  async writeRaw(entries: { id: string; rev: number; payload: RecordPayload }[]): Promise<EncryptedRecord[]> {
    const out: EncryptedRecord[] = [];
    for (const e of entries) out.push(await this.sealRecord(e.id, e.rev, e.payload));
    await this.repo.putRecords(out);
    for (let i = 0; i < out.length; i++) this.decrypted.set(out[i].id, { record: out[i], payload: entries[i].payload });
    this.emit({ type: 'records', local: false });
    return out;
  }

  // ------------------------------------------------------------------ header / security

  /**
   * Commit a header change (security config, KDF, wraps). Bumps the header revision and
   * re-encrypts the security config bound to the new revision.
   */
  async commitHeader(mutate: (header: VaultHeader, security: SecurityConfig) => void, minRev = 0): Promise<void> {
    const keys = this.requireKeys();
    const header: VaultHeader = structuredClone(this.header);
    const security: SecurityConfig = structuredClone(this.security);
    mutate(header, security);
    header.rev = Math.max(this.header.rev + 1, minRev);
    header.vtag = randomId();
    header.updatedAt = Date.now();
    header.security = await sealJson(keys.security, security, aad.security(header.vaultId, header.rev, header.vtag));
    await this.repo.putHeader(header);
    this.header = header;
    this.security = security;
    this.emit({ type: 'header', local: true });
  }

  /** Adopt a header received from sync (already authenticated by the caller). */
  async adoptHeader(header: VaultHeader, security: SecurityConfig): Promise<void> {
    await this.repo.putHeader(header);
    this.header = header;
    this.security = security;
    this.emit({ type: 'header', local: false });
  }

  // ------------------------------------------------------------------ device-local secrets

  async getDeviceSecrets(): Promise<DeviceSecrets> {
    if (this.deviceSecretsCache) return structuredClone(this.deviceSecretsCache);
    const keys = this.requireKeys();
    const sealed = await this.repo.getLocal<Sealed>(`secrets:${keys.vaultId}`);
    let value = structuredClone(DEFAULT_DEVICE_SECRETS);
    if (sealed) {
      try {
        value = { ...value, ...(await openJson<DeviceSecrets>(keys.local, sealed, aad.local(keys.vaultId, 'secrets'))) };
      } catch {
        /* unreadable device secrets are reset (they are non-essential) */
      }
    }
    this.deviceSecretsCache = value;
    return structuredClone(value);
  }

  async setDeviceSecrets(value: DeviceSecrets): Promise<void> {
    const keys = this.requireKeys();
    const sealed = await sealJson(keys.local, value, aad.local(keys.vaultId, 'secrets'));
    await this.repo.setLocal(`secrets:${keys.vaultId}`, sealed);
    this.deviceSecretsCache = structuredClone(value);
    this.emit({ type: 'device', local: false });
  }

  async updateDeviceSecrets(mutate: (s: DeviceSecrets) => void): Promise<DeviceSecrets> {
    const s = await this.getDeviceSecrets();
    mutate(s);
    await this.setDeviceSecrets(s);
    return s;
  }

  async markUsed(id: string): Promise<void> {
    await this.updateDeviceSecrets((s) => {
      s.usage[id] = Date.now();
    });
  }

  /** Synchronous view of cached device secrets (populated after first getDeviceSecrets call). */
  cachedDeviceSecrets(): DeviceSecrets {
    return this.deviceSecretsCache ?? DEFAULT_DEVICE_SECRETS;
  }

  lock(): void {
    this.keys = null;
    this.decrypted = new Map();
    this.deviceSecretsCache = null;
    this.emit({ type: 'lock', local: true });
    this.listeners.clear();
  }
}
