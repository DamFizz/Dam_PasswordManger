/**
 * Connects the UI to the sync engine and Google Drive: connection status, automatic
 * syncing (after local changes, when coming back online, periodically), error mapping.
 * Status shown in the UI always reflects the real result of the last operation.
 */
import { t } from '../i18n';
import { DriveRemote } from '../sync/drive';
import { downloadVaultToDevice } from '../sync/bootstrap';
import { InvalidVaultFileError, loadSyncState, RemoteKeyMismatchError, saveSyncState, SyncBusyError, SyncEngine, syncStateKey, VaultMismatchError } from '../sync/engine';
import { serializeSyncFile } from '../sync/format';
import {
  consumeRedirectResult,
  getClientId,
  OAuthError,
  requestTokenPopup,
  revokeToken,
  startRedirectSignIn,
  type GoogleToken,
} from '../sync/google-auth';
import { RemoteError } from '../sync/remote';
import type { VaultSession } from '../vault/session';
import { app, getRepo, onLocalChange, onLock, onSessionStart } from './app';
import { getPrefs } from './prefs-store';
import { createStore, useStore } from './store';
import { toast } from './ui';

export type SyncStatus = 'off' | 'idle' | 'syncing' | 'error' | 'offline' | 'needs-auth' | 'mismatch';

export interface SyncUiState {
  status: SyncStatus;
  connected: boolean;
  account: { email?: string; name?: string } | null;
  tokenExpiresAt: number | null;
  lastSyncAt: number | null;
  lastError: string | null;
  errorCode: string | null;
  online: boolean;
  mismatch: { remoteCreatedAt: number } | null;
  lastReport: { pulled: number; pushed: number; conflicts: number; at: number } | null;
}

export const syncStore = createStore<SyncUiState>({
  status: 'off',
  connected: false,
  account: null,
  tokenExpiresAt: null,
  lastSyncAt: null,
  lastError: null,
  errorCode: null,
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  mismatch: null,
  lastReport: null,
});

export function useSync<S>(sel: (s: SyncUiState) => S): S {
  return useStore(syncStore, sel);
}

/** Token obtained before a vault exists locally (new-device onboarding). Memory only. */
let pendingToken: GoogleToken | null = null;
let syncing: Promise<void> | null = null;
let autoTimer: number | undefined;
let periodicTimer: number | undefined;

function session(): VaultSession | null {
  const s = app.get().session;
  return s && !s.isLocked ? s : null;
}

async function currentToken(): Promise<string> {
  const s = session();
  const g = s ? (await s.getDeviceSecrets()).google : null;
  const token = g?.accessToken && g.tokenExpiresAt && g.tokenExpiresAt > Date.now() ? g.accessToken : pendingToken && pendingToken.expiresAt > Date.now() ? pendingToken.accessToken : null;
  if (!token) throw new RemoteError('auth', t('sync.error.expired'));
  return token;
}

function remote(): DriveRemote {
  return new DriveRemote(currentToken);
}

async function storeToken(s: VaultSession, token: GoogleToken): Promise<void> {
  const r = new DriveRemote(async () => token.accessToken);
  let account: { email?: string; name?: string } = {};
  try {
    account = await r.about();
  } catch {
    /* account info is optional */
  }
  await s.updateDeviceSecrets((sec) => {
    sec.google = {
      ...(sec.google ?? {}),
      accessToken: token.accessToken,
      tokenExpiresAt: token.expiresAt,
      email: account.email ?? sec.google?.email,
      name: account.name ?? sec.google?.name,
    };
  });
  syncStore.set({ connected: true, account: { email: account.email, name: account.name }, tokenExpiresAt: token.expiresAt, status: 'idle', lastError: null, errorCode: null });
}

async function refreshUiFromSession(s: VaultSession): Promise<void> {
  const g = (await s.getDeviceSecrets()).google;
  const state = await loadSyncState(s);
  const tokenValid = !!(g?.accessToken && g.tokenExpiresAt && g.tokenExpiresAt > Date.now());
  syncStore.set({
    connected: !!g,
    account: g ? { email: g.email, name: g.name } : null,
    tokenExpiresAt: g?.tokenExpiresAt ?? null,
    lastSyncAt: state.lastSyncAt ?? null,
    status: !g ? 'off' : !navigator.onLine ? 'offline' : tokenValid ? 'idle' : 'needs-auth',
    lastError: state.lastError ?? null,
    online: navigator.onLine,
  });
}

