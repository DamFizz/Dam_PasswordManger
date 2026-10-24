import { useMemo, useState, type ReactNode } from 'react';
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Clock,
  Cloud,
  DatabaseBackup,
  FolderPlus,
  History,
  KeyRound,
  LayoutDashboard,
  Layers,
  LockKeyhole,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Star,
  StickyNote,
  Tag,
  Trash2,
  WandSparkles,
  Wifi,
  SlidersHorizontal,
} from 'lucide-react';
import { useT } from '../../i18n';
import { lock, moveItems, navigate, useApp, type Filter, type Route } from '../../state/app';
import { setPrefs, usePrefs } from '../../state/prefs-store';
import type { Collection } from '../../vault/types';
import { IconButton } from '../components/Button';
import { Logo } from '../components/Misc';
import { cx } from '../cx';
import { CollectionIcon } from '../icons';
import { matchesFilter, descendantSectionIds } from '../filtering';
import { SyncPill } from './SyncPill';

export const DRAG_MIME = 'application/x-myvault-items';

function sameRoute(a: Route, b: Route): boolean {
  if (a.name !== b.name) return false;
  if (a.name === 'items' && b.name === 'items') return JSON.stringify(a.filter) === JSON.stringify(b.filter);
  return true;
}

interface NavProps {
  icon: ReactNode;
  label: string;
  route: Route;
  count?: number;
  collapsed: boolean;
  onNavigate?: () => void;
  dropTarget?: { sectionId?: string | null; categoryId?: string | null };
  depth?: number;
  trailing?: ReactNode;
}

