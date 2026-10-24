import { useState } from 'react';
import { Copy, Download, LifeBuoy, Printer } from 'lucide-react';
import { useT } from '../../i18n';
import { Button } from '../components/Button';
import { Checkbox } from '../components/Field';
import { copyWithFeedback } from '../components/Secret';
import { downloadTextFile, printText } from '../download';

/** Displays a freshly generated emergency recovery key exactly once. */
export function RecoveryKeyDisplay({ recoveryKey, onDone }: { recoveryKey: string; onDone: () => void }) {
  const t = useT();
  const [saved, setSaved] = useState(false);
  const text = `${t('recoveryKey.fileHeader')}\n${new Date().toLocaleString()}\n\n${recoveryKey}\n\n${t('recoveryKey.fileFooter')}\n`;
  return (
    <div className="animate-fade-in space-y-5">
      <div className="flex gap-3 rounded-2xl border border-warning/30 bg-warning-soft p-4">
        <LifeBuoy className="mt-0.5 size-5 shrink-0 text-warning" />
        <p className="text-sm text-fg">{t('recoveryKey.warning')}</p>
      </div>
      <div className="rounded-2xl border border-line bg-surface-2 p-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-widest text-faint">{t('recoveryKey.title')}</p>
        <p className="secret mt-3 break-all text-lg font-semibold tracking-wider text-fg select-all sm:text-xl">{recoveryKey}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" icon={<Copy className="size-4" />} onClick={() => copyWithFeedback(recoveryKey, { secret: true, label: t('recoveryKey.title') })}>
          {t('action.copy')}
        </Button>
        <Button size="sm" icon={<Download className="size-4" />} onClick={() => downloadTextFile('myvault-recovery-key.txt', text)}>
          {t('action.download')}
        </Button>
        <Button size="sm" icon={<Printer className="size-4" />} onClick={() => printText(t('recoveryKey.title'), text)}>
          {t('action.print')}
        </Button>
      </div>
      <div className="rounded-xl border border-line p-3">
        <Checkbox checked={saved} onChange={setSaved} label={t('recoveryKey.ack')} />
      </div>
      <Button variant="primary" size="lg" block disabled={!saved} onClick={onDone}>
        {t('action.done')}
      </Button>
    </div>
  );
}
