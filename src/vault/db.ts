import Dexie, { type Table } from 'dexie';
import type { EncryptedRecord, VaultHeader } from './types';

export interface KeyValue<T = unknown> {
  key: string;
  value: T;
}

export interface Snapshot {
  id: string;
  createdAt: number;
  reason: string;
  header: VaultHeader;
  records: EncryptedRecord[];
}

/**
 * IndexedDB schema. Everything sensitive is stored only as ciphertext:
 *  - meta.header: KDF params + wrapped vault key + encrypted security config
 *  - records: encrypted items, collections, settings and tombstones
 *  - local: device-only state (throttling counters, sync bookkeeping, encrypted device secrets)
 *  - snapshots: encrypted safety copies taken before destructive operations
 */
export class VaultDB extends Dexie {
  meta!: Table<KeyValue, string>;
  records!: Table<EncryptedRecord, string>;
  local!: Table<KeyValue, string>;
  snapshots!: Table<Snapshot, string>;

  constructor(name = 'myvault') {
    super(name);
    this.version(1).stores({
      meta: 'key',
      records: 'id',
      local: 'key',
      snapshots: 'id, createdAt',
    });
  }
}

export class VaultRepository {
  constructor(readonly db: VaultDB) {}

  async getHeader(): Promise<VaultHeader | undefined> {
    const row = await this.db.meta.get('header');
    return row?.value as VaultHeader | undefined;
  }

  async putHeader(header: VaultHeader): Promise<void> {
    await this.db.meta.put({ key: 'header', value: header });
  }

  async allRecords(): Promise<EncryptedRecord[]> {
    return this.db.records.toArray();
  }

  async getRecord(id: string): Promise<EncryptedRecord | undefined> {
    return this.db.records.get(id);
  }

  async putRecords(records: EncryptedRecord[]): Promise<void> {
    if (records.length) await this.db.records.bulkPut(records);
  }

  async deleteRecords(ids: string[]): Promise<void> {
    if (ids.length) await this.db.records.bulkDelete(ids);
  }

  async getLocal<T>(key: string): Promise<T | undefined> {
    const row = await this.db.local.get(key);
    return row?.value as T | undefined;
  }

  async setLocal<T>(key: string, value: T): Promise<void> {
    await this.db.local.put({ key, value });
  }

  async deleteLocal(key: string): Promise<void> {
    await this.db.local.delete(key);
  }

  /** Atomically replace the whole local vault (header + records). Device-local state is kept unless cleared. */
  async replaceVault(header: VaultHeader, records: EncryptedRecord[], clearLocalKeys: string[] = []): Promise<void> {
    await this.db.transaction('rw', this.db.meta, this.db.records, this.db.local, async () => {
      await this.db.records.clear();
      await this.db.records.bulkPut(records);
      await this.db.meta.put({ key: 'header', value: header });
      for (const k of clearLocalKeys) await this.db.local.delete(k);
    });
  }

  async createSnapshot(reason: string, id: string, keep = 5): Promise<Snapshot | null> {
    const header = await this.getHeader();
    if (!header) return null;
    const snap: Snapshot = { id, createdAt: Date.now(), reason, header, records: await this.allRecords() };
    await this.db.snapshots.put(snap);
    const all = await this.db.snapshots.orderBy('createdAt').toArray();
    const excess = all.length - keep;
    if (excess > 0) await this.db.snapshots.bulkDelete(all.slice(0, excess).map((s) => s.id));
    return snap;
  }

  async listSnapshots(): Promise<Snapshot[]> {
    return (await this.db.snapshots.orderBy('createdAt').toArray()).reverse();
  }

  async deleteSnapshot(id: string): Promise<void> {
    await this.db.snapshots.delete(id);
  }

  /** Remove every trace of the vault from this device. */
  async wipeAll(): Promise<void> {
    await this.db.transaction('rw', [this.db.meta, this.db.records, this.db.local, this.db.snapshots], async () => {
      await Promise.all([this.db.meta.clear(), this.db.records.clear(), this.db.local.clear(), this.db.snapshots.clear()]);
    });
  }

  async storageEstimate(): Promise<{ records: number; snapshots: number; usage?: number; quota?: number }> {
    const [records, snapshots] = await Promise.all([this.db.records.count(), this.db.snapshots.count()]);
    let usage: number | undefined;
    let quota: number | undefined;
    if (typeof navigator !== 'undefined' && navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      usage = est.usage;
      quota = est.quota;
    }
    return { records, snapshots, usage, quota };
  }
}
