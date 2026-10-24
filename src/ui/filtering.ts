import { hostOf } from '../lib/security-analysis';
import type { Filter } from '../state/app';
import type { Prefs } from '../state/prefs';
import type { Collection, VaultItem } from '../vault/types';

export function descendantSectionIds(collections: Collection[], rootId: string): Set<string> {
  const out = new Set<string>([rootId]);
  let added = true;
  while (added) {
    added = false;
    for (const c of collections) {
      if (c.kind === 'section' && c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id);
        added = true;
      }
    }
  }
  return out;
}

const RECENT_MS = 30 * 86_400_000;

export function matchesFilter(item: VaultItem, filter: Filter, ctx: { collections: Collection[]; usage: Record<string, number>; sectionScope?: Set<string> }): boolean {
  if (filter.kind === 'trash') return !!item.trashedAt;
  if (item.trashedAt) return false;
  if (filter.kind === 'archive') return !!item.archivedAt;
  if (filter.kind === 'ids') return filter.ids.includes(item.id);
  if (item.archivedAt) return false;
  switch (filter.kind) {
    case 'all':
      return true;
    case 'favorites':
      return item.favorite;
    case 'recentAdded':
      return Date.now() - item.createdAt < RECENT_MS;
    case 'recentUsed':
      return !!ctx.usage[item.id];
    case 'type':
      return filter.type === 'other' ? !['login', 'note'].includes(item.type) : item.type === filter.type;
    case 'category':
      return item.categoryId === filter.id;
    case 'section':
      return !!item.sectionId && (ctx.sectionScope ?? new Set([filter.id])).has(item.sectionId);
    case 'tag':
      return item.tags.includes(filter.tag);
    case 'uncategorized':
      return !item.categoryId && !item.sectionId;
  }
}

/** Search across non-secret fields only (passwords are never matched). */
export function matchesSearch(item: VaultItem, q: string, collections: Collection[]): boolean {
  if (!q) return true;
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const cat = collections.find((c) => c.id === item.categoryId)?.name ?? '';
  const sec = collections.find((c) => c.id === item.sectionId)?.name ?? '';
  const hay = [item.title, item.url, hostOf(item.url), item.username, item.email, item.ssid, item.product, item.service, item.notes, cat, sec, ...item.tags, ...item.customFields.filter((f) => !f.hidden).map((f) => `${f.label} ${f.value}`)]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  return terms.every((term) => hay.includes(term));
}

export function sortItems(items: VaultItem[], sortBy: Prefs['sortBy'], usage: Record<string, number>, filter: Filter): VaultItem[] {
  const by =
    filter.kind === 'recentUsed' ? 'used' : filter.kind === 'recentAdded' ? 'created' : sortBy;
  const arr = [...items];
  arr.sort((a, b) => {
    if (by === 'title') return a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
    if (by === 'updated') return b.updatedAt - a.updatedAt;
    if (by === 'created') return b.createdAt - a.createdAt;
    return (usage[b.id] ?? 0) - (usage[a.id] ?? 0);
  });
  return arr;
}

export function visibleItems(items: VaultItem[], filter: Filter, search: string, ctx: { collections: Collection[]; usage: Record<string, number>; sortBy: Prefs['sortBy'] }): VaultItem[] {
  const sectionScope = filter.kind === 'section' ? descendantSectionIds(ctx.collections, filter.id) : undefined;
  // Global search looks across all active items, regardless of the current filter.
  const base = search && filter.kind !== 'trash' && filter.kind !== 'archive' ? items.filter((i) => !i.trashedAt) : items.filter((i) => matchesFilter(i, filter, { ...ctx, sectionScope }));
  return sortItems(base.filter((i) => matchesSearch(i, search, ctx.collections)), ctx.sortBy, ctx.usage, filter);
}
