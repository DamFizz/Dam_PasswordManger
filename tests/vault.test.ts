import { describe, expect, it } from 'vitest';
import {
  changeMasterPassword,
  createRecoveryKey,
  createVault,
  disableTotp,
  enableTotp,
  InvalidCodeError,
  unlockWithPassword,
  unlockWithRecoveryKey,
  verifySecondFactor,
  WrongPasswordError,
  type UnlockStep,
} from '../src/vault/access';
import { ThrottledError, getThrottleState } from '../src/vault/throttle';
import { emptyItem, type VaultItem } from '../src/vault/types';
import { generateTotpSecret, totp } from '../src/lib/totp';
import { randomId } from '../src/lib/encoding';
import type { VaultSession } from '../src/vault/session';
import { freshRepo, STRONG_PASSWORD } from './helpers';

function login(title: string, password: string): VaultItem {
  return { ...emptyItem('login', randomId(), Date.now()), title, username: 'me', email: 'me@example.com', password, url: 'https://example.com' };
}

async function unlocked(step: UnlockStep): Promise<VaultSession> {
  if (step.type !== 'unlocked') throw new Error(`expected unlocked, got ${step.type}`);
  return step.session;
}

describe('vault creation and unlock', () => {
  it('creates a vault, persists encrypted data and unlocks after "reload"', async () => {
    const repo = freshRepo();
    const session = await createVault(repo, STRONG_PASSWORD);
    await session.saveItem(login('Instagram', 'insta-SECRET-pw'));
    session.lock();
    expect(session.isLocked).toBe(true);
    expect(session.items()).toHaveLength(0);

    // Nothing sensitive is stored in plaintext in IndexedDB
    const raw = JSON.stringify({ header: await repo.getHeader(), records: await repo.allRecords() });
    expect(raw).not.toContain('insta-SECRET-pw');
    expect(raw).not.toContain('Instagram');
    expect(raw).not.toContain('me@example.com');

    const again = await unlocked(await unlockWithPassword(repo, STRONG_PASSWORD));
    const items = again.items();
    expect(items).toHaveLength(1);
    expect(items[0].password).toBe('insta-SECRET-pw');
    // starter categories exist
    expect(again.collections().filter((c) => c.kind === 'category').length).toBeGreaterThan(0);
  });

  it('rejects an incorrect master password', async () => {
    const repo = freshRepo();
    (await createVault(repo, STRONG_PASSWORD)).lock();
    await expect(unlockWithPassword(repo, 'wrong password!!')).rejects.toBeInstanceOf(WrongPasswordError);
  });

  it('throttles after repeated failures and resets after success', async () => {
    const repo = freshRepo();
    (await createVault(repo, STRONG_PASSWORD)).lock();
    for (let i = 0; i < 5; i++) await expect(unlockWithPassword(repo, `bad-${i}`)).rejects.toBeInstanceOf(WrongPasswordError);
    await expect(unlockWithPassword(repo, STRONG_PASSWORD)).rejects.toBeInstanceOf(ThrottledError);
    // simulate the lockout window passing
    await repo.setLocal('throttle', { failures: 5, lockedUntil: Date.now() - 1 });
    await unlocked(await unlockWithPassword(repo, STRONG_PASSWORD));
    expect((await getThrottleState(repo)).failures).toBe(0);
  });

  it('refuses to create a second vault on the same device', async () => {
    const repo = freshRepo();
    await createVault(repo, STRONG_PASSWORD);
    await expect(createVault(repo, STRONG_PASSWORD)).rejects.toThrow();
  });

  it('detects tampered records and keeps the rest readable', async () => {
    const repo = freshRepo();
    const session = await createVault(repo, STRONG_PASSWORD);
    const a = login('A', 'pw-a');
    const b = login('B', 'pw-b');
    await session.saveItems([a, b]);
    session.lock();
    const rec = (await repo.getRecord(a.id))!;
    await repo.putRecords([{ ...rec, rev: rec.rev + 1 }]); // rev is bound via AAD
    const again = await unlocked(await unlockWithPassword(repo, STRONG_PASSWORD));
    expect(again.corruptedIds).toContain(a.id);
    expect(again.getItem(b.id)?.password).toBe('pw-b');
  });
});

