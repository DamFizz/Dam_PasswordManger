import { describe, expect, it } from 'vitest';
import { changeMasterPassword, createVault, unlockWithPassword, WrongPasswordError } from '../src/vault/access';
import { emptyItem, type EncryptedRecord, type VaultItem } from '../src/vault/types';
import { randomId } from '../src/lib/encoding';
import type { VaultSession } from '../src/vault/session';
import { SyncEngine, VaultMismatchError } from '../src/sync/engine';
import { mergeRecords } from '../src/sync/merge';
import { parseSyncFile } from '../src/sync/format';
import { downloadVaultToDevice } from '../src/sync/bootstrap';
import { MemoryRemote } from './memory-remote';
import { freshRepo, STRONG_PASSWORD } from './helpers';

function login(title: string, password = 'pw'): VaultItem {
  return { ...emptyItem('login', randomId(), Date.now()), title, password };
}

const rec = (id: string, rev: number, vtag: string): EncryptedRecord => ({ id, rev, vtag, iv: 'aaaaaaaaaaaaaaaa', ct: 'bbbb' });

describe('three-way merge', () => {
  it('handles every case', () => {
    const local = [rec('same', 1, 'a'), rec('localOnly', 1, 'b'), rec('remoteEdited', 1, 'c'), rec('localEdited', 2, 'd2'), rec('both', 2, 'e-local'), rec('stale', 3, 'f3')];
    const remote = [rec('same', 1, 'a'), rec('remoteOnly', 1, 'x'), rec('remoteEdited', 2, 'c2'), rec('localEdited', 1, 'd'), rec('both', 2, 'e-remote'), rec('stale', 1, 'f1')];
    const base = { same: 'a', remoteEdited: 'c', localEdited: 'd', both: 'e', stale: 'f3' };
    const r = mergeRecords(local, remote, base);
    expect(r.pull.map((x) => x.id).sort()).toEqual(['remoteEdited', 'remoteOnly']);
    expect(r.conflicts.map((c) => c.id)).toEqual(['both']);
    expect(r.merged.get('localEdited')?.vtag).toBe('d2');
    expect(r.merged.get('stale')?.vtag).toBe('f3'); // older remote revision never wins
    expect(r.merged.get('localOnly')?.vtag).toBe('b');
    expect(r.remoteChanged).toBe(true);
  });

  it('does not rewrite an identical remote', () => {
    const r = mergeRecords([rec('a', 1, 'x')], [rec('a', 1, 'x')], { a: 'x' });
    expect(r.remoteChanged).toBe(false);
    expect(r.pull).toHaveLength(0);
  });
});

/** Two devices sharing one vault through an in-memory "Drive". */
async function twoDevices() {
  const remote = new MemoryRemote();
  const repoA = freshRepo();
  const a = await createVault(repoA, STRONG_PASSWORD);
  await new SyncEngine(a, remote).sync();
  const repoB = freshRepo();
  await downloadVaultToDevice(repoB, remote);
  const step = await unlockWithPassword(repoB, STRONG_PASSWORD);
  if (step.type !== 'unlocked') throw new Error();
  const b = step.session;
  await new SyncEngine(b, remote).sync();
  return { remote, a, b, repoA, repoB };
}

const sync = (s: VaultSession, remote: MemoryRemote) => new SyncEngine(s, remote).sync();

