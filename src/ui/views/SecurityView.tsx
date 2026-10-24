import { useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Copy as CopyIcon, FolderX, Globe, History, Radar, Repeat, ShieldAlert, ShieldCheck, UserX } from 'lucide-react';
import { useT } from '../../i18n';
import { pwnedCount } from '../../lib/hibp';
import { analyzeVault } from '../../lib/security-analysis';
import { estimateStrength } from '../../lib/strength';
import { navigate, selectItem, useApp } from '../../state/app';
import { confirmDialog } from '../../state/ui';
import type { VaultItem } from '../../vault/types';
import { Button } from '../components/Button';
import { Badge, ItemAvatar, PageHeader } from '../components/Misc';
import { cx } from '../cx';

function ScoreRing({ score }: { score: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const color = score >= 80 ? 'var(--success)' : score >= 50 ? 'var(--warning)' : 'var(--danger)';
  return (
    <div className="relative size-36 shrink-0">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="10" />
        <circle cx="60" cy="60" r={r} fill="none" stroke={color} strokeWidth="10" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c - (score / 100) * c} className="transition-[stroke-dashoffset] duration-700" />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-4xl font-bold tabular-nums tracking-tight">{score}</span>
        <span className="text-xs text-muted">/ 100</span>
      </div>
    </div>
  );
}

