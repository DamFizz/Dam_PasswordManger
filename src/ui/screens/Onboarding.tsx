import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Cloud,
  FileUp,
  HardDrive,
  Languages,
} from 'lucide-react';
import { useT } from '../../i18n';
import { isAcceptableMasterPassword } from '../../lib/strength';
import { app, attachSession, createNewVault, getRepo } from '../../state/app';
import { setPrefs, usePrefs } from '../../state/prefs-store';
import { connectGoogle, downloadCloudVault, useClientId } from '../../state/sync-controller';
import { toastError } from '../../state/ui';
import { createRecoveryKey } from '../../vault/access';
import { BackupPasswordError, CorruptBackupError, inspectBackup, openBackup, restoreReplace } from '../../vault/backup';
import type { VaultSession } from '../../vault/session';
import { NoCloudVaultError } from '../../sync/bootstrap';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Field';
import { Logo } from '../components/Misc';
import { PasswordInput } from '../components/Secret';
import { readFileAsText } from '../download';
import { RecoveryKeyDisplay } from './RecoveryKit';
import { GoogleSetupHelp } from './SyncView';

type Step =
  | 'welcome'
  | 'password'
  | 'creating'
  | 'recovery'
  | 'recovery-show'
  | 'restore'
  | 'restore-drive'
  | 'restore-file';

