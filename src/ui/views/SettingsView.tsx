import { useEffect, useState, type ReactNode } from 'react';
import {
  Check,
  FingerprintPattern,
  Info,
  KeyRound,
  Languages,
  LifeBuoy,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  Settings as SettingsIcon,
  Smartphone,
  Sun,
} from 'lucide-react';
import { formatDate, useT } from '../../i18n';
import { isAcceptableMasterPassword } from '../../lib/strength';
import { emptyTrash, getRepo, lock, navigate, requireSession, useApp } from '../../state/app';
import { setPrefs, usePrefs } from '../../state/prefs-store';
import type { Accent } from '../../state/prefs';
import { confirmDialog, requestReauth, toast, toastError } from '../../state/ui';
import {
  changeMasterPassword,
  createRecoveryKey,
  disableTotp,
  regenerateRecoveryCodes,
  removeRecoveryKey,
  verifyMasterPassword,
  verifySecondFactor,
} from '../../vault/access';
import { renameDevice } from '../../vault/device';
import { disableQuickUnlock, enableQuickUnlock, getQuickUnlock, isQuickUnlockPossible, QuickUnlockUnsupportedError } from '../../vault/quick-unlock';
import { Button } from '../components/Button';
import { SelectField, Segmented, Switch, TextField } from '../components/Field';
import { Badge, PageHeader, SectionCard } from '../components/Misc';
import { Modal } from '../components/Modal';
import { PasswordInput, copyWithFeedback } from '../components/Secret';
import { cx } from '../cx';
import { downloadTextFile, printText } from '../download';
import { RecoveryKeyDisplay } from '../screens/RecoveryKit';
import { TotpEnroll } from '../screens/TotpEnroll';

const ACCENTS: { value: Accent; from: string; to: string }[] = [
  { value: 'teal', from: '#2dd4bf', to: '#818cf8' },
  { value: 'violet', from: '#a78bfa', to: '#f472b6' },
  { value: 'blue', from: '#60a5fa', to: '#22d3ee' },
  { value: 'emerald', from: '#34d399', to: '#a3e635' },
  { value: 'rose', from: '#fb7185', to: '#fb923c' },
  { value: 'amber', from: '#fbbf24', to: '#f87171' },
];

