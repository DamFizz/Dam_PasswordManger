import { describe, expect, it } from 'vitest';
import { createVault, unlockWithPassword } from '../src/vault/access';
import { BackupPasswordError, CorruptBackupError, createBackup, inspectBackup, openBackup, restoreMerge, restoreReplace } from '../src/vault/backup';
import { emptyItem, type VaultItem } from '../src/vault/types';
import { randomId } from '../src/lib/encoding';
import { csvToItems, detectCsv, parseCsv } from '../src/lib/csv';
import { analyzeVault } from '../src/lib/security-analysis';
import { pwnedCount, sha1Hex } from '../src/lib/hibp';
import { freshRepo, STRONG_PASSWORD } from './helpers';

function login(title: string, password = 'pw'): VaultItem {
  return { ...emptyItem('login', randomId(), Date.now()), title, password };
}

describe('encrypted backup & restore', () => {
  it('exports an encrypted file and restores it (replace)', async () => {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    await s.saveItem(login('GitHub', 'gh-SECRET'));
    const text = await createBackup(s, 'Backup-Pass-123', '1.0.0');
    expect(text).not.toContain('gh-SECRET');
    expect(text).not.toContain('GitHub');
    const meta = inspectBackup(text);
    expect(meta.format).toBe('myvault-backup');
    expect(meta.version).toBe(1);
    expect(meta.createdAt).toBeGreaterThan(0);

    // restore onto a brand-new device
    const repo2 = freshRepo();
    const opened = await openBackup(text, 'Backup-Pass-123');
    await restoreReplace(repo2, opened);
    const step = await unlockWithPassword(repo2, STRONG_PASSWORD);
    if (step.type !== 'unlocked') throw new Error();
    expect(step.session.items()[0].password).toBe('gh-SECRET');
  });

  it('takes a safety snapshot before replacing an existing vault', async () => {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    const text = await createBackup(s, 'Backup-Pass-123', '1.0.0');
    await restoreReplace(repo, await openBackup(text, 'Backup-Pass-123'));
    const snaps = await repo.listSnapshots();
    expect(snaps).toHaveLength(1);
    expect(snaps[0].reason).toBe('before-restore');
  });

  it('rejects the wrong backup password', async () => {
    const s = await createVault(freshRepo(), STRONG_PASSWORD);
    const text = await createBackup(s, 'Backup-Pass-123', '1.0.0');
    await expect(openBackup(text, 'wrong')).rejects.toBeInstanceOf(BackupPasswordError);
  });

  it('detects corrupted and tampered backups', async () => {
    const s = await createVault(freshRepo(), STRONG_PASSWORD);
    const text = await createBackup(s, 'Backup-Pass-123', '1.0.0');
    await expect(openBackup(text.slice(0, text.length / 2), 'Backup-Pass-123')).rejects.toBeInstanceOf(CorruptBackupError);
    await expect(openBackup('{"format":"something-else"}', 'x')).rejects.toBeInstanceOf(CorruptBackupError);
    const data = JSON.parse(text);
    data.createdAt += 1; // bound via AAD
    await expect(openBackup(JSON.stringify(data), 'Backup-Pass-123')).rejects.toBeInstanceOf(BackupPasswordError);
    const data2 = JSON.parse(text);
    data2.version = 99;
    expect(() => inspectBackup(JSON.stringify(data2))).toThrow(CorruptBackupError);
  });

  it('merges a backup without overwriting existing data', async () => {
    const repo = freshRepo();
    const s = await createVault(repo, STRONG_PASSWORD);
    const kept = login('Kept', 'old');
    await s.saveItem(kept);
    const text = await createBackup(s, 'Backup-Pass-123', '1.0.0');
    await s.saveItem({ ...s.getItem(kept.id)!, password: 'new' });
    await s.saveItem(login('Added later'));
    const res = await restoreMerge(s, await openBackup(text, 'Backup-Pass-123'), STRONG_PASSWORD);
    expect(res.copies).toBe(1);
    expect(s.getItem(kept.id)?.password).toBe('new');
    expect(s.items().some((i) => i.title === 'Kept (restored copy)' && i.password === 'old')).toBe(true);
    expect(s.items()).toHaveLength(3);
  });

  it('merges items from a different vault', async () => {
    const other = await createVault(freshRepo(), 'Other-Vault-Pass-1');
    await other.saveItem(login('From other vault', 'zzz'));
    const text = await createBackup(other, 'Backup-Pass-123', '1.0.0');
    const s = await createVault(freshRepo(), STRONG_PASSWORD);
    const res = await restoreMerge(s, await openBackup(text, 'Backup-Pass-123'), 'Other-Vault-Pass-1');
    expect(res.added).toBe(1);
    expect(s.items()[0].password).toBe('zzz');
    // duplicate category names are mapped, not duplicated
    expect(res.collectionsAdded).toBe(0);
  });
});

