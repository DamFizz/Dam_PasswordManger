import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, Eye, EyeOff, WandSparkles } from 'lucide-react';
import { copySecret, copyText } from '../../lib/clipboard';
import { estimateStrength } from '../../lib/strength';
import { DEFAULT_PASSWORD_OPTIONS, generatePassword } from '../../lib/generator';
import { useT, t as tt } from '../../i18n';
import { getPrefs, usePrefs } from '../../state/prefs-store';
import { toast } from '../../state/ui';
import { cx } from '../cx';
import { IconButton } from './Button';
import { TextField, type TextFieldProps } from './Field';

/** Fixed-length mask: never reveals the real length of a secret. */
export const MASK = '••••••••••••';

export async function copyWithFeedback(value: string, opts: { secret: boolean; label?: string }): Promise<boolean> {
  try {
    if (opts.secret) {
      const prefs = getPrefs();
      await copySecret(value, {
        clearAfterSeconds: prefs.clipboardClearSeconds,
        forceClear: prefs.clipboardForceClear,
        onClear: (outcome) => {
          if (outcome === 'cleared') toast(tt('clipboard.cleared'), { kind: 'info' });
          else if (outcome === 'unverifiable') toast(tt('clipboard.unverifiable'), { kind: 'info', duration: 5000 });
        },
      });
      const secs = prefs.clipboardClearSeconds;
      toast(secs > 0 ? tt('clipboard.copiedClears', { label: opts.label ?? tt('field.password'), s: secs }) : tt('clipboard.copied', { label: opts.label ?? tt('field.password') }));
    } else {
      await copyText(value);
      toast(tt('clipboard.copied', { label: opts.label ?? tt('clipboard.text') }));
    }
    return true;
  } catch {
    toast(tt('clipboard.failed'), { kind: 'error' });
    return false;
  }
}

export function CopyButton({
  value,
  secret,
  label,
  size = 'sm',
  beforeCopy,
  onCopied,
}: {
  value: string | (() => Promise<string | null>);
  secret: boolean;
  label: string;
  size?: 'sm' | 'md';
  beforeCopy?: () => Promise<boolean>;
  onCopied?: () => void;
}) {
  const t = useT();
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = window.setTimeout(() => setDone(false), 1500);
    return () => window.clearTimeout(id);
  }, [done]);
  return (
    <IconButton
      label={t('action.copyField', { field: label })}
      size={size}
      tone={done ? 'accent' : 'default'}
      onClick={async () => {
        if (beforeCopy && !(await beforeCopy())) return;
        const v = typeof value === 'function' ? await value() : value;
        if (!v) return;
        if (await copyWithFeedback(v, { secret, label })) {
          setDone(true);
          onCopied?.();
        }
      }}
    >
      {done ? <Check className="size-4" /> : <Copy className="size-4" />}
    </IconButton>
  );
}

/**
 * Read-only secret display for the item detail view. Hidden by default; revealing requires a
 * deliberate click (and optional re-authentication). Automatically re-hides after the
 * configured delay and whenever the item changes.
 */
export function SecretValue({
  value,
  label,
  beforeReveal,
  onCopied,
  multiline,
  resetKey,
}: {
  value: string;
  label: string;
  beforeReveal?: () => Promise<boolean>;
  onCopied?: () => void;
  multiline?: boolean;
  resetKey?: string;
}) {
  const t = useT();
  const prefs = usePrefs();
  const [shown, setShown] = useState(false);
  useEffect(() => setShown(false), [resetKey, value]);
  useEffect(() => {
    if (!shown || prefs.revealSeconds <= 0) return;
    const id = window.setTimeout(() => setShown(false), prefs.revealSeconds * 1000);
    return () => window.clearTimeout(id);
  }, [shown, prefs.revealSeconds]);
  return (
    <div className="flex items-start gap-1">
      <div
        className={cx('secret min-w-0 flex-1 py-1.5 text-[15px]', shown ? 'text-fg select-text' : 'text-muted select-none mask-dots', multiline && shown ? 'whitespace-pre-wrap break-all' : 'truncate')}
        aria-live="polite"
        aria-label={shown ? undefined : t('secret.hiddenLabel', { field: label })}
      >
        {shown ? value : MASK}
      </div>
      <IconButton
        label={shown ? t('action.hideField', { field: label }) : t('action.showField', { field: label })}
        size="sm"
        aria-pressed={shown}
        onClick={async () => {
          if (shown) return setShown(false);
          if (beforeReveal && !(await beforeReveal())) return;
          setShown(true);
        }}
      >
        {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </IconButton>
      <CopyButton value={value} secret label={label} beforeCopy={beforeReveal} onCopied={onCopied} />
    </div>
  );
}

const strengthColors = ['bg-danger', 'bg-danger', 'bg-warning', 'bg-success', 'bg-success'];

export function StrengthMeter({ password, bits: overrideBits, className }: { password: string; bits?: number; className?: string }) {
  const t = useT();
  if (!password) return null;
  const r = estimateStrength(password);
  const score = overrideBits !== undefined ? (overrideBits < 28 ? 0 : overrideBits < 40 ? 1 : overrideBits < 60 ? 2 : overrideBits < 80 ? 3 : 4) : r.score;
  const bits = overrideBits ?? r.bits;
  const labels = [t('strength.veryWeak'), t('strength.weak'), t('strength.fair'), t('strength.strong'), t('strength.veryStrong')];
  return (
    <div className={cx('mt-2', className)} aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={cx('h-1.5 flex-1 rounded-full transition-colors duration-300', i <= score ? strengthColors[score] : 'bg-surface-3')} />
        ))}
      </div>
      <div className="mt-1.5 flex justify-between text-xs">
        <span className={cx('font-medium', score < 2 ? 'text-danger' : score < 3 ? 'text-warning' : 'text-success')}>{labels[score]}</span>
        <span className="text-faint">{t('strength.bits', { n: Math.round(bits) })}</span>
      </div>
      {overrideBits === undefined && r.warnings.length > 0 && score < 3 && (
        <p className="mt-1 text-xs text-muted">{t(`strength.warn.${r.warnings[0]}` as 'strength.warn.common')}</p>
      )}
    </div>
  );
}

/** Masked input for forms with show/hide, optional generator and strength meter. */
export function PasswordInput({
  value,
  onValueChange,
  showStrength,
  allowGenerate,
  extraTrailing,
  ...rest
}: Omit<TextFieldProps, 'onChange' | 'value' | 'type'> & {
  value: string;
  onValueChange: (v: string) => void;
  showStrength?: boolean;
  allowGenerate?: boolean;
  extraTrailing?: ReactNode;
}) {
  const t = useT();
  const [shown, setShown] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <TextField
        ref={ref}
        {...rest}
        type={shown ? 'text' : 'password'}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        autoComplete={rest.autoComplete ?? 'off'}
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        className={cx('secret', rest.className)}
        trailing={
          <>
            {extraTrailing}
            {allowGenerate && (
              <IconButton
                label={t('generator.generate')}
                size="sm"
                onClick={() => {
                  onValueChange(generatePassword(DEFAULT_PASSWORD_OPTIONS));
                  setShown(true);
                }}
              >
                <WandSparkles className="size-4" />
              </IconButton>
            )}
            <IconButton label={shown ? t('action.hidePassword') : t('action.showPassword')} size="sm" aria-pressed={shown} onClick={() => setShown((s) => !s)}>
              {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </IconButton>
          </>
        }
      />
      {showStrength && <StrengthMeter password={value} />}
    </div>
  );
}
