/**
 * Security tab (Android ToolsScreens.SecurityTab): score ring, issue rows (weak, reused,
 * duplicates, old, missing URL / login, uncategorised), and the opt-in breach check.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Clock, Copy, Inbox, Link, Search, TriangleAlert, User, Users } from 'lucide-react';
import { useT } from '../../i18n';
import { pwnedCount } from '../../lib/hibp';
import { analyzeVault } from '../../lib/security-analysis';
import { navigate, useApp } from '../../state/app';
import { confirmDialog } from '../../state/ui';
import { Modal } from '../components/Modal';
import { ITEM_TYPE_ICONS } from '../icons';
import { Body, Chevron, Column, Footnote, GlassButton, GroupDivider, Headline, IconTile, InsetGroup, LargeTitle, ListRow, SectionHeader, Stack } from './kit';

const GOOD = '#46a758';
const WARN = '#f5a524';

export function SecurityTab() {
  const t = useT();
  const items = useApp((s) => s.items);
  const settings = useApp((s) => s.settings);
  const active = useMemo(() => items.filter((i) => !i.trashedAt && !i.archivedAt), [items]);
  const report = useMemo(() => analyzeVault(active, { oldPasswordDays: settings.oldPasswordDays }), [active, settings.oldPasswordDays]);
  const [list, setList] = useState<{ title: string; ids: string[] } | null>(null);
  const [breach, setBreach] = useState<{ running: boolean; done: number; total: number; results: Map<string, number> | null; error: string | null }>({ running: false, done: 0, total: 0, results: null, error: null });
  const cancel = useRef(false);
  const scoreColor = report.score >= 80 ? GOOD : report.score >= 50 ? WARN : 'var(--danger)';
  const r = 43;
  const arc = 2 * Math.PI * r * 0.75;

  const runBreach = async () => {
    const ok = await confirmDialog({ title: t('a.breach_confirm_title'), message: t('a.breach_confirm_body'), confirmLabel: t('a.breach_start') });
    if (!ok) return;
    const withPw = items.filter((i) => !i.trashedAt && i.password);
    const unique = [...new Set(withPw.map((i) => i.password!))];
    cancel.current = false;
    const counts = new Map<string, number>();
    setBreach({ running: true, done: 0, total: unique.length, results: null, error: null });
    try {
      for (let n = 0; n < unique.length; n++) {
        if (cancel.current) break;
        counts.set(unique[n]!, await pwnedCount(unique[n]!));
        setBreach((b) => ({ ...b, done: n + 1 }));
      }
      const results = new Map<string, number>();
      for (const i of withPw) {
        const c = counts.get(i.password!);
        if (c) results.set(i.id, c);
      }
      setBreach((b) => ({ ...b, running: false, results }));
    } catch (e) {
      setBreach((b) => ({ ...b, running: false, error: e instanceof Error ? e.message : String(e) }));
    } finally {
      counts.clear();
    }
  };

  const Issue = ({ label, icon, ids, bad, first }: { label: string; icon: ReactNode; ids: string[]; bad: boolean; first?: boolean }) => (
    <>
      {!first && <GroupDivider inset={64} />}
      <ListRow
        title={label}
        leading={<IconTile icon={<span className="flex size-full [&>svg]:size-full">{icon}</span>} size={34} color={ids.length === 0 ? GOOD : bad ? 'var(--danger)' : WARN} />}
        trailing={
          <>
            <span className={ids.length ? 'text-[17px] font-semibold text-fg' : 'text-[17px] font-semibold text-faint'}>{ids.length}</span>
            {ids.length > 0 && <Chevron />}
          </>
        }
        onClick={ids.length ? () => setList({ title: label, ids }) : undefined}
      />
    </>
  );

  const breachedRows = breach.results
    ? [...breach.results.entries()]
        .map(([id, n]) => ({ item: items.find((i) => i.id === id), n }))
        .filter((x) => x.item)
        .sort((a, b) => b.n - a.n)
    : [];
  const listItems = list ? [...new Set(list.ids)].map((id) => items.find((i) => i.id === id)).filter((i) => !!i) : [];

  return (
    <Column>
      <Stack gap={12}>
        <LargeTitle className="pl-1.5">{t('a.sec_title')}</LargeTitle>
        <Body className="px-1.5">{t('a.sec_subtitle')}</Body>
        <InsetGroup>
          <div className="flex items-center gap-[18px] p-[18px]">
            <div className="relative size-24 shrink-0">
              <svg viewBox="0 0 100 100" className="size-full -rotate-[225deg]" aria-hidden>
                <circle cx="50" cy="50" r={r} fill="none" stroke="var(--surface-3)" strokeWidth="10" strokeLinecap="round" strokeDasharray={`${arc} 999`} />
                <circle
                  cx="50"
                  cy="50"
                  r={r}
                  fill="none"
                  stroke={scoreColor}
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={`${arc * (report.score / 100)} 999`}
                  className="transition-[stroke-dasharray] duration-700 ease-[var(--ease-spring)]"
                />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center text-[30px] font-bold text-fg">{report.score}</span>
            </div>
            <div className="min-w-0">
              <Headline className="!text-[inherit]">
                <span style={{ color: scoreColor }}>{report.score >= 80 ? t('a.sec_great') : report.score >= 50 ? t('a.sec_ok') : t('a.sec_bad')}</span>
              </Headline>
              <p className="text-[13px] text-muted">{t('a.sec_summary', { 1: report.total, 2: report.withPassword })}</p>
            </div>
          </div>
        </InsetGroup>
        <InsetGroup>
          <Issue first label={t('a.sec_weak')} icon={<TriangleAlert />} ids={report.weak} bad />
          <Issue label={t('a.sec_reused')} icon={<Copy />} ids={report.reused.flat()} bad />
          <Issue label={t('a.sec_duplicates')} icon={<Users />} ids={report.duplicates.flat()} bad={false} />
          <Issue label={t('a.sec_old')} icon={<Clock />} ids={report.old} bad={false} />
        </InsetGroup>
        <InsetGroup>
          <Issue first label={t('a.sec_missing_url')} icon={<Link />} ids={report.missingUrl} bad={false} />
          <Issue label={t('a.sec_missing_login')} icon={<User />} ids={report.missingLogin} bad={false} />
          <Issue label={t('a.sec_uncategorized')} icon={<Inbox />} ids={report.uncategorized} bad={false} />
        </InsetGroup>

        <SectionHeader>{t('a.breach_title')}</SectionHeader>
        <Footnote className="px-4">{t('a.breach_desc')}</Footnote>
        {breach.running ? (
          <Footnote className="px-4 !text-accent">{t('a.breach_progress', { 1: breach.done, 2: breach.total })}</Footnote>
        ) : (
          <GlassButton block prominent={false} icon={<Search />} onClick={() => void runBreach()}>
            {t('a.breach_start')}
          </GlassButton>
        )}
        {breach.error && <Footnote className="px-4 !text-danger">{t('a.breach_error', { 1: breach.error })}</Footnote>}
        {breach.results && !breach.running && (
          breachedRows.length === 0 ? (
            <Footnote className="px-4" >
              <span style={{ color: GOOD }}>{t('a.breach_none')}</span>
            </Footnote>
          ) : (
            <>
              <Footnote className="px-4 !text-danger">{t('a.breach_found_desc')}</Footnote>
              <InsetGroup>
                {breachedRows.map(({ item, n }, i) => (
                  <div key={item!.id}>
                    {i > 0 && <GroupDivider inset={64} />}
                    <ListRow
                      title={item!.title}
                      subtitle={t('a.breach_times', { 1: n.toLocaleString() })}
                      leading={<IconTile icon={<TriangleAlert className="size-full" />} size={34} color="var(--danger)" />}
                      trailing={<Chevron />}
                      onClick={() => navigate({ name: 'item', id: item!.id })}
                    />
                  </div>
                ))}
              </InsetGroup>
            </>
          )
        )}
      </Stack>

      <Modal open={!!list} onClose={() => setList(null)} title={list?.title ?? ''} size="sm">
        <InsetGroup className="mb-1">
          {listItems.map((item, i) => {
            const Icon = ITEM_TYPE_ICONS[item!.type];
            return (
              <div key={item!.id}>
                {i > 0 && <GroupDivider inset={64} />}
                <ListRow
                  title={item!.title}
                  subtitle={item!.username ?? item!.email}
                  leading={<IconTile icon={Icon ? <Icon className="size-full" /> : null} size={34} />}
                  trailing={<Chevron />}
                  onClick={() => {
                    setList(null);
                    navigate({ name: 'item', id: item!.id });
                  }}
                />
              </div>
            );
          })}
        </InsetGroup>
      </Modal>
    </Column>
  );
}
