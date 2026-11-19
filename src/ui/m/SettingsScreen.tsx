/**
 * Settings (Android SettingsScreens.SettingsTab), opened from the profile button:
 * Appearance (name on lock screen, theme, background, accent, motion, reduce transparency,
 * increase contrast, language) · Security (master password, Authenticator, recovery codes,
 * recovery key, Secret Key, device unlock, trusted device) · Locking · Vault · This device · About.
 */
import { useEffect, useState, type ReactNode } from 'react';
import {
  Archive,
  CloudCog,
  Copy,
  DatabaseBackup,
  Fingerprint,
  Folder,
  Globe,
  Image as ImageIcon,
  ImagePlus,
  Key,
  KeyRound,
  Moon,
  Palette,
  QrCode,
  RectangleEllipsis,
  ShieldCheck,
  Smartphone,
  Trash2,
  User,
  Wallpaper as WallpaperIcon,
} from 'lucide-react';
import { formatDate, useT } from '../../i18n';
import { isAcceptableMasterPassword } from '../../lib/strength';
import { getRepo, navigate, useApp } from '../../state/app';
import { setPrefs, usePrefs } from '../../state/prefs-store';
import { WALLPAPERS, type Accent, type Wallpaper } from '../../state/prefs';
import { useSync } from '../../state/sync-controller';
import { confirmDialog, requestReauth, toast, toastError } from '../../state/ui';
import {
  changeMasterPassword,
  createRecoveryKey,
  currentSecretKey,
  deviceTrustedUntil,
  disableSecretKey,
  disableTotp,
  enableSecretKey,
  forgetDeviceTrust,
  regenerateRecoveryCodes,
  removeRecoveryKey,
  verifyMasterPassword,
  verifySecondFactor,
} from '../../vault/access';
import { renameDevice } from '../../vault/device';
import { formatSecretKey, generateSecretKey, secretKeyQrPayload } from '../../vault/keys';
import { disableQuickUnlock, enableQuickUnlock, getQuickUnlock, isQuickUnlockPossible, QuickUnlockUnsupportedError } from '../../vault/quick-unlock';
import { Modal } from '../components/Modal';
import { copyWithFeedback } from '../components/Secret';
import { cx } from '../cx';
import { TotpEnroll } from '../screens/TotpEnroll';
import { Body, CheckMark, Chevron, Column, ErrorText, Footnote, GlassButton, GlassTextField, GlassToggle, GroupDivider, Headline, IconTile, InsetGroup, LargeTitle, ListRow, SectionHeader, Stack, ToggleRow } from './kit';
import { PushedScreen } from './Shell';
import { StrengthBar } from './GeneratorTab';
import { hasWallpaperPhoto, setWallpaperPhoto } from './Wallpaper';

const ACCENTS: { value: Accent; light: string; dark: string }[] = [
  { value: 'blue', light: '#5b7cfa', dark: '#7c9cff' },
  { value: 'teal', light: '#0d9488', dark: '#2dd4bf' },
  { value: 'violet', light: '#7c3aed', dark: '#a78bfa' },
  { value: 'emerald', light: '#059669', dark: '#34d399' },
  { value: 'rose', light: '#e11d48', dark: '#fb7185' },
  { value: 'amber', light: '#d97706', dark: '#fbbf24' },
];

const WALL_SWATCH: Record<Exclude<Wallpaper, 'photo'>, [string, string]> = {
  midnight: ['#05070f', '#3b4bdb'],
  graphite: ['#0c0d10', '#464b55'],
  ocean: ['#031017', '#06b6d4'],
  sunset: ['#120812', '#f97316'],
  aurora: ['#070a16', '#6d4dff'],
  plain: ['#0a0b10', '#0a0b10'],
};

type Sheet =
  | ''
  | 'name'
  | 'theme'
  | 'wallpaper'
  | 'motion'
  | 'lang'
  | 'password'
  | 'totpOn'
  | 'rk'
  | 'sk'
  | 'skKit'
  | 'autoLock'
  | 'hidden'
  | 'reveal'
  | 'clip'
  | 'defCat'
  | 'history'
  | 'old'
  | 'trash'
  | 'device';

function ValueRow({ title, value, icon, onClick, inset }: { title: string; value: string; icon?: ReactNode; onClick: () => void; inset?: boolean }) {
  return (
    <ListRow
      title={title}
      leading={icon ? <IconTile icon={<span className="flex size-full [&>svg]:size-full">{icon}</span>} size={34} /> : undefined}
      trailing={
        <>
          <span className="max-w-[48vw] truncate text-[15px] text-muted sm:max-w-[260px]">{value}</span>
          <Chevron />
        </>
      }
      onClick={onClick}
      className={inset ? undefined : undefined}
    />
  );
}

