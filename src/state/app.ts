/**
 * Application state and actions. Decrypted vault data lives ONLY in this in-memory store
 * while unlocked; lock() replaces it with empty values and drops the session (keys).
 */
import { t } from '../i18n';
import { clearPendingNow } from '../lib/clipboard';
import { randomId } from '../lib/encoding';
import { createVault, unlockWithPassword, unlockWithRecoveryKey, type UnlockStep } from '../vault/access';
import { VaultDB, VaultRepository } from '../vault/db';
import type { ConflictNotice, VaultSession } from '../vault/session';
import {
  DEFAULT_VAULT_SETTINGS,
  emptyItem,
  type Collection,
  type ItemType,
  type VaultItem,
  type VaultSettings,
} from '../vault/types';
import { broadcastLock, startAutoLock } from './autolock';
import { getPrefs } from './prefs-store';
import { createStore, useStore } from './store';
import { confirmDialog, toast, toastError } from './ui';

export type Filter =
  | { kind: 'all' }
  | { kind: 'favorites' }
  | { kind: 'recentAdded' }
  | { kind: 'recentUsed' }
  | { kind: 'type'; type: ItemType | 'other' }
  | { kind: 'category'; id: string }
  | { kind: 'section'; id: string }
  | { kind: 'tag'; tag: string }
  | { kind: 'uncategorized' }
  | { kind: 'archive' }
  | { kind: 'trash' }
  | { kind: 'ids'; ids: string[]; label: string };

export type Route =
  | { name: 'dashboard' }
  | { name: 'items'; filter: Filter }
  | { name: 'generator' }
  | { name: 'security' }
  | { name: 'sync' }
  | { name: 'settings' }
  | { name: 'backup' }
  | { name: 'organize'; create?: 'section' | 'category' };

export interface EditorState {
  mode: 'new' | 'edit';
  itemId?: string;
  type?: ItemType;
  preset?: Partial<VaultItem>;
}

export interface AppState {
  phase: 'loading' | 'welcome' | 'locked' | 'unlocked';
  session: VaultSession | null;
  items: VaultItem[];
  collections: Collection[];
  settings: VaultSettings;
  usage: Record<string, number>;
  conflicts: ConflictNotice[];
  corrupted: number;
  route: Route;
  selectedId: string | null;
  editor: EditorState | null;
  search: string;
  selection: string[];
  lockReason: string | null;
  lastBackupAt: number | null;
}

const EMPTY: Pick<AppState, 'session' | 'items' | 'collections' | 'settings' | 'usage' | 'conflicts' | 'corrupted' | 'selectedId' | 'editor' | 'search' | 'selection' | 'lastBackupAt'> = {
  session: null,
  items: [],
  collections: [],
  settings: DEFAULT_VAULT_SETTINGS,
  usage: {},
  conflicts: [],
  corrupted: 0,
  selectedId: null,
  editor: null,
  search: '',
  selection: [],
  lastBackupAt: null,
};

export const app = createStore<AppState>({
  phase: 'loading',
  route: { name: 'dashboard' },
  lockReason: null,
  ...EMPTY,
});

export function useApp<S>(selector: (s: AppState) => S): S {
  return useStore(app, selector);
}

let repo: VaultRepository | null = null;
export function getRepo(): VaultRepository {
  if (!repo) repo = new VaultRepository(new VaultDB());
  return repo;
}

export function requireSession(): VaultSession {
  const s = app.get().session;
  if (!s || s.isLocked) throw new Error(t('error.locked'));
  return s;
}

// ------------------------------------------------------------------ lifecycle

let stopAutoLock: (() => void) | null = null;
let unsubscribeSession: (() => void) | null = null;
let dataChannel: BroadcastChannel | null = null;
const sessionHooks: ((s: VaultSession) => void)[] = [];
const lockHooks: (() => void)[] = [];
const localChangeHooks: (() => void)[] = [];

/** Other modules (sync) register here to avoid circular imports. */
export function onSessionStart(fn: (s: VaultSession) => void): void {
  sessionHooks.push(fn);
}
export function onLock(fn: () => void): void {
  lockHooks.push(fn);
}
export function onLocalChange(fn: () => void): void {
  localChangeHooks.push(fn);
}

export async function boot(): Promise<void> {
  try {
    const header = await getRepo().getHeader();
    app.set({ phase: header ? 'locked' : 'welcome' });
  } catch (e) {
    console.error('Failed to open local storage');
    app.set({ phase: 'welcome' });
    toastError(e, t('error.storage'));
  }
}

async function refreshFromSession(session: VaultSession): Promise<void> {
  const secrets = await session.getDeviceSecrets();
  app.set({
    items: session.items(),
    collections: session.collections(),
    settings: session.settings(),
    usage: secrets.usage,
    conflicts: secrets.conflicts,
    corrupted: session.corruptedIds.length,
    lastBackupAt: secrets.lastBackupAt ?? null,
  });
}

