/**
 * Vault tab, as in the Android app:
 *  - Home: overview (security score, backup reminder, damaged records), All items / Favourites
 *    tiles, category tiles, folder tiles. Long-press a tile to edit it.
 *  - List: back + large title, Views and Sort chips, grouped rows; long-press to select several.
 *  - Typing in search shows matching items from the whole vault.
 */
import { useMemo, useState, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Check,
  ChevronRight,
  CirclePlus,
  CloudUpload,
  Filter as FilterIcon,
  FolderInput,
  FolderPlus,
  History,
  Inbox,
  ListFilter,
  NotebookText,
  Plus,
  RotateCcw,
  ShieldCheck,
  Star,
  Tag,
  Trash2,
  TriangleAlert,
  User,
  Wifi,
  X,
} from 'lucide-react';
import { useT } from '../../i18n';
import {
  app,
  archiveItems,
  back,
  emptyTrash,
  moveItems,
  navigate,
  restoreItems,
  toggleFavorite,
  trashItems,
  useApp,
  type Filter,
} from '../../state/app';
import { setPrefs, usePrefs } from '../../state/prefs-store';
import { confirmDialog } from '../../state/ui';
import { analyzeVault } from '../../lib/security-analysis';
import type { Collection, VaultItem } from '../../vault/types';
import { Modal } from '../components/Modal';
import { cx } from '../cx';
import { CollectionIcon, ITEM_TYPE_ICONS } from '../icons';
import { descendantSectionIds, visibleItems } from '../filtering';
import { allTags, itemSubtitle, sectionOptions } from '../items/helpers';
import { Body, CheckMark, Chevron, Chip, Column, Footnote, GlassButton, GroupDivider, IconTile, InsetGroup, LargeTitle, ListRow, RowIconButton, SectionHeader } from './kit';
import { CollectionEditor, newCollectionTemplate } from './CollectionEditor';

export function typeLabelKey(type: string): string {
  return `a.type_${type}`;
}

export function useFilterLabel(filter: Filter, collections: Collection[]): string {
  const t = useT();
  switch (filter.kind) {
    case 'all':
      return t('a.vault_all_items');
    case 'favorites':
      return t('a.vault_favorites');
    case 'recentAdded':
      return t('a.nav_recent_added');
    case 'recentUsed':
      return t('a.nav_recent_used');
    case 'type':
      return filter.type === 'login' ? t('a.nav_passwords') : filter.type === 'note' ? t('a.nav_notes') : t('a.nav_other');
    case 'category':
    case 'section':
      return collections.find((c) => c.id === filter.id)?.name ?? t('a.vault_all_items');
    case 'tag':
      return `#${filter.tag}`;
    case 'uncategorized':
      return t('a.nav_uncategorized');
    case 'archive':
      return t('a.nav_archive');
    case 'trash':
      return t('a.nav_trash');
    case 'ids':
      return filter.label;
  }
}

function backupDue(lastBackupAt: number | null, days: number, items: number): boolean {
  if (!items || days <= 0) return false;
  return !lastBackupAt || Date.now() - lastBackupAt > days * 86_400_000;
}

