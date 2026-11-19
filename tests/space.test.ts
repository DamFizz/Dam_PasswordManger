import { describe, expect, it } from 'vitest';
import { createVault, unlockWithPassword } from '../src/vault/access';
import { createBackup, openBackup, restoreMerge } from '../src/vault/backup';
import { SyncEngine } from '../src/sync/engine';
import { downloadVaultToDevice } from '../src/sync/bootstrap';
import type { VaultSession } from '../src/vault/session';
import {
  assetIntact,
  bankBadge,
  base64ToBytesStd,
  groupedNumber,
  makeAsset,
  maskedNumber,
  newSpaceEntry,
  normalizeAccountNumber,
  searchSpace,
  shareText,
  sortPeople,
  spaceDisplayName,
} from '../src/lib/space';
import { MemoryRemote } from './memory-remote';
import { freshRepo, STRONG_PASSWORD } from './helpers';

const labels = { bank: 'Bank', holder: 'Account holder', number: 'Account number' };

function account(over: Partial<ReturnType<typeof newSpaceEntry>> = {}) {
  return { ...newSpaceEntry('bank', 'me', 1000), bankId: 'maybank', bankName: 'Maybank', holder: 'Ahmad Test', accountNumber: '000123456789', title: 'Personal', ...over };
}

describe('My Space helpers (same rules as Android)', () => {
  it('keeps leading zeros and the exact digits', () => {
    expect(normalizeAccountNumber(' 0001-2345 6789 ')).toBe('000123456789');
    expect(maskedNumber('000123456789')).toBe('•••• 6789');
    expect(maskedNumber('123')).toBe('123');
    expect(groupedNumber('000123456789')).toBe('0001 2345 6789');
  });

  it('share text has only what was chosen and never the notes', () => {
    const e = account({ notes: 'secret note', duitNowId: '0123456789' });
    expect(shareText(e, { includeBank: true, includeHolder: true }, labels)).toBe('Bank: Maybank\nAccount holder: Ahmad Test\nAccount number: 000123456789');
    expect(shareText(e, { includeBank: false, includeHolder: false }, labels)).toBe('Account number: 000123456789');
  });

  it('searches names and account digits', () => {
    const a = account();
    const b = account({ id: 'b', title: 'Rent', holder: 'Ali', accountNumber: '9988776655', bankName: 'CIMB Bank', bankId: 'cimb' });
    expect(searchSpace([a, b], '6789').map((e) => e.id)).toEqual([a.id]);
    expect(searchSpace([a, b], 'ali').map((e) => e.id)).toEqual(['b']);
    expect(searchSpace([a, b], '9988-77')).toHaveLength(1);
  });

  it('names and badges', () => {
    expect(bankBadge(account())).toBe('MBB');
    expect(bankBadge(account({ bankId: 'custom', bankName: 'Koperasi Hebat Sdn' }))).toBe('KHS');
    const other = account({ owner: 'other', title: '', holder: 'Siti Aminah' });
    expect(spaceDisplayName(other)).toBe('Siti Aminah');
    expect(sortPeople([account({ id: 'z', title: 'Zul' }), account({ id: 'a', title: 'Abu' })]).map((e) => e.id)).toEqual(['a', 'z']);
  });
});

