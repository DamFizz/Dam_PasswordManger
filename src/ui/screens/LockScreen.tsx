import { useEffect, useState } from 'react';
import { FingerprintPattern, KeyRound, LifeBuoy, LockKeyhole, Smartphone } from 'lucide-react';
import { useT } from '../../i18n';
import { isAcceptableMasterPassword } from '../../lib/strength';
import { app, attachSession, getRepo, startRecoveryUnlock, startUnlock, useApp } from '../../state/app';
import { confirmDialog, toast } from '../../state/ui';
import { InvalidCodeError, WrongPasswordError, type SecondFactorChallenge, type UnlockStep } from '../../vault/access';
import { hasSecretKeyOnDevice, SecretKeyRequiredError, WrongSecretKeyError } from '../../vault/secret-key';
import { InvalidSecretKeyError } from '../../vault/keys';
import { usePrefs } from '../../state/prefs-store';
import { Body, ErrorText, Footnote, GlassButton, GlassTextField, InsetGroup, LargeTitle, TextLink, ToggleRow } from '../m/kit';
import { getQuickUnlock, isQuickUnlockPossible, quickUnlock } from '../../vault/quick-unlock';
import { getThrottleState, ThrottledError } from '../../vault/throttle';
import { Button } from '../components/Button';
import { TextField } from '../components/Field';
import { Modal } from '../components/Modal';
import { PasswordInput } from '../components/Secret';
import { cx } from '../cx';
import { RestoreFromFile } from './Onboarding';
import { codeErrorText } from '../code-errors';

