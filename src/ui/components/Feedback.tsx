import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CircleAlert, CircleCheck, Info, X } from 'lucide-react';
import { useStore } from '../../state/store';
import { confirmStore, dismissToast, reauthStore, toastStore } from '../../state/ui';
import { useT } from '../../i18n';
import { cx } from '../cx';
import { Button, IconButton } from './Button';
import { Checkbox, TextField } from './Field';
import { Modal } from './Modal';
import { PasswordInput } from './Secret';
import { ThrottledError } from '../../vault/throttle';
import { WrongPasswordError, InvalidCodeError } from '../../vault/access';
import { app } from '../../state/app';

export function Toaster() {
  const toasts = useStore(toastStore, (s) => s.toasts);
  const t = useT();
  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[60] flex flex-col items-center gap-2 px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:items-end md:pb-6 md:pr-6"
      aria-live="polite"
      role="status"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="animate-toast-in pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-2xl border border-line bg-surface-2/95 px-4 py-3 shadow-strong backdrop-blur"
        >
          {toast.kind === 'error' ? (
            <CircleAlert className="size-5 shrink-0 text-danger" aria-hidden />
          ) : toast.kind === 'info' ? (
            <Info className="size-5 shrink-0 text-accent" aria-hidden />
          ) : (
            <CircleCheck className="size-5 shrink-0 text-success" aria-hidden />
          )}
          <p className="min-w-0 flex-1 text-sm text-fg">{toast.message}</p>
          {toast.action && (
            <button
              type="button"
              className="shrink-0 rounded-lg px-2 py-1 text-sm font-semibold text-accent hover:bg-accent-soft cursor-pointer"
              onClick={() => {
                toast.action!.run();
                dismissToast(toast.id);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <IconButton label={t('action.dismiss')} size="sm" className="-mr-2 size-7" onClick={() => dismissToast(toast.id)}>
            <X className="size-3.5" />
          </IconButton>
        </div>
      ))}
    </div>
  );
}

export function ConfirmHost() {
  const req = useStore(confirmStore, (s) => s.request);
  const t = useT();
  const [ack, setAck] = useState(false);
  useEffect(() => setAck(false), [req?.id]);
  return (
    <Modal
      open={!!req}
      onClose={() => req?.resolve(false)}
      title={req?.title}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => req?.resolve(false)}>
            {req?.cancelLabel ?? t('action.cancel')}
          </Button>
          <Button variant={req?.danger ? 'danger' : 'primary'} disabled={!!req?.acknowledge && !ack} onClick={() => req?.resolve(true)} autoFocus={!req?.danger}>
            {req?.confirmLabel ?? t('action.confirm')}
          </Button>
        </>
      }
    >
      <p className="whitespace-pre-line text-[15px] leading-relaxed text-muted">{req?.message}</p>
      {req?.acknowledge && (
        <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3">
          <Checkbox checked={ack} onChange={setAck} label={req.acknowledge} />
        </div>
      )}
    </Modal>
  );
}

export function ReauthHost() {
  const req = useStore(reauthStore, (s) => s.request);
  const t = useT();
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);
  useEffect(() => {
    setPassword('');
    setCode('');
    setError(null);
    setBusy(false);
  }, [req?.id]);
  const needsCode = !!req?.withSecondFactor && !!app.get().session?.security.totp;

  const submit = async () => {
    if (!req || busy) return;
    setBusy(true);
    setError(null);
    try {
      const value = await req.run(password, code.replace(/\s/g, ''));
      setPassword('');
      req.resolve({ ok: true, value });
    } catch (e) {
      setShake((n) => n + 1);
      if (e instanceof WrongPasswordError) setError(t('lock.wrongPassword'));
      else if (e instanceof InvalidCodeError) setError(t('lock.wrongCode'));
      else if (e instanceof ThrottledError) setError(t('lock.throttled', { s: Math.ceil((e.retryAt - Date.now()) / 1000) }));
      else setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={!!req}
      onClose={() => req?.resolve({ ok: false })}
      title={req?.title}
      description={req?.description ?? t('reauth.description')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={() => req?.resolve({ ok: false })}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!password || (needsCode && code.replace(/\s/g, '').length < 6)} onClick={submit}>
            {req?.submitLabel ?? t('action.continue')}
          </Button>
        </>
      }
    >
      <form
        key={shake}
        className={cx('space-y-4', shake > 0 && 'animate-shake')}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <PasswordInput label={t('lock.masterPassword')} value={password} onValueChange={setPassword} autoFocus autoComplete="current-password" error={error ?? undefined} />
        {needsCode && (
          <TextField
            label={t('reauth.code')}
            help={t('reauth.codeHelp')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="text"
            autoComplete="one-time-code"
            className="secret tracking-widest"
            maxLength={11}
          />
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

export function EmptyState({ icon, title, children, action }: { icon: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="animate-fade-in mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center">
      <div className="relative mb-5">
        <div className="absolute inset-0 rounded-3xl bg-accent-gradient opacity-25 blur-2xl" aria-hidden />
        <div className="relative flex size-16 items-center justify-center rounded-3xl border border-line bg-surface-2 text-accent">{icon}</div>
      </div>
      <h3 className="text-lg font-semibold text-fg">{title}</h3>
      {children && <div className="mt-2 text-sm leading-relaxed text-muted">{children}</div>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton', className)} aria-hidden />;
}

/** Six-digit code entry for Authenticator codes. Works with paste and OS one-time-code autofill. */
export function OtpInput({ value, onChange, onComplete, disabled, autoFocus, invalid }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; disabled?: boolean; autoFocus?: boolean; invalid?: boolean }) {
  const t = useT();
  const ref = useRef<HTMLInputElement>(null);
  const digits = value.padEnd(6, ' ').slice(0, 6).split('');
  return (
    <div className="relative mx-auto w-full max-w-xs" onClick={() => ref.current?.focus()}>
      <input
        ref={ref}
        value={value}
        onChange={(e) => {
          const v = e.target.value.replace(/\D/g, '').slice(0, 6);
          onChange(v);
          if (v.length === 6) onComplete?.(v);
        }}
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]*"
        maxLength={6}
        disabled={disabled}
        autoFocus={autoFocus}
        aria-label={t('lock.codeLabel')}
        aria-invalid={invalid || undefined}
        className="otp peer absolute inset-0 h-full w-full cursor-text opacity-0"
      />
      <div className="grid grid-cols-6 gap-2" aria-hidden>
        {digits.map((d, i) => {
          const active = i === Math.min(value.length, 5);
          return (
            <div
              key={i}
              className={cx(
                'flex aspect-[4/5] items-center justify-center rounded-xl border bg-surface-2 secret text-2xl font-semibold transition-colors',
                invalid ? 'border-danger' : active ? 'peer-focus:border-accent border-line-strong' : 'border-line',
                i === 2 && 'mr-2',
              )}
            >
              {d.trim()}
            </div>
          );
        })}
      </div>
    </div>
  );
}
