import { useMemo, type ReactNode } from 'react';
import {
  ArrowRight,
  Cloud,
  DatabaseBackup,
  History,
  KeyRound,
  LifeBuoy,
  Plus,
  Repeat,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Star,
  TriangleAlert,
  WandSparkles,
} from 'lucide-react';
import { formatRelative, useT } from '../../i18n';
import { analyzeVault } from '../../lib/security-analysis';
import { navigate, openEditor, selectItem, useApp, type Route } from '../../state/app';
import { usePrefs, setPrefs } from '../../state/prefs-store';
import { useSync } from '../../state/sync-controller';
import type { VaultItem } from '../../vault/types';
import { Button } from '../components/Button';
import { ItemAvatar } from '../components/Misc';
import { cx } from '../cx';
import { itemSubtitle, TYPE_LABEL_KEYS } from '../items/helpers';

function Stat({ icon, label, value, tone = 'default', onClick }: { icon: ReactNode; label: string; value: ReactNode; tone?: 'default' | 'danger' | 'warning' | 'success' | 'accent'; onClick?: () => void }) {
  const tones = {
    default: 'bg-surface-3 text-muted',
    accent: 'bg-accent-soft text-accent',
    danger: 'bg-danger-soft text-danger',
    warning: 'bg-warning-soft text-warning',
    success: 'bg-success-soft text-success',
  };
  return (
    <button type="button" onClick={onClick} disabled={!onClick} className="card group flex flex-col items-start gap-3 p-4 text-left transition-colors enabled:hover:border-line-strong enabled:cursor-pointer">
      <div className={cx('flex size-9 items-center justify-center rounded-xl [&>svg]:size-[18px]', tones[tone])}>{icon}</div>
      <div>
        <p className="text-2xl font-semibold tabular-nums tracking-tight text-fg">{value}</p>
        <p className="mt-0.5 text-[13px] text-muted">{label}</p>
      </div>
    </button>
  );
}