describe('item management', () => {
  it('creates, edits, trashes, restores and permanently deletes items', async () => {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    const item = login('Steam', 'steam-pw');
    await s.saveItem(item);
    await s.saveItem({ ...s.getItem(item.id)!, username: 'gamer' });
    expect(s.getItem(item.id)?.username).toBe('gamer');
    await s.saveItem({ ...s.getItem(item.id)!, trashedAt: Date.now() });
    expect(s.getItem(item.id)?.trashedAt).toBeTruthy();
    await s.saveItem({ ...s.getItem(item.id)!, trashedAt: null });
    expect(s.getItem(item.id)?.trashedAt).toBeNull();
    await s.purgeItems([item.id]);
    expect(s.getItem(item.id)).toBeUndefined();
    // tombstone remains so the deletion can sync
    expect((await repo.getRecord(item.id))?.rev).toBe(5);
  });

  it('deleting a category keeps its items (moved or uncategorized)', async () => {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    const [gaming, social] = s.collections().filter((c) => c.kind === 'category');
    const a = { ...login('Riot', 'x'), categoryId: gaming.id };
    const b = { ...login('Roblox', 'y'), categoryId: gaming.id };
    await s.saveItems([a, b]);
    await s.deleteCollection(gaming.id, social.id);
    expect(s.collections().some((c) => c.id === gaming.id)).toBe(false);
    expect(s.getItem(a.id)?.categoryId).toBe(social.id);
    await s.deleteCollection(social.id, null);
    expect(s.getItem(b.id)?.categoryId).toBeNull();
    expect(s.items()).toHaveLength(2);
  });

  it('re-parents child sections when a parent section is deleted', async () => {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    const now = Date.now();
    const parent = { id: randomId(), kind: 'section' as const, name: 'Gaming', icon: 'folder', color: '#888', parentId: null, pinned: false, order: 0, createdAt: now, updatedAt: now };
    const child = { ...parent, id: randomId(), name: 'Steam accounts', parentId: parent.id };
    await s.saveCollections([parent, child]);
    await s.deleteCollection(parent.id, null);
    expect(s.collections().find((c) => c.id === child.id)?.parentId).toBeNull();
  });

  it('stores device-only activity encrypted', async () => {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    const item = login('Bank', 'pw');
    await s.saveItem(item);
    await s.markUsed(item.id);
    expect((await s.getDeviceSecrets()).usage[item.id]).toBeGreaterThan(0);
    const raw = JSON.stringify(await repo.getLocal(`secrets:${s.vaultId}`));
    expect(raw).not.toContain(item.id);
  });
});

