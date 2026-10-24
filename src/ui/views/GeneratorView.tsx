import { useCallback, useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, RefreshCw, Save, WandSparkles } from 'lucide-react';
import { useT } from '../../i18n';
import {
  DEFAULT_PASSPHRASE_OPTIONS,
  DEFAULT_PASSWORD_OPTIONS,
  generatedPasswordEntropy,
  generatePassphrase,
  generatePassword,
  MAX_LENGTH,
  MIN_LENGTH,
  passphraseEntropy,
  type PassphraseOptions,
  type PasswordOptions,
} from '../../lib/generator';
import { openEditor, saveItem, useApp } from '../../state/app';
import { toast } from '../../state/ui';
import { Button } from '../components/Button';
import { SelectField, Segmented, Switch } from '../components/Field';
import { PageHeader } from '../components/Misc';
import { Modal } from '../components/Modal';
import { copyWithFeedback, StrengthMeter } from '../components/Secret';
import { cx } from '../cx';

const STORE_KEY = 'myvault.generatorOptions';

function loadOptions(): { mode: 'password' | 'passphrase'; pw: PasswordOptions; pp: PassphraseOptions } {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { mode: p.mode ?? 'password', pw: { ...DEFAULT_PASSWORD_OPTIONS, ...p.pw }, pp: { ...DEFAULT_PASSPHRASE_OPTIONS, ...p.pp } };
    }
  } catch {
    /* defaults */
  }
  return { mode: 'password', pw: DEFAULT_PASSWORD_OPTIONS, pp: DEFAULT_PASSPHRASE_OPTIONS };
}

function Colored({ value }: { value: string }) {
  return (
    <>
      {[...value].map((c, i) => (
        <span key={i} className={/[0-9]/.test(c) ? 'text-accent' : /[a-zA-Z]/.test(c) ? 'text-fg' : 'text-warning'}>
          {c}
        </span>
      ))}
    </>
  );
}

