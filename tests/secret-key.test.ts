import { describe, expect, it } from 'vitest';
import {
  changeMasterPassword,
  createRecoveryKey,
  createVault,
  currentSecretKey,
  disableSecretKey,
  enableSecretKey,
  unlockWithPassword,
  unlockWithRecoveryKey,
  verifyMasterPassword,
  WrongPasswordError,
  type UnlockStep,
} from '../src/vault/access';
import {
  formatSecretKey,
  generateSecretKey,
  InvalidSecretKeyError,
  parseSecretKey,
  passwordKek,
  secretKeyQrPayload,
  unwrapVaultKey,
} from '../src/vault/keys';
import { hasSecretKeyOnDevice, RecoveryKeyRequiredError, SecretKeyRequiredError, WrongSecretKeyError } from '../src/vault/secret-key';
import { createBackup, openBackup, restoreMerge } from '../src/vault/backup';
import { parseSyncFile, validateHeader, InvalidVaultFileError } from '../src/sync/format';
import { SyncEngine } from '../src/sync/engine';
import { downloadVaultToDevice } from '../src/sync/bootstrap';
import { emptyItem, type VaultHeader } from '../src/vault/types';
import { randomId } from '../src/lib/encoding';
import type { VaultRepository } from '../src/vault/db';
import type { VaultSession } from '../src/vault/session';
import { MemoryRemote } from './memory-remote';
import { freshRepo, STRONG_PASSWORD } from './helpers';

async function unlocked(step: UnlockStep | Promise<UnlockStep>): Promise<VaultSession> {
  const s = await step;
  if (s.type !== 'unlocked') throw new Error(`expected unlocked, got ${s.type}`);
  return s.session;
}

/** A vault with a recovery key and one item; returns the recovery key too. */
async function vaultWithRecovery() {
  const repo = freshRepo();
  const session = await createVault(repo, STRONG_PASSWORD);
  await session.saveItem({ ...emptyItem('login', 'item-1', Date.now()), title: 'GitHub', password: 'gh-secret' });
  const recoveryKey = await createRecoveryKey(session, STRONG_PASSWORD);
  return { repo, session, recoveryKey };
}

/** Copy the synced part of a vault to a "new device" (no local state). */
async function newDevice(from: VaultRepository): Promise<VaultRepository> {
  const repo = freshRepo();
  await repo.replaceVault((await from.getHeader())!, await from.allRecords());
  return repo;
}

describe('Secret Key format', () => {
  it('formats with prefix and checksum, and parses leniently', async () => {
    const { display, raw } = await generateSecretKey();
    expect(display).toMatch(/^MV2(-[A-Z2-7]{4}){7}$/);
    expect(await formatSecretKey(raw)).toBe(display);
    for (const variant of [display, display.toLowerCase(), display.replace(/-/g, ' '), display.slice(4)]) {
      expect((await parseSecretKey(variant)).raw).toEqual(raw);
    }
    const qr = secretKeyQrPayload('vault-123', raw);
    expect(await parseSecretKey(qr)).toEqual({ raw, vaultId: 'vault-123' });
  });

  it('catches typos with the checksum', async () => {
    const { display } = await generateSecretKey();
    const i = display.length - 6; // a character of the key body
    const typo = display.slice(0, i) + (display[i] === 'A' ? 'B' : 'A') + display.slice(i + 1);
    await expect(parseSecretKey(typo)).rejects.toBeInstanceOf(InvalidSecretKeyError);
    await expect(parseSecretKey('MV2-ABCD')).rejects.toBeInstanceOf(InvalidSecretKeyError);
  });

  it('header validation accepts v2 and refuses newer or inconsistent headers', async () => {
    const { session } = await vaultWithRecovery();
    const h: VaultHeader = structuredClone(session.header);
    expect(() => validateHeader({ ...h, version: 2, secretKey: { id: 'x', createdAt: 1 } })).not.toThrow();
    expect(() => validateHeader({ ...h, version: 3 })).toThrow(InvalidVaultFileError);
    expect(() => validateHeader({ ...h, version: 1, secretKey: { id: 'x', createdAt: 1 } })).toThrow(InvalidVaultFileError);
  });
});