function OptionSheet<T extends string | number | null>({ open, title, options, value, onPick, onClose }: { open: boolean; title: string; options: [T, string][]; value: T; onPick: (v: T) => void; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <InsetGroup className="mb-1">
        {options.map(([v, label], i) => (
          <div key={String(v)}>
            {i > 0 && <GroupDivider />}
            <ListRow
              title={label}
              trailing={<CheckMark on={value === v} />}
              onClick={() => {
                onPick(v);
                onClose();
              }}
            />
          </div>
        ))}
      </InsetGroup>
    </Modal>
  );
}

export function SettingsScreen() {
  const t = useT();
  const prefs = usePrefs();
  const session = useApp((s) => s.session);
  const settings = useApp((s) => s.settings);
  const collections = useApp((s) => s.collections);
  const syncAccount = useSync((s) => s.account);
  const [sheet, setSheet] = useState<Sheet>('');
  const [, force] = useState(0);
  const [quick, setQuick] = useState({ possible: false, enabled: false });
  const [trustedUntil, setTrustedUntil] = useState<number | null>(null);
  const [records, setRecords] = useState(0);
  const [hasPhoto, setHasPhoto] = useState(false);
  const [reveal, setReveal] = useState<{ kind: 'codes' | 'recoveryKey' | 'secretKey'; lines: string[] } | null>(null);
  const close = () => setSheet('');
  const dark = document.documentElement.dataset.theme !== 'light';

  useEffect(() => {
    if (!session) return;
    void (async () => {
      setQuick({ possible: await isQuickUnlockPossible(), enabled: !!(await getQuickUnlock(getRepo(), session.vaultId)) });
      setTrustedUntil(await deviceTrustedUntil(session));
      setRecords((await getRepo().storageEstimate()).records);
      setHasPhoto(await hasWallpaperPhoto());
    })();
  }, [session, sheet]);

  if (!session) return null;
  const security = session.security;
  const hasRecoveryKey = !!session.header.recoveryWrap;
  const hasSecretKey = !!session.header.secretKey;
  const categories = collections.filter((c) => c.kind === 'category');
  const refresh = () => force((n) => n + 1);

  /** Security changes ask for the master password (and the Authenticator code when on). */
  const reauth = (title: string, description?: string) =>
    requestReauth({
      title,
      description,
      withSecondFactor: true,
      run: async (password, code) => {
        await verifyMasterPassword(session, password);
        if (session.security.totp) await verifySecondFactor(session, code);
        return password;
      },
    });

  const never = t('a.set_never');
  const mins = (v: number) => (v === 0 ? never : t('a.set_minutes', { 1: v }));
  const secs = (v: number, zero = never) => (v < 0 ? never : v === 0 ? zero : v % 60 === 0 ? t('a.set_minutes', { 1: v / 60 }) : t('a.set_seconds', { 1: v }));
  const days = (v: number, zero: string) => (v === 0 ? zero : t('a.set_days', { 1: v }));
  const themeLabel = prefs.theme === 'dark' ? t('a.set_theme_dark') : prefs.theme === 'light' ? t('a.set_theme_light') : t('a.set_theme_system');
  const motionLabel = prefs.motion === 'reduced' ? t('a.set_motion_reduced') : prefs.motion === 'full' ? t('a.set_motion_full') : t('a.set_theme_system');
  const wallLabel = (w: Wallpaper) => t(`a.bg_${w}` as never);

  return (
    <PushedScreen title={t('a.settings_title')}>
      <Column>
        <Stack gap={10}>
          <LargeTitle className="pb-1.5 pl-1.5">{t('a.settings_title')}</LargeTitle>

          <SectionHeader>{t('a.set_appearance')}</SectionHeader>
          <InsetGroup>
            <ValueRow title={t('a.set_display_name')} value={prefs.displayName.trim() || t('a.set_display_name_none')} icon={<User />} onClick={() => setSheet('name')} />
            <GroupDivider inset={64} />
            <ValueRow title={t('a.set_theme')} value={themeLabel} icon={<Moon />} onClick={() => setSheet('theme')} />
            <GroupDivider inset={64} />
            <ValueRow title={t('a.set_background')} value={wallLabel(prefs.wallpaper)} icon={<WallpaperIcon />} onClick={() => setSheet('wallpaper')} />
            <GroupDivider inset={64} />
            <div className="flex flex-col gap-2.5 px-4 py-3">
              <p className="text-[17px] text-fg">{t('a.set_accent')}</p>
              <div className="flex flex-wrap gap-3" role="radiogroup" aria-label={t('a.set_accent')}>
                {ACCENTS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    role="radio"
                    aria-checked={prefs.accent === a.value}
                    aria-label={a.value}
                    onClick={() => setPrefs({ accent: a.value })}
                    className={cx('size-[34px] rounded-full cursor-pointer', prefs.accent === a.value && 'ring-[3px] ring-fg')}
                    style={{ background: dark ? a.dark : a.light }}
                  />
                ))}
              </div>
            </div>
            <GroupDivider inset={64} />
            <ValueRow title={t('a.set_motion')} value={motionLabel} icon={<Palette />} onClick={() => setSheet('motion')} />
            <GroupDivider />
            <ToggleRow title={t('a.set_reduce_transparency')} subtitle={t('a.set_reduce_transparency_sub')} checked={prefs.reduceTransparency} onChange={(v) => setPrefs({ reduceTransparency: v })} />
            <GroupDivider />
            <ToggleRow title={t('a.set_high_contrast')} checked={prefs.highContrast} onChange={(v) => setPrefs({ highContrast: v })} />
            <GroupDivider inset={64} />
            <ValueRow title={t('a.set_language')} value={prefs.lang === 'ms' ? 'Bahasa Melayu' : 'English'} icon={<Globe />} onClick={() => setSheet('lang')} />
          </InsetGroup>

          <SectionHeader>{t('a.settings_security')}</SectionHeader>
          <InsetGroup>
            <ListRow title={t('a.set_change_password')} leading={<IconTile icon={<RectangleEllipsis className="size-full" />} size={34} />} trailing={<Chevron />} onClick={() => setSheet('password')} />
            <GroupDivider inset={64} />
            <ListRow
              title={t('a.set_totp')}
              subtitle={security.totp ? t('a.set_totp_on') : t('a.set_totp_off')}
              leading={<IconTile icon={<Smartphone className="size-full" />} size={34} />}
              trailing={<GlassToggle checked={!!security.totp} onChange={() => void toggleTotp()} label={t('a.set_totp')} />}
              onClick={() => void toggleTotp()}
            />
            {security.totp && (
              <>
                <GroupDivider inset={64} />
                <ListRow
                  title={t('a.set_recovery_codes')}
                  subtitle={t('a.set_recovery_codes_left', { 1: security.recoveryCodeHashes.length })}
                  leading={<IconTile icon={<KeyRound className="size-full" />} size={34} />}
                  trailing={<Chevron />}
                  onClick={async () => {
                    if (!(await reauth(t('a.set_regenerate_codes'), t('a.set_recovery_codes_left', { 1: security.recoveryCodeHashes.length })))) return;
                    setReveal({ kind: 'codes', lines: await regenerateRecoveryCodes(session) });
                  }}
                />
              </>
            )}
            <GroupDivider inset={64} />
            <ListRow
              title={t('a.set_recovery_key')}
              subtitle={hasRecoveryKey ? t('a.settings_recovery_yes') : t('a.settings_recovery_no')}
              leading={<IconTile icon={<Key className="size-full" />} size={34} />}
              trailing={<Chevron />}
              onClick={() => setSheet('rk')}
            />
            <GroupDivider inset={64} />
            <ListRow title={hasSecretKey ? t('a.settings_secret_key_on') : t('a.settings_secret_key_off')} leading={<IconTile icon={<KeyRound className="size-full" />} size={34} />} trailing={<Chevron />} onClick={() => setSheet('sk')} />
            <GroupDivider inset={64} />
            <ListRow
              title={t('a.settings_biometric')}
              subtitle={quick.enabled ? t('a.settings_biometric_on') : !quick.possible ? t('settings.quickUnlockUnavailable') : undefined}
              leading={<IconTile icon={<Fingerprint className="size-full" />} size={34} />}
              trailing={quick.possible || quick.enabled ? <GlassToggle checked={quick.enabled} onChange={() => void toggleQuick()} label={t('a.settings_biometric')} /> : undefined}
              onClick={quick.possible || quick.enabled ? () => void toggleQuick() : undefined}
            />
            {trustedUntil && (
              <>
                <GroupDivider inset={64} />
                <ListRow
                  title={t('a.settings_trust', { 1: formatDate(trustedUntil) })}
                  subtitle={t('a.settings_trust_forget')}
                  leading={<IconTile icon={<ShieldCheck className="size-full" />} size={34} />}
                  onClick={async () => {
                    await forgetDeviceTrust(session);
                    setTrustedUntil(null);
                    toast(t('settings.trustedDeviceForgotten'));
                  }}
                />
              </>
            )}
          </InsetGroup>
          <Footnote className="px-4">{t('a.set_totp_note')}</Footnote>

          <SectionHeader>{t('a.set_locking')}</SectionHeader>
          <InsetGroup>
            <ValueRow title={t('a.set_auto_lock')} value={mins(prefs.autoLockMinutes)} onClick={() => setSheet('autoLock')} />
            <GroupDivider />
            <ValueRow title={t('a.set_lock_hidden')} value={secs(prefs.lockOnHiddenSeconds, t('a.set_immediately'))} onClick={() => setSheet('hidden')} />
            <GroupDivider />
            <ValueRow title={t('a.set_reveal')} value={secs(prefs.revealSeconds)} onClick={() => setSheet('reveal')} />
            <GroupDivider />
            <ValueRow title={t('a.set_clipboard')} value={secs(prefs.clipboardClearSeconds)} onClick={() => setSheet('clip')} />
          </InsetGroup>

          <SectionHeader>{t('a.set_vault')}</SectionHeader>
          <InsetGroup>
            <ListRow title={t('a.set_organize')} leading={<IconTile icon={<Folder className="size-full" />} size={34} />} trailing={<Chevron />} onClick={() => navigate({ name: 'organize' })} />
            <GroupDivider inset={64} />
            <ListRow title={t('a.nav_archive')} leading={<IconTile icon={<Archive className="size-full" />} size={34} />} trailing={<Chevron />} onClick={() => navigate({ name: 'items', filter: { kind: 'archive' } })} />
            <GroupDivider inset={64} />
            <ListRow title={t('a.nav_trash')} leading={<IconTile icon={<Trash2 className="size-full" />} size={34} />} trailing={<Chevron />} onClick={() => navigate({ name: 'items', filter: { kind: 'trash' } })} />
            <GroupDivider inset={64} />
            <ValueRow title={t('a.set_default_category')} value={categories.find((c) => c.id === settings.defaultCategoryId)?.name ?? t('a.field_none')} onClick={() => setSheet('defCat')} />
            <GroupDivider />
            <ValueRow title={t('a.set_history')} value={settings.passwordHistoryLimit === 0 ? t('a.set_off') : t('a.set_history_keep', { 1: settings.passwordHistoryLimit })} onClick={() => setSheet('history')} />
            <GroupDivider />
            <ValueRow title={t('a.set_old_passwords')} value={days(settings.oldPasswordDays, never)} onClick={() => setSheet('old')} />
            <GroupDivider />
            <ValueRow title={t('a.set_trash_retention')} value={days(settings.trashRetentionDays, t('a.set_keep_forever'))} onClick={() => setSheet('trash')} />
            <GroupDivider />
            <ToggleRow title={t('a.set_reprompt_default')} checked={settings.repromptByDefault} onChange={(v) => void session.saveSettings({ repromptByDefault: v })} />
          </InsetGroup>

          <SectionHeader>{t('a.set_data')}</SectionHeader>
          <InsetGroup>
            <ListRow title={t('a.sync_title')} subtitle={syncAccount?.email ?? undefined} leading={<IconTile icon={<CloudCog className="size-full" />} size={34} />} trailing={<Chevron />} onClick={() => navigate({ name: 'sync' })} />
            <GroupDivider inset={64} />
            <ListRow title={t('a.bk_title')} leading={<IconTile icon={<DatabaseBackup className="size-full" />} size={34} />} trailing={<Chevron />} onClick={() => navigate({ name: 'backup' })} />
            <GroupDivider inset={64} />
            <ValueRow title={t('a.set_device_name')} value={session.device.name} onClick={() => setSheet('device')} />
          </InsetGroup>
          <Footnote className="px-4">{t('a.set_storage', { 1: records })}</Footnote>

          <SectionHeader>{t('a.set_about')}</SectionHeader>
          <Footnote className="px-4 !text-muted">{t('a.set_about_security')}</Footnote>
          <Footnote className="px-4 !text-muted">{t('settings.aboutPrivacyWeb')}</Footnote>
          <Footnote className="px-4">{t('a.settings_version', { 1: __APP_VERSION__ })}</Footnote>

          <InsetGroup className="mt-1.5">
            <ListRow
              title={t('a.settings_wipe')}
              titleClassName="!text-danger"
              onClick={async () => {
                const ok = await confirmDialog({ title: t('a.settings_wipe'), message: t('settings.wipeConfirmWeb'), confirmLabel: t('a.settings_wipe_yes'), danger: true });
                if (!ok) return;
                await getRepo().wipeAll();
                location.reload();
              }}
            />
          </InsetGroup>
        </Stack>
      </Column>

      {/* ---- option sheets */}
      <NameSheet open={sheet === 'name'} onClose={close} />
      <OptionSheet open={sheet === 'theme'} title={t('a.set_theme')} value={prefs.theme} onPick={(v) => setPrefs({ theme: v })} onClose={close} options={[['system', t('a.set_theme_system')], ['light', t('a.set_theme_light')], ['dark', t('a.set_theme_dark')]]} />
      <OptionSheet open={sheet === 'motion'} title={t('a.set_motion')} value={prefs.motion} onPick={(v) => setPrefs({ motion: v })} onClose={close} options={[['system', t('a.set_theme_system')], ['reduced', t('a.set_motion_reduced')], ['full', t('a.set_motion_full')]]} />
      <OptionSheet open={sheet === 'lang'} title={t('a.set_language')} value={prefs.lang} onPick={(v) => setPrefs({ lang: v })} onClose={close} options={[['en', 'English'], ['ms', 'Bahasa Melayu']]} />
      <OptionSheet open={sheet === 'autoLock'} title={t('a.set_auto_lock')} value={prefs.autoLockMinutes} onPick={(v) => setPrefs({ autoLockMinutes: v })} onClose={close} options={[1, 5, 10, 30, 60, 0].map((v) => [v, mins(v)] as [number, string])} />
      <OptionSheet open={sheet === 'hidden'} title={t('a.set_lock_hidden')} value={prefs.lockOnHiddenSeconds} onPick={(v) => setPrefs({ lockOnHiddenSeconds: v })} onClose={close} options={[0, 30, 60, 300, -1].map((v) => [v, secs(v, t('a.set_immediately'))] as [number, string])} />
      <OptionSheet open={sheet === 'reveal'} title={t('a.set_reveal')} value={prefs.revealSeconds} onPick={(v) => setPrefs({ revealSeconds: v })} onClose={close} options={[10, 20, 60, 0].map((v) => [v, secs(v)] as [number, string])} />
      <OptionSheet open={sheet === 'clip'} title={t('a.set_clipboard')} value={prefs.clipboardClearSeconds} onPick={(v) => setPrefs({ clipboardClearSeconds: v })} onClose={close} options={[10, 30, 60, 120, 0].map((v) => [v, secs(v)] as [number, string])} />
      <OptionSheet
        open={sheet === 'defCat'}
        title={t('a.set_default_category')}
        value={settings.defaultCategoryId}
        onPick={(v) => void session.saveSettings({ defaultCategoryId: v })}
        onClose={close}
        options={[[null, t('a.field_none')] as [string | null, string], ...categories.map((c) => [c.id, c.name] as [string | null, string])]}
      />
      <OptionSheet
        open={sheet === 'history'}
        title={t('a.set_history')}
        value={settings.passwordHistoryLimit}
        onPick={async (n) => {
          if (n === 0 && settings.passwordHistoryLimit > 0) {
            const ok = await confirmDialog({ title: t('settings.historyOff'), message: t('settings.historyOffConfirm'), confirmLabel: t('settings.historyOff'), danger: true });
            if (!ok) return;
            await session.saveItems(session.items().filter((i) => i.passwordHistory?.length).map((i) => ({ ...i, passwordHistory: [] })));
          }
          await session.saveSettings({ passwordHistoryLimit: n });
        }}
        onClose={close}
        options={[0, 3, 5, 10, 20].map((v) => [v, v === 0 ? t('a.set_off') : t('a.set_history_keep', { 1: v })] as [number, string])}
      />
      <OptionSheet open={sheet === 'old'} title={t('a.set_old_passwords')} value={settings.oldPasswordDays} onPick={(v) => void session.saveSettings({ oldPasswordDays: v })} onClose={close} options={[90, 180, 365, 730].map((v) => [v, days(v, never)] as [number, string])} />
      <OptionSheet open={sheet === 'trash'} title={t('a.set_trash_retention')} value={settings.trashRetentionDays} onPick={(v) => void session.saveSettings({ trashRetentionDays: v })} onClose={close} options={[7, 30, 90, 0].map((v) => [v, days(v, t('a.set_keep_forever'))] as [number, string])} />

      <DeviceSheet open={sheet === 'device'} onClose={close} current={session.device.name} />
      <PasswordChangeSheet open={sheet === 'password'} onClose={close} />
      <WallpaperSheet open={sheet === 'wallpaper'} onClose={close} hasPhoto={hasPhoto} />

      <Modal open={sheet === 'totpOn'} onClose={close} title={t('a.set_totp_enable')} size="md" dismissible>
        <TotpEnroll
          session={session}
          onDone={() => {
            close();
            refresh();
          }}
          onCancel={close}
        />
      </Modal>

      {/* recovery key */}
      <Modal open={sheet === 'rk'} onClose={close} title={t('a.set_recovery_key')} size="sm">
        <div className="flex flex-col gap-3 pb-1">
          <Body>{hasRecoveryKey ? t('a.settings_recovery_yes') : t('a.settings_recovery_no')}</Body>
          <GlassButton block onClick={() => void createRk()}>
            {hasRecoveryKey ? t('a.set_recovery_key_replace') : t('a.set_recovery_key_create')}
          </GlassButton>
          {hasRecoveryKey && (
            <GlassButton
              block
              prominent={false}
              destructive
              onClick={async () => {
                close();
                if (!(await reauth(t('a.set_recovery_key_remove')))) return;
                await removeRecoveryKey(session);
                refresh();
              }}
            >
              {t('a.set_recovery_key_remove')}
            </GlassButton>
          )}
        </div>
      </Modal>

      {/* Secret Key */}
      <Modal open={sheet === 'sk'} onClose={close} title={t('a.sk_title')} size="sm">
        <div className="flex flex-col gap-3 pb-1">
          <Body>{t('a.sk_explain')}</Body>
          {hasSecretKey ? (
            <>
              <GlassButton
                block
                icon={<QrCode />}
                onClick={async () => {
                  close();
                  if (!(await reauth(t('a.sk_show')))) return;
                  const raw = currentSecretKey(session);
                  if (raw) setReveal({ kind: 'secretKey', lines: [await formatSecretKey(raw)] });
                }}
              >
                {t('a.sk_show')}
              </GlassButton>
              <GlassButton block prominent={false} onClick={() => setSheet('skKit')}>
                {t('a.sk_rotate')}
              </GlassButton>
              <GlassButton
                block
                prominent={false}
                destructive
                onClick={async () => {
                  close();
                  const pw = await reauth(t('a.sk_turn_off'), t('a.sk_explain'));
                  if (!pw) return;
                  try {
                    await disableSecretKey(session, pw);
                    toast(t('a.sk_disabled'));
                    refresh();
                  } catch (e) {
                    toastError(e);
                  }
                }}
              >
                {t('a.sk_turn_off')}
              </GlassButton>
            </>
          ) : !hasRecoveryKey ? (
            <>
              <Footnote className="!text-danger">{t('a.sk_needs_recovery')}</Footnote>
              <GlassButton block onClick={() => void createRk()}>
                {t('a.set_recovery_key_create')}
              </GlassButton>
            </>
          ) : (
            <>
              <Footnote className="!text-[var(--star)]">{t('a.sk_web_warning')}</Footnote>
              <GlassButton block onClick={() => setSheet('skKit')}>
                {t('a.sk_turn_on')}
              </GlassButton>
            </>
          )}
        </div>
      </Modal>
      <SecretKeyKit open={sheet === 'skKit'} onClose={close} onDone={refresh} />

      <RevealSheet value={reveal} onClose={() => setReveal(null)} vaultId={session.vaultId} />
    </PushedScreen>
  );

  async function toggleTotp() {
    if (!session) return;
    if (session.security.totp) {
      const ok = await confirmDialog({ title: t('a.set_totp_disable'), message: t('a.set_totp_note'), confirmLabel: t('a.set_totp_disable'), danger: true });
      if (!ok || !(await reauth(t('a.set_totp_disable')))) return;
      await disableTotp(session);
      toast(t('settings.totpDisabled'));
      refresh();
    } else if (await reauth(t('a.set_totp_enable'))) {
      setSheet('totpOn');
    }
  }

  async function toggleQuick() {
    if (!session) return;
    if (quick.enabled) {
      await disableQuickUnlock(getRepo(), session.vaultId);
      setQuick((q) => ({ ...q, enabled: false }));
      return;
    }
    const ok = await requestReauth({
      title: t('a.settings_biometric'),
      description: t('a.settings_biometric_body'),
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
      toast(t('a.bio_enabled'));
    }
  }

  async function createRk() {
    if (!session) return;
    close();
    const pw = await reauth(t('a.set_recovery_key_create'), t('a.set_recovery_key_once'));
    if (!pw) return;
    try {
      setReveal({ kind: 'recoveryKey', lines: [await createRecoveryKey(session, pw)] });
      refresh();
    } catch (e) {
      toastError(e);
    }
  }
}

function NameSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { displayName } = usePrefs();
  const [draft, setDraft] = useState(displayName);
  useEffect(() => {
    if (open) setDraft(displayName);
  }, [open, displayName]);
  const save = () => {
    setPrefs({ displayName: draft.trim().slice(0, 40) });
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title={t('a.set_display_name')} size="sm">
      <div className="flex flex-col gap-3 pb-1">
        <Footnote>{t('a.set_display_name_sub')}</Footnote>
        <GlassTextField value={draft} onChange={(v) => setDraft(v.slice(0, 40))} placeholder={t('a.set_display_name_hint')} onDone={save} autoFocus />
        <GlassButton block onClick={save}>
          {t('a.action_save')}
        </GlassButton>
      </div>
    </Modal>
  );
}

function DeviceSheet({ open, onClose, current }: { open: boolean; onClose: () => void; current: string }) {
  const t = useT();
  const [name, setName] = useState(current);
  useEffect(() => {
    if (open) setName(current);
  }, [open, current]);
  return (
    <Modal open={open} onClose={onClose} title={t('a.set_device_name')} size="sm">
      <div className="flex flex-col gap-3 pb-1">
        <Body>{t('a.set_device_name_help')}</Body>
        <GlassTextField value={name} onChange={(v) => setName(v.slice(0, 40))} placeholder={t('a.set_device_name')} />
        <GlassButton
          block
          disabled={!name.trim()}
          onClick={async () => {
            await renameDevice(getRepo(), name);
            toast(t('a.toast_saved'));
            onClose();
          }}
        >
          {t('a.action_save')}
        </GlassButton>
      </div>
    </Modal>
  );
}

function PasswordChangeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const session = useApp((s) => s.session);
  const [cur, setCur] = useState('');
  const [n1, setN1] = useState('');
  const [n2, setN2] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => {
    setCur('');
    setN1('');
    setN2('');
    setCode('');
    setError(null);
  };
  if (!session) return null;
  const needsCode = !!session.security.totp;
  return (
    <Modal
      open={open}
      onClose={() => {
        reset();
        onClose();
      }}
      title={t('a.set_change_password')}
      size="sm"
    >
      <div className="flex flex-col gap-3 pb-1">
        <GlassTextField value={cur} onChange={setCur} placeholder={t('a.set_current_password')} secret />
        <GlassTextField value={n1} onChange={setN1} placeholder={t('a.set_new_password')} secret />
        {n1 && <StrengthBar password={n1} />}
        <GlassTextField value={n2} onChange={setN2} placeholder={t('a.set_confirm_password')} secret />
        {needsCode && <GlassTextField value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder={t('a.twofa_code')} mono inputMode="numeric" />}
        <Footnote>{t('a.set_change_password_note')}</Footnote>
        <ErrorText>{error}</ErrorText>
        <GlassButton
          block
          loading={busy}
          disabled={!cur || !n1 || !n2 || (needsCode && code.length !== 6)}
          onClick={async () => {
            if (n1 !== n2) return setError(t('a.err_password_mismatch'));
            if (!isAcceptableMasterPassword(n1)) return setError(t('a.err_password_weak'));
            setBusy(true);
            try {
              await verifyMasterPassword(session, cur);
              if (needsCode) await verifySecondFactor(session, code);
              await changeMasterPassword(session, cur, n1);
              toast(t('a.settings_password_changed'));
              reset();
              onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('a.set_change_password')}
        </GlassButton>
      </div>
    </Modal>
  );
}

function WallpaperSheet({ open, onClose, hasPhoto }: { open: boolean; onClose: () => void; hasPhoto: boolean }) {
  const t = useT();
  const { wallpaper } = usePrefs();
  const ids = WALLPAPERS.filter((w) => w !== 'photo') as Exclude<Wallpaper, 'photo'>[];
  return (
    <Modal open={open} onClose={onClose} title={t('a.set_background')} size="sm">
      <div className="flex flex-col gap-3 pb-1">
        <InsetGroup>
          {ids.map((id, i) => (
            <div key={id}>
              {i > 0 && <GroupDivider inset={64} />}
              <ListRow
                title={t(`a.bg_${id}` as never)}
                leading={<span aria-hidden className="size-[34px] rounded-[10px] border border-line" style={{ background: `linear-gradient(135deg, ${WALL_SWATCH[id][0]}, ${WALL_SWATCH[id][1]})` }} />}
                trailing={<CheckMark on={wallpaper === id} />}
                onClick={() => {
                  setPrefs({ wallpaper: id });
                  onClose();
                }}
              />
            </div>
          ))}
          {hasPhoto && (
            <>
              <GroupDivider inset={64} />
              <ListRow
                title={t('a.bg_photo')}
                leading={<IconTile icon={<ImageIcon className="size-full" />} size={34} />}
                trailing={<CheckMark on={wallpaper === 'photo'} />}
                onClick={() => {
                  setPrefs({ wallpaper: 'photo' });
                  onClose();
                }}
              />
            </>
          )}
        </InsetGroup>
        <label className="glass-clear lg-wide inline-flex min-h-[52px] w-full cursor-pointer items-center justify-center gap-2 rounded-full px-[22px] py-3.5 text-[17px] font-semibold text-fg">
          <ImagePlus className="size-5" />
          {t('a.bg_choose_photo')}
          <input
            type="file"
            accept="image/*"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                await setWallpaperPhoto(f);
                setPrefs({ wallpaper: 'photo' });
                onClose();
              } catch {
                toast(t('a.space_err_not_image'), { kind: 'error' });
              }
            }}
          />
        </label>
        <Footnote>{t('settings.photoNoteWeb')}</Footnote>
      </div>
    </Modal>
  );
}

