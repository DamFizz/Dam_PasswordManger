import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, KeyRound, LockKeyhole, PanelLeftClose, PanelLeftOpen, Plus, Settings, ShieldCheck, Star, WandSparkles } from 'lucide-react';
import { useT } from '../../i18n';
import { lock, moveItems, navigate, openEditor, useApp, type Route } from '../../state/app';
import { setPrefs, usePrefs } from '../../state/prefs-store';
import type { Collection } from '../../vault/types';
import { Button, IconButton } from '../components/Button';
import { Segmented } from '../components/Field';
import { Logo } from '../components/Misc';
import { cx } from '../cx';
import { CollectionIcon } from '../icons';
import { descendantSectionIds, matchesFilter } from '../filtering';
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
          'flex w-full items-center gap-2.5 rounded-full text-[14px] transition-colors duration-200 cursor-pointer',
          collapsed ? 'h-10 justify-center' : 'h-9 px-3',
          active ? 'bg-[var(--seg-thumb)] text-fg font-semibold shadow-[inset_0_1px_0_var(--glass-sheen)] [&_svg]:text-accent' : 'text-fg/85 hover:bg-surface-2 hover:text-fg',
          over && 'bg-accent-soft text-fg outline outline-1 outline-accent',
        )}
        style={!collapsed && depth ? { paddingLeft: `${8 + depth * 16}px` } : undefined}
      >
        <span className="flex size-4 shrink-0 items-center justify-center [&>svg]:size-4">{icon}</span>
        {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{label}</span>}
        {!collapsed && count !== undefined && count > 0 && <span className={cx('text-xs tabular-nums text-faint', !!trailing && 'mr-6')}>{count}</span>}
      </button>
      {!collapsed && trailing && <div className="absolute right-1 top-1/2 -translate-y-1/2">{trailing}</div>}
    </div>
  );
}

function FolderTree({ sections, parentId, depth, collapsed, onNavigate, counts }: { sections: Collection[]; parentId: string | null; depth: number; collapsed: boolean; onNavigate?: () => void; counts: Map<string, number> }) {
  const t = useT();
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
                    aria-label={isClosed ? t('nav.expandFolder', { name: s.name }) : t('nav.collapseFolder', { name: s.name })}
                    aria-expanded={!isClosed}
                    className="flex size-6 items-center justify-center rounded text-faint hover:bg-surface-3 hover:text-fg cursor-pointer"
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
            {hasKids && !isClosed && !collapsed && <FolderTree sections={sections} parentId={s.id} depth={depth + 1} collapsed={collapsed} onNavigate={onNavigate} counts={counts} />}
          </div>
        );
      })}
    </>
  );
}

/**
 * Main navigation: All items and Favorites, then your categories or folders (switchable),
 * plus three tools. Types, archive and trash live in the list's filter menu; sync, backup
 * and organising live in Settings.
 */