function mapError(e: unknown): { status: SyncStatus; message: string; code: string } {
  if (e instanceof VaultMismatchError) return { status: 'mismatch', message: t('sync.error.mismatch'), code: 'mismatch' };
  if (e instanceof RemoteKeyMismatchError) return { status: 'error', message: t('sync.error.keyMismatch'), code: 'key-mismatch' };
  if (e instanceof InvalidVaultFileError) return { status: 'error', message: `${t('sync.error.corrupt')} (${e.message})`, code: 'corrupt' };
  if (e instanceof SyncBusyError) return { status: 'error', message: t('sync.error.busy'), code: 'busy' };
  if (e instanceof RemoteError) {
    if (e.code === 'auth') return { status: 'needs-auth', message: t('sync.error.expired'), code: 'auth' };
    if (e.code === 'network') return { status: navigator.onLine ? 'error' : 'offline', message: t('sync.error.network'), code: 'network' };
    if (e.code === 'quota') return { status: 'error', message: t('sync.error.quota'), code: 'quota' };
    if (e.code === 'rate-limit') return { status: 'error', message: t('sync.error.rateLimit'), code: 'rate-limit' };
    if (e.code === 'config') return { status: 'error', message: t('sync.error.config'), code: 'config' };
    return { status: 'error', message: e.message, code: e.code };
  }
  return { status: 'error', message: e instanceof Error ? e.message : String(e), code: 'unknown' };
}

/** Run a sync now. Safe to call repeatedly (single flight). */
export async function syncNow(opts: { silent?: boolean } = {}): Promise<void> {
  const s = session();
  if (!s) return;
  if (!syncStore.get().connected) return;
  if (!navigator.onLine) {
    syncStore.set({ status: 'offline', online: false });
    return;
  }
  if (syncing) return syncing;
  syncing = (async () => {
    syncStore.set({ status: 'syncing', lastError: null, errorCode: null, mismatch: null });
    try {
      const report = await new SyncEngine(s, remote()).sync();
      syncStore.set({
        status: 'idle',
        lastSyncAt: report.at,
        lastReport: { pulled: report.pulled, pushed: report.pushed, conflicts: report.conflicts.length, at: report.at },
      });
      if (report.conflicts.length) toast(t('sync.toast.conflicts', { n: report.conflicts.length }), { kind: 'info', duration: 7000 });
      else if (!opts.silent) toast(report.pulled || report.pushed ? t('sync.toast.done', { pulled: report.pulled, pushed: report.pushed }) : t('sync.toast.upToDate'));
      if (report.headerUpdated) toast(t('sync.toast.headerUpdated'), { kind: 'info', duration: 7000 });
      if (report.skippedCorrupt) toast(t('sync.toast.skippedCorrupt', { n: report.skippedCorrupt }), { kind: 'error', duration: 8000 });
    } catch (e) {
      const m = mapError(e);
      syncStore.set({
        status: m.status,
        lastError: m.message,
        errorCode: m.code,
        mismatch: e instanceof VaultMismatchError ? { remoteCreatedAt: e.remoteCreatedAt } : null,
      });
      const st = await loadSyncState(s).catch(() => null);
      if (st && session()) await saveSyncState(s, { ...st, lastAttemptAt: Date.now(), lastError: m.message }).catch(() => undefined);
      if (!opts.silent || m.status === 'mismatch') toast(m.message, { kind: 'error', duration: 6000 });
    } finally {
      syncing = null;
    }
  })();
  return syncing;
}

function scheduleAutoSync(delay = 4000): void {
  if (!getPrefs().autoSync || !syncStore.get().connected) return;
  window.clearTimeout(autoTimer);
  autoTimer = window.setTimeout(() => {
    const st = syncStore.get().status;
    if (st === 'needs-auth' || st === 'mismatch') return;
    void syncNow({ silent: true });
  }, delay);
}

/** Interactive Google connection (popup). Must be triggered by a click. */
export async function connectGoogle(opts: { switchAccount?: boolean } = {}): Promise<boolean> {
  const s = session();
  try {
    const hint = syncStore.get().account?.email;
    const token = await requestTokenPopup({ prompt: opts.switchAccount ? 'select_account' : '', loginHint: opts.switchAccount ? undefined : hint });
    if (s) {
      await storeToken(s, token);
      toast(t('sync.toast.connected'));
      await syncNow();
    } else {
      pendingToken = token;
    }
    return true;
  } catch (e) {
    if (e instanceof OAuthError && e.code === 'cancelled') return false;
    toast(e instanceof Error ? e.message : t('sync.error.connect'), { kind: 'error', duration: 6000 });
    return false;
  }
}