export function VaultTab() {
  const t = useT();
  const prefs = usePrefs();
  const route = useApp((s) => s.route);
  const items = useApp((s) => s.items);
  const collections = useApp((s) => s.collections);
  const usage = useApp((s) => s.usage);
  const search = useApp((s) => s.search);
  const selection = useApp((s) => s.selection);
  const [views, setViews] = useState(false);
  const [sort, setSort] = useState(false);
  const [move, setMove] = useState(false);
  const [editing, setEditing] = useState<Collection | null>(null);

  const filter: Filter = route.name === 'items' ? route.filter : { kind: 'all' };
  const query = search.trim();
  const home = route.name === 'home' && !query && selection.length === 0;
  const shown = useMemo(
    () => (home ? [] : visibleItems(items, query ? { kind: 'all' } : filter, query, { collections, usage, sortBy: prefs.sortBy })),
    [home, items, filter, query, collections, usage, prefs.sortBy],
  );
  const label = useFilterLabel(filter, collections);

  return (
    <Column wide={home}>
      {route.name === 'items' && !query ? (
        <div className="mb-3 flex items-center gap-1">
          <RowIconButton label={t('a.back')} onClick={back} tone="fg">
            <ArrowLeft />
          </RowIconButton>
          <LargeTitle className="min-w-0 truncate">{label}</LargeTitle>
        </div>
      ) : (
        <LargeTitle className="mb-3 pl-1.5">MyVault</LargeTitle>
      )}

      {!home && (
        <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 py-3">
          {!query && (
            <Chip icon={<FilterIcon />} selected={filter.kind !== 'all'} onClick={() => setViews(true)}>
              {label}
            </Chip>
          )}
          <Chip icon={<ListFilter />} onClick={() => setSort(true)}>
            {t('a.sort_title')}
          </Chip>
        </div>
      )}

      {selection.length > 0 ? (
        <SelectionBar filter={filter} onMove={() => setMove(true)} />
      ) : home ? (
        <Home onEdit={setEditing} />
      ) : null}

      {!home && filter.kind === 'trash' && shown.length > 0 && !query && (
        <GlassButton
          block
          prominent={false}
          destructive
          icon={<Trash2 />}
          className="mb-3"
          onClick={async () => {
            const ok = await confirmDialog({ title: t('a.trash_empty'), message: t('a.purge_message'), confirmLabel: t('a.trash_empty'), danger: true });
            if (ok) await emptyTrash();
          }}
        >
          {t('a.trash_empty')}
        </GlassButton>
      )}

      {!home && shown.length === 0 && <Body className="p-4">{t('a.vault_empty')}</Body>}
      {!home && shown.length > 0 && <ItemRows items={shown} />}
      {!home && shown.length > 0 && selection.length === 0 && <Footnote className="px-4 pt-3">{t('a.sel_hint')}</Footnote>}

      <ViewsSheet open={views} onClose={() => setViews(false)} filter={filter} />
      <SortSheet open={sort} onClose={() => setSort(false)} />
      <MoveSheet open={move} onClose={() => setMove(false)} ids={selection} />
      <CollectionEditor value={editing} onChange={setEditing} />
    </Column>
  );
}

// ---------------------------------------------------------------- home

