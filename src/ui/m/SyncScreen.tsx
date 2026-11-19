/**
 * Google Drive sync (Android SyncScreens): status, account, Connect / Sync now, vault mismatch
 * resolution, auto-sync, conflicts, disconnect and delete cloud copy. The web also needs the
 * Google OAuth client ID set up once (shown until it is saved).
 */
import { useState } from 'react';
import { Check, Cloud, GitMerge, LoaderCircle, RefreshCw, TriangleAlert, Unplug, UserRound, WifiOff } from 'lucide-react';
import { formatRelative, useT } from '../../i18n';
import { dismissConflict, navigate, useApp } from '../../state/app';
import { setPrefs, usePrefs } from '../../state/prefs-store';
import { connectGoogle, connectGoogleRedirect, deleteCloudCopy, disconnectGoogle, downloadCloudVault, replaceCloudWithLocal, syncNow, useClientId, useSync } from '../../state/sync-controller';
import { confirmDialog, toastError } from '../../state/ui';
import { getClientId, isValidClientId, redirectUri, setClientId } from '../../sync/google-auth';
import { copyWithFeedback } from '../components/Secret';
import { Body, Column, Footnote, GlassButton, GlassTextField, GroupDivider, Headline, IconTile, InsetGroup, LargeTitle, ListRow, SectionHeader, Stack, TextLink, ToggleRow } from './kit';
import { PushedScreen } from './Shell';

function GoogleSetup() {
  const t = useT();
  const [value, setValue] = useState(getClientId());
  const valid = !value || isValidClientId(value);
  return (
    <InsetGroup>
      <div className="flex flex-col gap-3 p-4">
        <Headline>{t('google.setupTitle')}</Headline>
        <Body>{t('google.setupBody')}</Body>
      </div>
      <GroupDivider />
      <ListRow title={t('google.origin')} subtitle={location.origin} onClick={() => void copyWithFeedback(location.origin, { secret: false, label: t('google.origin') })} />
      <GroupDivider />
      <ListRow title={t('google.redirect')} subtitle={redirectUri()} onClick={() => void copyWithFeedback(redirectUri(), { secret: false, label: t('google.redirect') })} />
      <div className="flex flex-col gap-2 p-3">
        <GlassTextField value={value} onChange={setValue} placeholder="1234567890-abc123.apps.googleusercontent.com" label={t('google.clientId')} error={!valid ? t('google.clientIdInvalid') : undefined} />
        <GlassButton block disabled={!valid || !value} onClick={() => setClientId(value)}>
          {t('action.save')}
        </GlassButton>
        <Footnote className="px-1">{t('google.clientIdNote')}</Footnote>
      </div>
    </InsetGroup>
  );
}

