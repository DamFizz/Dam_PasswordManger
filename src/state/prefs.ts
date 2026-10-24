/**
 * Device preferences. These are NOT sensitive (appearance, timers) and are kept in
 * localStorage so the lock screen can be themed and localised before unlocking.
 * No vault data, statistics or account names are ever stored here.
 */
export type Accent = 'teal' | 'violet' | 'blue' | 'emerald' | 'rose' | 'amber';
export type Lang = 'en' | 'ms';

export interface Prefs {
  theme: 'dark' | 'light' | 'system';
  accent: Accent;
  lang: Lang;
  motion: 'system' | 'reduced' | 'full';
  density: 'comfortable' | 'compact';
  /** minutes of inactivity before locking; 0 = never */
  autoLockMinutes: number;
  /** seconds in background before locking; 0 = immediately, -1 = never */
  lockOnHiddenSeconds: number;
  /** seconds before a revealed secret is hidden again; 0 = keep until hidden manually */
  revealSeconds: number;
  /** seconds before the clipboard is cleared; 0 = never */
  clipboardClearSeconds: number;
  /** clear clipboard even when its contents cannot be verified */
  clipboardForceClear: boolean;
  sidebarCollapsed: boolean;
  viewMode: 'list' | 'grid';
  sortBy: 'title' | 'updated' | 'created' | 'used';
  autoSync: boolean;
  tourDone: boolean;
  backupReminderDays: number;
}

export const DEFAULT_PREFS: Prefs = {
  theme: 'dark',
  accent: 'teal',
  lang: typeof navigator !== 'undefined' && navigator.language?.toLowerCase().startsWith('ms') ? 'ms' : 'en',
  motion: 'system',
  density: 'comfortable',
  autoLockMinutes: 10,
  lockOnHiddenSeconds: 60,
  revealSeconds: 20,
  clipboardClearSeconds: 30,
  clipboardForceClear: false,
  sidebarCollapsed: false,
  viewMode: 'list',
  sortBy: 'title',
  autoSync: true,
  tourDone: false,
  backupReminderDays: 30,
};

const KEY = 'myvault.prefs';

export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    /* storage unavailable or corrupted: fall back to defaults */
  }
  return { ...DEFAULT_PREFS };
}

export function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function applyPrefsToDocument(p: Prefs): void {
  const root = document.documentElement;
  const dark = p.theme === 'system' ? window.matchMedia('(prefers-color-scheme: dark)').matches : p.theme === 'dark';
  root.dataset.theme = dark ? 'dark' : 'light';
  root.dataset.accent = p.accent;
  root.dataset.density = p.density;
  const reduce = p.motion === 'system' ? window.matchMedia('(prefers-reduced-motion: reduce)').matches : p.motion === 'reduced';
  root.dataset.motion = reduce ? 'reduced' : 'full';
  root.lang = p.lang;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0b0d12' : '#f5f6f8');
}
