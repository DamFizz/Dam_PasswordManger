import { expect, test, type Page } from '@playwright/test';

// Test-only credentials for a throwaway vault created inside the test browser profile.
const MASTER = 'E2e-Test-Vault-Passphrase-77';

async function createVault(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /create a new vault/i }).click();
  await page.getByRole('button', { name: /continue/i }).click();
  await page.getByLabel('Master password', { exact: true }).fill(MASTER);
  await page.getByLabel('Confirm password', { exact: true }).fill(MASTER);
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: /create vault/i }).click();
  await page.getByRole('button', { name: /skip for now/i }).click({ timeout: 30_000 });
  await page.getByRole('button', { name: /skip for now/i }).click();
  await page.getByRole('button', { name: /maybe later/i }).click();
  await page.getByRole('button', { name: /open my vault/i }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible();
}

async function unlock(page: Page) {
  await page.getByLabel('Master password', { exact: true }).fill(MASTER);
  await page.getByRole('button', { name: /^unlock$/i }).click();
  await expect(page.getByRole('heading', { name: 'Overview' })).toBeVisible({ timeout: 30_000 });
}

test('create, add, lock, reload, unlock, work offline — with no CSP violations', async ({ page, context }) => {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));

  await createVault(page);

  await page.getByRole('button', { name: /add an account/i }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Steam');
  await dialog.getByLabel('Username', { exact: true }).fill('gamer42');
  await dialog.getByLabel('Password', { exact: true }).fill('Steam-Pass-Very-Secret-1');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page.getByRole('heading', { name: 'Steam', level: 2 })).toBeVisible();
  await expect(page.getByText('Steam-Pass-Very-Secret-1')).toHaveCount(0);
  await page.getByRole('button', { name: 'Show Password' }).click();
  await expect(page.getByText('Steam-Pass-Very-Secret-1')).toBeVisible();

  // Nothing readable is persisted
  const stored = await page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const req = indexedDB.open('myvault');
        req.onsuccess = () => {
          const tx = req.result.transaction(['records', 'meta', 'local']);
          const out: unknown[] = [];
          let n = 0;
          for (const s of ['records', 'meta', 'local']) {
            const r = tx.objectStore(s).getAll();
            r.onsuccess = () => {
              out.push(r.result);
              if (++n === 3) resolve(JSON.stringify(out) + JSON.stringify(localStorage));
            };
          }
        };
      }),
  );
  expect(stored).not.toContain('Steam');
  expect(stored).not.toContain('gamer42');
  expect(stored).not.toContain('Steam-Pass-Very-Secret-1');

  // Reload while unlocked → the vault is locked (keys only live in memory)
  await page.reload();
  await expect(page.getByRole('heading', { name: /myvault is locked/i })).toBeVisible();
  await expect(page.getByText('Steam')).toHaveCount(0);
  await unlock(page);

  // Offline: the service worker serves the app shell and the local vault still opens
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null || true);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: /myvault is locked/i })).toBeVisible();
  await unlock(page);
  await page.getByRole('button', { name: 'Vault', exact: true }).or(page.getByRole('button', { name: /^All items/ })).first().click();
  await expect(page.getByText('gamer42').first()).toBeVisible();
  await context.setOffline(false);

  // No horizontal overflow
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);

  expect(errors.filter((e) => /Content Security Policy|Refused to/i.test(e))).toEqual([]);
  expect(errors.filter((e) => !/Failed to load resource/i.test(e))).toEqual([]);
});