function MiniList({ title, icon, items, empty, onMore }: { title: string; icon: ReactNode; items: VaultItem[]; empty: string; onMore?: () => void }) {
  const t = useT();
  const collections = useApp((s) => s.collections);
  return (
    <section className="card p-4">
      <div className="mb-2 flex items-center justify-between px-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-fg">
          <span className="text-muted [&>svg]:size-4">{icon}</span>
          {title}
        </h2>
        {onMore && items.length > 0 && (
          <button type="button" onClick={onMore} className="text-xs font-medium text-accent hover:underline cursor-pointer">
            {t('dashboard.seeAll')}
          </button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-1 py-4 text-sm text-faint">{empty}</p>
      ) : (
        <ul className="space-y-0.5">
          {items.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => {
                  navigate({ name: 'items', filter: { kind: 'all' } });
                  selectItem(i.id);
                }}
                className="flex w-full items-center gap-3 rounded-xl px-1.5 py-1.5 text-left hover:bg-surface-2 cursor-pointer"
              >
                <ItemAvatar item={i} category={collections.find((c) => c.id === i.categoryId)} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-fg">{i.title}</p>
                  <p className="truncate text-xs text-muted">{itemSubtitle(i, t(TYPE_LABEL_KEYS[i.type]))}</p>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function DashboardView() {
  const t = useT();
  const prefs = usePrefs();
  const items = useApp((s) => s.items);
  const usage = useApp((s) => s.usage);
  const settings = useApp((s) => s.settings);
  const session = useApp((s) => s.session);
  const conflicts = useApp((s) => s.conflicts);
  const corrupted = useApp((s) => s.corrupted);
  const lastBackupAt = useApp((s) => s.lastBackupAt);
  const sync = { connected: useSync((s) => s.connected), lastSyncAt: useSync((s) => s.lastSyncAt) };
  const report = useMemo(() => analyzeVault(items, { oldPasswordDays: settings.oldPasswordDays }), [items, settings.oldPasswordDays]);
  const active = items.filter((i) => !i.trashedAt && !i.archivedAt);
  const favorites = active.filter((i) => i.favorite).slice(0, 5);
  const recentUsed = active.filter((i) => usage[i.id]).sort((a, b) => usage[b.id] - usage[a.id]).slice(0, 5);
  const recentAdded = [...active].sort((a, b) => b.createdAt - a.createdAt).slice(0, 5);
  const recentlyChanged = active.filter((i) => i.passwordChangedAt && Date.now() - i.passwordChangedAt < 30 * 86_400_000 && i.passwordChangedAt - i.createdAt > 60_000).length;
  const reusedCount = report.reused.reduce((n, g) => n + g.length, 0);
  const go = (r: Route) => navigate(r);
  const ids = (list: string[], label: string): Route => ({ name: 'items', filter: { kind: 'ids', ids: list, label } });

  const recs: { icon: ReactNode; text: string; action: string; tone: 'danger' | 'warning' | 'accent'; run: () => void }[] = [];
  if (report.weak.length) recs.push({ icon: <ShieldAlert />, text: t('rec.weak', { n: report.weak.length }), action: t('rec.review'), tone: 'danger', run: () => go(ids(report.weak, t('security.weak'))) });
  if (report.reused.length) recs.push({ icon: <Repeat />, text: t('rec.reused', { n: reusedCount }), action: t('rec.review'), tone: 'danger', run: () => go(ids(report.reused.flat(), t('security.reused'))) });
  if (!session?.security.totp) recs.push({ icon: <Smartphone />, text: t('rec.totp'), action: t('rec.setup'), tone: 'accent', run: () => go({ name: 'settings' }) });
  if (!session?.security.recoveryKeyCreatedAt) recs.push({ icon: <LifeBuoy />, text: t('rec.recoveryKey'), action: t('rec.setup'), tone: 'warning', run: () => go({ name: 'settings' }) });
  if (!sync.connected) recs.push({ icon: <Cloud />, text: t('rec.sync'), action: t('rec.connect'), tone: 'accent', run: () => go({ name: 'sync' }) });
  if (!lastBackupAt && active.length > 0) recs.push({ icon: <DatabaseBackup />, text: t('rec.backup'), action: t('rec.backupNow'), tone: 'warning', run: () => go({ name: 'backup' }) });
  if (report.old.length) recs.push({ icon: <History />, text: t('rec.old', { n: report.old.length, days: settings.oldPasswordDays }), action: t('rec.review'), tone: 'warning', run: () => go(ids(report.old, t('security.old'))) });

  const toneClass = { danger: 'bg-danger-soft text-danger', warning: 'bg-warning-soft text-warning', accent: 'bg-accent-soft text-accent' };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-4 pb-28 pt-6 sm:px-6 md:pb-10">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{t('dashboard.title')}</h1>
            <p className="mt-1 text-sm text-muted">
              {sync.connected ? t('dashboard.syncedAt', { when: formatRelative(sync.lastSyncAt) }) : t('dashboard.localOnly')}
            </p>
          </div>
          <div className="hidden gap-2 md:flex">
            <Button icon={<WandSparkles className="size-4" />} onClick={() => go({ name: 'generator' })}>
              {t('nav.generator')}
            </Button>
          </div>
        </div>

        {corrupted > 0 && (
          <div role="alert" className="mb-4 flex items-start gap-3 rounded-2xl border border-danger/30 bg-danger-soft p-4 text-sm text-fg">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" />
            <p>{t('dashboard.corrupted', { n: corrupted })}</p>
          </div>
        )}
        {conflicts.length > 0 && (
          <button type="button" onClick={() => go({ name: 'sync' })} className="mb-4 flex w-full items-center gap-3 rounded-2xl border border-warning/30 bg-warning-soft p-4 text-left text-sm text-fg cursor-pointer">
            <TriangleAlert className="size-5 shrink-0 text-warning" />
            <span className="flex-1">{t('dashboard.conflicts', { n: conflicts.length })}</span>
            <ArrowRight className="size-4 text-muted" />
          </button>
        )}

        {active.length === 0 && !prefs.tourDone ? (
          <section className="card relative overflow-hidden p-6 sm:p-8">
            <div className="absolute -right-16 -top-16 size-64 rounded-full bg-accent-gradient opacity-20 blur-3xl" aria-hidden />
            <div className="relative">
              <div className="mb-4 flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <Sparkles className="size-6" />
              </div>
              <h2 className="text-xl font-semibold">{t('tour.title')}</h2>
              <p className="mt-1 max-w-xl text-muted">{t('tour.body')}</p>
              <ol className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {(['tour.step1', 'tour.step2', 'tour.step3', 'tour.step4'] as const).map((k, i) => (
                  <li key={k} className="rounded-2xl border border-line bg-surface-2/60 p-4 text-sm text-muted">
                    <span className="mb-2 flex size-6 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent">{i + 1}</span>
                    {t(k)}
                  </li>
                ))}
              </ol>
              <div className="mt-6 flex flex-wrap gap-2">
                <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openEditor({ mode: 'new', type: 'login' })}>
                  {t('item.addFirst')}
                </Button>
                <Button onClick={() => go({ name: 'backup' })}>{t('tour.import')}</Button>
                <Button variant="ghost" onClick={() => setPrefs({ tourDone: true })}>
                  {t('action.dismiss')}
                </Button>
              </div>
            </div>
          </section>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Stat icon={<KeyRound />} label={t('stat.total')} value={active.length} tone="accent" onClick={() => go({ name: 'items', filter: { kind: 'all' } })} />
              <Stat icon={<Star />} label={t('stat.favorites')} value={favorites.length ? active.filter((i) => i.favorite).length : 0} tone="warning" onClick={() => go({ name: 'items', filter: { kind: 'favorites' } })} />
              <Stat icon={<ShieldAlert />} label={t('stat.weak')} value={report.weak.length} tone={report.weak.length ? 'danger' : 'success'} onClick={report.weak.length ? () => go(ids(report.weak, t('security.weak'))) : undefined} />
              <Stat icon={<Repeat />} label={t('stat.reused')} value={reusedCount} tone={reusedCount ? 'danger' : 'success'} onClick={reusedCount ? () => go(ids(report.reused.flat(), t('security.reused'))) : undefined} />
              <Stat icon={<History />} label={t('stat.changed')} value={recentlyChanged} />
              <Stat icon={<ShieldCheck />} label={t('stat.score')} value={`${report.score}`} tone={report.score >= 80 ? 'success' : report.score >= 50 ? 'warning' : 'danger'} onClick={() => go({ name: 'security' })} />
            </div>

            {recs.length > 0 && (
              <section className="card mt-4 p-4 sm:p-5">
                <h2 className="mb-3 text-sm font-semibold text-fg">{t('dashboard.recommendations')}</h2>
                <ul className="divide-y divide-line">
                  {recs.slice(0, 5).map((r) => (
                    <li key={r.text} className="flex items-center gap-3 py-2.5">
                      <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-lg [&>svg]:size-4', toneClass[r.tone])}>{r.icon}</span>
                      <p className="min-w-0 flex-1 text-sm text-fg">{r.text}</p>
                      <Button size="sm" variant="ghost" onClick={r.run}>
                        {r.action}
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <MiniList title={t('nav.favorites')} icon={<Star />} items={favorites} empty={t('dashboard.noFavorites')} onMore={() => go({ name: 'items', filter: { kind: 'favorites' } })} />
              <MiniList title={t('nav.recentUsed')} icon={<History />} items={recentUsed} empty={t('dashboard.noRecentUsed')} onMore={() => go({ name: 'items', filter: { kind: 'recentUsed' } })} />
              <MiniList title={t('nav.recentAdded')} icon={<Plus />} items={recentAdded} empty={t('dashboard.noItems')} onMore={() => go({ name: 'items', filter: { kind: 'recentAdded' } })} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