function Row({ icon, title, description, children }: { icon?: ReactNode; title: ReactNode; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 py-4 first:pt-0 last:pb-0 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {icon && <div className="mt-0.5 text-muted [&>svg]:size-5">{icon}</div>}
        <div className="min-w-0">
          <p className="text-[15px] font-medium text-fg">{title}</p>
          {description && <p className="mt-0.5 text-[13px] leading-relaxed text-muted">{description}</p>}
        </div>
      </div>
      {children && <div className="flex shrink-0 flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsCode = !!useApp((s) => s.session)?.security.totp;
  useEffect(() => {
    if (open) {
      setCurrent('');
      setNext('');
      setConfirm('');
      setCode('');
      setError(null);
    }
  }, [open]);
  const valid = current && next === confirm && isAcceptableMasterPassword(next) && next !== current && (!needsCode || code.trim().length >= 6);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('settings.changePassword')}
      description={t('settings.changePasswordHelp')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const session = requireSession();
                await verifyMasterPassword(session, current);
                if (session.security.totp) await verifySecondFactor(session, code.replace(/\s/g, ''));
                await changeMasterPassword(session, current, next);
                toast(t('settings.passwordChanged'));
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('settings.changePassword')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <PasswordInput label={t('settings.currentPassword')} value={current} onValueChange={setCurrent} autoComplete="current-password" autoFocus error={error ?? undefined} />
        <PasswordInput label={t('forgot.newPassword')} value={next} onValueChange={setNext} autoComplete="new-password" showStrength />
        <PasswordInput label={t('onboarding.pw.confirm')} value={confirm} onValueChange={setConfirm} autoComplete="new-password" error={confirm && confirm !== next ? t('onboarding.pw.mismatch') : undefined} />
        {needsCode && <TextField label={t('reauth.code')} help={t('reauth.codeHelp')} value={code} onChange={(e) => setCode(e.target.value)} autoComplete="one-time-code" className="secret tracking-widest" maxLength={11} />}
        <p className="text-xs leading-relaxed text-faint">{t('settings.changePasswordNote')}</p>
      </div>
    </Modal>
  );
}

export function SettingsView() {
  const t = useT();
  const prefs = usePrefs();
  const session = useApp((s) => s.session);
  const settings = useApp((s) => s.settings);
  const collections = useApp((s) => s.collections);
  const [pwOpen, setPwOpen] = useState(false);
  const [totpOpen, setTotpOpen] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [quick, setQuick] = useState<{ possible: boolean; enabled: boolean }>({ possible: false, enabled: false });
  const [deviceName, setDeviceName] = useState(session?.device.name ?? '');
  const [storage, setStorage] = useState<{ usage?: number; quota?: number; records: number; snapshots: number } | null>(null);
  const [, force] = useState(0);
  const security = session?.security;

  useEffect(() => {
    if (!session) return;
    void (async () => {
      setQuick({ possible: await isQuickUnlockPossible(), enabled: !!(await getQuickUnlock(getRepo(), session.vaultId)) });
      setStorage(await getRepo().storageEstimate());
    })();
  }, [session]);

  if (!session || !security) return null;
  const refresh = () => force((n) => n + 1);

  /** Security changes require the master password and, if enabled, an Authenticator code. */
  const reauth = (title: string) =>
    requestReauth({
      title,
      withSecondFactor: true,
      run: async (password, code) => {
        await verifyMasterPassword(session, password);
        if (session.security.totp) await verifySecondFactor(session, code);
        return password;
      },
    });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-28 pt-6 sm:px-6 md:pb-10">
        <PageHeader title={t('settings.title')} icon={<SettingsIcon className="size-5" />} />
        <div className="space-y-4">
          <SectionCard title={t('settings.appearance')}>
            <div className="divide-y divide-line">
              <Row icon={<Palette />} title={t('settings.theme')}>
                <Segmented
                  label={t('settings.theme')}
                  value={prefs.theme}
                  onChange={(v) => setPrefs({ theme: v })}
                  size="sm"
                  options={[
                    { value: 'dark', label: t('settings.dark'), icon: <Moon className="size-3.5" /> },
                    { value: 'light', label: t('settings.light'), icon: <Sun className="size-3.5" /> },
                    { value: 'system', label: t('settings.system'), icon: <Monitor className="size-3.5" /> },
                  ]}
                />
              </Row>
              <Row title={t('settings.accent')}>
                <div className="flex gap-2" role="radiogroup" aria-label={t('settings.accent')}>
                  {ACCENTS.map((a) => (
                    <button
                      key={a.value}
                      type="button"
                      role="radio"
                      aria-checked={prefs.accent === a.value}
                      aria-label={a.value}
                      onClick={() => setPrefs({ accent: a.value })}
                      className={cx('flex size-8 items-center justify-center rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110 cursor-pointer', prefs.accent === a.value && 'ring-2 ring-fg')}
                      style={{ backgroundImage: `linear-gradient(135deg, ${a.from}, ${a.to})` }}
                    >
                      {prefs.accent === a.value && <Check className="size-4 text-black/70" />}
                    </button>
                  ))}
                </div>
              </Row>
              <Row icon={<Languages />} title={t('settings.language')}>
                <Segmented label={t('settings.language')} value={prefs.lang} onChange={(v) => setPrefs({ lang: v })} size="sm" options={[{ value: 'en', label: 'English' }, { value: 'ms', label: 'Bahasa Melayu' }]} />
              </Row>
              <Row title={t('settings.motion')} description={t('settings.motionHelp')}>
                <Segmented
                  label={t('settings.motion')}
                  value={prefs.motion}
                  onChange={(v) => setPrefs({ motion: v })}
                  size="sm"
                  options={[
                    { value: 'system', label: t('settings.system') },
                    { value: 'full', label: t('settings.motionFull') },
                    { value: 'reduced', label: t('settings.motionReduced') },
                  ]}
                />
              </Row>
              <Row title={t('settings.density')}>
                <Segmented
                  label={t('settings.density')}
                  value={prefs.density}
                  onChange={(v) => setPrefs({ density: v })}
                  size="sm"
                  options={[
                    { value: 'comfortable', label: t('settings.comfortable') },
                    { value: 'compact', label: t('settings.compact') },
                  ]}
                />
              </Row>
            </div>
          </SectionCard>

          <SectionCard title={t('settings.security')}>
            <div className="divide-y divide-line">
              <Row icon={<KeyRound />} title={t('settings.masterPassword')} description={t('settings.passwordChangedAt', { date: formatDate(security.passwordChangedAt) })}>
                <Button size="sm" onClick={() => setPwOpen(true)}>
                  {t('settings.changePassword')}
                </Button>
              </Row>
              <Row
                icon={<Smartphone />}
                title={
                  <span className="flex items-center gap-2">
                    {t('settings.totp')} {security.totp ? <Badge tone="success">{t('settings.on')}</Badge> : <Badge>{t('settings.off')}</Badge>}
                  </span>
                }
                description={security.totp ? t('settings.totpOnHelp', { date: formatDate(security.totp.enrolledAt) }) : t('settings.totpOffHelp')}
              >
                {security.totp ? (
                  <>
                    <Button
                      size="sm"
                      onClick={async () => {
                        if (!(await reauth(t('settings.totpReplace')))) return;
                        await disableTotp(session);
                        setTotpOpen(true);
                      }}
                    >
                      {t('settings.totpReplace')}
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        const ok = await confirmDialog({ title: t('settings.totpDisable'), message: t('settings.totpDisableConfirm'), confirmLabel: t('settings.totpDisable'), danger: true });
                        if (!ok || !(await reauth(t('settings.totpDisable')))) return;
                        await disableTotp(session);
                        toast(t('settings.totpDisabled'));
                        refresh();
                      }}
                    >
                      {t('settings.totpDisable')}
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="subtle"
                    onClick={async () => {
                      if (await reauth(t('settings.totpEnable'))) setTotpOpen(true);
                    }}
                  >
                    {t('settings.totpEnable')}
                  </Button>
                )}
              </Row>
              {security.totp && (
                <Row icon={<LifeBuoy />} title={t('settings.recoveryCodes')} description={t('settings.recoveryCodesHelp', { n: security.recoveryCodeHashes.length })}>
                  <Button
                    size="sm"
                    onClick={async () => {
                      if (!(await reauth(t('settings.regenerateCodes')))) return;
                      setCodes(await regenerateRecoveryCodes(session));
                    }}
                  >
                    {t('settings.regenerateCodes')}
                  </Button>
                </Row>
              )}
              <Row
                icon={<LifeBuoy />}
                title={
                  <span className="flex items-center gap-2">
                    {t('settings.recoveryKey')} {security.recoveryKeyCreatedAt ? <Badge tone="success">{t('settings.on')}</Badge> : <Badge tone="warning">{t('settings.off')}</Badge>}
                  </span>
                }
                description={security.recoveryKeyCreatedAt ? t('settings.recoveryKeyOn', { date: formatDate(security.recoveryKeyCreatedAt) }) : t('settings.recoveryKeyOff')}
              >
                <Button
                  size="sm"
                  variant={security.recoveryKeyCreatedAt ? 'secondary' : 'subtle'}
                  onClick={async () => {
                    const pw = await reauth(t('settings.recoveryKeyCreate'));
                    if (!pw) return;
                    try {
                      setRecoveryKey(await createRecoveryKey(session, pw));
                    } catch (e) {
                      toastError(e);
                    }
                  }}
                >
                  {security.recoveryKeyCreatedAt ? t('settings.recoveryKeyReplace') : t('settings.recoveryKeyCreate')}
                </Button>
                {security.recoveryKeyCreatedAt && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      const ok = await confirmDialog({ title: t('settings.recoveryKeyRemove'), message: t('settings.recoveryKeyRemoveConfirm'), confirmLabel: t('settings.recoveryKeyRemove'), danger: true });
                      if (!ok || !(await reauth(t('settings.recoveryKeyRemove')))) return;
                      await removeRecoveryKey(session);
                      refresh();
                    }}
                  >
                    {t('settings.recoveryKeyRemove')}
                  </Button>
                )}
              </Row>
              <Row
                icon={<FingerprintPattern />}
                title={
                  <span className="flex items-center gap-2">
                    {t('settings.quickUnlock')} {quick.enabled && <Badge tone="success">{t('settings.on')}</Badge>}
                  </span>
                }
                description={quick.possible ? t('settings.quickUnlockHelp') : t('settings.quickUnlockUnavailable')}
              >
                {quick.enabled ? (
                  <Button
                    size="sm"
                    onClick={async () => {
                      await disableQuickUnlock(getRepo(), session.vaultId);
                      setQuick((q) => ({ ...q, enabled: false }));
                      toast(t('settings.quickUnlockOff'));
                    }}
                  >
                    {t('settings.disable')}
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="subtle"
                    disabled={!quick.possible}
                    onClick={async () => {
                      const ok = await requestReauth({
                        title: t('settings.quickUnlock'),
                        description: t('settings.quickUnlockReauth'),
                        run: async (pw) => {
                          await enableQuickUnlock(session, pw);
                          return true;
                        },
                      }).catch((e) => {
                        toast(e instanceof QuickUnlockUnsupportedError ? e.message : String(e), { kind: 'error' });
                        return null;
                      });
                      if (ok) {
                        setQuick((q) => ({ ...q, enabled: true }));
                        toast(t('settings.quickUnlockOn'));
                      }
                    }}
                  >
                    {t('settings.enable')}
                  </Button>
                )}
              </Row>
            </div>
          </SectionCard>

          <SectionCard title={t('settings.locking')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label={t('settings.autoLock')}
                value={String(prefs.autoLockMinutes)}
                onChange={(e) => setPrefs({ autoLockMinutes: Number(e.target.value) })}
                options={[1, 2, 5, 10, 15, 30, 60, 0].map((m) => ({ value: String(m), label: m === 0 ? t('settings.never') : t('settings.minutes', { n: m }) }))}
                help={t('settings.autoLockHelp')}
              />
              <SelectField
                label={t('settings.lockHidden')}
                value={String(prefs.lockOnHiddenSeconds)}
                onChange={(e) => setPrefs({ lockOnHiddenSeconds: Number(e.target.value) })}
                options={[
                  { value: '0', label: t('settings.immediately') },
                  { value: '30', label: t('settings.seconds', { n: 30 }) },
                  { value: '60', label: t('settings.minutes', { n: 1 }) },
                  { value: '300', label: t('settings.minutes', { n: 5 }) },
                  { value: '-1', label: t('settings.never') },
                ]}
                help={t('settings.lockHiddenHelp')}
              />
              <SelectField
                label={t('settings.revealTimeout')}
                value={String(prefs.revealSeconds)}
                onChange={(e) => setPrefs({ revealSeconds: Number(e.target.value) })}
                options={[10, 20, 30, 60, 0].map((s) => ({ value: String(s), label: s === 0 ? t('settings.untilHidden') : t('settings.seconds', { n: s }) }))}
              />
              <SelectField
                label={t('settings.clipboard')}
                value={String(prefs.clipboardClearSeconds)}
                onChange={(e) => setPrefs({ clipboardClearSeconds: Number(e.target.value) })}
                options={[15, 30, 60, 120, 0].map((s) => ({ value: String(s), label: s === 0 ? t('settings.never') : t('settings.seconds', { n: s }) }))}
              />
            </div>
            <div className="mt-3">
              <Switch checked={prefs.clipboardForceClear} onChange={(v) => setPrefs({ clipboardForceClear: v })} label={t('settings.clipboardForce')} description={t('settings.clipboardHelp')} />
            </div>
            <div className="mt-3 border-t border-line pt-4">
              <Button icon={<LockKeyhole className="size-4" />} onClick={() => lock('manual')}>
                {t('action.lockNow')}
              </Button>
            </div>
          </SectionCard>

          <SectionCard title={t('settings.vault')}>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label={t('settings.defaultCategory')}
                value={settings.defaultCategoryId ?? ''}
                onChange={(e) => void session.saveSettings({ defaultCategoryId: e.target.value || null })}
                options={[{ value: '', label: t('field.none') }, ...collections.filter((c) => c.kind === 'category').map((c) => ({ value: c.id, label: c.name }))]}
              />
              <SelectField
                label={t('settings.history')}
                value={String(settings.passwordHistoryLimit)}
                onChange={async (e) => {
                  const n = Number(e.target.value);
                  if (n === 0 && settings.passwordHistoryLimit > 0) {
                    const ok = await confirmDialog({ title: t('settings.historyOff'), message: t('settings.historyOffConfirm'), confirmLabel: t('settings.historyOff'), danger: true });
                    if (!ok) return;
                    await session.saveItems(session.items().filter((i) => i.passwordHistory?.length).map((i) => ({ ...i, passwordHistory: [] })));
                  }
                  await session.saveSettings({ passwordHistoryLimit: n });
                }}
                options={[0, 1, 3, 5, 10].map((n) => ({ value: String(n), label: n === 0 ? t('settings.historyDisabled') : t('settings.historyKeep', { n }) }))}
                help={t('settings.historyHelp')}
              />
              <SelectField
                label={t('settings.oldPasswords')}
                value={String(settings.oldPasswordDays)}
                onChange={(e) => void session.saveSettings({ oldPasswordDays: Number(e.target.value) })}
                options={[90, 180, 365, 730].map((d) => ({ value: String(d), label: t('settings.days', { n: d }) }))}
              />
              <SelectField
                label={t('settings.trashRetention')}
                value={String(settings.trashRetentionDays)}
                onChange={(e) => void session.saveSettings({ trashRetentionDays: Number(e.target.value) })}
                options={[7, 30, 90, 0].map((d) => ({ value: String(d), label: d === 0 ? t('settings.keepForever') : t('settings.days', { n: d }) }))}
              />
              <SelectField
                label={t('settings.backupReminder')}
                value={String(prefs.backupReminderDays)}
                onChange={(e) => setPrefs({ backupReminderDays: Number(e.target.value) })}
                options={[7, 14, 30, 90, 0].map((d) => ({ value: String(d), label: d === 0 ? t('settings.never') : t('settings.days', { n: d }) }))}
              />
            </div>
          </SectionCard>

          <SectionCard title={t('settings.data')}>
            <div className="divide-y divide-line">
              <Row title={t('nav.backup')} description={t('settings.backupHelp')}>
                <Button size="sm" onClick={() => navigate({ name: 'backup' })}>
                  {t('settings.open')}
                </Button>
              </Row>
              <Row title={t('nav.sync')} description={t('settings.syncHelp')}>
                <Button size="sm" onClick={() => navigate({ name: 'sync' })}>
                  {t('settings.open')}
                </Button>
              </Row>
              <Row title={t('trash.empty')} description={t('settings.emptyTrashHelp')}>
                <Button size="sm" variant="danger" onClick={() => void emptyTrash()}>
                  {t('trash.empty')}
                </Button>
              </Row>
              <Row title={t('settings.storage')} description={storage ? t('settings.storageValue', { records: storage.records, snapshots: storage.snapshots, used: storage.usage ? `${(storage.usage / 1024 / 1024).toFixed(1)} MB` : '—' }) : '…'} />
              <Row title={t('settings.deviceName')} description={t('settings.deviceNameHelp')}>
                <form
                  className="flex gap-2"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    await renameDevice(getRepo(), deviceName);
                    toast(t('action.saved'));
                  }}
                >
                  <TextField value={deviceName} onChange={(e) => setDeviceName(e.target.value)} aria-label={t('settings.deviceName')} className="h-9 w-40" maxLength={40} />
                  <Button size="sm" type="submit">
                    {t('action.save')}
                  </Button>
                </form>
              </Row>
            </div>
          </SectionCard>

          <SectionCard title={t('settings.about')}>
            <div className="space-y-3 text-sm leading-relaxed text-muted">
              <p className="flex items-center gap-2 text-fg">
                <Info className="size-4 text-accent" />
                MyVault {__APP_VERSION__}
              </p>
              <p>{t('about.security')}</p>
              <p>{t('about.privacy')}</p>
              <p>{t('about.audit')}</p>
              <p>{t('about.license')}</p>
            </div>
          </SectionCard>
        </div>
      </div>

      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
      <Modal open={totpOpen} onClose={() => setTotpOpen(false)} title={t('settings.totpEnable')} size="md" dismissible>
        <TotpEnroll
          session={session}
          onDone={() => {
            setTotpOpen(false);
            refresh();
          }}
          onCancel={() => setTotpOpen(false)}
        />
      </Modal>
      <Modal open={!!codes} onClose={() => setCodes(null)} title={t('recoveryCodes.title')} size="sm">
        {codes && (
          <div className="space-y-4">
            <p className="text-sm text-muted">{t('recoveryCodes.regenerated')}</p>
            <ol className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface-2 p-4 secret text-[15px]">
              {codes.map((c) => (
                <li key={c} className="rounded-lg bg-surface px-3 py-2 text-center text-fg">
                  {c}
                </li>
              ))}
            </ol>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => copyWithFeedback(codes.join('\n'), { secret: true, label: t('recoveryCodes.title') })}>
                {t('action.copy')}
              </Button>
              <Button size="sm" onClick={() => downloadTextFile('myvault-recovery-codes.txt', `${t('recoveryCodes.fileHeader')}\n\n${codes.join('\n')}\n`)}>
                {t('action.download')}
              </Button>
              <Button size="sm" onClick={() => printText(t('recoveryCodes.title'), codes.join('\n'))}>
                {t('action.print')}
              </Button>
            </div>
            <Button variant="primary" block onClick={() => setCodes(null)}>
              {t('action.done')}
            </Button>
          </div>
        )}
      </Modal>
      <Modal open={!!recoveryKey} onClose={() => setRecoveryKey(null)} title={t('recoveryKey.title')} size="md" dismissible={false}>
        {recoveryKey && (
          <RecoveryKeyDisplay
            recoveryKey={recoveryKey}
            onDone={() => {
              setRecoveryKey(null);
              refresh();
            }}
          />
        )}
      </Modal>
    </div>
  );
}
