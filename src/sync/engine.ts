/**
 * Conflict-safe synchronization of the encrypted vault with a RemoteStore (Google Drive).
 *
 * - Runs only while the vault is unlocked; the remote only ever receives ciphertext.
 * - Never silently overwrites newer data: three-way merge per record (see merge.ts),
 *   concurrent edits produce a "conflict copy" so both versions survive.
 * - Edits beat deletions (a record deleted on one device but edited on another is kept).
 * - Optimistic concurrency: before uploading, the remote version is re-checked; if another
 *   device wrote in the meantime the whole merge is redone.
 * - A remote file belonging to a different vault, or one that fails authentication,
 *   stops the sync with an explicit error instead of being overwritten.
 */
import { randomId } from '../lib/encoding';
import { openJson } from '../lib/crypto';
import { aad } from '../vault/keys';
import type { ConflictNotice, VaultSession } from '../vault/session';
import type { EncryptedRecord, RecordPayload, SecurityConfig, VaultHeader } from '../vault/types';
import { parseSyncFile, serializeSyncFile, InvalidVaultFileError } from './format';
import { baseFromRecords, mergeRecords } from './merge';
import type { RemoteFileMeta, RemoteStore } from './remote';

export interface SyncState {
  vaultId: string;
  remoteFileId?: string;
  remoteVersion?: string;
  base: Record<string, string>;
  baseHeaderVtag?: string;
  maxHeaderRev: number;
  lastSyncAt?: number;
  lastAttemptAt?: number;
  lastError?: string | null;
}

export interface SyncReport {
  created: boolean;
  pulled: number;
  pushed: number;
  conflicts: ConflictNotice[];
  headerUpdated: boolean;
  skippedCorrupt: number;
  at: number;
}

export class VaultMismatchError extends Error {
  constructor(readonly remoteVaultId: string, readonly remoteCreatedAt: number) {
    super('The cloud vault belongs to a different vault than the one on this device.');
    this.name = 'VaultMismatchError';
  }
}

export class RemoteKeyMismatchError extends Error {
  constructor() {
    super('The cloud vault could not be authenticated with this vault’s keys. It may have been modified or re-keyed.');
    this.name = 'RemoteKeyMismatchError';
  }
}

export class SyncBusyError extends Error {
  constructor() {
    super('The cloud vault kept changing during sync. Please try again.');
    this.name = 'SyncBusyError';
  }
}

export const syncStateKey = (vaultId: string) => `sync:${vaultId}`;

export async function loadSyncState(session: VaultSession): Promise<SyncState> {
  return (
    (await session.repo.getLocal<SyncState>(syncStateKey(session.vaultId))) ?? {
      vaultId: session.vaultId,
      base: {},
      maxHeaderRev: session.header.rev,
    }
  );
}

export async function saveSyncState(session: VaultSession, state: SyncState): Promise<void> {
  await session.repo.setLocal(syncStateKey(session.vaultId), state);
}

function contentKey(p: RecordPayload): string {
  // Compare payloads ignoring bookkeeping fields.
  const { updatedAt: _u, device: _d, ...rest } = p as RecordPayload & { updatedAt: number; device: string };
  if (rest.kind === 'item') {
    const { updatedAt: _iu, ...item } = rest.item;
    return JSON.stringify({ kind: 'item', item });
  }
  return JSON.stringify(rest);
}

export class SyncEngine {
  constructor(
    private readonly session: VaultSession,
    private readonly remote: RemoteStore,
  ) {}