describe('My Space storage', () => {
  it('stores entries and QR images encrypted, and cleans up replaced or deleted images', async () => {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    const e = account();
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]);
    const a1 = await makeAsset(e.id, 'image/png', 10, 10, png);
    await s.saveSpaceEntry({ ...e, qrAssetId: a1.id }, a1);
    expect(s.spaceEntry(e.id)?.accountNumber).toBe('000123456789');
    expect(await assetIntact(s.asset(a1.id)!)).toBe(true);
    expect(Array.from(base64ToBytesStd(s.asset(a1.id)!.data))).toEqual(Array.from(png));
    // nothing readable at rest
    const raw = JSON.stringify(await repo.allRecords());
    expect(raw).not.toContain('000123456789');
    expect(raw).not.toContain('Maybank');

    // replace the QR: the old image becomes a tombstone in the same write
    const a2 = await makeAsset(e.id, 'image/png', 10, 10, new Uint8Array([9, 9, 9]));
    await s.saveSpaceEntry({ ...s.spaceEntry(e.id)!, qrAssetId: a2.id }, a2, a1.id);
    expect(s.asset(a1.id)).toBeUndefined();
    expect(s.asset(a2.id)).toBeDefined();

    // lock and unlock: still there
    s.lock();
    const step = await unlockWithPassword(repo, STRONG_PASSWORD);
    if (step.type !== 'unlocked') throw new Error('expected unlock');
    const s2 = step.session;
    expect(s2.spaceEntries()).toHaveLength(1);

    await s2.deleteSpaceEntry(e.id);
    expect(s2.spaceEntries()).toHaveLength(0);
    expect(s2.asset(a2.id)).toBeUndefined();
  });

  it('syncs entries and images, and keeps a conflict copy on concurrent edits', async () => {
    const remote = new MemoryRemote();
    const a = await createVault(freshRepo(), STRONG_PASSWORD);
    await new SyncEngine(a, remote).sync();
    const repoB = freshRepo();
    await downloadVaultToDevice(repoB, remote);
    const step = await unlockWithPassword(repoB, STRONG_PASSWORD);
    if (step.type !== 'unlocked') throw new Error('expected unlock');
    const b = step.session;
    const sync = (s: VaultSession) => new SyncEngine(s, remote).sync();

    const e = account();
    const img = await makeAsset(e.id, 'image/png', 1, 1, new Uint8Array([1, 2, 3]));
    await a.saveSpaceEntry({ ...e, qrAssetId: img.id }, img);
    await sync(a);
    await sync(b);
    expect(b.spaceEntry(e.id)?.holder).toBe('Ahmad Test');
    expect(b.asset(img.id)?.data).toBe(img.data);

    await a.saveSpaceEntry({ ...a.spaceEntry(e.id)!, holder: 'From PC' });
    await new Promise((r) => setTimeout(r, 5));
    await b.saveSpaceEntry({ ...b.spaceEntry(e.id)!, holder: 'From phone' });
    await sync(a);
    const report = await sync(b);
    expect(report.conflicts).toHaveLength(1);
    expect(report.conflicts[0]!.kind).toBe('space');
    await sync(a);
    for (const s of [a, b]) {
      expect(s.spaceEntries().map((x) => x.holder).sort()).toEqual(['From PC', 'From phone']);
      expect(s.spaceEntry(e.id)?.holder).toBe('From phone');
    }
  });

  it('backups include My Space and merge without overwriting', async () => {
    const s = await createVault(freshRepo(), STRONG_PASSWORD);
    const e = account();
    const img = await makeAsset(e.id, 'image/png', 1, 1, new Uint8Array([7, 7]));
    await s.saveSpaceEntry({ ...e, qrAssetId: img.id }, img);
    const text = await createBackup(s, 'Backup-Pass-123', '1.0.0');
    await s.saveSpaceEntry({ ...s.spaceEntry(e.id)!, holder: 'Changed' });
    const other = account({ id: 'gone-later', title: 'Second' });
    const opened = await openBackup(text, 'Backup-Pass-123');
    await s.deleteSpaceEntry(e.id);
    await s.saveSpaceEntry(other);
    const res = await restoreMerge(s, opened, STRONG_PASSWORD);
    expect(res.added).toBe(1);
    const restored = s.spaceEntry(e.id)!;
    expect(restored.holder).toBe('Ahmad Test');
    expect(s.asset(restored.qrAssetId)).toBeDefined();
    // merging again: identical, skipped
    const again = await restoreMerge(s, opened, STRONG_PASSWORD);
    expect(again.skipped).toBeGreaterThanOrEqual(1);
    expect(s.spaceEntries()).toHaveLength(2);
  });
});