/** Emergency Kit: show the new key and its QR, confirm it was saved, then turn it on. */
function SecretKeyKit({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const t = useT();
  const session = useApp((s) => s.session);
  const [key, setKey] = useState<string | null>(null);
  const [qr, setQr] = useState<string | null>(null);
  const [last4, setLast4] = useState('');
  const [pw, setPw] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !session) {
      setKey(null);
      setQr(null);
      setLast4('');
      setPw('');
      setCode('');
      setError(null);
      return;
    }
    void generateSecretKey().then(async ({ display, raw }) => {
      setKey(display);
      setQr(await qrDataUrl(secretKeyQrPayload(session.vaultId, raw)));
    });
  }, [open, session]);
  if (!session) return null;
  const needsCode = !!session.security.totp;
  const ready = !!key && last4 === key.replace(/-/g, '').slice(-4) && !!pw && (!needsCode || code.length === 6);
  return (
    <Modal open={open} onClose={onClose} title={t('a.sk_kit_title')} size="sm">
      {key && (
        <div className="flex flex-col gap-3 pb-1">
          <Body>{t('a.sk_kit_body')}</Body>
          {qr && <img src={qr} alt={t('a.sk_title')} className="mx-auto size-[190px] rounded-[16px] bg-white p-2" />}
          <InsetGroup>
            <p className="break-all p-4 font-mono text-[17px] text-fg select-all">{key}</p>
          </InsetGroup>
          <GlassButton block prominent={false} icon={<Copy />} onClick={() => void copyWithFeedback(key, { secret: true, label: t('a.sk_title') })}>
            {t('a.detail_copy')}
          </GlassButton>
          <GlassTextField value={last4} onChange={(v) => setLast4(v.toUpperCase().slice(0, 4))} placeholder={t('a.sk_confirm_last4')} mono />
          <GlassTextField value={pw} onChange={setPw} placeholder={t('a.master_password')} secret />
          {needsCode && <GlassTextField value={code} onChange={(v) => setCode(v.replace(/\D/g, '').slice(0, 6))} placeholder={t('a.twofa_code')} mono inputMode="numeric" />}
          <ErrorText>{error}</ErrorText>
          <GlassButton
            block
            loading={busy}
            disabled={!ready}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await verifyMasterPassword(session, pw);
                if (needsCode) await verifySecondFactor(session, code);
                await enableSecretKey(session, pw, key);
                toast(t('a.sk_enabled'));
                onDone();
                onClose();
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
                setPw('');
              }
            }}
          >
            {t('a.sk_turn_on')}
          </GlassButton>
        </div>
      )}
    </Modal>
  );
}

