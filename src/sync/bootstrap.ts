/**
 * New-device setup: download the encrypted vault from the cloud and store it locally.
 * The vault stays encrypted; the user then unlocks it with the master password
 * (and Authenticator code if enabled). Google sign-in never replaces the master password.
 */
import { randomId } from '../lib/encoding';
import type { VaultRepository } from '../vault/db';
import { syncStateKey, type SyncState } from './engine';
import { parseSyncFile } from './format';
import { baseFromRecords } from './merge';
import type { RemoteStore } from './remote';

export class NoCloudVaultError extends Error {
  constructor() {
    super('No MyVault vault was found in this Google account yet. Create a vault on your other device and sync it first.');
    this.name = 'NoCloudVaultError';
  }
}

export async function cloudVaultInfo(remote: RemoteStore): Promise<{ createdAt: number; records: number; writtenAt: number } | null> {
  const meta = await remote.find();
  if (!meta) return null;
  const file = parseSyncFile(await remote.download(meta.id));
  return { createdAt: file.header.createdAt, records: file.records.length, writtenAt: file.writtenAt };
}

export async function downloadVaultToDevice(repo: VaultRepository, remote: RemoteStore): Promise<{ vaultId: string }> {
  const meta = await remote.find();
  if (!meta) throw new NoCloudVaultError();
  const file = parseSyncFile(await remote.download(meta.id));
  if (await repo.getHeader()) await repo.createSnapshot('before-cloud-download', randomId());
  await repo.replaceVault(file.header, file.records);
  const state: SyncState = {
    vaultId: file.header.vaultId,
    remoteFileId: meta.id,
    remoteVersion: meta.version,
    base: baseFromRecords(file.records),
    baseHeaderVtag: file.header.vtag,
    maxHeaderRev: file.header.rev,
    lastSyncAt: Date.now(),
    lastError: null,
  };
  await repo.setLocal(syncStateKey(file.header.vaultId), state);
  return { vaultId: file.header.vaultId };
}