describe('Secret Key lifecycle', () => {
  it('requires a recovery key before it can be enabled', async () => {
    const session = await createVault(freshRepo(), STRONG_PASSWORD);
    const { display } = await generateSecretKey();
    await expect(enableSecretKey(session, STRONG_PASSWORD, display)).rejects.toBeInstanceOf(RecoveryKeyRequiredError);
    expect(session.header.secretKey ?? null).toBeNull();
  });

  it('enable: the cloud copy + master password is no longer enough', async () => {
    const { repo, session } = await vaultWithRecovery();
    const { display, raw } = await generateSecretKey();
    await expect(enableSecretKey(session, 'wrong password', display)).rejects.toBeInstanceOf(WrongPasswordError);
    await enableSecretKey(session, STRONG_PASSWORD, display);

    const header = (await repo.getHeader())!;
    expect(header.version).toBe(2);
    expect(header.secretKey?.id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(currentSecretKey(session)).toEqual(raw);
    const stored = await repo.getLocal<{ id: string; key: CryptoKey }>(`secretKey:${header.vaultId}`);
    expect(stored?.key.extractable).toBe(false); // raw key is not readable from IndexedDB through Web Crypto
    expect(JSON.stringify(header)).not.toContain(display.slice(4, 8));

    // The v1 (password-only) KEK can no longer unwrap the vault key.
    const v1 = await passwordKek(STRONG_PASSWORD, header.kdf, header.vaultId);
    await expect(unwrapVaultKey(v1, header.passwordWrap, header.vaultId, 'password')).rejects.toThrow();

    // Same device: unlocks with the password alone (Secret Key is remembered).
    session.lock();
    expect((await unlocked(unlockWithPassword(repo, STRONG_PASSWORD))).items()).toHaveLength(1);

    // New device: needs the Secret Key; a wrong key or wrong password is reported precisely.
    const repo2 = await newDevice(repo);
    expect(await hasSecretKeyOnDevice(repo2, header)).toBe(false);
    await expect(unlockWithPassword(repo2, STRONG_PASSWORD)).rejects.toBeInstanceOf(SecretKeyRequiredError);
    await expect(unlockWithPassword(repo2, STRONG_PASSWORD, { secretKey: (await generateSecretKey()).display })).rejects.toBeInstanceOf(WrongSecretKeyError);
    await expect(unlockWithPassword(repo2, 'wrong password', { secretKey: display })).rejects.toBeInstanceOf(WrongPasswordError);
    expect(await hasSecretKeyOnDevice(repo2, header)).toBe(false); // not remembered after a failed unlock
    const s2 = await unlocked(unlockWithPassword(repo2, STRONG_PASSWORD, { secretKey: display }));
    expect(s2.getItem('item-1')?.password).toBe('gh-secret');
    s2.lock();
    await unlocked(unlockWithPassword(repo2, STRONG_PASSWORD)); // remembered now

    // "Don't remember on this device"
    const repo3 = await newDevice(repo);
    await unlocked(unlockWithPassword(repo3, STRONG_PASSWORD, { secretKey: display, rememberSecretKey: false }));
    await expect(unlockWithPassword(repo3, STRONG_PASSWORD)).rejects.toBeInstanceOf(SecretKeyRequiredError);
  });

  it('master password change and re-authentication keep the Secret Key mode', async () => {
    const { repo, session } = await vaultWithRecovery();
    const { display } = await generateSecretKey();
    await enableSecretKey(session, STRONG_PASSWORD, display);
    await verifyMasterPassword(session, STRONG_PASSWORD);
    await changeMasterPassword(session, STRONG_PASSWORD, 'Another-Strong-Pass-77');
    expect(session.header.secretKey).toBeTruthy();
    const repo2 = await newDevice(repo);
    await expect(unlockWithPassword(repo2, 'Another-Strong-Pass-77')).rejects.toBeInstanceOf(SecretKeyRequiredError);
    await unlocked(unlockWithPassword(repo2, 'Another-Strong-Pass-77', { secretKey: display }));
  });

  it('recovery key on a new device recovers the Secret Key from inside the vault', async () => {
    const { repo, session, recoveryKey } = await vaultWithRecovery();
    const { display } = await generateSecretKey();
    await enableSecretKey(session, STRONG_PASSWORD, display);
    const repo2 = await newDevice(repo);
    const s2 = await unlocked(unlockWithRecoveryKey(repo2, recoveryKey, 'Recovered-Pass-1234'));
    expect(s2.header.secretKey?.id).toBe(session.header.secretKey?.id);
    s2.lock();
    await unlocked(unlockWithPassword(repo2, 'Recovered-Pass-1234')); // Secret Key now on this device
    const repo3 = await newDevice(repo2);
    await unlocked(unlockWithPassword(repo3, 'Recovered-Pass-1234', { secretKey: display }));
  });

  it('rotation makes the old key useless; disabling returns to password-only', async () => {
    const { repo, session } = await vaultWithRecovery();
    const first = await generateSecretKey();
    await enableSecretKey(session, STRONG_PASSWORD, first.display);
    const other = await newDevice(repo);
    await unlocked(unlockWithPassword(other, STRONG_PASSWORD, { secretKey: first.display }));

    const second = await generateSecretKey();
    await enableSecretKey(session, STRONG_PASSWORD, second.display); // rotate
    await other.putHeader((await repo.getHeader())!); // the other device receives the new header
    await expect(unlockWithPassword(other, STRONG_PASSWORD)).rejects.toBeInstanceOf(SecretKeyRequiredError); // stale key discarded
    await expect(unlockWithPassword(other, STRONG_PASSWORD, { secretKey: first.display })).rejects.toBeInstanceOf(WrongSecretKeyError);
    await unlocked(unlockWithPassword(other, STRONG_PASSWORD, { secretKey: second.display }));

    await disableSecretKey(session, STRONG_PASSWORD);
    const h = (await repo.getHeader())!;
    expect(h.version).toBe(2);
    expect(h.secretKey).toBeNull();
    expect(session.security.secretKey).toBeNull();
    await unlocked(unlockWithPassword(await newDevice(repo), STRONG_PASSWORD));
  });

  it('a backup of a Secret Key vault needs the Secret Key to merge-import', async () => {
    const { session } = await vaultWithRecovery();
    const { display } = await generateSecretKey();
    await enableSecretKey(session, STRONG_PASSWORD, display);
    const backup = await openBackup(await createBackup(session, 'backup-pass', 'test'), 'backup-pass');
    const target = await createVault(freshRepo(), STRONG_PASSWORD);
    await expect(restoreMerge(target, backup, STRONG_PASSWORD)).rejects.toBeInstanceOf(SecretKeyRequiredError);
    const res = await restoreMerge(target, backup, STRONG_PASSWORD, display);
    expect(res.added).toBe(1);
  });
});

describe('Secret Key and sync', () => {
  async function twoDevices() {
    const remote = new MemoryRemote();
    const { repo: repoA, session: a } = await vaultWithRecovery();
    await new SyncEngine(a, remote).sync();
    const repoB = freshRepo();
    await downloadVaultToDevice(repoB, remote);
    const b = await unlocked(unlockWithPassword(repoB, STRONG_PASSWORD));
    await new SyncEngine(b, remote).sync();
    return { remote, a, b, repoA, repoB };
  }
  const sync = (s: VaultSession, remote: MemoryRemote) => new SyncEngine(s, remote).sync();

  it('enabling on one device reaches the other; its open session keeps working', async () => {
    const { remote, a, b, repoB } = await twoDevices();
    const { display } = await generateSecretKey();
    await enableSecretKey(a, STRONG_PASSWORD, display);
    await sync(a, remote);
    const report = await sync(b, remote);
    expect(report.headerUpdated).toBe(true);
    expect(b.header.secretKey?.id).toBe(a.header.secretKey?.id);
    await b.saveItem({ ...emptyItem('note', randomId(), Date.now()), title: 'still works' });
    await sync(b, remote);
    b.lock();
    await expect(unlockWithPassword(repoB, STRONG_PASSWORD)).rejects.toBeInstanceOf(SecretKeyRequiredError);
    await unlocked(unlockWithPassword(repoB, STRONG_PASSWORD, { secretKey: display }));
    const file = parseSyncFile(remote.files.values().next().value!.content);
    expect(file.header.version).toBe(2);
  });

  it('a concurrent password change never silently removes the Secret Key', async () => {
    const { remote, a, b } = await twoDevices();
    const { display } = await generateSecretKey();
    await enableSecretKey(a, STRONG_PASSWORD, display); // device A: turn on
    await sync(a, remote);
    // device B (not yet synced) changes the master password later in time
    await new Promise((r) => setTimeout(r, 5));
    await changeMasterPassword(b, STRONG_PASSWORD, 'Changed-On-Phone-55');
    const report = await sync(b, remote);
    expect(report.conflicts.some((c) => c.kind === 'header')).toBe(true);
    expect(b.header.secretKey?.id).toBe(a.header.secretKey?.id); // the Secret Key header won despite being older
    await sync(a, remote);
    expect(a.header.secretKey).toBeTruthy();
    const file = parseSyncFile(remote.files.values().next().value!.content);
    expect(file.header.secretKey?.id).toBe(a.header.secretKey?.id);
  });
});