export function Sidebar({ variant = 'desktop', onNavigate }: { variant?: 'desktop' | 'drawer'; onNavigate?: () => void }) {
  const t = useT();
  const prefs = usePrefs();
  const items = useApp((s) => s.items);
  const collections = useApp((s) => s.collections);
  const usage = useApp((s) => s.usage);
  const collapsed = variant === 'desktop' && prefs.sidebarCollapsed;

  const counts = useMemo(() => {
    const ctx = { collections, usage };
    const folders = new Map<string, number>();
    for (const c of collections) {
      if (c.kind === 'section') folders.set(c.id, items.filter((i) => matchesFilter(i, { kind: 'section', id: c.id }, { ...ctx, sectionScope: descendantSectionIds(collections, c.id) })).length);
      else folders.set(c.id, items.filter((i) => matchesFilter(i, { kind: 'category', id: c.id }, ctx)).length);
    }
    return {
      all: items.filter((i) => matchesFilter(i, { kind: 'all' }, ctx)).length,
      favorites: items.filter((i) => matchesFilter(i, { kind: 'favorites' }, ctx)).length,
      folders,
    };
  }, [items, collections, usage]);

  const folders = collections.filter((c) => c.kind === 'section');
  const categories = collections.filter((c) => c.kind === 'category').sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order || a.name.localeCompare(b.name));
  const group = prefs.sidebarGroup;
  const nav = (p: Omit<NavProps, 'collapsed' | 'onNavigate'>) => <NavItem {...p} collapsed={collapsed} onNavigate={onNavigate} />;

  return (
    <nav aria-label={t('nav.main')} className={cx('flex h-full flex-col', variant === 'desktop' ? cx('transition-[width] duration-300 ease-[var(--ease-ios)]', collapsed ? 'w-[64px]' : 'w-[248px]') : 'w-full')}>
      <div className={cx('flex h-14 shrink-0 items-center', collapsed ? 'justify-center' : 'justify-between pl-4 pr-2')}>
        {!collapsed && (
          <div className="flex items-center gap-2">
            <Logo className="size-6" />
            <span className="text-[15px] font-semibold">MyVault</span>
          </div>
        )}
        {variant === 'desktop' && (
          <IconButton label={collapsed ? t('nav.expand') : t('nav.collapse')} size="sm" onClick={() => setPrefs({ sidebarCollapsed: !prefs.sidebarCollapsed })}>
            {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
          </IconButton>
        )}
      </div>

      <div className={cx('pb-3', collapsed ? 'px-2' : 'px-3')}>
        {collapsed ? (
          <IconButton label={t('item.new')} tone="accent" className="w-full" onClick={() => openEditor({ mode: 'new', type: 'login' })}>
            <Plus className="size-4" />
          </IconButton>
        ) : (
          <Button
            variant="primary"
            block
            icon={<Plus className="size-4" />}
            onClick={() => {
              openEditor({ mode: 'new', type: 'login' });
              onNavigate?.();
            }}
          >
            {t('item.new')}
          </Button>
        )}
      </div>

      <div className={cx('min-h-0 flex-1 overflow-y-auto pb-4', collapsed ? 'px-2' : 'px-3')}>
        <div className="space-y-px">
          {nav({ icon: <KeyRound />, label: t('nav.all'), route: { name: 'items', filter: { kind: 'all' } }, count: counts.all, dropTarget: { sectionId: null } })}
          {nav({ icon: <Star />, label: t('nav.favorites'), route: { name: 'items', filter: { kind: 'favorites' } }, count: counts.favorites })}
        </div>

        <div className={cx(collapsed ? 'mt-3 border-t border-line pt-3' : 'mt-5')}>
          {!collapsed && (
            <div className="mb-2 flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <Segmented
                  label={t('nav.browseBy')}
                  value={group}
                  onChange={(v) => setPrefs({ sidebarGroup: v })}
                  size="sm"
                  block
                  options={[
                    { value: 'categories', label: t('nav.categories') },
                    { value: 'folders', label: t('nav.folders') },
                  ]}
                />
              </div>
              <button
                type="button"
                aria-label={group === 'categories' ? t('organize.newCategory') : t('organize.newSection')}
                title={group === 'categories' ? t('organize.newCategory') : t('organize.newSection')}
                className="pressable flex size-8 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 hover:text-fg cursor-pointer"
                onClick={() => {
                  navigate({ name: 'organize', create: group === 'categories' ? 'category' : 'section' });
                  onNavigate?.();
                }}
              >
                <Plus className="size-4" />
              </button>
            </div>
          )}
          <div className="space-y-px">
            {group === 'categories' ? (
              categories.length === 0 && !collapsed ? (
                <p className="px-3 py-1 text-[13px] text-faint">{t('organize.noCategories')}</p>
              ) : (
                categories.map((c) => (
                  <div key={c.id}>
                    {nav({
                      icon: <CollectionIcon name={c.icon} color={c.color} />,
                      label: c.name,
                      route: { name: 'items', filter: { kind: 'category', id: c.id } },
                      count: counts.folders.get(c.id),
                      dropTarget: { categoryId: c.id },
                    })}
                  </div>
                ))
              )
            ) : folders.length === 0 && !collapsed ? (
              <p className="px-3 py-1 text-[13px] text-faint">{t('nav.noFolders')}</p>
            ) : (
              <FolderTree sections={folders} parentId={null} depth={0} collapsed={collapsed} onNavigate={onNavigate} counts={counts.folders} />
            )}
          </div>
        </div>
      </div>

      <div className={cx('shrink-0 space-y-px py-2', collapsed ? 'px-2' : 'px-3')}>
        {nav({ icon: <WandSparkles />, label: t('nav.generatorShort'), route: { name: 'generator' } })}
        {nav({ icon: <ShieldCheck />, label: t('nav.securityShort'), route: { name: 'security' } })}
        {nav({ icon: <Settings />, label: t('nav.settings'), route: { name: 'settings' } })}
      </div>
      <div className={cx('flex shrink-0 items-center gap-1 p-2', collapsed && 'flex-col')}>
        <SyncPill className={collapsed ? '' : 'min-w-0 flex-1'} compact={collapsed} />
        <IconButton label={t('action.lockNow')} size="sm" onClick={() => lock('manual')}>
          <LockKeyhole className="size-4" />
        </IconButton>
      </div>
    </nav>
  );
}