export async function attachSession(session: VaultSession): Promise<void> {
  unsubscribeSession?.();
  unsubscribeSession = session.subscribe((change) => {
    if (change.type === 'lock') return;
    void refreshFromSession(session);
    if (change.local && change.type !== 'device') {
      try {
        dataChannel?.postMessage({ type: 'changed' });
      } catch {
        /* closed */
      }
      for (const fn of localChangeHooks) fn();
    }
  });
  await refreshFromSession(session);
  app.set({ session, phase: 'unlocked', lockReason: null, route: { name: 'dashboard' } });

  stopAutoLock?.();
  stopAutoLock = startAutoLock(getPrefs, (reason) => lock(reason));

  try {
    dataChannel = new BroadcastChannel('myvault-data');
    dataChannel.onmessage = (ev) => {
      if ((ev.data as { type?: string })?.type === 'changed') void session.reload();
    };
  } catch {
    dataChannel = null;
  }

  // Ask the browser not to evict the vault under storage pressure.
  void navigator.storage?.persist?.().catch(() => undefined);
  void purgeExpiredTrash(session);
  for (const fn of sessionHooks) fn(session);
}

export function lock(reason: 'manual' | 'idle' | 'hidden' | 'other-tab' | 'restore' = 'manual'): void {
  const { session } = app.get();
  if (!session) return;
  void clearPendingNow(getPrefs().clipboardForceClear);
  for (const fn of lockHooks) fn();
  unsubscribeSession?.();
  unsubscribeSession = null;
  stopAutoLock?.();
  stopAutoLock = null;
  dataChannel?.close();
  dataChannel = null;
  session.lock();
  if (reason !== 'other-tab') broadcastLock();
  app.set({ ...EMPTY, phase: 'locked', lockReason: reason, route: { name: 'dashboard' } });
}

export async function createNewVault(password: string): Promise<VaultSession> {
  const session = await createVault(getRepo(), password);
  return session;
}

export async function startUnlock(password: string): Promise<UnlockStep> {
  return unlockWithPassword(getRepo(), password);
}

export async function startRecoveryUnlock(recoveryKey: string, newPassword: string): Promise<UnlockStep> {
  return unlockWithRecoveryKey(getRepo(), recoveryKey, newPassword);
}

// ------------------------------------------------------------------ navigation

export function navigate(route: Route): void {
  app.set({ route, selectedId: null, selection: [] });
}

export function selectItem(id: string | null): void {
  app.set({ selectedId: id });
}

export function openEditor(editor: EditorState): void {
  app.set({ editor });
}

export function closeEditor(): void {
  app.set({ editor: null });
}

// ------------------------------------------------------------------ item actions

export function newItemTemplate(type: ItemType, preset: Partial<VaultItem> = {}): VaultItem {
  const now = Date.now();
  const { route, settings } = app.get();
  const base = emptyItem(type, randomId(), now);
  if (route.name === 'items') {
    if (route.filter.kind === 'category') base.categoryId = route.filter.id;
    if (route.filter.kind === 'section') base.sectionId = route.filter.id;
    if (route.filter.kind === 'tag') base.tags = [route.filter.tag];
    if (route.filter.kind === 'favorites') base.favorite = true;
  }
  if (!base.categoryId && settings.defaultCategoryId) base.categoryId = settings.defaultCategoryId;
  return { ...base, ...preset };
}

/** Save with password-history bookkeeping. */
export async function saveItem(next: VaultItem): Promise<void> {
  const session = requireSession();
  const prev = session.getItem(next.id);
  const now = Date.now();
  const item: VaultItem = { ...next, updatedAt: now, title: next.title.trim() || t('item.untitled') };
  if (!prev) {
    item.createdAt = now;
    if (item.password) item.passwordChangedAt = now;
  } else if ((prev.password ?? '') !== (item.password ?? '')) {
    item.passwordChangedAt = now;
    const limit = session.settings().passwordHistoryLimit;
    if (limit > 0 && prev.password) {
      item.passwordHistory = [{ password: prev.password, changedAt: prev.passwordChangedAt ?? prev.updatedAt }, ...(prev.passwordHistory ?? [])].slice(0, limit);
    } else {
      item.passwordHistory = [];
    }
  }
  await session.saveItem(item);
}

async function patchItems(ids: string[], patch: (i: VaultItem) => VaultItem): Promise<VaultItem[]> {
  const session = requireSession();
  const before: VaultItem[] = [];
  const after: VaultItem[] = [];
  for (const id of ids) {
    const it = session.getItem(id);
    if (!it) continue;
    before.push(it);
    after.push({ ...patch(it), updatedAt: Date.now() });
  }
  if (after.length) await session.saveItems(after);
  return before;
}

function undoable(message: string, before: VaultItem[]): void {
  toast(message, {
    action: {
      label: t('action.undo'),
      run: () => {
        const session = app.get().session;
        if (!session) return;
        // Restore the previous field values, keeping the record revision moving forward.
        void session.saveItems(before.map((b) => ({ ...b, updatedAt: Date.now() }))).then(() => toast(t('toast.undone'), { kind: 'info' }));
      },
    },
  });
}

