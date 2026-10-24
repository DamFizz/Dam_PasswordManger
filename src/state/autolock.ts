/**
 * Automatic locking:
 *  - after N minutes without user interaction,
 *  - when the app is backgrounded/hidden (immediately or after a delay),
 *  - in every tab at once (BroadcastChannel), when any tab locks.
 * While hidden, the UI is blurred so OS app-switcher snapshots are less revealing
 * (best effort — platforms may capture the snapshot before the page can react).
 */
import type { Prefs } from './prefs';

const LOCK_CHANNEL = 'myvault-lock';

export function broadcastLock(): void {
  try {
    const ch = new BroadcastChannel(LOCK_CHANNEL);
    ch.postMessage({ type: 'lock' });
    ch.close();
  } catch {
    /* unsupported */
  }
}

export function startAutoLock(getPrefs: () => Prefs, lock: (reason: 'idle' | 'hidden' | 'other-tab') => void): () => void {
  let lastActivity = Date.now();
  let hiddenAt: number | null = null;
  let hiddenTimer: number | undefined;

  const activity = () => {
    lastActivity = Date.now();
  };
  const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'] as const;
  for (const e of events) window.addEventListener(e, activity, { passive: true, capture: true });

  const interval = window.setInterval(() => {
    const mins = getPrefs().autoLockMinutes;
    if (mins > 0 && Date.now() - lastActivity > mins * 60_000) lock('idle');
  }, 10_000);

  const onVisibility = () => {
    const root = document.documentElement;
    const secs = getPrefs().lockOnHiddenSeconds;
    if (document.visibilityState === 'hidden') {
      root.dataset.privacy = 'on';
      hiddenAt = Date.now();
      if (secs === 0) lock('hidden');
      else if (secs > 0) hiddenTimer = window.setTimeout(() => lock('hidden'), secs * 1000);
    } else {
      root.dataset.privacy = 'off';
      window.clearTimeout(hiddenTimer);
      // Timers may be suspended in the background on mobile: re-check elapsed time.
      if (hiddenAt !== null && secs >= 0 && Date.now() - hiddenAt >= secs * 1000) lock('hidden');
      hiddenAt = null;
      const mins = getPrefs().autoLockMinutes;
      if (mins > 0 && Date.now() - lastActivity > mins * 60_000) lock('idle');
    }
  };
  document.addEventListener('visibilitychange', onVisibility);

  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(LOCK_CHANNEL);
    channel.onmessage = (ev) => {
      if ((ev.data as { type?: string })?.type === 'lock') lock('other-tab');
    };
  } catch {
    /* unsupported */
  }

  return () => {
    for (const e of events) window.removeEventListener(e, activity, { capture: true });
    window.clearInterval(interval);
    window.clearTimeout(hiddenTimer);
    document.removeEventListener('visibilitychange', onVisibility);
    document.documentElement.dataset.privacy = 'off';
    channel?.close();
  };
}