export function SyncScreen() {
  const t = useT();
  const prefs = usePrefs();
  const status = useSync((s) => s.status);
  const connected = useSync((s) => s.connected);
  const account = useSync((s) => s.account);
  const lastSyncAt = useSync((s) => s.lastSyncAt);
  const lastError = useSync((s) => s.lastError);
  const online = useSync((s) => s.online);
  const conflicts = useApp((s) => s.conflicts);
  const clientId = useClientId();
  const [busy, setBusy] = useState(false);
  const [popupFailed, setPopupFailed] = useState(false);

  const line = !online
    ? { icon: <WifiOff />, text: t('sync.line.offline'), color: 'var(--warning)' }
    : status === 'syncing'
      ? { icon: <LoaderCircle className="animate-spin" />, text: t('sync.line.syncing'), color: 'var(--accent)' }
      : status === 'idle'
        ? { icon: <Check />, text: lastSyncAt ? t('sync.line.synced', { when: formatRelative(lastSyncAt) }) : t('sync.line.ready'), color: '#46a758' }
        : status === 'needs-auth'
          ? { icon: <RefreshCw />, text: t('sync.line.needsAuth'), color: 'var(--warning)' }
          : status === 'off'
            ? { icon: <Unplug />, text: t('sync.line.off'), color: 'var(--text-faint)' }
            : { icon: <TriangleAlert />, text: lastError ?? t('sync.status.error'), color: 'var(--danger)' };

  const connect = async (switchAccount = false) => {
    setBusy(true);
    setPopupFailed(false);
    const ok = await connectGoogle({ switchAccount });
    if (!ok) setPopupFailed(true);
    setBusy(false);
  };

  return (
    <PushedScreen title={t('a.sync_title')}>
      <Column>
        <Stack gap={12}>
          <LargeTitle className="pl-1.5">{t('a.sync_title')}</LargeTitle>
          <Body className="px-1.5">{t('a.sync_subtitle')}</Body>

          <InsetGroup>
            <ListRow title={line.text} leading={<IconTile icon={<span className="flex size-full [&>svg]:size-full">{line.icon}</span>} size={34} color={line.color} />} />
            {connected && account?.email && (
              <>
                <GroupDivider inset={64} />
                <ListRow title={t('a.sync_account', { 1: account.email })} leading={<IconTile icon={<UserRound className="size-full" />} size={34} />} />
              </>
            )}
          </InsetGroup>

          {!clientId ? (
            <GoogleSetup />
          ) : !connected ? (
            <>
              <GlassButton block icon={<Cloud />} loading={busy} onClick={() => void connect()}>
                {t('a.sync_connect')}
              </GlassButton>
              {popupFailed && (
                <>
                  <Footnote className="px-4">{t('sync.popupHelp')}</Footnote>
                  <TextLink onClick={connectGoogleRedirect}>{t('sync.redirect')}</TextLink>
                </>
              )}
            </>
          ) : (
            <>
              {status === 'needs-auth' ? (
                <GlassButton block icon={<Cloud />} loading={busy} onClick={() => void connect()}>
                  {t('a.sync_reconnect')}
                </GlassButton>
              ) : (
                <GlassButton block icon={<RefreshCw />} disabled={status === 'syncing'} onClick={() => void syncNow()}>
                  {t('a.sync_now')}
                </GlassButton>
              )}
              {status === 'mismatch' && (
                <>
                  <SectionHeader>{t('a.sync_mismatch_title')}</SectionHeader>
                  <GlassButton
                    block
                    prominent={false}
                    onClick={async () => {
                      const ok = await confirmDialog({ title: t('sync.mismatch.keepLocal'), message: t('sync.mismatch.keepLocalConfirm'), confirmLabel: t('sync.mismatch.keepLocal'), danger: true });
                      if (ok) await replaceCloudWithLocal().catch(toastError);
                    }}
                  >
                    {t('a.sync_keep_local')}
                  </GlassButton>
                  <GlassButton
                    block
                    prominent={false}
                    destructive
                    onClick={async () => {
                      const ok = await confirmDialog({ title: t('sync.mismatch.useCloud'), message: t('sync.mismatch.useCloudConfirm'), confirmLabel: t('sync.mismatch.useCloud') });
                      if (ok) await downloadCloudVault().catch(toastError);
                    }}
                  >
                    {t('a.sync_use_cloud')}
                  </GlassButton>
                </>
              )}
              <InsetGroup>
                <ToggleRow title={t('a.sync_auto')} subtitle={t('a.sync_auto_help')} checked={prefs.autoSync} onChange={(v) => setPrefs({ autoSync: v })} />
              </InsetGroup>
              {conflicts.length > 0 && (
                <>
                  <SectionHeader>{t('a.sync_conflicts')}</SectionHeader>
                  <InsetGroup>
                    {conflicts.map((n, i) => (
                      <div key={n.id}>
                        {i > 0 && <GroupDivider inset={64} />}
                        <ListRow
                          title={n.title}
                          subtitle={n.message}
                          leading={<IconTile icon={<GitMerge className="size-full" />} size={34} color="var(--star)" />}
                          onClick={
                            n.keptId && n.kind === 'item'
                              ? () => navigate({ name: 'item', id: n.keptId! })
                              : n.keptId && n.kind === 'space'
                                ? () => navigate({ name: 'spaceItem', id: n.keptId! })
                                : undefined
                          }
                        />
                      </div>
                    ))}
                  </InsetGroup>
                  <TextLink onClick={() => void dismissConflict('all')}>{t('sync.dismissAll')}</TextLink>
                </>
              )}
              <InsetGroup>
                <ListRow title={t('sync.switchAccount')} onClick={() => void connect(true)} />
                <GroupDivider />
                <ListRow
                  title={t('a.sync_disconnect')}
                  onClick={async () => {
                    const ok = await confirmDialog({ title: t('a.sync_disconnect'), message: t('a.sync_disconnect_confirm'), confirmLabel: t('a.sync_disconnect') });
                    if (ok) await disconnectGoogle({ revoke: true });
                  }}
                />
                <GroupDivider />
                <ListRow
                  title={t('a.sync_delete_cloud')}
                  titleClassName="!text-danger"
                  onClick={async () => {
                    const ok = await confirmDialog({ title: t('a.sync_delete_cloud'), message: t('a.sync_delete_cloud_confirm'), confirmLabel: t('a.org_delete'), danger: true, acknowledge: t('sync.deleteCloudAck') });
                    if (ok) await deleteCloudCopy().catch(toastError);
                  }}
                />
              </InsetGroup>
            </>
          )}
          <Footnote className="px-4">{t('a.sync_note')}</Footnote>
          {clientId && !connected && <GoogleSetup />}
        </Stack>
      </Column>
    </PushedScreen>
  );
}