describe('CSV import', () => {
  it('parses quoted fields with commas, quotes and newlines', () => {
    expect(parseCsv('a,b\n"x, y","he said ""hi""\nline2"\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'he said "hi"\nline2'],
    ]);
  });

  it('maps Bitwarden exports', () => {
    const csv =
      'folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n' +
      'Gaming,1,login,Steam,,,0,https://store.steampowered.com,gamer,steam-pw,JBSWY3DPEHPK3PXP\n' +
      ',,note,My note,secret text,,0,,,,\n';
    const preview = detectCsv(csv);
    expect(preview.detectedFormat).toBe('Bitwarden');
    const { items, folders } = csvToItems(preview, () => 'sec1');
    expect(folders).toEqual(['Gaming']);
    expect(items[0]).toMatchObject({ title: 'Steam', username: 'gamer', password: 'steam-pw', favorite: true, sectionId: 'sec1', type: 'login' });
    expect(items[0].customFields[0].hidden).toBe(true);
    expect(items[1]).toMatchObject({ type: 'note', notes: 'secret text' });
  });

  it('maps Chrome exports and derives titles', () => {
    const preview = detectCsv('name,url,username,password,note\n,https://www.instagram.com/,me,ig-pw,\n');
    expect(preview.detectedFormat).toBe('Chrome / Edge');
    expect(csvToItems(preview, () => null).items[0].title).toBe('instagram.com');
  });

  it('rejects files without password columns', () => {
    expect(() => detectCsv('a,b\n1,2\n')).toThrow();
  });
});

describe('security analysis', () => {
  it('finds weak, reused, duplicate, old and incomplete entries', () => {
    const now = Date.now();
    const items: VaultItem[] = [
      { ...login('A', 'password'), url: 'https://a.com', username: 'me' },
      { ...login('B', 'Shared-Strong-Pass-991!'), url: 'https://b.com', username: 'me' },
      { ...login('C', 'Shared-Strong-Pass-991!'), url: 'https://b.com', username: 'me' },
      { ...login('D', 'Unique-Strong-Pass-123!'), passwordChangedAt: now - 400 * 86_400_000, createdAt: now - 400 * 86_400_000 },
    ];
    const r = analyzeVault(items, { oldPasswordDays: 365, now });
    expect(r.weak).toEqual([items[0].id]);
    expect(r.reused).toEqual([[items[1].id, items[2].id]]);
    expect(r.duplicates).toEqual([[items[1].id, items[2].id]]);
    expect(r.old).toEqual([items[3].id]);
    expect(r.missingUrl).toEqual([items[3].id]);
    expect(r.missingLogin).toEqual([items[3].id]);
    expect(r.score).toBeLessThan(100);
  });

  it('ignores trashed and archived items', () => {
    const r = analyzeVault([{ ...login('X', 'password'), trashedAt: Date.now() }], { oldPasswordDays: 365 });
    expect(r.weak).toHaveLength(0);
  });
});

describe('breach check (k-anonymity)', () => {
  it('sends only the 5-character hash prefix and matches locally', async () => {
    const hash = await sha1Hex('password');
    expect(hash).toBe('5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8');
    const urls: string[] = [];
    const fakeFetch = (async (url: string) => {
      urls.push(url);
      return new Response(`0018A45C4D1DEF81644B54AB7F969B88D65:1\r\n1E4C9B93F3F0682250B6CF8331B7EE68FD8:9545824\r\n`);
    }) as unknown as typeof fetch;
    expect(await pwnedCount('password', fakeFetch)).toBe(9545824);
    expect(urls).toEqual(['https://api.pwnedpasswords.com/range/5BAA6']);
  });
});
