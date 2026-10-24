import { Cloud, CloudOff, LoaderCircle, RefreshCw, TriangleAlert, Unplug } from 'lucide-react';
import { useT } from '../../i18n';
import { navigate } from '../../state/app';
import { useSync } from '../../state/sync-controller';
import { cx } from '../cx';

/** Compact, honest sync status indicator (reflects the real last result). */
export function SyncPill({ className, compact }: { className?: string; compact?: boolean }) {
  const t = useT();
  const status = useSync((s) => s.status);
  const online = useSync((s) => s.online);
  const map = {
    off: { icon: <Unplug className="size-4" />, label: t('sync.status.off'), tone: 'text-faint' },
    idle: { icon: <Cloud className="size-4" />, label: t('sync.status.idle'), tone: 'text-success' },
    syncing: { icon: <LoaderCircle className="size-4 animate-spin" />, label: t('sync.status.syncing'), tone: 'text-accent' },
    error: { icon: <TriangleAlert className="size-4" />, label: t('sync.status.error'), tone: 'text-danger' },
    offline: { icon: <CloudOff className="size-4" />, label: t('sync.status.offline'), tone: 'text-warning' },
    'needs-auth': { icon: <RefreshCw className="size-4" />, label: t('sync.status.needsAuth'), tone: 'text-warning' },
    mismatch: { icon: <TriangleAlert className="size-4" />, label: t('sync.status.mismatch'), tone: 'text-danger' },
  } as const;
  const m = !online && status !== 'off' ? map.offline : map[status];
  return (
    <button
      type="button"
      onClick={() => navigate({ name: 'sync' })}
      className={cx('flex h-10 items-center gap-2 rounded-xl px-2.5 text-[13px] text-muted hover:bg-surface-2 hover:text-fg cursor-pointer', className)}
      aria-label={`${t('nav.sync')}: ${m.label}`}
      title={m.label}
    >
      <span className={m.tone}>{m.icon}</span>
      {!compact && <span className="truncate">{m.label}</span>}
    </button>
  );
}