function Home({ onEdit }: { onEdit: (c: Collection) => void }) {
  const t = useT();
  const prefs = usePrefs();
  const items = useApp((s) => s.items);
  const collections = useApp((s) => s.collections);
  const settings = useApp((s) => s.settings);
  const corrupted = useApp((s) => s.corrupted);
  const conflicts = useApp((s) => s.conflicts);
  const lastBackupAt = useApp((s) => s.lastBackupAt);
  const active = useMemo(() => items.filter((i) => !i.trashedAt && !i.archivedAt), [items]);
  const report = useMemo(() => analyzeVault(active, { oldPasswordDays: settings.oldPasswordDays }), [active, settings.oldPasswordDays]);
  const withPassword = active.some((i) => i.type === 'login' && i.password);
  const due = backupDue(lastBackupAt, prefs.backupReminderDays, active.length);

  const byCategory = useMemo(() => count(active, (i) => i.categoryId), [active]);
  const bySection = useMemo(() => count(active, (i) => i.sectionId), [active]);
  const sorted = (kind: Collection['kind'], top: boolean) =>
    collections
      .filter((c) => c.kind === kind && (!top || !c.parentId))
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.order - b.order || a.name.localeCompare(b.name));
  const categories = sorted('category', false);
  const folders = sorted('section', true);
  const uncategorized = active.filter((i) => !i.categoryId && !i.sectionId).length;
  const open = (f: Filter) => navigate({ name: 'items', filter: f });

  return (
    <div className="flex flex-col gap-3">
      {(withPassword || due || corrupted > 0 || conflicts.length > 0) && (
        <InsetGroup>
          {withPassword && (
            <ListRow
              title={t('a.dash_security', { 1: report.score })}
              subtitle={t('a.dash_security_sub', { 1: report.weak.length, 2: report.reused.reduce((n, g) => n + g.length, 0) })}
              leading={<IconTile icon={<ShieldCheck className="size-full" />} size={34} />}
              trailing={<Chevron />}
              onClick={() => navigate({ name: 'security' })}
            />
          )}
          {due && (
            <>
              {withPassword && <GroupDivider inset={64} />}
              <ListRow
                title={t('a.bk_title')}
                subtitle={t('a.dash_backup_due')}
                leading={<IconTile icon={<CloudUpload className="size-full" />} size={34} color="var(--star)" />}
                trailing={<Chevron />}
                onClick={() => navigate({ name: 'backup' })}
              />
            </>
          )}
          {conflicts.length > 0 && (
            <>
              <GroupDivider inset={64} />
              <ListRow
                title={t('dashboard.conflicts', { n: conflicts.length })}
                leading={<IconTile icon={<TriangleAlert className="size-full" />} size={34} color="var(--warning)" />}
                trailing={<Chevron />}
                onClick={() => navigate({ name: 'sync' })}
              />
            </>
          )}
          {corrupted > 0 && (
            <>
              <GroupDivider inset={64} />
              <ListRow title={t('a.dash_corrupted', { 1: corrupted })} leading={<IconTile icon={<TriangleAlert className="size-full" />} size={34} color="var(--danger)" />} />
            </>
          )}
        </InsetGroup>
      )}

      <TileGrid>
        <VaultTile label={t('a.vault_all_items')} count={active.length} icon={<ShieldCheck />} color="var(--accent)" onClick={() => open({ kind: 'all' })} />
        <VaultTile label={t('a.vault_favorites')} count={active.filter((i) => i.favorite).length} icon={<Star />} color="var(--star)" onClick={() => open({ kind: 'favorites' })} />
      </TileGrid>

      <SectionHeader>{t('a.nav_categories')}</SectionHeader>
      <TileGrid>
        {categories.map((c) => (
          <VaultTile
            key={c.id}
            label={c.name}
            count={byCategory.get(c.id) ?? 0}
            icon={<CollectionIcon name={c.icon} />}
            color={c.color}
            onClick={() => open({ kind: 'category', id: c.id })}
            onLongPress={() => onEdit(c)}
            onDropItems={(ids) => void moveItems(ids, { categoryId: c.id })}
          />
        ))}
        <VaultTile label={t('a.org_new_category')} icon={<Plus />} color="var(--accent)" dashed onClick={() => onEdit(newCollectionTemplate('category', collections))} />
      </TileGrid>

      <SectionHeader>{t('a.nav_folders')}</SectionHeader>
      <TileGrid>
        {folders.map((f) => {
          const n = [...descendantSectionIds(collections, f.id)].reduce((sum, id) => sum + (bySection.get(id) ?? 0), 0);
          return (
            <VaultTile
              key={f.id}
              label={f.name}
              count={n}
              icon={<CollectionIcon name={f.icon} />}
              color={f.color}
              onClick={() => open({ kind: 'section', id: f.id })}
              onLongPress={() => onEdit(f)}
              onDropItems={(ids) => void moveItems(ids, { sectionId: f.id })}
            />
          );
        })}
        <VaultTile label={t('a.org_new_folder')} icon={<FolderPlus />} color="var(--accent)" dashed onClick={() => onEdit(newCollectionTemplate('section', collections))} />
      </TileGrid>

      {uncategorized > 0 && (
        <InsetGroup>
          <ListRow
            title={t('a.nav_uncategorized')}
            leading={<IconTile icon={<Inbox className="size-full" />} size={34} />}
            trailing={
              <>
                <span className="text-[17px] font-semibold text-muted">{uncategorized}</span>
                <Chevron />
              </>
            }
            onClick={() => open({ kind: 'uncategorized' })}
          />
        </InsetGroup>
      )}
      <Footnote className="px-4">{t('a.vault_home_hint')}</Footnote>
    </div>
  );
}

function count<T>(list: T[], key: (x: T) => string | null | undefined): Map<string, number> {
  const m = new Map<string, number>();
  for (const x of list) {
    const k = key(x);
    if (k) m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
}

function TileGrid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{children}</div>;
}

export const DRAG_MIME = 'application/x-myvault-items';