export async function trashItems(ids: string[]): Promise<void> {
  try {
    const before = await patchItems(ids, (i) => ({ ...i, trashedAt: Date.now() }));
    if (ids.includes(app.get().selectedId ?? '')) app.set({ selectedId: null });
    app.set({ selection: [] });
    undoable(t('toast.movedToTrash', { n: before.length }), before);
  } catch (e) {
    toastError(e);
  }
}

export async function restoreItems(ids: string[]): Promise<void> {
  try {
    const before = await patchItems(ids, (i) => ({ ...i, trashedAt: null, archivedAt: null }));
    app.set({ selection: [] });
    undoable(t('toast.restored', { n: before.length }), before);
  } catch (e) {
    toastError(e);
  }
}

export async function archiveItems(ids: string[], archived: boolean): Promise<void> {
  try {
    const before = await patchItems(ids, (i) => ({ ...i, archivedAt: archived ? Date.now() : null }));
    app.set({ selection: [] });
    if (archived && ids.includes(app.get().selectedId ?? '')) app.set({ selectedId: null });
    undoable(archived ? t('toast.archived', { n: before.length }) : t('toast.unarchived', { n: before.length }), before);
  } catch (e) {
    toastError(e);
  }
}

export async function purgeItems(ids: string[]): Promise<boolean> {
  const ok = await confirmDialog({
    title: t('confirm.purge.title', { n: ids.length }),
    message: t('confirm.purge.message'),
    confirmLabel: t('action.deleteForever'),
    danger: true,
  });
  if (!ok) return false;
  try {
    await requireSession().purgeItems(ids);
    app.set({ selection: [], selectedId: ids.includes(app.get().selectedId ?? '') ? null : app.get().selectedId });
    toast(t('toast.deleted', { n: ids.length }));
    return true;
  } catch (e) {
    toastError(e);
    return false;
  }
}

export async function emptyTrash(): Promise<void> {
  const ids = app.get().items.filter((i) => i.trashedAt).map((i) => i.id);
  if (!ids.length) return;
  await purgeItems(ids);
}

async function purgeExpiredTrash(session: VaultSession): Promise<void> {
  const days = session.settings().trashRetentionDays;
  if (!days) return;
  const cutoff = Date.now() - days * 86_400_000;
  const expired = session.items().filter((i) => i.trashedAt && i.trashedAt < cutoff).map((i) => i.id);
  if (expired.length) await session.purgeItems(expired).catch(() => undefined);
}

export async function toggleFavorite(ids: string[], value?: boolean): Promise<void> {
  try {
    const items = app.get().items.filter((i) => ids.includes(i.id));
    const target = value ?? !items.every((i) => i.favorite);
    await patchItems(ids, (i) => ({ ...i, favorite: target }));
  } catch (e) {
    toastError(e);
  }
}

export async function moveItems(ids: string[], patch: { sectionId?: string | null; categoryId?: string | null }): Promise<void> {
  try {
    const before = await patchItems(ids, (i) => ({ ...i, ...patch }));
    app.set({ selection: [] });
    undoable(t('toast.moved', { n: before.length }), before);
  } catch (e) {
    toastError(e);
  }
}

export async function addTags(ids: string[], tags: string[]): Promise<void> {
  try {
    await patchItems(ids, (i) => ({ ...i, tags: [...new Set([...i.tags, ...tags])] }));
    toast(t('toast.tagsUpdated'));
  } catch (e) {
    toastError(e);
  }
}

export async function removeTag(ids: string[], tag: string): Promise<void> {
  try {
    await patchItems(ids, (i) => ({ ...i, tags: i.tags.filter((x) => x !== tag) }));
  } catch (e) {
    toastError(e);
  }
}

export async function duplicateItem(id: string): Promise<void> {
  try {
    const session = requireSession();
    const src = session.getItem(id);
    if (!src) return;
    const now = Date.now();
    const copy: VaultItem = { ...structuredClone(src), id: randomId(), title: `${src.title} ${t('item.copySuffix')}`, createdAt: now, updatedAt: now, favorite: false, passwordHistory: [] };
    await session.saveItem(copy);
    app.set({ selectedId: copy.id });
    toast(t('toast.duplicated'));
  } catch (e) {
    toastError(e);
  }
}

export async function markUsed(id: string): Promise<void> {
  try {
    await requireSession().markUsed(id);
  } catch {
    /* non-essential */
  }
}

// ------------------------------------------------------------------ collections

export async function saveCollection(c: Collection): Promise<void> {
  await requireSession().saveCollections([{ ...c, updatedAt: Date.now() }]);
}

export async function deleteCollection(id: string, moveTo: string | null): Promise<void> {
  await requireSession().deleteCollection(id, moveTo);
  const { route } = app.get();
  if (route.name === 'items' && (route.filter.kind === 'category' || route.filter.kind === 'section') && route.filter.id === id) {
    navigate({ name: 'items', filter: { kind: 'all' } });
  }
}

export async function dismissConflict(id: string | 'all'): Promise<void> {
  await requireSession().updateDeviceSecrets((s) => {
    s.conflicts = id === 'all' ? [] : s.conflicts.filter((c) => c.id !== id);
  });
}