describe('Google Authenticator (TOTP) second factor', () => {
  async function vaultWithTotp() {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    const secret = generateTotpSecret();
    // Enrollment verifies a code from a *previous* step so that the unlock test can use the current one.
    const codes = await enableTotp(s, secret, await totp(secret, Date.now() - 30_000));
    s.lock();
    return { repo, secret, codes };
  }

  it('enrollment rejects a wrong code', async () => {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    await expect(enableTotp(s, generateTotpSecret(), '000000')).rejects.toBeInstanceOf(InvalidCodeError);
    expect(s.security.totp).toBeNull();
  });

  it('is mandatory once enabled: password alone does not unlock', async () => {
    const { repo, secret, codes } = await vaultWithTotp();
    expect(codes).toHaveLength(10);
    const step = await unlockWithPassword(repo, STRONG_PASSWORD);
    expect(step.type).toBe('second-factor');
    if (step.type !== 'second-factor') return;
    await expect(step.challenge.verifyTotp('123456')).rejects.toBeInstanceOf(InvalidCodeError);
    const session = await step.challenge.verifyTotp(await totp(secret));
    expect(session.isLocked).toBe(false);
  });

  it('rejects an expired code and a replayed code', async () => {
    const { repo, secret } = await vaultWithTotp();
    let step = await unlockWithPassword(repo, STRONG_PASSWORD);
    if (step.type !== 'second-factor') throw new Error();
    await expect(step.challenge.verifyTotp(await totp(secret, Date.now() - 5 * 60_000))).rejects.toBeInstanceOf(InvalidCodeError);
    const code = await totp(secret);
    (await step.challenge.verifyTotp(code)).lock();
    step = await unlockWithPassword(repo, STRONG_PASSWORD);
    if (step.type !== 'second-factor') throw new Error();
    await expect(step.challenge.verifyTotp(code)).rejects.toBeInstanceOf(InvalidCodeError);
  });

  it('accepts each recovery code exactly once', async () => {
    const { repo, codes } = await vaultWithTotp();
    let step = await unlockWithPassword(repo, STRONG_PASSWORD);
    if (step.type !== 'second-factor') throw new Error();
    expect(step.challenge.recoveryCodesLeft).toBe(10);
    await expect(step.challenge.useRecoveryCode('AAAAA-BBBBB')).rejects.toBeInstanceOf(InvalidCodeError);
    const s = await step.challenge.useRecoveryCode(codes[0].toLowerCase());
    expect(s.security.recoveryCodeHashes).toHaveLength(9);
    s.lock();
    step = await unlockWithPassword(repo, STRONG_PASSWORD);
    if (step.type !== 'second-factor') throw new Error();
    await expect(step.challenge.useRecoveryCode(codes[0])).rejects.toBeInstanceOf(InvalidCodeError);
  });

  it('a cancelled challenge cannot be completed', async () => {
    const { repo, secret } = await vaultWithTotp();
    const step = await unlockWithPassword(repo, STRONG_PASSWORD);
    if (step.type !== 'second-factor') throw new Error();
    step.challenge.cancel();
    await expect(step.challenge.verifyTotp(await totp(secret))).rejects.toBeInstanceOf(InvalidCodeError);
  });

  it('can be disabled after verification', async () => {
    const { repo, secret } = await vaultWithTotp();
    const step = await unlockWithPassword(repo, STRONG_PASSWORD);
    if (step.type !== 'second-factor') throw new Error();
    const s = await step.challenge.verifyTotp(await totp(secret));
    await expect(verifySecondFactor(s, '000000')).rejects.toBeInstanceOf(InvalidCodeError);
    await disableTotp(s);
    s.lock();
    expect((await unlockWithPassword(repo, STRONG_PASSWORD)).type).toBe('unlocked');
  });

  it('cannot be bypassed by editing the stored header', async () => {
    const { repo } = await vaultWithTotp();
    const header = (await repo.getHeader())!;
    // An attacker swapping in a fake "security" blob just breaks authentication.
    await repo.putHeader({ ...header, security: { iv: header.security.iv, ct: header.passwordWrap.ct } });
    await expect(unlockWithPassword(repo, STRONG_PASSWORD)).rejects.toThrow();
  });
});

describe('master password change and recovery key', () => {
  it('changes the master password without re-encrypting items', async () => {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    await s.saveItem(login('Mail', 'mail-pw'));
    await expect(changeMasterPassword(s, 'not the password', 'New-Master-Pass-99')).rejects.toBeInstanceOf(WrongPasswordError);
    await changeMasterPassword(s, STRONG_PASSWORD, 'New-Master-Pass-99');
    s.lock();
    await expect(unlockWithPassword(repo, STRONG_PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    const again = await unlocked(await unlockWithPassword(repo, 'New-Master-Pass-99'));
    expect(again.items()[0].password).toBe('mail-pw');
  });

  it('recovery key resets a forgotten master password', async () => {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    await s.saveItem(login('Mail', 'mail-pw'));
    const key = await createRecoveryKey(s, STRONG_PASSWORD);
    expect(key.replace(/-/g, '')).toHaveLength(32);
    s.lock();
    await expect(unlockWithRecoveryKey(repo, 'AAAA-'.repeat(8), 'Another-Pass-123')).rejects.toBeInstanceOf(InvalidCodeError);
    const step = await unlockWithRecoveryKey(repo, key.toLowerCase(), 'Another-Pass-123');
    (await unlocked(step)).lock();
    await expect(unlockWithPassword(repo, STRONG_PASSWORD)).rejects.toBeInstanceOf(WrongPasswordError);
    const again = await unlocked(await unlockWithPassword(repo, 'Another-Pass-123'));
    expect(again.items()[0].password).toBe('mail-pw');
  });

  it('recovery key still requires the Authenticator when it is mandatory', async () => {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    const key = await createRecoveryKey(s, STRONG_PASSWORD);
    const secret = generateTotpSecret();
    await enableTotp(s, secret, await totp(secret, Date.now() - 30_000));
    s.lock();
    const step = await unlockWithRecoveryKey(repo, key, 'Another-Pass-123');
    expect(step.type).toBe('second-factor');
    if (step.type !== 'second-factor') return;
    (await step.challenge.verifyTotp(await totp(secret))).lock();
    const next = await unlockWithPassword(repo, 'Another-Pass-123');
    expect(next.type).toBe('second-factor');
  });
});
