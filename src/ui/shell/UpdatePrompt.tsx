import { useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useT } from '../../i18n';
import { Button } from '../components/Button';

/**
 * Service-worker update handling: a new version is downloaded in the background but only
 * activated when the user chooses to reload, so an open (unlocked) session is never
 * replaced unexpectedly.
 */
export function UpdatePrompt() {
  const t = useT();
  const [update, setUpdate] = useState<null | ((reload?: boolean) => Promise<void>)>(null);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;
    let cancelled = false;
    void import('virtual:pwa-register').then(({ registerSW }) => {
      if (cancelled) return;
      const updateSW = registerSW({
        onNeedRefresh() {
          setUpdate(() => updateSW);
        },
        onOfflineReady() {
          setOfflineReady(true);
          window.setTimeout(() => setOfflineReady(false), 5000);
        },
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!update && !offlineReady) return null;
  return (
    <div className="fixed inset-x-0 top-0 z-[70] flex justify-center px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
      <div className="animate-toast-in flex max-w-md items-center gap-3 rounded-2xl border border-line bg-surface-2 px-4 py-3 shadow-strong">
        <RefreshCw className="size-5 shrink-0 text-accent" />
        <p className="text-sm text-fg">{update ? t('update.available') : t('update.offlineReady')}</p>
        {update && (
          <Button size="sm" variant="primary" onClick={() => void update(true)}>
            {t('update.reload')}
          </Button>
        )}
      </div>
    </div>
  );
}
