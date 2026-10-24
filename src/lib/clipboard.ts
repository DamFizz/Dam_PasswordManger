/**
 * Clipboard helpers with best-effort automatic clearing.
 *
 * Browsers do not offer a guaranteed way to erase clipboard contents or to mark them as
 * sensitive. MyVault therefore:
 *  - schedules a clear after the configured delay,
 *  - before clearing, tries to read the clipboard and only clears it if it still contains
 *    what MyVault copied (so something the user copied later is not destroyed),
 *  - if reading is not permitted (Firefox, Safari, or permission denied) it does NOT clear,
 *    unless the user enabled "clear even when it cannot be verified".
 * Clipboard history features of the OS (e.g. Windows Win+V, keyboard apps on phones) may keep
 * their own copies; MyVault cannot remove those.
 */

let pending: { timer: number; value: string } | null = null;

export type ClearOutcome = 'cleared' | 'changed' | 'unverifiable' | 'failed';

export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  // Legacy fallback (very old browsers / insecure contexts)
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    if (!document.execCommand('copy')) throw new Error('Copy failed');
  } finally {
    ta.value = '';
    ta.remove();
  }
}

async function tryClear(value: string, force: boolean): Promise<ClearOutcome> {
  try {
    const current = await navigator.clipboard.readText();
    if (current !== value) return 'changed';
    await navigator.clipboard.writeText('');
    return 'cleared';
  } catch {
    if (!force) return 'unverifiable';
    try {
      await navigator.clipboard.writeText('');
      return 'cleared';
    } catch {
      return 'failed';
    }
  }
}

export function cancelScheduledClear(): void {
  if (pending) window.clearTimeout(pending.timer);
  pending = null;
}

/**
 * Copy a secret and schedule clearing. `clearAfterSeconds` 0 disables clearing.
 * `onClear` reports what happened so the UI can inform the user honestly.
 */
export async function copySecret(
  text: string,
  opts: { clearAfterSeconds: number; forceClear: boolean; onClear?: (o: ClearOutcome) => void },
): Promise<void> {
  await copyText(text);
  cancelScheduledClear();
  if (opts.clearAfterSeconds > 0) {
    const timer = window.setTimeout(async () => {
      const value = pending?.value ?? '';
      pending = null;
      const outcome = await tryClear(value, opts.forceClear);
      opts.onClear?.(outcome);
    }, opts.clearAfterSeconds * 1000);
    pending = { timer, value: text };
  }
}

/** Called when the vault locks: try to clear a pending secret immediately. */
export async function clearPendingNow(forceClear: boolean): Promise<void> {
  if (!pending) return;
  const { value, timer } = pending;
  window.clearTimeout(timer);
  pending = null;
  await tryClear(value, forceClear);
}