async function qrDataUrl(text: string): Promise<string> {
  const { default: QRCode } = await import('qrcode');
  return QRCode.toDataURL(text, { errorCorrectionLevel: 'M', margin: 1, width: 380, color: { dark: '#111113', light: '#ffffff' } });
}

/** One-time secrets (recovery codes, recovery key, Secret Key): shown once, copy, "I have saved it". */
function RevealSheet({ value, onClose, vaultId }: { value: { kind: 'codes' | 'recoveryKey' | 'secretKey'; lines: string[] } | null; onClose: () => void; vaultId: string }) {
  const t = useT();
  const [ack, setAck] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
  useEffect(() => {
    setAck(false);
    setQr(null);
    if (value?.kind === 'secretKey') {
      void import('../../vault/keys').then(async ({ parseSecretKey }) => {
        const { raw } = await parseSecretKey(value.lines[0]!);
        setQr(await qrDataUrl(secretKeyQrPayload(vaultId, raw)));
      });
    }
  }, [value, vaultId]);
  const text = value?.lines.join('\n') ?? '';
  const title = value?.kind === 'recoveryKey' ? t('a.set_recovery_key') : value?.kind === 'codes' ? t('a.set_recovery_codes') : t('a.sk_title');
  return (
    <Modal open={!!value} onClose={() => (ack || value?.kind === 'secretKey') && onClose()} title={title} size="sm" dismissible={ack || value?.kind === 'secretKey'}>
      {value && (
        <div className="flex flex-col gap-3 pb-1">
          <Body>{value.kind === 'recoveryKey' ? t('a.set_recovery_key_once') : value.kind === 'codes' ? t('a.set_codes_once') : t('a.sk_kit_body')}</Body>
          {qr && <img src={qr} alt={t('a.sk_title')} className="mx-auto size-[190px] rounded-[16px] bg-white p-2" />}
          <InsetGroup>
            <pre className="whitespace-pre-wrap break-all p-4 font-mono text-[17px] leading-[26px] text-fg select-all">{text}</pre>
          </InsetGroup>
          <GlassButton block prominent={false} icon={<Copy />} onClick={() => void copyWithFeedback(text, { secret: true, label: title })}>
            {t('a.detail_copy')}
          </GlassButton>
          {value.kind !== 'secretKey' ? (
            <>
              <InsetGroup>
                <ToggleRow title={t('a.set_saved_ack')} checked={ack} onChange={setAck} />
              </InsetGroup>
              <GlassButton block disabled={!ack} onClick={onClose}>
                {t('a.action_done')}
              </GlassButton>
            </>
          ) : (
            <GlassButton block onClick={onClose}>
              {t('a.action_done')}
            </GlassButton>
          )}
          <Headline className="hidden">{title}</Headline>
        </div>
      )}
    </Modal>
  );
}