export function connectGoogleRedirect(): void {
  startRedirectSignIn({ loginHint: syncStore.get().account?.email });
}

export function hasPendingToken(): boolean {
  return !!pendingToken && pendingToken.expiresAt > Date.now();
}

/** New device: download the encrypted cloud vault using the pending (memory-only) token. */
export async function downloadCloudVault(): Promise<void> {
  await downloadVaultToDevice(getRepo(), new DriveRemote(currentToken));
}

export async function disconnectGoogle(opts: { revoke: boolean }): Promise<void> {
  const s = session();
  if (!s) return;
  const g = (await s.getDeviceSecrets()).google;
  if (opts.revoke && g?.accessToken) await revokeToken(g.accessToken);
  await s.updateDeviceSecrets((sec) => {
    sec.google = null;
  });
  await getRepo().deleteLocal(syncStateKey(s.vaultId));
  syncStore.set({ status: 'off', connected: false, account: null, tokenExpiresAt: null, lastSyncAt: null, lastError: null, errorCode: null, mismatch: null });
  toast(t('sync.toast.disconnected'));
}

/** Delete the encrypted copy in Google Drive (local data is untouched). */
export async function deleteCloudCopy(): Promise<void> {
  const s = session();
  if (!s) return;
  const r = remote();
  const meta = await r.find();
  if (meta) await r.remove(meta.id);
  await getRepo().deleteLocal(syncStateKey(s.vaultId));
  syncStore.set({ lastSyncAt: null });
  toast(t('sync.toast.cloudDeleted'));
}

/**
 * Resolve a vault mismatch by keeping this device's vault: the other cloud vault is NOT
 * deleted, it is renamed (kept as a backup in the app folder), then this vault is uploaded.
 */
export async function replaceCloudWithLocal(): Promise<void> {
  const s = session();
  if (!s) return;
  const r = remote();
  const meta = await r.find();
  if (meta) await r.rename(meta.id, `myvault.vault.replaced-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const created = await r.create(serializeSyncFile(s.header, s.encryptedRecords(), s.device.id));
  await saveSyncState(s, {
    vaultId: s.vaultId,
    remoteFileId: created.id,
    remoteVersion: created.version,
    base: Object.fromEntries(s.encryptedRecords().map((x) => [x.id, x.vtag])),
    baseHeaderVtag: s.header.vtag,
    maxHeaderRev: s.header.rev,
    lastSyncAt: Date.now(),
    lastError: null,
  });
  syncStore.set({ status: 'idle', mismatch: null, lastError: null, errorCode: null, lastSyncAt: Date.now() });
  toast(t('sync.toast.replaced'));
}

// ------------------------------------------------------------------ wiring

onSessionStart((s) => {
  void (async () => {
    // Token from a redirect sign-in or from onboarding: encrypt it now that the vault is unlocked.
    const redirected = consumeRedirectResult();
    const token = redirected ?? (pendingToken && pendingToken.expiresAt > Date.now() ? pendingToken : null);
    pendingToken = null;
    if (token) await storeToken(s, token);
    await refreshUiFromSession(s);
    if (getPrefs().autoSync && syncStore.get().status === 'idle') void syncNow({ silent: true });
    window.clearInterval(periodicTimer);
    periodicTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') scheduleAutoSync(0);
    }, 5 * 60_000);
  })();
});

onLocalChange(() => scheduleAutoSync());

onLock(() => {
  window.clearTimeout(autoTimer);
  window.clearInterval(periodicTimer);
  syncStore.set({ status: 'off', connected: false, account: null, lastError: null, errorCode: null, mismatch: null, lastReport: null });
});

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    syncStore.set({ online: true, status: syncStore.get().status === 'offline' ? 'idle' : syncStore.get().status });
    scheduleAutoSync(1000);
  });
  window.addEventListener('offline', () => {
    syncStore.set({ online: false, status: syncStore.get().connected ? 'offline' : syncStore.get().status });
  });
}

export function hasClientId(): boolean {
  return !!getClientId();
}