/** Solid content tile (not glass): icon tile, count, name. */
function VaultTile({
  label,
  count: n,
  icon,
  color,
  onClick,
  onLongPress,
  dashed,
  onDropItems,
}: {
  label: string;
  count?: number;
  icon: ReactNode;
  color: string;
  onClick: () => void;
  onLongPress?: () => void;
  dashed?: boolean;
  onDropItems?: (ids: string[]) => void;
}) {
  const [over, setOver] = useState(false);
  const longPress = useTileLongPress(onLongPress);
  return (
    <button
      type="button"
      onClick={() => {
        if (longPress.consume()) return;
        onClick();
      }}
      {...longPress.handlers}
      onDragOver={
        onDropItems
          ? (e) => {
              if (e.dataTransfer.types.includes(DRAG_MIME)) {
                e.preventDefault();
                setOver(true);
              }
            }
          : undefined
      }
      onDragLeave={onDropItems ? () => setOver(false) : undefined}
      onDrop={
        onDropItems
          ? (e) => {
              e.preventDefault();
              setOver(false);
              try {
                const ids = JSON.parse(e.dataTransfer.getData(DRAG_MIME)) as string[];
                if (Array.isArray(ids) && ids.length) onDropItems(ids);
              } catch {
                /* ignore */
              }
            }
          : undefined
      }
      className={cx(
        'lg-tile flex min-h-[116px] flex-col justify-between rounded-[24px] p-[18px] text-left cursor-pointer',
        dashed ? 'border-[1.5px] border-dashed border-line-strong bg-transparent' : 'bg-surface',
        over && 'outline outline-2 outline-accent',
      )}
    >
      <span className="flex w-full items-start justify-between">
        <IconTile icon={<span className="flex size-full [&>svg]:size-full">{icon}</span>} color={color} size={46} />
        {n !== undefined && <span className="text-[24px] font-bold leading-[30px] text-fg">{n}</span>}
      </span>
      <span className="mt-3 line-clamp-2 text-[17px] font-semibold leading-[22px] text-fg">{label}</span>
    </button>
  );
}

function useTileLongPress(onLongPress?: () => void) {
  const state = useMemo(() => ({ timer: 0, fired: false }), []);
  if (!onLongPress) return { handlers: {}, consume: () => false };
  return {
    handlers: {
      onPointerDown: (e: React.PointerEvent) => {
        if (e.button !== 0) return;
        state.fired = false;
        window.clearTimeout(state.timer);
        state.timer = window.setTimeout(() => {
          state.fired = true;
          onLongPress();
        }, 480);
      },
      onPointerUp: () => window.clearTimeout(state.timer),
      onPointerLeave: () => window.clearTimeout(state.timer),
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        window.clearTimeout(state.timer);
        state.fired = true;
        onLongPress();
      },
    },
    consume: () => {
      const f = state.fired;
      state.fired = false;
      return f;
    },
  };
}

// ---------------------------------------------------------------- list

const TYPE_FALLBACK_ICON: Record<string, ReactNode> = { login: <User />, note: <NotebookText />, wifi: <Wifi /> };

export function ItemRows({ items }: { items: VaultItem[] }) {
  const t = useT();
  const selection = useApp((s) => s.selection);
  const selecting = selection.length > 0;
  const toggle = (id: string) => app.set({ selection: selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id] });
  return (
    <InsetGroup>
      {items.map((item, i) => {
        const Icon = ITEM_TYPE_ICONS[item.type];
        const selected = selection.includes(item.id);
        return (
          <div
            key={item.id}
            draggable={!item.trashedAt && !selecting}
            onDragStart={(e) => {
              const ids = selection.length && selection.includes(item.id) ? selection : [item.id];
              e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
              e.dataTransfer.effectAllowed = 'move';
            }}
          >
            {i > 0 && <GroupDivider inset={68} />}
            <ListRow
              title={item.title || t('a.untitled')}
              subtitle={itemSubtitle(item, t(typeLabelKey(item.type) as never))}
              leading={selected ? <IconTile icon={<Check className="size-full" />} /> : <IconTile icon={Icon ? <Icon className="size-full" /> : TYPE_FALLBACK_ICON[item.type]} />}
              trailing={
                <>
                  {item.favorite && <Star className="size-[17px] fill-[var(--star)] text-[var(--star)]" aria-label={t('a.vault_favorites')} />}
                  {!selecting && <Chevron />}
                </>
              }
              selected={selected}
              onClick={() => (selecting ? toggle(item.id) : navigate({ name: 'item', id: item.id }))}
              onLongPress={() => toggle(item.id)}
            />
          </div>
        );
      })}
    </InsetGroup>
  );
}