function useCountdown(until: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

/** After a correct two-step code, this device can skip the code for this long. */
const TRUST_DAYS = 30;

export function LockScreen() {
  const t = useT();
  const { displayName } = usePrefs();
  const lockReason = useApp((s) => s.lockReason);
  const [password, setPassword] = useState('');
  const [secretKey, setSecretKey] = useState('');
  const [rememberSk, setRememberSk] = useState(true);
  const [needsSecretKey, setNeedsSecretKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [challenge, setChallenge] = useState<SecondFactorChallenge | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [trustDevice, setTrustDevice] = useState(true);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [quick, setQuick] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const remaining = useCountdown(lockedUntil);

  useEffect(() => {
    void (async () => {
      const s = await getThrottleState(getRepo());
      if (s.lockedUntil > Date.now()) setLockedUntil(s.lockedUntil);
      const header = await getRepo().getHeader();
      if (header?.secretKey && !(await hasSecretKeyOnDevice(getRepo(), header))) setNeedsSecretKey(true);
      if (header && (await getQuickUnlock(getRepo(), header.vaultId)) && (await isQuickUnlockPossible())) setQuick(true);
    })();
  }, []);

  useEffect(() => () => challenge?.cancel(), [challenge]);

  const fail = (e: unknown) => {
    setShake((n) => n + 1);
    if (e instanceof WrongPasswordError) setError(t('lock.wrongPassword'));
    else if (e instanceof SecretKeyRequiredError) {
      setNeedsSecretKey(true);
      setError(t('a.err_secret_key_required'));
    } else if (e instanceof WrongSecretKeyError || e instanceof InvalidSecretKeyError) setError(t('a.err_wrong_secret_key'));
    else if (e instanceof InvalidCodeError) setError(codeErrorText(e, t, useRecovery ? 'lock.wrongRecoveryCode' : 'lock.wrongCode'));
    else if (e instanceof ThrottledError) {
      setLockedUntil(e.retryAt);
      setError(null);
    } else setError(e instanceof Error ? e.message : String(e));
    void getThrottleState(getRepo()).then((s) => s.lockedUntil > Date.now() && setLockedUntil(s.lockedUntil));
  };

  const handleStep = async (step: UnlockStep) => {
    if (step.type === 'unlocked') {
      setPassword('');
      await attachSession(step.session);
      return;
    }
    setChallenge(step.challenge);
    setCode('');
  };

  const unlock = async () => {
    if (!password || busy || remaining > 0) return;
    setBusy(true);
    setError(null);
    try {
      await handleStep(await startUnlock(password, needsSecretKey ? { secretKey: secretKey.trim() || undefined, rememberSecretKey: rememberSk } : {}));
      setPassword('');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (value = code) => {
    if (!challenge || busy) return;
    setBusy(true);
    setError(null);
    try {
      const session = useRecovery ? await challenge.useRecoveryCode(value) : await challenge.verifyTotp(value, trustDevice ? TRUST_DAYS : 0);
      setChallenge(null);
      await attachSession(session);
      if (useRecovery) toast(t('lock.recoveryCodeUsed', { n: session.security.recoveryCodeHashes.length }), { kind: 'info', duration: 8000 });
    } catch (e) {
      setCode('');
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const reasonText =
    lockReason === 'idle'
      ? t('lock.reason.idle')
      : lockReason === 'hidden'
        ? t('lock.reason.hidden')
        : lockReason === 'downloaded'
          ? t('a.lock_downloaded')
          : lockReason === 'restored'
            ? t('lock.reason.restored')
            : null;
  const name = displayName.trim();

  return (
    <div className="h-full overflow-y-auto">
      <div key={shake} className={cx('mx-auto flex min-h-full w-full max-w-[460px] flex-col gap-3.5 px-6 pb-10 pt-[calc(env(safe-area-inset-top)+72px)]', shake > 0 && 'animate-shake')}>
        <span className="glass flex size-[88px] items-center justify-center rounded-full text-accent">
          {challenge ? <Smartphone className="size-10" /> : <LockKeyhole className="size-10" />}
        </span>
        <div className="mt-1.5">
          {challenge ? (
            <LargeTitle>{t('a.twofa_title')}</LargeTitle>
          ) : name ? (
            <>
              <p className="pl-0.5 text-[13px] uppercase tracking-[0.02em] text-faint">{t('a.unlock_title')}</p>
              <LargeTitle>{t('a.welcome_name', { 1: name })}</LargeTitle>
            </>
          ) : (
            <LargeTitle>{t('a.unlock_title')}</LargeTitle>
          )}
          {!challenge && reasonText && <Body className="mt-1">{reasonText}</Body>}
        </div>

        {!challenge ? (
          <form
            className="flex flex-col gap-3.5"
            onSubmit={(e) => {
              e.preventDefault();
              void unlock();
            }}
          >
            {/* A username field helps password managers/OS autofill associate the entry. */}
            <input type="text" name="username" autoComplete="username" value="MyVault" readOnly hidden />
            <GlassTextField value={password} onChange={setPassword} placeholder={t('a.master_password')} secret autoFocus autoComplete="current-password" name="password" disabled={busy || remaining > 0} />
            {needsSecretKey && (
              <>
                <GlassTextField value={secretKey} onChange={(v) => setSecretKey(v.toUpperCase())} placeholder={t('a.secret_key')} mono />
                <Footnote className="px-4">{t('a.secret_key_hint')}</Footnote>
                <InsetGroup>
                  <ToggleRow title={t('lock.rememberSecretKey')} checked={rememberSk} onChange={setRememberSk} />
                </InsetGroup>
              </>
            )}
            <ErrorText>{error}</ErrorText>
            {remaining > 0 && (
              <p role="alert" className="rounded-[16px] bg-warning-soft p-3 text-sm text-warning">
                {t('lock.throttled', { s: remaining })}
              </p>
            )}
            <GlassButton type="submit" block loading={busy} disabled={!password || remaining > 0}>
              {busy ? t('lock.unlocking') : t('a.unlock_button')}
            </GlassButton>
            {quick && (
              <GlassButton
                block
                prominent={false}
                disabled={busy || remaining > 0}
                icon={<FingerprintPattern />}
                onClick={async () => {
                  setBusy(true);
                  setError(null);
                  try {
                    await handleStep(await quickUnlock(getRepo()));
                  } catch (e) {
                    if (e instanceof DOMException && e.name === 'NotAllowedError') setError(t('lock.quickCancelled'));
                    else fail(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('lock.quickUnlock')}
              </GlassButton>
            )}
            <TextLink onClick={() => setForgotOpen(true)}>{t('a.forgot_password')}</TextLink>
          </form>
        ) : (
          <div className="flex flex-col gap-3.5">
            {useRecovery ? (
              <form
                className="flex flex-col gap-3.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  void verifyCode();
                }}
              >
                <GlassTextField value={code} onChange={(v) => setCode(v.toUpperCase().slice(0, 11))} placeholder={t('a.twofa_recovery_code')} mono autoFocus />
                <Footnote className="px-4">{t('a.twofa_codes_left', { 1: challenge.recoveryCodesLeft })}</Footnote>
                <ErrorText>{error}</ErrorText>
                <GlassButton type="submit" block loading={busy} disabled={code.replace(/[^A-Z2-7]/gi, '').length < 10}>
                  {t('a.twofa_recovery_button')}
                </GlassButton>
              </form>
            ) : (
              <>
                <Body>{t('a.twofa_body')}</Body>
                <GlassTextField
                  value={code}
                  onChange={(v) => {
                    const c = v.replace(/\D/g, '').slice(0, 6);
                    setCode(c);
                    if (c.length === 6) void verifyCode(c);
                  }}
                  placeholder={t('a.twofa_code')}
                  mono
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  autoFocus
                  disabled={busy || remaining > 0}
                  onDone={() => code.length === 6 && void verifyCode()}
                />
                <InsetGroup>
                  <ToggleRow title={t('lock.trustDevice', { n: TRUST_DAYS })} checked={trustDevice} onChange={setTrustDevice} />
                </InsetGroup>
                <ErrorText>{error}</ErrorText>
                <GlassButton block loading={busy} disabled={code.length !== 6 || remaining > 0} onClick={() => void verifyCode()}>
                  {t('a.twofa_verify')}
                </GlassButton>
              </>
            )}
            {remaining > 0 && (
              <p role="alert" className="rounded-[16px] bg-warning-soft p-3 text-sm text-warning">
                {t('lock.throttled', { s: remaining })}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TextLink
                tone="muted"
                onClick={() => {
                  challenge.cancel();
                  setChallenge(null);
                  setUseRecovery(false);
                  setError(null);
                }}
              >
                {t('a.back')}
              </TextLink>
              <TextLink
                onClick={() => {
                  setUseRecovery((v) => !v);
                  setCode('');
                  setError(null);
                }}
              >
                {useRecovery ? t('lock.useAuthenticator') : t('a.twofa_use_recovery')}
              </TextLink>
            </div>
          </div>
        )}
        <p className="mt-auto pt-8 text-center text-xs text-faint">{t('lock.footer')}</p>
      </div>
      <ForgotPasswordDialog open={forgotOpen} onClose={() => setForgotOpen(false)} onStep={handleStep} />
    </div>
  );
}

function ForgotPasswordDialog({ open, onClose, onStep }: { open: boolean; onClose: () => void; onStep: (s: UnlockStep) => Promise<void> }) {
  const t = useT();
  const [mode, setMode] = useState<'menu' | 'key' | 'backup'>('menu');
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setMode('menu');
    setKey('');
    setPw('');
    setPw2('');
    setError(null);
    void getRepo()
      .getHeader()
      .then((h) => setHasKey(!!h?.recoveryWrap));
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title={t('forgot.title')} size="md">
      {mode === 'menu' && (
        <div className="space-y-4">
          <p className="text-sm leading-relaxed text-muted">{t('forgot.explain')}</p>
          <div className="space-y-2">
            <button
              type="button"
              disabled={!hasKey}
              onClick={() => setMode('key')}
              className="flex w-full items-start gap-3 rounded-xl border border-line bg-surface-2 p-4 text-left hover:border-accent/50 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <KeyRound className="mt-0.5 size-5 shrink-0 text-accent" />
              <div>
                <p className="font-medium text-fg">{t('forgot.useKey')}</p>
                <p className="mt-0.5 text-sm text-muted">{hasKey ? t('forgot.useKeyBody') : t('forgot.noKey')}</p>
              </div>
            </button>
            <button type="button" onClick={() => setMode('backup')} className="flex w-full items-start gap-3 rounded-xl border border-line bg-surface-2 p-4 text-left hover:border-accent/50 cursor-pointer">
              <LifeBuoy className="mt-0.5 size-5 shrink-0 text-accent" />
              <div>
                <p className="font-medium text-fg">{t('forgot.useBackup')}</p>
                <p className="mt-0.5 text-sm text-muted">{t('forgot.useBackupBody')}</p>
              </div>
            </button>
          </div>
          <div className="rounded-xl border border-danger/30 bg-danger-soft p-4 text-sm text-fg">
            <p>{t('forgot.noBackdoor')}</p>
            <button
              type="button"
              className="mt-3 font-medium text-danger hover:underline cursor-pointer"
              onClick={async () => {
                const ok = await confirmDialog({
                  title: t('forgot.reset.title'),
                  message: t('forgot.reset.message'),
                  confirmLabel: t('forgot.reset.confirm'),
                  danger: true,
                  acknowledge: t('forgot.reset.ack'),
                });
                if (!ok) return;
                await getRepo().wipeAll();
                onClose();
                app.set({ phase: 'welcome', lockReason: null });
                toast(t('forgot.reset.done'), { kind: 'info' });
              }}
            >
              {t('forgot.reset.button')}
            </button>
          </div>
        </div>
      )}
      {mode === 'key' && (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pw !== pw2 || !isAcceptableMasterPassword(pw)) return;
            setBusy(true);
            setError(null);
            try {
              const step = await startRecoveryUnlock(key, pw);
              onClose();
              await onStep(step);
              toast(t('forgot.passwordReset'), { duration: 6000 });
            } catch (err) {
              setError(err instanceof ThrottledError ? t('lock.throttled', { s: Math.ceil((err.retryAt - Date.now()) / 1000) }) : err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <TextField label={t('forgot.keyLabel')} value={key} onChange={(e) => setKey(e.target.value)} placeholder="XXXX-XXXX-XXXX-…" className="secret" autoComplete="off" autoFocus />
          <PasswordInput label={t('forgot.newPassword')} value={pw} onValueChange={setPw} showStrength autoComplete="new-password" />
          <PasswordInput label={t('onboarding.pw.confirm')} value={pw2} onValueChange={setPw2} autoComplete="new-password" error={pw2 && pw !== pw2 ? t('onboarding.pw.mismatch') : undefined} />
          {error && (
            <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setMode('menu')}>
              {t('action.back')}
            </Button>
            <Button type="submit" variant="primary" loading={busy} disabled={!key || !pw || pw !== pw2 || !isAcceptableMasterPassword(pw)}>
              {t('forgot.resetPassword')}
            </Button>
          </div>
        </form>
      )}
      {mode === 'backup' && (
        <div>
          <RestoreFromFile
            onRestored={() => {
              onClose();
              app.set({ phase: 'locked', lockReason: 'restored' });
              toast(t('backup.restoredUnlock'), { kind: 'info', duration: 6000 });
            }}
          />
          <Button variant="ghost" className="mt-4" onClick={() => setMode('menu')}>
            {t('action.back')}
          </Button>
        </div>
      )}
    </Modal>
  );
}