function IssueGroup({ icon, title, description, items, tone, extra, label }: { icon: ReactNode; title: string; description: string; items: VaultItem[]; tone: 'danger' | 'warning' | 'default'; extra?: (i: VaultItem) => ReactNode; label: string }) {
  const t = useT();
  const collections = useApp((s) => s.collections);
  const [open, setOpen] = useState(false);
  const tones = { danger: 'bg-danger-soft text-danger', warning: 'bg-warning-soft text-warning', default: 'bg-surface-3 text-muted' };
  const shown = open ? items : items.slice(0, 4);
  return (
    <section className="card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className={cx('flex size-10 shrink-0 items-center justify-center rounded-xl [&>svg]:size-5', items.length ? tones[tone] : 'bg-success-soft text-success')}>{items.length ? icon : <ShieldCheck />}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold text-fg">{title}</h2>
            <span className="rounded-md bg-surface-3 px-1.5 text-xs font-semibold tabular-nums text-muted">{items.length}</span>
          </div>
          <p className="mt-0.5 text-sm text-muted">{description}</p>
        </div>
        {items.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => navigate({ name: 'items', filter: { kind: 'ids', ids: items.map((i) => i.id), label } })}>
            {t('security.viewAll')}
          </Button>
        )}
      </div>
      {items.length > 0 && (
        <ul className="mt-3 space-y-0.5">
          {shown.map((i) => (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => {
                  navigate({ name: 'items', filter: { kind: 'ids', ids: items.map((x) => x.id), label } });
                  selectItem(i.id);
                }}
                className="group flex w-full items-center gap-3 rounded-xl px-2 py-1.5 text-left hover:bg-surface-2 cursor-pointer"
              >
                <ItemAvatar item={i} category={collections.find((c) => c.id === i.categoryId)} size="sm" />
                <span className="min-w-0 flex-1 truncate text-sm text-fg">{i.title}</span>
                {extra?.(i)}
                <ArrowRight className="size-4 text-faint opacity-0 transition-opacity group-hover:opacity-100" />
              </button>
            </li>
          ))}
          {items.length > 4 && (
            <li>
              <button type="button" onClick={() => setOpen((o) => !o)} className="px-2 py-1 text-xs font-medium text-accent hover:underline cursor-pointer">
                {open ? t('security.showLess') : t('security.showMore', { n: items.length - 4 })}
              </button>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}

export function SecurityView() {
  const t = useT();
  const items = useApp((s) => s.items);
  const settings = useApp((s) => s.settings);
  const report = useMemo(() => analyzeVault(items, { oldPasswordDays: settings.oldPasswordDays }), [items, settings.oldPasswordDays]);
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const get = (ids: string[]) => ids.map((id) => byId.get(id)).filter(Boolean) as VaultItem[];
  const [breach, setBreach] = useState<{ running: boolean; done: number; total: number; results: Map<string, number>; error: string | null; finished: boolean }>({ running: false, done: 0, total: 0, results: new Map(), error: null, finished: false });
  const cancelRef = useRef(false);

  const runBreachCheck = async () => {
    const ok = await confirmDialog({ title: t('breach.confirmTitle'), message: t('breach.confirmBody'), confirmLabel: t('breach.start') });
    if (!ok) return;
    const withPw = items.filter((i) => !i.trashedAt && i.password);
    const unique = [...new Set(withPw.map((i) => i.password!))];
    cancelRef.current = false;
    const counts = new Map<string, number>();
    setBreach({ running: true, done: 0, total: unique.length, results: new Map(), error: null, finished: false });
    try {
      for (let n = 0; n < unique.length; n++) {
        if (cancelRef.current) break;
        counts.set(unique[n], await pwnedCount(unique[n]));
        setBreach((b) => ({ ...b, done: n + 1 }));
      }
      const results = new Map<string, number>();
      for (const i of withPw) {
        const c = counts.get(i.password!);
        if (c) results.set(i.id, c);
      }
      setBreach((b) => ({ ...b, running: false, results, finished: !cancelRef.current }));
    } catch (e) {
      setBreach((b) => ({ ...b, running: false, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      counts.clear();
    }
  };

  const breached = get([...breach.results.keys()]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl px-4 pb-28 pt-6 sm:px-6 md:pb-10">
        <PageHeader title={t('security.title')} subtitle={t('security.subtitle')} icon={<ShieldCheck className="size-5" />} />

        <section className="card mb-4 flex flex-col items-center gap-6 p-6 sm:flex-row">
          <ScoreRing score={report.score} />
          <div className="min-w-0 flex-1 text-center sm:text-left">
            <h2 className="text-lg font-semibold">{report.score >= 80 ? t('security.great') : report.score >= 50 ? t('security.ok') : t('security.bad')}</h2>
            <p className="mt-1 text-sm text-muted">{t('security.summary', { total: report.withPassword, weak: report.weak.length, reused: report.reused.reduce((n, g) => n + g.length, 0) })}</p>
            <p className="mt-3 text-xs text-faint">{t('security.localOnly')}</p>
          </div>
        </section>

        <div className="space-y-4">
          <IssueGroup icon={<ShieldAlert />} tone="danger" title={t('security.weak')} label={t('security.weak')} description={t('security.weakDesc')} items={get(report.weak)} extra={(i) => <Badge tone="danger">{t(`strength.${estimateStrength(i.password ?? '').label}` as 'strength.weak')}</Badge>} />
          <IssueGroup icon={<Repeat />} tone="danger" title={t('security.reused')} label={t('security.reused')} description={t('security.reusedDesc')} items={get(report.reused.flat())} extra={(i) => <Badge>{t('security.usedTimes', { n: report.reused.find((g) => g.includes(i.id))?.length ?? 0 })}</Badge>} />
          <IssueGroup icon={<CopyIcon />} tone="warning" title={t('security.duplicates')} label={t('security.duplicates')} description={t('security.duplicatesDesc')} items={get(report.duplicates.flat())} />
          <IssueGroup icon={<History />} tone="warning" title={t('security.old')} label={t('security.old')} description={t('security.oldDesc', { days: settings.oldPasswordDays })} items={get(report.old)} />
          <IssueGroup icon={<Globe />} tone="default" title={t('security.missingUrl')} label={t('security.missingUrl')} description={t('security.missingUrlDesc')} items={get(report.missingUrl)} />
          <IssueGroup icon={<UserX />} tone="default" title={t('security.missingLogin')} label={t('security.missingLogin')} description={t('security.missingLoginDesc')} items={get(report.missingLogin)} />
          <IssueGroup icon={<FolderX />} tone="default" title={t('security.uncategorized')} label={t('security.uncategorized')} description={t('security.uncategorizedDesc')} items={get(report.uncategorized)} />

          <section className="card p-4 sm:p-5">
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Radar className="size-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-fg">{t('breach.title')}</h2>
                <p className="mt-0.5 text-sm text-muted">{t('breach.desc')}</p>
              </div>
              {breach.running ? (
                <Button size="sm" variant="ghost" onClick={() => (cancelRef.current = true)}>
                  {t('action.cancel')}
                </Button>
              ) : (
                <Button size="sm" variant="subtle" onClick={() => void runBreachCheck()}>
                  {t('breach.start')}
                </Button>
              )}
            </div>
            {breach.running && (
              <div className="mt-4">
                <div className="h-2 overflow-hidden rounded-full bg-surface-3">
                  <div className="h-full bg-accent-gradient transition-[width]" style={{ width: `${breach.total ? (breach.done / breach.total) * 100 : 0}%` }} />
                </div>
                <p className="mt-1.5 text-xs text-muted">{t('breach.progress', { done: breach.done, total: breach.total })}</p>
              </div>
            )}
            {breach.error && <p className="mt-3 text-sm text-danger">{t('breach.error', { error: breach.error })}</p>}
            {breach.finished && breached.length === 0 && <p className="mt-3 text-sm text-success">{t('breach.none')}</p>}
            {breached.length > 0 && (
              <div className="mt-4">
                <IssueGroup icon={<ShieldAlert />} tone="danger" title={t('breach.found')} label={t('breach.found')} description={t('breach.foundDesc')} items={breached} extra={(i) => <Badge tone="danger">{t('breach.times', { n: (breach.results.get(i.id) ?? 0).toLocaleString() })}</Badge>} />
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
