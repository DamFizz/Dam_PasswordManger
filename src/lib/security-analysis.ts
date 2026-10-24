/**
 * Local security analysis. Runs in memory on decrypted items; nothing leaves the device.
 * It reports facts derivable from the vault only — it does NOT claim whether an account
 * has been compromised (see the optional, privacy-preserving breach check in hibp.ts).
 */
import { estimateStrength } from './strength';
import type { VaultItem } from '../vault/types';

export interface SecurityIssue {
  itemId: string;
  kind: 'weak' | 'reused' | 'duplicate' | 'old' | 'missingUrl' | 'missingLogin' | 'uncategorized';
}

export interface SecurityReport {
  /** 0–100 */
  score: number;
  total: number;
  withPassword: number;
  weak: string[];
  reused: string[][];
  duplicates: string[][];
  old: string[];
  missingUrl: string[];
  missingLogin: string[];
  uncategorized: string[];
}

export function hostOf(url?: string): string {
  if (!url) return '';
  try {
    return new URL(url.includes('://') ? url : `https://${url}`).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function analyzeVault(items: VaultItem[], opts: { oldPasswordDays: number; now?: number }): SecurityReport {
  const now = opts.now ?? Date.now();
  const active = items.filter((i) => !i.trashedAt && !i.archivedAt);
  const logins = active.filter((i) => i.type === 'login');
  const withPassword = logins.filter((i) => i.password);

  const weak = withPassword.filter((i) => estimateStrength(i.password!).score < 3).map((i) => i.id);

  const byPassword = new Map<string, string[]>();
  for (const i of withPassword) {
    const list = byPassword.get(i.password!) ?? [];
    list.push(i.id);
    byPassword.set(i.password!, list);
  }
  const reused = [...byPassword.values()].filter((g) => g.length > 1);

  const byAccount = new Map<string, string[]>();
  for (const i of logins) {
    const who = (i.username || i.email || '').toLowerCase();
    const host = hostOf(i.url) || i.title.toLowerCase().trim();
    if (!who || !host) continue;
    const key = `${host}|${who}`;
    const list = byAccount.get(key) ?? [];
    list.push(i.id);
    byAccount.set(key, list);
  }
  const duplicates = [...byAccount.values()].filter((g) => g.length > 1);

  const cutoff = now - opts.oldPasswordDays * 86_400_000;
  const old = withPassword.filter((i) => (i.passwordChangedAt ?? i.createdAt) < cutoff).map((i) => i.id);
  const missingUrl = logins.filter((i) => !i.url).map((i) => i.id);
  const missingLogin = logins.filter((i) => !i.username && !i.email).map((i) => i.id);
  const uncategorized = active.filter((i) => !i.categoryId && !i.sectionId).map((i) => i.id);

  const reusedCount = reused.reduce((n, g) => n + g.length, 0);
  let score = 100;
  if (withPassword.length) {
    score -= (weak.length / withPassword.length) * 45;
    score -= (reusedCount / withPassword.length) * 35;
    score -= (old.length / withPassword.length) * 10;
  }
  if (logins.length) score -= (duplicates.reduce((n, g) => n + g.length - 1, 0) / logins.length) * 10;
  score = Math.max(0, Math.round(score));

  return { score, total: active.length, withPassword: withPassword.length, weak, reused, duplicates, old, missingUrl, missingLogin, uncategorized };
}