function SelectionBar({ filter, onMove }: { filter: Filter; onMove: () => void }) {
  const t = useT();
  const ids = useApp((s) => s.selection);
  const clear = () => app.set({ selection: [] });
  return (
    <InsetGroup className="mb-3">
      <div className="flex items-center py-1 pl-4 pr-1">
        <span className="min-w-0 flex-1 text-[17px] font-semibold text-fg">{t('a.sel_count', { 1: ids.length })}</span>
        {filter.kind === 'trash' ? (
          <RowIconButton
            label={t('a.action_restore')}
            onClick={() => {
              void restoreItems(ids);
              clear();
            }}
          >
            <RotateCcw />
          </RowIconButton>
        ) : (
          <>
            <RowIconButton label={t('a.action_favorite')} onClick={() => void toggleFavorite(ids, true)}>
              <Star />
            </RowIconButton>
            <RowIconButton label={t('a.sel_move')} onClick={onMove}>
              <FolderInput />
            </RowIconButton>
            <RowIconButton
              label={filter.kind === 'archive' ? t('a.action_unarchive') : t('a.action_archive')}
              onClick={() => {
                void archiveItems(ids, filter.kind !== 'archive');
                clear();
              }}
            >
              {filter.kind === 'archive' ? <ArchiveRestore /> : <Archive />}
            </RowIconButton>
            <RowIconButton
              label={t('a.action_trash')}
              tone="danger"
              onClick={() => {
                void trashItems(ids);
                clear();
              }}
            >
              <Trash2 />
            </RowIconButton>
          </>
        )}
        <RowIconButton label={t('a.cancel')} tone="muted" onClick={clear}>
          <X />
        </RowIconButton>
      </div>
    </InsetGroup>
  );
}

// ---------------------------------------------------------------- sheets

function ViewsSheet({ open, onClose, filter }: { open: boolean; onClose: () => void; filter: Filter }) {
  const t = useT();
  const items = useApp((s) => s.items);
  const collections = useApp((s) => s.collections);
  const tags = useMemo(() => allTags(items.filter((i) => !i.trashedAt)), [items]);
  const folders = sectionOptions(collections);
  const pick = (f: Filter) => {
    navigate({ name: 'items', filter: f });
    onClose();
  };
  const same = (f: Filter) => JSON.stringify(f) === JSON.stringify(filter);
  const Row = ({ label, icon, f, depth = 0, first }: { label: string; icon: ReactNode; f: Filter; depth?: number; first?: boolean }) => (
    <>
      {!first && <GroupDivider inset={62} />}
      <ListRow title={label} indent={depth} leading={<IconTile icon={<span className="flex size-full [&>svg]:size-full">{icon}</span>} size={32} />} trailing={<CheckMark on={same(f)} />} onClick={() => pick(f)} />
    </>
  );
  return (
    <Modal open={open} onClose={onClose} title={t('a.views_title')} size="sm">
      <div className="flex flex-col gap-3 pb-1">
        <InsetGroup>
          <Row first label={t('a.vault_all')} icon={<ShieldCheck />} f={{ kind: 'all' }} />
          <Row label={t('a.vault_favorites')} icon={<Star />} f={{ kind: 'favorites' }} />
          <Row label={t('a.nav_recent_added')} icon={<CirclePlus />} f={{ kind: 'recentAdded' }} />
          <Row label={t('a.nav_recent_used')} icon={<History />} f={{ kind: 'recentUsed' }} />
        </InsetGroup>
        <InsetGroup>
          <Row first label={t('a.nav_passwords')} icon={<User />} f={{ kind: 'type', type: 'login' }} />
          <Row label={t('a.nav_notes')} icon={<NotebookText />} f={{ kind: 'type', type: 'note' }} />
          <Row label={t('a.nav_other')} icon={<Wifi />} f={{ kind: 'type', type: 'other' }} />
        </InsetGroup>
        {folders.length > 0 && (
          <>
            <SectionHeader>{t('a.nav_folders')}</SectionHeader>
            <InsetGroup>
              {folders.map(({ c, depth }, i) => (
                <Row key={c.id} first={i === 0} label={c.name} icon={<CollectionIcon name={c.icon} />} f={{ kind: 'section', id: c.id }} depth={depth} />
              ))}
            </InsetGroup>
          </>
        )}
        {tags.length > 0 && (
          <>
            <SectionHeader>{t('a.nav_tags')}</SectionHeader>
            <InsetGroup>
              {tags.map((tag, i) => (
                <Row key={tag} first={i === 0} label={tag} icon={<Tag />} f={{ kind: 'tag', tag }} />
              ))}
            </InsetGroup>
          </>
        )}
        <InsetGroup>
          <Row first label={t('a.nav_uncategorized')} icon={<Inbox />} f={{ kind: 'uncategorized' }} />
          <Row label={t('a.nav_archive')} icon={<Archive />} f={{ kind: 'archive' }} />
          <Row label={t('a.nav_trash')} icon={<Trash2 />} f={{ kind: 'trash' }} />
        </InsetGroup>
      </div>
    </Modal>
  );
}

function SortSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const { sortBy } = usePrefs();
  const opts: { v: typeof sortBy; label: string }[] = [
    { v: 'title', label: t('a.sort_az') },
    { v: 'updated', label: t('a.sort_updated') },
    { v: 'created', label: t('a.sort_created') },
    { v: 'used', label: t('a.sort_used') },
  ];
  return (
    <Modal open={open} onClose={onClose} title={t('a.sort_title')} size="sm">
      <InsetGroup className="mb-1">
        {opts.map((o, i) => (
          <div key={o.v}>
            {i > 0 && <GroupDivider />}
            <ListRow
              title={o.label}
              trailing={<CheckMark on={sortBy === o.v} />}
              onClick={() => {
                setPrefs({ sortBy: o.v });
                onClose();
              }}
            />
          </div>
        ))}
      </InsetGroup>
    </Modal>
  );
}

function MoveSheet({ open, onClose, ids }: { open: boolean; onClose: () => void; ids: string[] }) {
  const t = useT();
  const collections = useApp((s) => s.collections);
  const [cat, setCat] = useState<string | null>('keep');
  const [folder, setFolder] = useState<string | null>('keep');
  const categories = collections.filter((c) => c.kind === 'category');
  const folders = sectionOptions(collections);
  const pickRow = (label: string, on: boolean, onClick: () => void, depth = 0, first = false) => (
    <div key={label + depth}>
      {!first && <GroupDivider />}
      <ListRow title={label} indent={depth} trailing={<CheckMark on={on} />} onClick={onClick} />
    </div>
  );
  return (
    <Modal open={open} onClose={onClose} title={t('a.sel_move_title', { 1: ids.length })} size="sm">
      <div className="flex flex-col gap-3 pb-1">
        <SectionHeader>{t('a.field_category')}</SectionHeader>
        <InsetGroup>
          {pickRow(t('a.sel_keep'), cat === 'keep', () => setCat('keep'), 0, true)}
          {pickRow(t('a.field_none'), cat === null, () => setCat(null))}
          {categories.map((c) => pickRow(c.name, cat === c.id, () => setCat(c.id)))}
        </InsetGroup>
        <SectionHeader>{t('a.field_folder')}</SectionHeader>
        <InsetGroup>
          {pickRow(t('a.sel_keep'), folder === 'keep', () => setFolder('keep'), 0, true)}
          {pickRow(t('a.field_none'), folder === null, () => setFolder(null))}
          {folders.map(({ c, depth }) => pickRow(c.name, folder === c.id, () => setFolder(c.id), depth))}
        </InsetGroup>
        <GlassButton
          block
          onClick={() => {
            const patch: { categoryId?: string | null; sectionId?: string | null } = {};
            if (cat !== 'keep') patch.categoryId = cat;
            if (folder !== 'keep') patch.sectionId = folder;
            void moveItems(ids, patch);
            app.set({ selection: [] });
            onClose();
          }}
        >
          {t('a.sel_move')}
        </GlassButton>
      </div>
    </Modal>
  );
}

// re-exported for the item screen
export { ChevronRight };