function NavItem({ icon, label, route, count, collapsed, onNavigate, dropTarget, depth = 0, trailing }: NavProps) {
  const current = useApp((s) => s.route);
  const active = sameRoute(current, route);
  const [over, setOver] = useState(false);
  return (
    <div
      className="relative"
      onDragOver={
        dropTarget
          ? (e) => {
              if (e.dataTransfer.types.includes(DRAG_MIME)) {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                setOver(true);
              }
            }
          : undefined
      }
      onDragLeave={dropTarget ? () => setOver(false) : undefined}
      onDrop={
        dropTarget
          ? (e) => {
              e.preventDefault();
              setOver(false);
              try {
                const ids = JSON.parse(e.dataTransfer.getData(DRAG_MIME)) as string[];
                if (Array.isArray(ids) && ids.length) void moveItems(ids, dropTarget);
              } catch {
                /* ignore foreign drops */
              }
            }
          : undefined
      }
    >
      <button
        type="button"
        onClick={() => {
          navigate(route);
          onNavigate?.();
        }}
        title={collapsed ? label : undefined}
        aria-current={active ? 'page' : undefined}
        className={cx(
          'group flex w-full items-center gap-3 rounded-xl text-[14px] transition-colors duration-150 cursor-pointer',
          collapsed ? 'h-10 justify-center' : 'h-9 px-2.5',
          active ? 'bg-accent-soft text-fg font-medium' : 'text-muted hover:bg-surface-2 hover:text-fg',
          over && 'ring-2 ring-accent bg-accent-soft',
        )}
        style={!collapsed && depth ? { paddingLeft: `${10 + depth * 14}px` } : undefined}
      >
        <span className={cx('flex size-5 shrink-0 items-center justify-center [&>svg]:size-[18px]', active && 'text-accent')}>{icon}</span>
        {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
        {!collapsed && count !== undefined && count > 0 && <span className="text-xs tabular-nums text-faint">{count}</span>}
      </button>
      {!collapsed && trailing && <div className="absolute right-1 top-1/2 -translate-y-1/2">{trailing}</div>}
    </div>
  );
}

function Group({ title, children, collapsed, open, onToggle, action }: { title: string; children: ReactNode; collapsed: boolean; open: boolean; onToggle: () => void; action?: ReactNode }) {
  if (collapsed) return <div className="mt-3 space-y-0.5 border-t border-line pt-3">{children}</div>;
  return (
    <div className="mt-5">
      <div className="mb-1 flex items-center justify-between px-2.5">
        <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-faint hover:text-muted cursor-pointer">
          {open ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
          {title}
        </button>
        {action}
      </div>
      {open && <div className="space-y-0.5">{children}</div>}
    </div>
  );
}

function SectionTree({ sections, parentId, depth, collapsed, onNavigate, counts }: { sections: Collection[]; parentId: string | null; depth: number; collapsed: boolean; onNavigate?: () => void; counts: Map<string, number> }) {
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const children = sections.filter((s) => (s.parentId ?? null) === parentId).sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order || a.name.localeCompare(b.name));
  return (
    <>
      {children.map((s) => {
        const hasKids = sections.some((c) => c.parentId === s.id);
        const isClosed = closed.has(s.id);
        return (
          <div key={s.id}>
            <NavItem
              icon={<CollectionIcon name={s.icon} color={s.color} />}
              label={s.name}
              route={{ name: 'items', filter: { kind: 'section', id: s.id } }}
              count={counts.get(s.id)}
              collapsed={collapsed}
              onNavigate={onNavigate}
              dropTarget={{ sectionId: s.id }}
              depth={depth}
              trailing={
                hasKids ? (
                  <button
                    type="button"
                    aria-label={isClosed ? 'Expand' : 'Collapse'}
                    aria-expanded={!isClosed}
                    className="flex size-6 items-center justify-center rounded-md text-faint hover:bg-surface-3 hover:text-fg cursor-pointer"
                    onClick={() =>
                      setClosed((prev) => {
                        const n = new Set(prev);
                        if (n.has(s.id)) n.delete(s.id);
                        else n.add(s.id);
                        return n;
                      })
                    }
                  >
                    {isClosed ? <ChevronRight className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                  </button>
                ) : undefined
              }
            />
            {hasKids && !isClosed && !collapsed && <SectionTree sections={sections} parentId={s.id} depth={depth + 1} collapsed={collapsed} onNavigate={onNavigate} counts={counts} />}
          </div>
        );
      })}
    </>
  );
}

export function Sidebar({ variant = 'desktop', onNavigate }: { variant?: 'desktop' | 'drawer'; onNavigate?: () => void }) {
  const t = useT();
  const prefs = usePrefs();
  const items = useApp((s) => s.items);
  const collections = useApp((s) => s.collections);
  const usage = useApp((s) => s.usage);
  const collapsed = variant === 'desktop' && prefs.sidebarCollapsed;
  const [open, setOpen] = useState({ categories: true, sections: true, tags: false, types: true });

  const counts = useMemo(() => {
    const ctx = { collections, usage };
    const count = (f: Filter) => items.filter((i) => matchesFilter(i, f, ctx)).length;
    const m = new Map<string, number>();
    for (const c of collections) {
      if (c.kind === 'category') m.set(c.id, count({ kind: 'category', id: c.id }));
      else m.set(c.id, items.filter((i) => matchesFilter(i, { kind: 'section', id: c.id }, { ...ctx, sectionScope: descendantSectionIds(collections, c.id) })).length);
    }
    const tags = new Map<string, number>();
    for (const i of items) if (!i.trashedAt && !i.archivedAt) for (const tg of i.tags) tags.set(tg, (tags.get(tg) ?? 0) + 1);
    return {
      all: count({ kind: 'all' }),
      favorites: count({ kind: 'favorites' }),
      recentAdded: count({ kind: 'recentAdded' }),
      recentUsed: count({ kind: 'recentUsed' }),
      login: count({ kind: 'type', type: 'login' }),
      note: count({ kind: 'type', type: 'note' }),
      other: count({ kind: 'type', type: 'other' }),
      archive: count({ kind: 'archive' }),
      trash: count({ kind: 'trash' }),
      collections: m,
      tags: [...tags.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    };
  }, [items, collections, usage]);

  const categories = collections.filter((c) => c.kind === 'category').sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order);
  const sections = collections.filter((c) => c.kind === 'section');
  const toggle = (k: keyof typeof open) => setOpen((o) => ({ ...o, [k]: !o[k] }));
  const nav = (p: Omit<NavProps, 'collapsed' | 'onNavigate'>) => <NavItem {...p} collapsed={collapsed} onNavigate={onNavigate} />;

  return (
    <nav aria-label={t('nav.main')} className={cx('flex h-full flex-col', variant === 'desktop' ? cx('border-r border-line bg-surface/60 backdrop-blur transition-[width] duration-200', collapsed ? 'w-[68px]' : 'w-[264px]') : 'w-full')}>
      <div className={cx('flex h-16 shrink-0 items-center', collapsed ? 'justify-center' : 'justify-between px-4')}>
        {!collapsed && (
          <button type="button" className="flex items-center gap-2.5 cursor-pointer" onClick={() => { navigate({ name: 'dashboard' }); onNavigate?.(); }}>
            <Logo className="size-8" />
            <span className="text-[17px] font-semibold tracking-tight">MyVault</span>
          </button>
        )}
        {variant === 'desktop' && (
          <IconButton label={collapsed ? t('nav.expand') : t('nav.collapse')} size="sm" onClick={() => setPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed })}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </IconButton>
        )}
      </div>

      <div className={cx('min-h-0 flex-1 overflow-y-auto pb-4', collapsed ? 'px-2.5' : 'px-3')}>
        <div className="space-y-0.5">
          {nav({ icon: <LayoutDashboard />, label: t('nav.dashboard'), route: { name: 'dashboard' } })}
          {nav({ icon: <Layers />, label: t('nav.all'), route: { name: 'items', filter: { kind: 'all' } }, count: counts.all, dropTarget: { sectionId: null } })}
          {nav({ icon: <Star />, label: t('nav.favorites'), route: { name: 'items', filter: { kind: 'favorites' } }, count: counts.favorites })}
          {nav({ icon: <Clock />, label: t('nav.recentAdded'), route: { name: 'items', filter: { kind: 'recentAdded' } }, count: counts.recentAdded })}
          {nav({ icon: <History />, label: t('nav.recentUsed'), route: { name: 'items', filter: { kind: 'recentUsed' } }, count: counts.recentUsed })}
        </div>

        <Group title={t('nav.types')} collapsed={collapsed} open={open.types} onToggle={() => toggle('types')}>
          {nav({ icon: <KeyRound />, label: t('nav.passwords'), route: { name: 'items', filter: { kind: 'type', type: 'login' } }, count: counts.login })}
          {nav({ icon: <StickyNote />, label: t('nav.notes'), route: { name: 'items', filter: { kind: 'type', type: 'note' } }, count: counts.note })}
          {nav({ icon: <Wifi />, label: t('nav.otherItems'), route: { name: 'items', filter: { kind: 'type', type: 'other' } }, count: counts.other })}
        </Group>

        <Group
          title={t('nav.categories')}
          collapsed={collapsed}
          open={open.categories}
          onToggle={() => toggle('categories')}
          action={
            <button type="button" aria-label={t('organize.manage')} title={t('organize.manage')} className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg cursor-pointer" onClick={() => { navigate({ name: 'organize' }); onNavigate?.(); }}>
              <SlidersHorizontal className="size-3.5" />
            </button>
          }
        >
          {categories.map((c) =>
            nav({
              icon: <CollectionIcon name={c.icon} color={c.color} />,
              label: c.name,
              route: { name: 'items', filter: { kind: 'category', id: c.id } },
              count: counts.collections.get(c.id),
              dropTarget: { categoryId: c.id },
            }),
          ).map((el, i) => <div key={categories[i].id}>{el}</div>)}
        </Group>

        <Group
          title={t('nav.sections')}
          collapsed={collapsed}
          open={open.sections}
          onToggle={() => toggle('sections')}
          action={
            <button type="button" aria-label={t('organize.newSection')} title={t('organize.newSection')} className="rounded-md p-1 text-faint hover:bg-surface-2 hover:text-fg cursor-pointer" onClick={() => { navigate({ name: 'organize', create: 'section' }); onNavigate?.(); }}>
              <FolderPlus className="size-3.5" />
            </button>
          }
        >
          {sections.length === 0 && !collapsed ? (
            <p className="px-2.5 py-1 text-xs leading-relaxed text-faint">{t('nav.noSections')}</p>
          ) : (
            <SectionTree sections={sections} parentId={null} depth={0} collapsed={collapsed} onNavigate={onNavigate} counts={counts.collections} />
          )}
        </Group>

        {counts.tags.length > 0 && (
          <Group title={t('nav.tags')} collapsed={collapsed} open={open.tags} onToggle={() => toggle('tags')}>
            {counts.tags.map(([tag, n]) => (
              <div key={tag}>{nav({ icon: <Tag />, label: tag, route: { name: 'items', filter: { kind: 'tag', tag } }, count: n })}</div>
            ))}
          </Group>
        )}

        <div className={cx('space-y-0.5', collapsed ? 'mt-3 border-t border-line pt-3' : 'mt-5')}>
          {nav({ icon: <Archive />, label: t('nav.archive'), route: { name: 'items', filter: { kind: 'archive' } }, count: counts.archive })}
          {nav({ icon: <Trash2 />, label: t('nav.trash'), route: { name: 'items', filter: { kind: 'trash' } }, count: counts.trash })}
        </div>

        <div className={cx('space-y-0.5', collapsed ? 'mt-3 border-t border-line pt-3' : 'mt-5 border-t border-line pt-4')}>
          {nav({ icon: <WandSparkles />, label: t('nav.generator'), route: { name: 'generator' } })}
          {nav({ icon: <ShieldCheck />, label: t('nav.security'), route: { name: 'security' } })}
          {nav({ icon: <Cloud />, label: t('nav.sync'), route: { name: 'sync' } })}
          {nav({ icon: <DatabaseBackup />, label: t('nav.backup'), route: { name: 'backup' } })}
          {nav({ icon: <Settings />, label: t('nav.settings'), route: { name: 'settings' } })}
        </div>
      </div>

      <div className={cx('shrink-0 border-t border-line p-3', collapsed ? 'flex flex-col items-center gap-2' : 'flex items-center gap-2')}>
        {!collapsed && <SyncPill className="min-w-0 flex-1" />}
        <IconButton label={t('action.lockNow')} onClick={() => lock('manual')} tone="accent">
          <LockKeyhole className="size-[18px]" />
        </IconButton>
      </div>
    </nav>
  );
}
