import { useEffect, useState } from 'react';
import { Check, Copy, Download, Printer, Smartphone } from 'lucide-react';
import { enableTotp, InvalidCodeError } from '../../vault/access';
import type { VaultSession } from '../../vault/session';
import { formatSecretForDisplay, generateTotpSecret, otpauthUri } from '../../lib/totp';
import { useT } from '../../i18n';
import { Button } from '../components/Button';
import { OtpInput } from '../components/Feedback';
import { Checkbox } from '../components/Field';
import { copyWithFeedback } from '../components/Secret';
import { downloadTextFile, printText } from '../download';

/**
 * Google Authenticator enrollment: generate a 160-bit secret, show it as a QR code and as a
 * manual setup key, verify one code, then show single-use recovery codes.
 */
export function TotpEnroll({ session, onDone, onCancel }: { session: VaultSession; onDone: () => void; onCancel?: () => void }) {
  const t = useT();
  const [secret] = useState(() => generateTotpSecret());
  const [qr, setQr] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const label = `${session.device.name}`;

  useEffect(() => {
    let alive = true;
    import('qrcode')
      .then(({ default: QRCode }) => QRCode.toDataURL(otpauthUri(secret, `Vault (${label})`), { errorCorrectionLevel: 'M', margin: 1, width: 232, color: { dark: '#0b0d12', light: '#ffffff' } }))
      .then((url) => alive && setQr(url))
      .catch(() => alive && setQr(null));
    return () => {
      alive = false;
    };
  }, [secret, label]);

  const verify = async (value = code) => {
    if (value.length !== 6 || busy) return;
    setBusy(true);
    setError(null);
    try {
      setCodes(await enableTotp(session, secret, value));
    } catch (e) {
      setError(e instanceof InvalidCodeError ? t('totp.wrongCode') : e instanceof Error ? e.message : String(e));
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (codes) {
    const text = `${t('recoveryCodes.fileHeader')}\n${new Date().toLocaleString()}\n\n${codes.join('\n')}\n`;
    return (
      <div className="animate-fade-in space-y-5">
        <div className="flex items-center gap-3 rounded-2xl bg-success-soft p-4 text-success">
          <Check className="size-5 shrink-0" />
          <p className="text-sm font-medium">{t('totp.enabled')}</p>
        </div>
        <div>
          <h3 className="text-base font-semibold text-fg">{t('recoveryCodes.title')}</h3>
          <p className="mt-1 text-sm text-muted">{t('recoveryCodes.explain')}</p>
        </div>
        <ol className="grid grid-cols-2 gap-2 rounded-2xl border border-line bg-surface-2 p-4 secret text-[15px]" aria-label={t('recoveryCodes.title')}>
          {codes.map((c) => (
            <li key={c} className="rounded-lg bg-surface px-3 py-2 text-center text-fg">
              {c}
            </li>
          ))}
        </ol>
        <div className="no-print flex flex-wrap gap-2">
          <Button size="sm" icon={<Copy className="size-4" />} onClick={() => copyWithFeedback(codes.join('\n'), { secret: true, label: t('recoveryCodes.title') })}>
            {t('action.copy')}
          </Button>
          <Button size="sm" icon={<Download className="size-4" />} onClick={() => downloadTextFile('myvault-recovery-codes.txt', text)}>
            {t('action.download')}
          </Button>
          <Button size="sm" icon={<Printer className="size-4" />} onClick={() => printText(t('recoveryCodes.title'), text)}>
            {t('action.print')}
          </Button>
        </div>
        <div className="rounded-xl border border-line p-3">
          <Checkbox checked={saved} onChange={setSaved} label={t('recoveryCodes.ack')} />
        </div>
        <Button variant="primary" block size="lg" disabled={!saved} onClick={onDone}>
          {t('action.done')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="space-y-4 text-sm text-muted">
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">1</span>
          <span>{t('totp.step1')}</span>
        </li>
        <li className="flex gap-3">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">2</span>
          <span>{t('totp.step2')}</span>
        </li>
      </ol>
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
        <div className="flex size-[232px] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white p-2">
          {qr ? <img src={qr} alt={t('totp.qrAlt')} className="size-full" /> : <Smartphone className="size-10 text-faint" />}
        </div>
        <div className="w-full min-w-0 space-y-2">
          <p className="text-sm text-muted">{t('totp.manual')}</p>
          {showKey ? (
            <div className="rounded-xl border border-line bg-surface-2 p-3">
              <p className="secret break-all text-[15px] text-fg select-all">{formatSecretForDisplay(secret)}</p>
              <p className="mt-2 text-xs text-faint">{t('totp.manualDetails')}</p>
            </div>
          ) : (
            <Button size="sm" onClick={() => setShowKey(true)}>
              {t('totp.showKey')}
            </Button>
          )}
          {showKey && (
            <Button size="sm" variant="ghost" icon={<Copy className="size-4" />} onClick={() => copyWithFeedback(secret, { secret: true, label: t('totp.setupKey') })}>
              {t('action.copy')}
            </Button>
          )}
        </div>
      </div>
      <div className="flex gap-3 text-sm text-muted">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-bold text-accent">3</span>
        <span>{t('totp.step3')}</span>
      </div>
      <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={busy} invalid={!!error} />
      {error && (
        <p role="alert" className="text-center text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            {t('action.cancel')}
          </Button>
        )}
        <Button variant="primary" loading={busy} disabled={code.length !== 6} onClick={() => void verify()}>
          {t('totp.verify')}
        </Button>
      </div>
    </div>
  );
}