describe('sync engine', () => {
  it('first sync uploads only ciphertext', async () => {
    const remote = new MemoryRemote();
    const a = await createVault(freshRepo(), STRONG_PASSWORD);
    await a.saveItem(login('Instagram', 'insta-SECRET'));
    const report = await sync(a, remote);
    expect(report.created).toBe(true);
    const content = [...remote.files.values()][0].content;
    expect(content).not.toContain('insta-SECRET');
    expect(content).not.toContain('Instagram');
    expect(parseSyncFile(content).records.length).toBe(a.encryptedRecords().length);
  });

  it('PC → phone → PC round trip (the Instagram scenario)', async () => {
    const { remote, a, b } = await twoDevices();
    const insta = login('Instagram', 'insta-pw');
    await a.saveItem(insta);
    await sync(a, remote);
    const r = await sync(b, remote);
    expect(r.pulled).toBe(1);
    expect(b.getItem(insta.id)?.password).toBe('insta-pw');

    await b.saveItem({ ...b.getItem(insta.id)!, password: 'changed-on-phone' });
    await sync(b, remote);
    await sync(a, remote);
    expect(a.getItem(insta.id)?.password).toBe('changed-on-phone');
  });

  it('a second sync with no changes does not rewrite the remote', async () => {
    const { remote, a } = await twoDevices();
    const before = [...remote.files.values()][0].version;
    const r = await sync(a, remote);
    expect(r.pushed).toBe(0);
    expect([...remote.files.values()][0].version).toBe(before);
  });

  it('concurrent edits keep both versions (conflict copy) and warn', async () => {
    const { remote, a, b } = await twoDevices();
    const item = login('Discord', 'original');
    await a.saveItem(item);
    await sync(a, remote);
    await sync(b, remote);

    await a.saveItem({ ...a.getItem(item.id)!, password: 'edited-on-pc' });
    await new Promise((r) => setTimeout(r, 5));
    await b.saveItem({ ...b.getItem(item.id)!, password: 'edited-on-phone' });
    await sync(a, remote);
    const report = await sync(b, remote);
    expect(report.conflicts).toHaveLength(1);
    await sync(a, remote);

    for (const s of [a, b]) {
      const passwords = s.items().filter((i) => i.title.startsWith('Discord')).map((i) => i.password).sort();
      expect(passwords).toEqual(['edited-on-pc', 'edited-on-phone']);
      expect(s.getItem(item.id)?.password).toBe('edited-on-phone'); // newest wins the original id
    }
    expect((await b.getDeviceSecrets()).conflicts).toHaveLength(1);
  });

  it('deletions propagate, but an edit beats a concurrent deletion', async () => {
    const { remote, a, b } = await twoDevices();
    const x = login('Delete me');
    const y = login('Keep me');
    await a.saveItems([x, y]);
    await sync(a, remote);
    await sync(b, remote);

    await a.purgeItems([x.id]);
    await sync(a, remote);
    await sync(b, remote);
    expect(b.getItem(x.id)).toBeUndefined();

    await a.purgeItems([y.id]);
    await b.saveItem({ ...b.getItem(y.id)!, notes: 'important edit' });
    await sync(a, remote);
    await sync(b, remote);
    await sync(a, remote);
    expect(a.getItem(y.id)?.notes).toBe('important edit');
    expect(b.getItem(y.id)?.notes).toBe('important edit');
  });

  it('retries when another device writes during sync (no lost update)', async () => {
    const { remote, a, b } = await twoDevices();
    await b.saveItem(login('From phone'));
    await a.saveItem(login('From PC'));
    // While device A is merging (after its download), device B uploads its change.
    remote.afterDownload = async () => {
      remote.afterDownload = undefined;
      await sync(b, remote);
    };
    await sync(a, remote);
    await sync(b, remote);
    expect(a.items().map((i) => i.title).sort()).toEqual(['From PC', 'From phone']);
    expect(b.items().map((i) => i.title).sort()).toEqual(['From PC', 'From phone']);
  });

  it('a rolled-back (stale) remote file never overwrites newer local data', async () => {
    const { remote, a } = await twoDevices();
    const item = login('Bank', 'v1');
    await a.saveItem(item);
    await sync(a, remote);
    const [fileId, file] = [...remote.files.entries()][0];
    const oldContent = file.content;
    await a.saveItem({ ...a.getItem(item.id)!, password: 'v2' });
    await sync(a, remote);
    // Attacker / provider restores the old file version
    remote.files.set(fileId, { ...remote.files.get(fileId)!, content: oldContent, version: file.version + 1 });
    await sync(a, remote);
    expect(a.getItem(item.id)?.password).toBe('v2');
    const remoteFile = parseSyncFile(remote.files.get(fileId)!.content);
    expect(remoteFile.records.find((r) => r.id === item.id)?.rev).toBe(a.encryptedRecords().find((r) => r.id === item.id)?.rev);
  });

  it('master password change on one device applies to the other', async () => {
    const { remote, a, b, repoB } = await twoDevices();
    await changeMasterPassword(a, STRONG_PASSWORD, 'Brand-New-Pass-77');
    await sync(a, remote);
    const report = await sync(b, remote);
    expect(report.headerUpdated).toBe(true);
    b.lock();
    await expect(unlockWithPassword(repoB, STRONG_PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    expect((await unlockWithPassword(repoB, 'Brand-New-Pass-77')).type).toBe('unlocked');
  });

  it('refuses to merge with a different vault', async () => {
    const remote = new MemoryRemote();
    await sync(await createVault(freshRepo(), STRONG_PASSWORD), remote);
    const other = await createVault(freshRepo(), STRONG_PASSWORD);
    await expect(sync(other, remote)).rejects.toBeInstanceOf(VaultMismatchError);
  });

  it('skips tampered remote records instead of importing them', async () => {
    const { remote, a, b } = await twoDevices();
    const item = login('Mail', 'mail-pw');
    await a.saveItem(item);
    await sync(a, remote);
    const [id, f] = [...remote.files.entries()][0];
    const parsed = JSON.parse(f.content);
    const r = parsed.records.find((x: EncryptedRecord) => x.id === item.id);
    r.ct = r.ct.slice(0, -4) + (r.ct.endsWith('AAA=') ? 'BBB=' : 'AAA=');
    remote.files.set(id, { ...f, content: JSON.stringify(parsed), version: f.version + 1 });
    const report = await sync(b, remote);
    expect(report.skippedCorrupt).toBe(1);
    expect(b.getItem(item.id)).toBeUndefined();
  });
});