function Shell({ children, onBack, step, total }: { children: ReactNode; onBack?: () => void; step?: number; total?: number }) {
  const t = useT();
  const prefs = usePrefs();
  return (
    <div className="flex min-h-full flex-col">
      <header className="safe-top flex items-center justify-between px-4 py-4 sm:px-8">
        <div className="flex items-center gap-2">
          {onBack ? (
            <Button variant="ghost" size="sm" icon={<ArrowLeft className="size-4" />} onClick={onBack}>
              {t('action.back')}
            </Button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setPrefs({ lang: prefs.lang === 'en' ? 'ms' : 'en' })}
          className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm text-muted hover:bg-surface-2 hover:text-fg cursor-pointer"
          aria-label={t('settings.language')}
        >
          <Languages className="size-4" />
          {prefs.lang === 'en' ? 'Bahasa Melayu' : 'English'}
        </button>
      </header>
      <main className="flex flex-1 items-start justify-center px-5 pb-10 pt-6 sm:items-center sm:px-6">
        <div className="glass animate-fade-in w-full max-w-sm rounded-[32px] p-7 sm:p-8">
          {step !== undefined && total !== undefined && <p className="mb-2 text-xs font-medium text-faint">{t('onboarding.progress', { n: step, total })}</p>}
          {children}
        </div>
      </main>
    </div>
  );
}

export function Onboarding() {
  const t = useT();
  const [step, setStep] = useState<Step>('welcome');
  const hasClientId = !!useClientId();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [ack, setAck] = useState(false);
  const [session, setSession] = useState<VaultSession | null>(null);
  const [recoveryKey, setRecoveryKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The master password is held only until the recovery key step, then cleared.
  const pwRef = useRef('');

  useEffect(() => setError(null), [step]);

  const finish = async () => {
    pwRef.current = '';
    setPassword('');
    setConfirm('');
    if (session) await attachSession(session);
  };

  const create = async () => {
    if (password !== confirm || !isAcceptableMasterPassword(password) || !ack) return;
    setStep('creating');
    try {
      pwRef.current = password;
      const s = await createNewVault(password);
      setPassword('');
      setConfirm('');
      setSession(s);
      setStep('recovery');
    } catch (e) {
      setStep('password');
      toastError(e);
    }
  };

  if (step === 'welcome') {
    return (
      <Shell>
        <div className="text-center">
          <Logo className="mx-auto mb-6 size-14" />
          <h1 className="text-[34px] font-bold tracking-tight text-fg">MyVault</h1>
          <p className="mx-auto mt-3 max-w-xs text-[15px] leading-relaxed text-muted">{t('onboarding.tagline')}</p>
          <div className="mt-10 space-y-2.5">
            <Button variant="primary" size="lg" block onClick={() => setStep('password')}>
              {t('onboarding.create')}
            </Button>
            <Button size="lg" block onClick={() => setStep('restore')}>
              {t('onboarding.haveVault')}
            </Button>
          </div>
        </div>
      </Shell>
    );
  }

  if (step === 'password' || step === 'creating') {
    const mismatch = confirm.length > 0 && confirm !== password;
    const weak = password.length > 0 && !isAcceptableMasterPassword(password);
    return (
      <Shell onBack={step === 'creating' ? undefined : () => setStep('welcome')} step={1} total={2}>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{t('onboarding.pw.title')}</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-muted">{t('onboarding.pw.subtitle')}</p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <PasswordInput
            label={t('onboarding.pw.label')}
            value={password}
            onValueChange={setPassword}
            showStrength
            autoFocus
            autoComplete="new-password"
            name="new-password"
            disabled={step === 'creating'}
            help={weak ? t('onboarding.pw.tooWeak') : undefined}
          />
          <PasswordInput
            label={t('onboarding.pw.confirm')}
            value={confirm}
            onValueChange={setConfirm}
            autoComplete="new-password"
            disabled={step === 'creating'}
            error={mismatch ? t('onboarding.pw.mismatch') : undefined}
          />
          <p className="text-[13px] leading-relaxed text-muted">{t('onboarding.pw.tip1')}</p>
          <div className="pt-1">
            <Checkbox checked={ack} onChange={setAck} label={t('onboarding.pw.ack')} />
          </div>
          <Button
            type="submit"
            variant="primary"
            size="lg"
            block
            loading={step === 'creating'}
            disabled={!password || password !== confirm || weak || !ack}
          >
            {step === 'creating' ? t('onboarding.pw.creating') : t('onboarding.pw.create')}
          </Button>
          {step === 'creating' && <p className="text-center text-xs text-faint">{t('onboarding.pw.creatingHint')}</p>}
        </form>
      </Shell>
    );
  }

  if ((step === 'recovery' || step === 'recovery-show') && session) {
    return (
      <Shell step={2} total={2}>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{t('onboarding.recovery.title')}</h1>
        {step === 'recovery' || !recoveryKey ? (
          <>
            <p className="mt-2 text-[15px] leading-relaxed text-muted">{t('onboarding.recovery.body')}</p>
            <div className="mt-8 space-y-2.5">
              <Button
                variant="primary"
                size="lg"
                block
                loading={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    setRecoveryKey(await createRecoveryKey(session, pwRef.current));
                    pwRef.current = '';
                    setStep('recovery-show');
                  } catch (e) {
                    toastError(e);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {t('onboarding.recovery.create')}
              </Button>
              <Button
                size="lg"
                block
                variant="ghost"
                onClick={() => void finish()}
              >
                {t('onboarding.skip')}
              </Button>
            </div>
          </>
        ) : (
          <div className="mt-6">
            <RecoveryKeyDisplay
              recoveryKey={recoveryKey}
              onDone={() => {
                setRecoveryKey(null);
                void finish();
              }}
            />
          </div>
        )}
      </Shell>
    );
  }

  if (step === 'restore') {
    return (
      <Shell onBack={() => setStep('welcome')}>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{t('onboarding.restore.title')}</h1>
        <p className="mt-2 text-muted">{t('onboarding.restore.subtitle')}</p>
        <div className="mt-6 space-y-3">
          <ChoiceCard icon={<Cloud className="size-5" />} title={t('onboarding.restore.drive')} body={t('onboarding.restore.driveBody')} onClick={() => setStep('restore-drive')} />
          <ChoiceCard icon={<FileUp className="size-5" />} title={t('onboarding.restore.file')} body={t('onboarding.restore.fileBody')} onClick={() => setStep('restore-file')} />
        </div>
        <p className="mt-6 flex gap-2 text-xs leading-relaxed text-faint">
          <HardDrive className="size-4 shrink-0" />
          {t('onboarding.restore.note')}
        </p>
      </Shell>
    );
  }

  if (step === 'restore-drive') {
    return (
      <Shell onBack={() => setStep('restore')}>
        <h1 className="text-[28px] font-bold leading-tight tracking-tight">{t('onboarding.restore.drive')}</h1>
        <p className="mt-2 leading-relaxed text-muted">{t('onboarding.restore.driveSteps')}</p>
        {!hasClientId && (
          <div className="mt-4">
            <GoogleSetupHelp compact />
          </div>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-danger-soft p-3 text-sm text-danger">
            {error}
          </p>
        )}
        <Button
          variant="primary"
          size="lg"
          block
          className="mt-8"
          disabled={!hasClientId}
          loading={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              if (!(await connectGoogle())) return;
              await downloadCloudVault();
              app.set({ phase: 'locked', lockReason: 'downloaded' });
            } catch (e) {
              setError(e instanceof NoCloudVaultError ? t('onboarding.restore.noCloud') : e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {t('onboarding.restore.connectDownload')}
        </Button>
      </Shell>
    );
  }

  if (step === 'restore-file') {
    return (
      <Shell onBack={() => setStep('restore')}>
        <RestoreFromFile onRestored={() => app.set({ phase: 'locked', lockReason: 'restored' })} />
      </Shell>
    );
  }

  return null;
}

function ChoiceCard({ icon, title, body, onClick }: { icon: ReactNode; title: string; body: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex w-full items-start gap-4 rounded-xl border border-line bg-surface/80 p-4 text-left transition-colors hover:border-accent/50 hover:bg-surface-2 cursor-pointer"
    >
      <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">{icon}</div>
      <div className="min-w-0 flex-1">
        <h3 className="font-semibold text-fg">{title}</h3>
        <p className="mt-1 text-sm text-muted">{body}</p>
      </div>
      <ArrowRight className="mt-2 size-4 text-faint transition-transform group-hover:translate-x-0.5" />
    </button>
  );
}

/** Restore an encrypted .myvault backup onto this device (used by onboarding and the lock screen). */
export function RestoreFromFile({ onRestored }: { onRestored: () => void }) {
  const t = useT();
  const [text, setText] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ createdAt: number; appVersion: string } | null>(null);
  const [fileName, setFileName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <h1 className="text-[28px] font-bold leading-tight tracking-tight">{t('onboarding.restore.file')}</h1>
      <p className="mt-2 text-muted">{t('backup.restoreHelp')}</p>
      <label className="mt-6 flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-line-strong bg-surface/60 p-6 text-center hover:border-accent/60">
        <FileUp className="size-6 text-accent" />
        <span className="text-sm font-medium text-fg">{fileName || t('backup.chooseFile')}</span>
        <span className="text-xs text-faint">.myvault</span>
        <input
          type="file"
          accept=".myvault,.json,application/json"
          className="sr-only"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            setError(null);
            setMeta(null);
            if (!f) return;
            setFileName(f.name);
            try {
              const content = await readFileAsText(f);
              const info = inspectBackup(content);
              setText(content);
              setMeta({ createdAt: info.createdAt, appVersion: info.appVersion });
            } catch (err) {
              setText(null);
              setError(err instanceof Error ? err.message : String(err));
            }
          }}
        />
      </label>
      {meta && (
        <p className="mt-3 text-sm text-muted">
          {t('backup.createdOn', { date: new Date(meta.createdAt).toLocaleString() })}
        </p>
      )}
      {text && (
        <form
          className="mt-4 space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              const opened = await openBackup(text, password);
              await restoreReplace(getRepo(), opened);
              setPassword('');
              onRestored();
            } catch (err) {
              setError(err instanceof BackupPasswordError ? t('backup.wrongPassword') : err instanceof CorruptBackupError ? err.message : err instanceof Error ? err.message : String(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <PasswordInput label={t('backup.backupPassword')} value={password} onValueChange={setPassword} autoFocus help={t('backup.backupPasswordHelp')} />
          <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={!password}>
            {t('backup.restore')}
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-danger-soft p-3 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
