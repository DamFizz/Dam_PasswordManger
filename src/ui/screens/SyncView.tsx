import { useEffect, useState } from 'react';
import {
  ArrowRight,
  Check,
  Cloud,
  CloudOff,
  ExternalLink,
  HardDrive,
  Info,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  TriangleAlert,
  Unplug,
  UserRound,
  WifiOff,
} from 'lucide-react';
import { formatDate, formatRelative, useT } from '../../i18n';
import { dismissConflict, getRepo, lock, navigate, selectItem, useApp } from '../../state/app';
import { setPrefs, usePrefs } from '../../state/prefs-store';
import {
  connectGoogle,
  connectGoogleRedirect,
  deleteCloudCopy,
  disconnectGoogle,
  downloadCloudVault,
  replaceCloudWithLocal,
  syncNow,
  useSync,
} from '../../state/sync-controller';
import { confirmDialog, toastError } from '../../state/ui';
import { getClientId, isValidClientId, redirectUri, setClientId } from '../../sync/google-auth';
import { Button } from '../components/Button';
import { Switch, TextField } from '../components/Field';
import { Badge, PageHeader, SectionCard } from '../components/Misc';
import { CopyButton } from '../components/Secret';
import { cx } from '../cx';

export function GoogleSetupHelp({ compact }: { compact?: boolean }) {
  const t = useT();
  const [value, setValue] = useState(getClientId());
  const [saved, setSaved] = useState(false);
  const valid = !value || isValidClientId(value);
  return (
    <div className={cx('rounded-2xl border border-line bg-surface-2/60 p-4 text-sm', compact && 'text-[13px]')}>
      <p className="flex items-center gap-2 font-medium text-fg">
        <Info className="size-4 text-accent" />
        {t('google.setupTitle')}
      </p>
      <p className="mt-1.5 leading-relaxed text-muted">{t('google.setupBody')}</p>
      <dl className="mt-3 space-y-2">
        <div className="flex items-center gap-2">
          <dt className="w-32 shrink-0 text-faint">{t('google.origin')}</dt>
          <dd className="secret min-w-0 flex-1 truncate text-fg">{location.origin}</dd>
          <CopyButton value={location.origin} secret={false} label={t('google.origin')} />
        </div>
        <div className="flex items-center gap-2">
          <dt className="w-32 shrink-0 text-faint">{t('google.redirect')}</dt>
          <dd className="secret min-w-0 flex-1 truncate text-fg">{redirectUri()}</dd>
          <CopyButton value={redirectUri()} secret={false} label={t('google.redirect')} />
        </div>
      </dl>
      <form
        className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid) return;
          setClientId(value);
          setSaved(true);
          window.setTimeout(() => setSaved(false), 2000);
        }}
      >
        <TextField
          label={t('google.clientId')}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="1234567890-abc123.apps.googleusercontent.com"
          wrapClassName="flex-1"
          autoCapitalize="none"
          spellCheck={false}
          error={!valid ? t('google.clientIdInvalid') : undefined}
        />
        <Button type="submit" disabled={!valid} icon={saved ? <Check className="size-4" /> : undefined}>
          {saved ? t('action.saved') : t('action.save')}
        </Button>
      </form>
      <p className="mt-2 text-xs text-faint">{t('google.clientIdNote')}</p>
    </div>
  );
}