  async sync(): Promise<SyncReport> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.attempt();
      if (result) return result;
    }
    throw new SyncBusyError();
  }

  private async locate(state: SyncState): Promise<RemoteFileMeta | null> {
    if (state.remoteFileId) {
      const meta = await this.remote.getMeta(state.remoteFileId);
      if (meta) return meta;
    }
    return this.remote.find();
  }

  /** One merge attempt. Returns null if the remote changed underneath us (caller retries). */
  private async attempt(): Promise<SyncReport | null> {
    const s = this.session;
    const state = await loadSyncState(s);
    const now = Date.now();
    const meta = await this.locate(state);

    if (!meta) {
      const created = await this.remote.create(serializeSyncFile(s.header, s.encryptedRecords(), s.device.id));
      await saveSyncState(s, {
        ...state,
        remoteFileId: created.id,
        remoteVersion: created.version,
        base: baseFromRecords(s.encryptedRecords()),
        baseHeaderVtag: s.header.vtag,
        maxHeaderRev: Math.max(state.maxHeaderRev, s.header.rev),
        lastSyncAt: now,
        lastAttemptAt: now,
        lastError: null,
      });
      return { created: true, pulled: 0, pushed: s.encryptedRecords().length, conflicts: [], headerUpdated: false, skippedCorrupt: 0, at: now };
    }

    const file = parseSyncFile(await this.remote.download(meta.id));
    if (file.header.vaultId !== s.vaultId) throw new VaultMismatchError(file.header.vaultId, file.header.createdAt);

    const notices: ConflictNotice[] = [];
    const header = await this.mergeHeader(file.header, state, notices);

    // ------------------------------------------------------------ records
    const snapshot = s.encryptedRecords();
    const snapshotTags = new Map(snapshot.map((r) => [r.id, r.vtag]));
    const result = mergeRecords(snapshot, file.records, state.base);
    const merged = result.merged;
    let remoteChanged = result.remoteChanged || header.pushLocal;
    let skippedCorrupt = 0;

    // Verify remote records we intend to pull (authenticated decryption).
    const pullOk: EncryptedRecord[] = [];
    for (const r of result.pull) {
      try {
        await s.decryptRecord(r);
        pullOk.push(r);
      } catch {
        skippedCorrupt++;
        const local = snapshot.find((x) => x.id === r.id);
        if (local) {
          merged.set(r.id, local);
          remoteChanged = true;
        }
      }
    }

    // Re-seal local winners that must outrank the remote revision.
    const rewrites: { id: string; rev: number; payload: RecordPayload }[] = [];
    for (const { id, minRev } of result.bump) {
      const rec = merged.get(id)!;
      rewrites.push({ id, rev: minRev, payload: await s.decryptRecord(rec) });
    }

    // Resolve conflicts without losing data.
    for (const c of result.conflicts) {
      const minRev = Math.max(c.local.rev, c.remote.rev) + 1;
      let pl: RecordPayload | null = null;
      let pr: RecordPayload | null = null;
      try {
        pl = await s.decryptRecord(c.local);
      } catch {
        /* corrupted local */
      }
      try {
        pr = await s.decryptRecord(c.remote);
      } catch {
        skippedCorrupt++;
      }
      if (!pl && !pr) continue;
      if (!pr) {
        rewrites.push({ id: c.id, rev: minRev, payload: pl! });
        continue;
      }
      if (!pl) {
        rewrites.push({ id: c.id, rev: minRev, payload: pr });
        continue;
      }
      if (contentKey(pl) === contentKey(pr)) {
        rewrites.push({ id: c.id, rev: minRev, payload: pl.updatedAt >= pr.updatedAt ? pl : pr });
        continue;
      }
      // Edit beats delete
      if (pl.kind === 'tombstone' || pr.kind === 'tombstone') {
        const kept = pl.kind === 'tombstone' ? pr : pl;
        rewrites.push({ id: c.id, rev: minRev, payload: kept });
        if (kept.kind === 'item') {
          notices.push({
            id: randomId(),
            at: now,
            kind: 'item',
            title: kept.item.title,
            keptId: c.id,
            message: 'This item was deleted on one device but edited on another. The edited version was kept.',
          });
        }
        continue;
      }
      const [winner, loser] = pl.updatedAt >= pr.updatedAt ? [pl, pr] : [pr, pl];
      rewrites.push({ id: c.id, rev: minRev, payload: winner });
      if (winner.kind === 'item' && loser.kind === 'item') {
        const copyId = randomId();
        const copyItem = {
          ...loser.item,
          id: copyId,
          title: `${loser.item.title || 'Untitled'} (conflict copy)`,
          updatedAt: now,
        };
        rewrites.push({ id: copyId, rev: 1, payload: { kind: 'item', item: copyItem, updatedAt: now, device: loser.device } });
        notices.push({
          id: randomId(),
          at: now,
          kind: 'item',
          title: winner.item.title,
          keptId: c.id,
          copyId,
          message: `Edited on two devices at the same time. The newest version was kept and the version from “${loser.device}” was saved as a conflict copy.`,
        });
      } else if (winner.kind === 'collection' && loser.kind === 'collection' && winner.collection.name !== loser.collection.name) {
        notices.push({
          id: randomId(),
          at: now,
          kind: 'collection',
          title: winner.collection.name,
          keptId: c.id,
          message: `“${loser.collection.name}” was also renamed on another device. The most recent change was kept.`,
        });
      } else if (winner.kind === 'settings') {
        notices.push({
          id: randomId(),
          at: now,
          kind: 'settings',
          title: 'Vault settings',
          message: 'Vault settings were changed on two devices. The most recent change was kept.',
        });
      }
    }

    // Abort cleanly if the remote changed since we downloaded it.
    if (remoteChanged || rewrites.length) {
      const current = await this.remote.getMeta(meta.id);
      if (!current || current.version !== meta.version) return null;
    }

    // ------------------------------------------------------------ apply locally
    // Only overwrite local records the user has not edited while we were merging.
    const stillSame = (id: string) => {
      const cur = s.encryptedRecords().find((r) => r.id === id);
      return !cur || cur.vtag === snapshotTags.get(id);
    };
    const toApply = pullOk.filter((r) => stillSame(r.id));
    if (toApply.length) await s.applyEncryptedRecords(toApply);
    const safeRewrites = rewrites.filter((w) => !snapshotTags.has(w.id) || stillSame(w.id));
    if (safeRewrites.length) {
      const written = await s.writeRaw(safeRewrites);
      for (const w of written) merged.set(w.id, w);
      remoteChanged = true;
    }
    if (header.adopt) await s.adoptHeader(header.adopt.header, header.adopt.security);
    if (header.bumpLocal) {
      await s.commitHeader(() => undefined, header.bumpLocal);
      remoteChanged = true;
    }

    // ------------------------------------------------------------ upload
    let finalMeta = meta;
    if (remoteChanged) {
      finalMeta = await this.remote.update(meta.id, serializeSyncFile(s.header, [...merged.values()], s.device.id));
    }

    if (notices.length) {
      await s.updateDeviceSecrets((sec) => {
        sec.conflicts = [...notices, ...sec.conflicts].slice(0, 50);
      });
    }

    await saveSyncState(s, {
      ...state,
      remoteFileId: finalMeta.id,
      remoteVersion: finalMeta.version,
      base: baseFromRecords(merged.values()),
      baseHeaderVtag: s.header.vtag,
      maxHeaderRev: Math.max(state.maxHeaderRev, s.header.rev),
      lastSyncAt: now,
      lastAttemptAt: now,
      lastError: null,
    });

    return {
      created: false,
      pulled: toApply.length,
      pushed: remoteChanged ? result.pushed + safeRewrites.length : 0,
      conflicts: notices,
      headerUpdated: !!header.adopt,
      skippedCorrupt,
      at: now,
    };
  }

  /** Decide which vault header wins. */
  private async mergeHeader(
    remote: VaultHeader,
    state: SyncState,
    notices: ConflictNotice[],
  ): Promise<{ adopt?: { header: VaultHeader; security: SecurityConfig }; pushLocal: boolean; bumpLocal?: number }> {
    const local = this.session.header;
    if (remote.vtag === local.vtag) return { pushLocal: false };

    const authenticate = async (): Promise<SecurityConfig> => {
      try {
        const keys = this.session.getKeys();
        return await openJson<SecurityConfig>(keys.security, remote.security, aad.security(remote.vaultId, remote.rev, remote.vtag));
      } catch {
        throw new RemoteKeyMismatchError();
      }
    };

    // Rollback protection: never accept a header older than one we've already seen.
    if (remote.rev < state.maxHeaderRev || (remote.rev < local.rev && local.vtag === state.baseHeaderVtag)) {
      return { pushLocal: true };
    }
    if (local.vtag === state.baseHeaderVtag) {
      return { adopt: { header: remote, security: await authenticate() }, pushLocal: false };
    }
    if (remote.vtag === state.baseHeaderVtag) {
      return { pushLocal: true };
    }
    // Both changed: keep the most recent change, make sure the result outranks both.
    const security = await authenticate();
    notices.push({
      id: randomId(),
      at: Date.now(),
      kind: 'header',
      title: 'Security settings',
      message: 'Security settings (master password, Authenticator or recovery options) were changed on two devices. The most recent change was kept — please review Settings → Security.',
    });
    const minRev = Math.max(local.rev, remote.rev) + 1;
    if (remote.updatedAt > local.updatedAt) {
      return { adopt: { header: remote, security }, pushLocal: true, bumpLocal: minRev };
    }
    return { pushLocal: true, bumpLocal: minRev };
  }
}

export { InvalidVaultFileError };