export function GeneratorView() {
  const t = useT();
  const initial = loadOptions();
  const [mode, setMode] = useState(initial.mode);
  const [pw, setPw] = useState<PasswordOptions>(initial.pw);
  const [pp, setPp] = useState<PassphraseOptions>(initial.pp);
  const [value, setValue] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const regenerate = useCallback(() => {
    try {
      setError(null);
      setValue(mode === 'password' ? generatePassword(pw) : generatePassphrase(pp));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setValue('');
    }
  }, [mode, pw, pp]);

  useEffect(() => {
    regenerate();
    try {
      // Only the generator *settings* are remembered — never generated values.
      localStorage.setItem(STORE_KEY, JSON.stringify({ mode, pw, pp }));
    } catch {
      /* ignore */
    }
  }, [regenerate, mode, pw, pp]);

  const bits = mode === 'password' ? generatedPasswordEntropy(pw) : passphraseEntropy(pp);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-4 pb-28 pt-6 sm:px-6 md:pb-10">
        <PageHeader title={t('generator.title')} subtitle={t('generator.subtitle')} icon={<WandSparkles className="size-5" />} />

        <section className="card overflow-hidden">
          <div className="relative bg-surface-2/60 p-5 sm:p-6">
            <div className="absolute inset-x-0 top-0 h-1 bg-accent-gradient" aria-hidden />
            <p className="secret min-h-[3.5rem] break-all text-xl leading-relaxed font-medium sm:text-2xl" aria-live="polite" aria-label={t('generator.result')}>
              {value ? <Colored value={value} /> : <span className="text-faint">{error ?? '—'}</span>}
            </p>
            <StrengthMeter password={value} bits={bits} />
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="primary" icon={<Copy className="size-4" />} disabled={!value} onClick={() => copyWithFeedback(value, { secret: true, label: t('generator.result') })}>
                {t('action.copy')}
              </Button>
              <Button icon={<RefreshCw className="size-4" />} onClick={regenerate}>
                {t('generator.regenerate')}
              </Button>
              <Button variant="ghost" icon={<Save className="size-4" />} disabled={!value} onClick={() => setSaveOpen(true)}>
                {t('generator.save')}
              </Button>
            </div>
          </div>

          <div className="space-y-5 p-5 sm:p-6">
            <Segmented
              label={t('generator.type')}
              value={mode}
              onChange={setMode}
              options={[
                { value: 'password', label: t('generator.password') },
                { value: 'passphrase', label: t('generator.passphrase') },
              ]}
            />

            {mode === 'password' ? (
              <>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label htmlFor="gen-length" className="text-sm font-medium text-fg">
                      {t('generator.length')}
                    </label>
                    <input
                      type="number"
                      min={MIN_LENGTH}
                      max={MAX_LENGTH}
                      value={pw.length}
                      onChange={(e) => setPw({ ...pw, length: Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Number(e.target.value) || MIN_LENGTH)) })}
                      aria-label={t('generator.length')}
                      className="h-8 w-16 rounded-lg border border-line bg-surface-2 text-center text-sm tabular-nums text-fg"
                    />
                  </div>
                  <input id="gen-length" type="range" min={MIN_LENGTH} max={64} value={Math.min(pw.length, 64)} onChange={(e) => setPw({ ...pw, length: Number(e.target.value) })} className="mv-range w-full" />
                </div>
                <div className="divide-y divide-line">
                  <Switch checked={pw.upper} onChange={(v) => setPw({ ...pw, upper: v })} label={t('generator.upper')} description="A–Z" />
                  <Switch checked={pw.lower} onChange={(v) => setPw({ ...pw, lower: v })} label={t('generator.lower')} description="a–z" />
                  <Switch checked={pw.digits} onChange={(v) => setPw({ ...pw, digits: v })} label={t('generator.digits')} description="0–9" />
                  <Switch checked={pw.symbols} onChange={(v) => setPw({ ...pw, symbols: v })} label={t('generator.symbols')} description="! @ # $ % ^ & * ( ) - _ = + [ ] { } ; : , . ? / ~" />
                  <Switch checked={pw.excludeAmbiguous} onChange={(v) => setPw({ ...pw, excludeAmbiguous: v })} label={t('generator.ambiguous')} description={t('generator.ambiguousHelp')} />
                  <Switch checked={pw.avoidRepeats} onChange={(v) => setPw({ ...pw, avoidRepeats: v })} label={t('generator.repeats')} description={t('generator.repeatsHelp')} />
                </div>
              </>
            ) : (
              <>
                <div>
                  <div className="mb-2 flex items-center justify-between">
                    <label htmlFor="gen-words" className="text-sm font-medium text-fg">
                      {t('generator.words')}
                    </label>
                    <span className="text-sm tabular-nums text-muted">{pp.words}</span>
                  </div>
                  <input id="gen-words" type="range" min={3} max={12} value={pp.words} onChange={(e) => setPp({ ...pp, words: Number(e.target.value) })} className="mv-range w-full" />
                </div>
                <SelectField
                  label={t('generator.separator')}
                  value={pp.separator}
                  onChange={(e) => setPp({ ...pp, separator: e.target.value })}
                  options={[
                    { value: '-', label: t('generator.sep.hyphen') },
                    { value: ' ', label: t('generator.sep.space') },
                    { value: '.', label: t('generator.sep.period') },
                    { value: '_', label: t('generator.sep.underscore') },
                    { value: ',', label: t('generator.sep.comma') },
                  ]}
                />
                <div className="divide-y divide-line">
                  <Switch checked={pp.capitalize} onChange={(v) => setPp({ ...pp, capitalize: v })} label={t('generator.capitalize')} />
                  <Switch checked={pp.includeNumber} onChange={(v) => setPp({ ...pp, includeNumber: v })} label={t('generator.number')} />
                </div>
                <p className="text-xs leading-relaxed text-faint">{t('generator.wordlistNote')}</p>
              </>
            )}
            <p className="text-xs leading-relaxed text-faint">{t('generator.csprng')}</p>
          </div>
        </section>
      </div>
      <SaveGeneratedDialog open={saveOpen} onClose={() => setSaveOpen(false)} value={value} />
    </div>
  );
}

/** Save a generated password into a new entry or replace the password of an existing login. */
function SaveGeneratedDialog({ open, onClose, value }: { open: boolean; onClose: () => void; value: string }) {
  const t = useT();
  const items = useApp((s) => s.items);
  const [target, setTarget] = useState('');
  const logins = items.filter((i) => i.type === 'login' && !i.trashedAt).sort((a, b) => a.title.localeCompare(b.title));
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('generator.save')}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!target}
            onClick={async () => {
              const item = items.find((i) => i.id === target);
              if (!item) return;
              await saveItem({ ...item, password: value });
              toast(t('generator.savedTo', { title: item.title }));
              onClose();
            }}
          >
            {t('generator.replace')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => {
            onClose();
            openEditor({ mode: 'new', type: 'login', preset: { password: value } });
          }}
          className={cx('flex w-full items-center gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-left hover:border-accent/50 cursor-pointer')}
        >
          <span className="flex size-9 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Plus className="size-4" />
          </span>
          <span className="font-medium text-fg">{t('generator.newEntry')}</span>
        </button>
        <div className="flex items-center gap-3 text-xs uppercase tracking-wider text-faint">
          <span className="h-px flex-1 bg-line" />
          {t('generator.or')}
          <span className="h-px flex-1 bg-line" />
        </div>
        <SelectField
          label={t('generator.existing')}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          options={[{ value: '', label: t('generator.chooseEntry') }, ...logins.map((i) => ({ value: i.id, label: `${i.title}${i.username ? ` — ${i.username}` : ''}` }))]}
        />
        {target && (
          <p className="flex items-start gap-2 text-xs text-muted">
            <KeyRound className="mt-0.5 size-3.5 shrink-0" />
            {t('generator.historyNote')}
          </p>
        )}
      </div>
    </Modal>
  );
}

