import { useState } from 'react';
import { DatabaseBackup, X } from 'lucide-react';
import { useT } from '../../i18n';
import { navigate, useApp } from '../../state/app';
import { usePrefs } from '../../state/prefs-store';
import { useSync } from '../../state/sync-controller';

/** Gentle reminder to export an encrypted backup when none was made recently. */
export function BackupReminder() {
  const t = useT();
  const prefs = usePrefs();
  const lastBackupAt = useApp((s) => s.lastBackupAt);
  const count = useApp((s) => s.items.length);
  const connected = useSync((s) => s.connected);
  const [dismissed, setDismissed] = useState(false);
  if (dismissed || prefs.backupReminderDays <= 0 || count < 3) return null;
  const due = !lastBackupAt || Date.now() - lastBackupAt > prefs.backupReminderDays * 86_400_000;
  if (!due) return null;
  return (
    <div className="flex items-center gap-3 border-b border-line bg-accent-soft px-4 py-2 text-sm md:px-6">
      <DatabaseBackup className="size-4 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 text-fg">{lastBackupAt ? t('reminder.backupOld') : connected ? t('reminder.backupNeverSynced') : t('reminder.backupNever')}</p>
      <button type="button" className="shrink-0 font-medium text-accent hover:underline cursor-pointer" onClick={() => navigate({ name: 'backup' })}>
        {t('reminder.backupNow')}
      </button>
      <button type="button" aria-label={t('action.dismiss')} className="shrink-0 rounded-md p-1 text-muted hover:text-fg cursor-pointer" onClick={() => setDismissed(true)}>
        <X className="size-4" />
      </button>
    </div>
  );
}
