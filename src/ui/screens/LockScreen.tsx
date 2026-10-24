import { useEffect, useState } from 'react';
import { ArrowLeft, FingerprintPattern, KeyRound, LifeBuoy, LockKeyhole, Smartphone } from 'lucide-react';
import { useT } from '../../i18n';
import { isAcceptableMasterPassword } from '../../lib/strength';
import { app, attachSession, getRepo, startRecoveryUnlock, startUnlock, useApp } from '../../state/app';
import { confirmDialog, toast } from '../../state/ui';
import { InvalidCodeError, WrongPasswordError, type SecondFactorChallenge, type UnlockStep } from '../../vault/access';
import { getQuickUnlock, isQuickUnlockPossible, quickUnlock } from '../../vault/quick-unlock';
import { getThrottleState, ThrottledError } from '../../vault/throttle';
import { Button } from '../components/Button';
import { OtpInput } from '../components/Feedback';
import { TextField } from '../components/Field';
import { Logo } from '../components/Misc';
import { Modal } from '../components/Modal';
import { PasswordInput } from '../components/Secret';
import { cx } from '../cx';
import { RestoreFromFile } from './Onboarding';

function useCountdown(until: number | null): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!until || until <= Date.now()) return;
    const id = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(id);
  }, [until]);
  return until ? Math.max(0, Math.ceil((until - now) / 1000)) : 0;
}