export function SyncView() {
  const t = useT();
  const prefs = usePrefs();
  const status = useSync((s) => s.status);
  const connected = useSync((s) => s.connected);
  const account = useSync((s) => s.account);
  const lastSyncAt = useSync((s) => s.lastSyncAt);
  const lastError = useSync((s) => s.lastError);
  const errorCode = useSync((s) => s.errorCode);
  const online = useSync((s) => s.online);
  const tokenExpiresAt = useSync((s) => s.tokenExpiresAt);
  const lastReport = useSync((s) => s.lastReport);
  const conflicts = useApp((s) => s.conflicts);
  const session = useApp((s) => s.session);
  const [records, setRecords] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [popupFailed, setPopupFailed] = useState(false);
  const clientId = getClientId();

  useEffect(() => {
    void getRepo()
      .storageEstimate()
      .then((e) => setRecords(e.records));
  }, [lastSyncAt]);

  const statusLine = !online
    ? { icon: <WifiOff className="size-5" />, text: t('sync.line.offline'), tone: 'text-warning' }
    : status === 'syncing'
      ? { icon: <LoaderCircle className="size-5 animate-spin" />, text: t('sync.line.syncing'), tone: 'text-accent' }
      : status === 'idle'
        ? { icon: <Check className="size-5" />, text: lastSyncAt ? t('sync.line.synced', { when: formatRelative(lastSyncAt) }) : t('sync.line.ready'), tone: 'text-success' }
        : status === 'needs-auth'
          ? { icon: <RefreshCw className="size-5" />, text: t('sync.line.needsAuth'), tone: 'text-warning' }
          : status === 'off'
            ? { icon: <Unplug className="size-5" />, text: t('sync.line.off'), tone: 'text-faint' }
            : { icon: <TriangleAlert className="size-5" />, text: lastError ?? t('sync.status.error'), tone: 'text-danger' };

  const connect = async (switchAccount = false) => {
    setBusy(true);
    setPopupFailed(false);
    const ok = await connectGoogle({ switchAccount });
    if (!ok) setPopupFailed(true);
    setBusy(false);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-28 pt-6 sm:px-6 md:pb-10">
        <PageHeader title={t('sync.title')} subtitle={t('sync.subtitle')} icon={<Cloud className="size-5" />} />

        <div className="space-y-4">
          <SectionCard>
            <div className="flex flex-wrap items-center gap-4">
              <div className={cx('flex size-12 items-center justify-center rounded-2xl', connected ? 'bg-accent-soft text-accent' : 'bg-surface-3 text-muted')}>{connected ? <Cloud className="size-6" /> : <CloudOff className="size-6" />}</div>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-fg">{t('sync.googleDrive')}</p>
                <p className={cx('mt-0.5 flex items-center gap-1.5 text-sm', statusLine.tone)}>
                  <span className="[&>svg]:size-4">{statusLine.icon}</span>
                  <span className="min-w-0">{statusLine.text}</span>
                </p>
              </div>
              {connected ? (
                <div className="flex flex-wrap gap-2">
                  {status === 'needs-auth' ? (
                    <Button variant="primary" loading={busy} icon={<RefreshCw className="size-4" />} onClick={() => void connect()}>
                      {t('sync.reconnect')}
                    </Button>
                  ) : (
                    <Button variant="primary" loading={status === 'syncing'} disabled={!online || status === 'mismatch'} icon={<RefreshCw className="size-4" />} onClick={() => void syncNow()}>
                      {t('sync.now')}
                    </Button>
                  )}
                </div>
              ) : (
                <Button variant="primary" loading={busy} disabled={!clientId || !online} onClick={() => void connect()}>
                  {t('sync.connect')}
                </Button>
              )}
            </div>

            {connected && (
              <dl className="mt-5 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <UserRound className="size-4 text-faint" />
                  <dt className="sr-only">{t('sync.account')}</dt>
                  <dd className="min-w-0 truncate text-fg">{account?.email ?? account?.name ?? t('sync.accountUnknown')}</dd>
                </div>
                <div>
                  <dt className="inline text-faint">{t('sync.lastSuccess')}: </dt>
                  <dd className="inline text-fg">{lastSyncAt ? formatDate(lastSyncAt, true) : t('time.never')}</dd>
                </div>
                <div>
                  <dt className="inline text-faint">{t('sync.session')}: </dt>
                  <dd className="inline text-fg">{tokenExpiresAt && tokenExpiresAt > Date.now() ? t('sync.sessionValid', { when: formatDate(tokenExpiresAt, true) }) : t('sync.sessionExpired')}</dd>
                </div>
                {lastReport && (
                  <div>
                    <dt className="inline text-faint">{t('sync.lastResult')}: </dt>
                    <dd className="inline text-fg">{t('sync.lastResultValue', { pulled: lastReport.pulled, pushed: lastReport.pushed })}</dd>
                  </div>
                )}
              </dl>
            )}

            {popupFailed && clientId && (
              <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3 text-sm text-muted">
                <p>{t('sync.popupHelp')}</p>
                <Button size="sm" className="mt-2" icon={<ExternalLink className="size-4" />} onClick={() => connectGoogleRedirect()}>
                  {t('sync.redirect')}
                </Button>
              </div>
            )}

            {status === 'mismatch' && (
              <div role="alert" className="mt-4 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm">
                <p className="font-medium text-fg">{t('sync.mismatch.title')}</p>
                <p className="mt-1 text-muted">{t('sync.mismatch.body')}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={async () => {
                      const ok = await confirmDialog({ title: t('sync.mismatch.keepLocal'), message: t('sync.mismatch.keepLocalConfirm'), confirmLabel: t('sync.mismatch.keepLocal'), danger: true });
                      if (!ok) return;
                      try {
                        await replaceCloudWithLocal();
                      } catch (e) {
                        toastError(e);
                      }
                    }}
                  >
                    {t('sync.mismatch.keepLocal')}
                  </Button>
                  <Button
                    size="sm"
                    onClick={async () => {
                      const ok = await confirmDialog({ title: t('sync.mismatch.useCloud'), message: t('sync.mismatch.useCloudConfirm'), confirmLabel: t('sync.mismatch.useCloud') });
                      if (!ok) return;
                      try {
                        await downloadCloudVault();
                        lock('restore');
                      } catch (e) {
                        toastError(e);
                      }
                    }}
                  >
                    {t('sync.mismatch.useCloud')}
                  </Button>
                </div>
              </div>
            )}
            {errorCode === 'auth' && status !== 'needs-auth' && (
              <p className="mt-3 text-sm text-warning">{t('sync.error.expired')}</p>
            )}
          </SectionCard>

          {conflicts.length > 0 && (
            <SectionCard
              title={t('sync.conflicts.title', { n: conflicts.length })}
              description={t('sync.conflicts.desc')}
              actions={
                <Button size="sm" variant="ghost" onClick={() => void dismissConflict('all')}>
                  {t('sync.conflicts.dismissAll')}
                </Button>
              }
            >
              <ul className="divide-y divide-line">
                {conflicts.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-start gap-3 py-3">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg">{c.title}</p>
                      <p className="mt-0.5 text-sm text-muted">{c.message}</p>
                      <p className="mt-0.5 text-xs text-faint">{formatDate(c.at, true)}</p>
                    </div>
                    <div className="flex gap-1">
                      {c.keptId && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            navigate({ name: 'items', filter: { kind: 'ids', ids: [c.keptId!, ...(c.copyId ? [c.copyId] : [])], label: t('sync.conflicts.review') } });
                            selectItem(c.keptId!);
                          }}
                        >
                          {t('sync.conflicts.review')} <ArrowRight className="size-3.5" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => void dismissConflict(c.id)}>
                        {t('action.dismiss')}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            </SectionCard>
          )}

          <SectionCard title={t('sync.where.title')}>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl border border-line bg-surface-2/60 p-4">
                <HardDrive className="size-5 text-accent" />
                <p className="mt-2 text-sm font-medium text-fg">{t('sync.where.local')}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t('sync.where.localBody', { n: records ?? '…' })}</p>
              </div>
              <div className="rounded-2xl border border-line bg-surface-2/60 p-4">
                <Cloud className="size-5 text-accent" />
                <p className="mt-2 text-sm font-medium text-fg">{t('sync.where.cloud')}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{connected ? t('sync.where.cloudBody') : t('sync.where.cloudOff')}</p>
              </div>
              <div className="rounded-2xl border border-line bg-surface-2/60 p-4">
                <ShieldCheck className="size-5 text-accent" />
                <p className="mt-2 text-sm font-medium text-fg">{t('sync.where.backup')}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{t('sync.where.backupBody')}</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard title={t('sync.options')}>
            <Switch checked={prefs.autoSync} onChange={(v) => setPrefs({ autoSync: v })} label={t('sync.auto')} description={t('sync.autoHelp')} />
            {connected && (
              <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
                <Button size="sm" icon={<UserRound className="size-4" />} onClick={() => void connect(true)}>
                  {t('sync.switchAccount')}
                </Button>
                <Button
                  size="sm"
                  icon={<Unplug className="size-4" />}
                  onClick={async () => {
                    const ok = await confirmDialog({ title: t('sync.disconnect'), message: t('sync.disconnectConfirm'), confirmLabel: t('sync.disconnect') });
                    if (ok) await disconnectGoogle({ revoke: true });
                  }}
                >
                  {t('sync.disconnect')}
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  disabled={status === 'needs-auth' || !online}
                  onClick={async () => {
                    const ok = await confirmDialog({ title: t('sync.deleteCloud'), message: t('sync.deleteCloudConfirm'), confirmLabel: t('sync.deleteCloud'), danger: true, acknowledge: t('sync.deleteCloudAck') });
                    if (!ok) return;
                    try {
                      await deleteCloudCopy();
                    } catch (e) {
                      toastError(e);
                    }
                  }}
                >
                  {t('sync.deleteCloud')}
                </Button>
              </div>
            )}
          </SectionCard>

          <GoogleSetupHelp />

          <div className="flex items-start gap-3 rounded-2xl border border-line p-4 text-xs leading-relaxed text-muted">
            <Info className="mt-0.5 size-4 shrink-0 text-faint" />
            <div className="space-y-1.5">
              <p>{t('sync.note.encryption')}</p>
              <p>{t('sync.note.token')}</p>
              <p>{t('sync.note.limits')}</p>
              {session && (
                <p>
                  {t('sync.note.device')} <Badge>{session.device.name}</Badge>
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
