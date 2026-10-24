import type { Collection, ItemType, VaultItem } from '../../vault/types';
import type { TKey } from '../../i18n';

/**
 * Only http(s) URLs may be opened. Anything else (javascript:, data:, file:, …) is rejected,
 * which prevents a malicious imported/synced entry from executing code when clicked.
 */
export function safeHttpUrl(raw?: string): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function displayHost(raw?: string): string {
  const u = safeHttpUrl(raw);
  if (!u) return raw ?? '';
  return new URL(u).hostname.replace(/^www\./, '');
}

export function itemSubtitle(item: VaultItem, typeLabel: string): string {
  switch (item.type) {
    case 'login':
      return item.username || item.email || displayHost(item.url) || typeLabel;
    case 'wifi':
      return item.ssid || typeLabel;
    case 'license':
      return item.product || typeLabel;
    case 'recoveryCodes':
      return item.service || typeLabel;
    default:
      return typeLabel;
  }
}

export const TYPE_LABEL_KEYS: Record<ItemType, TKey> = {
  login: 'type.login',
  note: 'type.note',
  wifi: 'type.wifi',
  recoveryCodes: 'type.recoveryCodes',
  license: 'type.license',
  custom: 'type.custom',
};

export const TYPE_DESC_KEYS: Record<ItemType, TKey> = {
  login: 'type.login.desc',
  note: 'type.note.desc',
  wifi: 'type.wifi.desc',
  recoveryCodes: 'type.recoveryCodes.desc',
  license: 'type.license.desc',
  custom: 'type.custom.desc',
};

/** Sections ordered as a tree with depth, for select boxes. */
export function sectionOptions(collections: Collection[]): { c: Collection; depth: number }[] {
  const sections = collections.filter((c) => c.kind === 'section');
  const out: { c: Collection; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const s of sections.filter((x) => (x.parentId ?? null) === parent).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))) {
      out.push({ c: s, depth });
      if (depth < 8) walk(s.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

export function allTags(items: VaultItem[]): string[] {
  const s = new Set<string>();
  for (const i of items) for (const t of i.tags) s.add(t);
  return [...s].sort((a, b) => a.localeCompare(b));
}