export function LockScreen() {
  const t = useT();
  const lockReason = useApp((s) => s.lockReason);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shake, setShake] = useState(0);
  const [challenge, setChallenge] = useState<SecondFactorChallenge | null>(null);
  const [code, setCode] = useState('');
  const [useRecovery, setUseRecovery] = useState(false);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [quick, setQuick] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const remaining = useCountdown(lockedUntil);

  useEffect(() => {
    void (async () => {
      const s = await getThrottleState(getRepo());
      if (s.lockedUntil > Date.now()) setLockedUntil(s.lockedUntil);
      const header = await getRepo().getHeader();
      if (header && (await getQuickUnlock(getRepo(), header.vaultId)) && (await isQuickUnlockPossible())) setQuick(true);
    })();
  }, []);

  useEffect(() => () => challenge?.cancel(), [challenge]);

  const fail = (e: unknown) => {
    setShake((n) => n + 1);
    if (e instanceof WrongPasswordError) setError(t('lock.wrongPassword'));
    else if (e instanceof InvalidCodeError) setError(e.reason === 'expired' ? t('lock.challengeExpired') : useRecovery ? t('lock.wrongRecoveryCode') : t('lock.wrongCode'));
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
      await handleStep(await startUnlock(password));
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
      const session = useRecovery ? await challenge.useRecoveryCode(value) : await challenge.verifyTotp(value);
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
          ? t('lock.reason.downloaded')
          : lockReason === 'restored'
            ? t('lock.reason.restored')
            : null;

  return (
    <div className="ambient flex min-h-full flex-col items-center justify-center px-4 py-10">
      <div key={shake} className={cx('w-full max-w-sm', shake > 0 && 'animate-shake')}>
        <div className="mb-8 text-center">
          <div className="relative mx-auto mb-5 w-fit">
            <div className="absolute inset-0 scale-125 rounded-full bg-accent-gradient opacity-25 blur-2xl" aria-hidden />
            <Logo className="relative size-16" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{challenge ? t('lock.twoStep') : t('lock.title')}</h1>
          <p className="mt-1.5 text-sm text-muted">{challenge ? (useRecovery ? t('lock.enterRecovery') : t('lock.enterCode')) : (reasonText ?? t('lock.subtitle'))}</p>
        </div>

        <div className="card p-5 sm:p-6">
          {!challenge ? (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void unlock();
              }}
            >
              {/* A username field helps password managers/OS autofill associate the entry. */}
              <input type="text" name="username" autoComplete="username" value="MyVault" readOnly hidden />
              <PasswordInput
                label={t('lock.masterPassword')}
                value={password}
                onValueChange={setPassword}
                autoFocus
                autoComplete="current-password"
                name="password"
                disabled={busy || remaining > 0}
                error={error ?? undefined}
              />
              {remaining > 0 && (
                <p role="alert" className="rounded-xl bg-warning-soft p-3 text-sm text-warning">
                  {t('lock.throttled', { s: remaining })}
                </p>
              )}
              <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!password || remaining > 0} icon={<LockKeyhole className="size-5" />}>
                {busy ? t('lock.unlocking') : t('lock.unlock')}
              </Button>
              {quick && (
                <Button
                  size="lg"
                  block
                  disabled={busy || remaining > 0}
                  icon={<FingerprintPattern className="size-5" />}
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
                </Button>
              )}
            </form>
          ) : (
            <div className="space-y-5">
              {useRecovery ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void verifyCode();
                  }}
                  className="space-y-4"
                >
                  <TextField
                    label={t('lock.recoveryCode')}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="XXXXX-XXXXX"
                    autoFocus
                    autoComplete="off"
                    className="secret tracking-widest"
                    error={error ?? undefined}
                    maxLength={11}
                  />
                  <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={code.replace(/[^A-Z2-7]/gi, '').length < 10}>
                    {t('lock.verify')}
                  </Button>
                </form>
              ) : (
                <>
                  <div className="flex justify-center text-accent">
                    <Smartphone className="size-8" />
                  </div>
                  <OtpInput value={code} onChange={setCode} onComplete={(v) => void verifyCode(v)} autoFocus disabled={busy || remaining > 0} invalid={!!error} />
                  {error && (
                    <p role="alert" className="text-center text-sm text-danger">
                      {error}
                    </p>
                  )}
                  <Button variant="primary" size="lg" block loading={busy} disabled={code.length !== 6 || remaining > 0} onClick={() => void verifyCode()}>
                    {t('lock.verify')}
                  </Button>
                </>
              )}
              {remaining > 0 && (
                <p role="alert" className="rounded-xl bg-warning-soft p-3 text-sm text-warning">
                  {t('lock.throttled', { s: remaining })}
                </p>
              )}
              <div className="flex items-center justify-between gap-2 text-sm">
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-muted hover:text-fg cursor-pointer"
                  onClick={() => {
                    challenge.cancel();
                    setChallenge(null);
                    setUseRecovery(false);
                    setError(null);
                  }}
                >
                  <ArrowLeft className="size-4" /> {t('action.back')}
                </button>
                <button
                  type="button"
                  className="font-medium text-accent hover:underline cursor-pointer"
                  onClick={() => {
                    setUseRecovery((v) => !v);
                    setCode('');
                    setError(null);
                  }}
                >
                  {useRecovery ? t('lock.useAuthenticator') : t('lock.useRecoveryCode', { n: challenge.recoveryCodesLeft })}
                </button>
              </div>
            </div>
          )}
        </div>

        {!challenge && (
          <div className="mt-6 text-center">
            <button type="button" className="text-sm text-muted hover:text-fg hover:underline cursor-pointer" onClick={() => setForgotOpen(true)}>
              {t('lock.forgot')}
            </button>
          </div>
        )}
        <p className="mt-8 text-center text-xs text-faint">{t('lock.footer')}</p>
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
              className="flex w-full items-start gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-left hover:border-accent/50 disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
            >
              <KeyRound className="mt-0.5 size-5 shrink-0 text-accent" />
              <div>
                <p className="font-medium text-fg">{t('forgot.useKey')}</p>
                <p className="mt-0.5 text-sm text-muted">{hasKey ? t('forgot.useKeyBody') : t('forgot.noKey')}</p>
              </div>
            </button>
            <button type="button" onClick={() => setMode('backup')} className="flex w-full items-start gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-left hover:border-accent/50 cursor-pointer">
              <LifeBuoy className="mt-0.5 size-5 shrink-0 text-accent" />
              <div>
                <p className="font-medium text-fg">{t('forgot.useBackup')}</p>
                <p className="mt-0.5 text-sm text-muted">{t('forgot.useBackupBody')}</p>
              </div>
            </button>
          </div>
          <div className="rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-fg">
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
