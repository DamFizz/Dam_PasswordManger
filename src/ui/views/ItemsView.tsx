import { useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  Check,
  CheckSquare,
  Circle,
  CircleCheck,
  FolderInput,
  KeyRound,
  ListFilter,
  Pencil,
  RotateCcw,
  Search,
  Square,
  SquareCheck,
  Star,
  Tag,
  Trash2,
  TriangleAlert,
  UserRound,
  X,
} from 'lucide-react';
import { useT } from '../../i18n';
import {
  addTags,
  app,
  archiveItems,
  emptyTrash,
  HOME,
  markUsed,
  navigate,
  openEditor,
  purgeItems,
  restoreItems,
  selectItem,
  toggleFavorite,
  trashItems,
  useApp,
  type Filter,
} from '../../state/app';
import { setPrefs, usePrefs } from '../../state/prefs-store';
import { useSync } from '../../state/sync-controller';
import type { Collection, VaultItem } from '../../vault/types';
import { Button, IconButton } from '../components/Button';
import { EmptyState } from '../components/Feedback';
import { TextField } from '../components/Field';
import { CollectionIcon, ITEM_TYPE_ICONS } from '../icons';
import { ItemAvatar, Menu } from '../components/Misc';
import { Modal } from '../components/Modal';
import { CopyButton } from '../components/Secret';
import { cx } from '../cx';
import { visibleItems } from '../filtering';
import { itemSubtitle, TYPE_LABEL_KEYS } from '../items/helpers';
import { ItemDetail } from '../items/ItemDetail';
import { MoveDialog } from '../items/MoveDialog';
import { ensureItemAccess } from '../items/reprompt';
import { DRAG_MIME } from '../shell/Sidebar';

function useFilterTitle(filter: Filter, collections: Collection[]): string {
  const t = useT();
  switch (filter.kind) {
    case 'all':
      return t('nav.all');
    case 'favorites':
      return t('nav.favorites');
    case 'recentAdded':
      return t('nav.recentAdded');
    case 'recentUsed':
      return t('nav.recentUsed');
    case 'type':
      return filter.type === 'login' ? t('nav.passwords') : filter.type === 'note' ? t('nav.notes') : t('nav.otherItems');
    case 'category':
    case 'section':
      return collections.find((x) => x.id === filter.id)?.name ?? '—';
    case 'tag':
      return `#${filter.tag}`;
    case 'uncategorized':
      return t('nav.uncategorized');
    case 'archive':
      return t('nav.archive');
    case 'trash':
      return t('nav.trash');
    case 'ids':
      return filter.label;
  }
}

/** One menu for everything that used to crowd the sidebar: type, category, archive, trash and sort. */
function FilterMenu({ filter }: { filter: Filter }) {
  const t = useT();
  const prefs = usePrefs();
  const collections = useApp((s) => s.collections);
  const categories = collections.filter((c) => c.kind === 'category').sort((a, b) => a.order - b.order);
  const is = (f: Filter) => JSON.stringify(f) === JSON.stringify(filter);
  const Row = ({ label, active, onSelect, icon }: { label: string; active: boolean; onSelect: () => void; icon?: ReactNode }) => (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2 text-left text-sm text-fg outline-none hover:bg-surface-2 focus:bg-surface-2 cursor-pointer"
    >
      <span className="flex size-4 items-center justify-center text-muted [&>svg]:size-4">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {active && <Check className="size-4 text-accent" />}
    </button>
  );
  const Heading = ({ children }: { children: ReactNode }) => <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-faint">{children}</p>;
  return (
    <Menu
      trigger={(p) => (
        <Button size="sm" variant={filter.kind === 'all' || filter.kind === 'favorites' || filter.kind === 'section' ? 'secondary' : 'subtle'} icon={<ListFilter className="size-4" />} {...p}>
          {t('filter.button')}
        </Button>
      )}
      className="shrink-0"
    >
      {(close) => {
        const go = (f: Filter) => {
          close();
          navigate({ name: 'items', filter: f });
        };
        return (
          <div className="max-h-[80vh] w-60 overflow-y-auto">
            <Heading>{t('filter.show')}</Heading>
            <Row label={t('nav.all')} active={is({ kind: 'all' })} onSelect={() => go({ kind: 'all' })} />
            <Row label={t('nav.passwords')} active={is({ kind: 'type', type: 'login' })} onSelect={() => go({ kind: 'type', type: 'login' })} />
            <Row label={t('nav.notes')} active={is({ kind: 'type', type: 'note' })} onSelect={() => go({ kind: 'type', type: 'note' })} />
            <Row label={t('nav.otherItems')} active={is({ kind: 'type', type: 'other' })} onSelect={() => go({ kind: 'type', type: 'other' })} />
            <Heading>{t('sort.label')}</Heading>
            {(['title', 'updated', 'created', 'used'] as const).map((s) => (
              <Row
                key={s}
                label={t(`sort.${s}`)}
                active={prefs.sortBy === s}
                onSelect={() => {
                  close();
                  setPrefs({ sortBy: s });
                }}
              />
            ))}
            {categories.length > 0 && <Heading>{t('field.category')}</Heading>}
            {categories.map((c) => (
              <Row key={c.id} label={c.name} icon={<CollectionIcon name={c.icon} color={c.color} />} active={is({ kind: 'category', id: c.id })} onSelect={() => go({ kind: 'category', id: c.id })} />
            ))}
            <div className="my-1 border-t border-line" />
            <Row label={t('nav.archive')} icon={<Archive />} active={is({ kind: 'archive' })} onSelect={() => go({ kind: 'archive' })} />
            <Row label={t('nav.trash')} icon={<Trash2 />} active={is({ kind: 'trash' })} onSelect={() => go({ kind: 'trash' })} />
          </div>
        );
      }}
    </Menu>
  );
}

/** Replaces the old dashboard: a short, dismissible list of the things worth doing once. */
function SetupChecklist() {
  const t = useT();
  const prefs = usePrefs();
  const items = useApp((s) => s.items);
  const session = useApp((s) => s.session);
  const lastBackupAt = useApp((s) => s.lastBackupAt);
  const connected = useSync((s) => s.connected);
  if (prefs.tourDone || !session) return null;
  const steps = [
    { done: items.some((i) => !i.trashedAt), label: t('setup.add'), run: () => openEditor({ mode: 'new', type: 'login' }) },
    { done: !!session.security.recoveryKeyCreatedAt, label: t('setup.recoveryKey'), run: () => navigate({ name: 'settings' }) },
    { done: !!session.security.totp, label: t('setup.totp'), run: () => navigate({ name: 'settings' }) },
    { done: connected, label: t('setup.sync'), run: () => navigate({ name: 'sync' }) },
    { done: !!lastBackupAt, label: t('setup.backup'), run: () => navigate({ name: 'backup' }) },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  if (doneCount === steps.length) return null;
  return (
    <section className="lg-group mx-3 mb-3 p-4" aria-label={t('setup.title')}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-fg">{t('setup.title')}</h2>
          <p className="mt-0.5 text-xs text-muted">{t('setup.progress', { done: doneCount, total: steps.length })}</p>
        </div>
        <button type="button" onClick={() => setPrefs({ tourDone: true })} className="text-xs text-faint hover:text-fg cursor-pointer">
          {t('setup.hide')}
        </button>
      </div>
      <ul className="mt-3 space-y-0.5">
        {steps.map((s) => (
          <li key={s.label}>
            <button
              type="button"
              disabled={s.done}
              onClick={s.run}
              className={cx('flex w-full items-center gap-2.5 rounded-md px-1.5 py-1.5 text-left text-sm', s.done ? 'text-faint line-through' : 'text-fg hover:bg-surface-2 cursor-pointer')}
            >
              {s.done ? <CircleCheck className="size-4 shrink-0 text-success" /> : <Circle className="size-4 shrink-0 text-faint" />}
              {s.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Notices() {
  const t = useT();
  const corrupted = useApp((s) => s.corrupted);
  const conflicts = useApp((s) => s.conflicts);
  if (!corrupted && !conflicts.length) return null;
  return (
    <div className="mx-3 mb-3 space-y-2 sm:mx-5">
      {corrupted > 0 && (
        <p role="alert" className="flex gap-2 rounded-lg border border-danger/30 bg-danger-soft p-3 text-sm text-fg">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-danger" />
          {t('dashboard.corrupted', { n: corrupted })}
        </p>
      )}
      {conflicts.length > 0 && (
        <button type="button" onClick={() => navigate({ name: 'sync' })} className="flex w-full gap-2 rounded-lg border border-warning/30 bg-warning-soft p-3 text-left text-sm text-fg cursor-pointer">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
          {t('dashboard.conflicts', { n: conflicts.length })}
        </button>
      )}
    </div>
  );
}

export function ItemsView({ filter }: { filter: Filter }) {
  const t = useT();
  const prefs = usePrefs();
  const items = useApp((s) => s.items);
  const collections = useApp((s) => s.collections);
  const usage = useApp((s) => s.usage);
  const search = useApp((s) => s.search);
  const selectedId = useApp((s) => s.selectedId);
  const selection = useApp((s) => s.selection);
  const [selectMode, setSelectMode] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [tagOpen, setTagOpen] = useState(false);
  const title = useFilterTitle(filter, collections);

  const list = useMemo(() => visibleItems(items, filter, search, { collections, usage, sortBy: prefs.sortBy }), [items, filter, search, collections, usage, prefs.sortBy]);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const categoryById = useMemo(() => new Map(collections.map((c) => [c.id, c])), [collections]);
  const inTrash = filter.kind === 'trash';
  const inArchive = filter.kind === 'archive';
  const selecting = selectMode || selection.length > 0;
  const showsChip = !['all', 'favorites', 'section'].includes(filter.kind);

  useEffect(() => {
    if (selectedId && !items.some((i) => i.id === selectedId)) selectItem(null);
  }, [items, selectedId]);

  const toggleSel = (id: string) => app.set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] }));
  const allSelected = list.length > 0 && list.every((i) => selection.includes(i.id));
  const folder = filter.kind === 'section' ? collections.find((c) => c.id === filter.id) : undefined;

  return (
    <div className="flex h-full md:gap-3">
      <section className={cx('flex min-w-0 flex-1 flex-col lg-panel lg:max-w-[420px] xl:max-w-[460px]', selected && 'max-lg:hidden')} aria-label={title}>
        <div className="flex items-center gap-2 px-4 pb-2 pt-4 sm:px-5">
          <div className="flex min-w-0 flex-1 items-baseline gap-2">
            <h1 className="truncate text-[30px] font-bold leading-tight tracking-tight md:text-[22px]">{search ? t('search.results') : title}</h1>
            <span className="text-sm tabular-nums text-faint">{list.length}</span>
            {folder && (
              <IconButton label={t('organize.edit')} size="sm" onClick={() => navigate({ name: 'organize' })} className="self-center">
                <Pencil className="size-3.5" />
              </IconButton>
            )}
          </div>
          <FilterMenu filter={filter} />
          <IconButton
            label={t('select.toggle')}
            size="sm"
            active={selecting}
            onClick={() => {
              if (selecting) {
                setSelectMode(false);
                app.set({ selection: [] });
              } else setSelectMode(true);
            }}
          >
            <CheckSquare className="size-4" />
          </IconButton>
        </div>

        {showsChip && !search && (
          <div className="flex items-center gap-2 px-4 pb-2 sm:px-5">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface py-1 pl-3 pr-1.5 text-[13px] text-fg">
              {title}
              <button type="button" aria-label={t('filter.clear')} onClick={() => navigate(HOME)} className="flex size-5 items-center justify-center rounded-full text-muted hover:bg-surface-3 hover:text-fg cursor-pointer">
                <X className="size-3.5" />
              </button>
            </span>
            {inTrash && list.length > 0 && (
              <Button size="sm" variant="danger" className="ml-auto" onClick={() => void emptyTrash()}>
                {t('trash.empty')}
              </Button>
            )}
          </div>
        )}

        {selecting && (
          <div className="mx-3 mb-2 flex flex-wrap items-center gap-1 rounded-lg border border-line bg-surface p-1 sm:mx-5">
            <Button size="sm" variant="ghost" icon={allSelected ? <SquareCheck className="size-4" /> : <Square className="size-4" />} onClick={() => app.set({ selection: allSelected ? [] : list.map((i) => i.id) })}>
              {t('select.count', { n: selection.length })}
            </Button>
            <div className="ml-auto flex flex-wrap items-center gap-0.5">
              {inTrash ? (
                <>
                  <IconButton label={t('action.restore')} size="sm" disabled={!selection.length} onClick={() => void restoreItems(selection)}>
                    <RotateCcw className="size-4" />
                  </IconButton>
                  <IconButton label={t('action.deleteForever')} size="sm" tone="danger" disabled={!selection.length} onClick={() => void purgeItems(selection)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </>
              ) : (
                <>
                  <IconButton label={t('action.favorite')} size="sm" disabled={!selection.length} onClick={() => void toggleFavorite(selection)}>
                    <Star className="size-4" />
                  </IconButton>
                  <IconButton label={t('action.move')} size="sm" disabled={!selection.length} onClick={() => setMoveOpen(true)}>
                    <FolderInput className="size-4" />
                  </IconButton>
                  <IconButton label={t('action.addTag')} size="sm" disabled={!selection.length} onClick={() => setTagOpen(true)}>
                    <Tag className="size-4" />
                  </IconButton>
                  <IconButton label={inArchive ? t('action.unarchive') : t('action.archive')} size="sm" disabled={!selection.length} onClick={() => void archiveItems(selection, !inArchive)}>
                    {inArchive ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
                  </IconButton>
                  <IconButton label={t('action.moveToTrash')} size="sm" tone="danger" disabled={!selection.length} onClick={() => void trashItems(selection)}>
                    <Trash2 className="size-4" />
                  </IconButton>
                </>
              )}
              <IconButton
                label={t('action.close')}
                size="sm"
                onClick={() => {
                  setSelectMode(false);
                  app.set({ selection: [] });
                }}
              >
                <X className="size-4" />
              </IconButton>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto pb-28 md:pb-6">
          {filter.kind === 'all' && !search && (
            <>
              <Notices />
              <SetupChecklist />
            </>
          )}
          {list.length === 0 ? (
            <ListEmpty filter={filter} search={search} />
          ) : (
            <ul className="lg-list max-md:mx-3 max-md:p-1.5 md:px-2" role="list">
              {list.map((item) => (
                <ItemRow key={item.id} item={item} category={item.categoryId ? categoryById.get(item.categoryId) : undefined} selected={item.id === selectedId} checked={selection.includes(item.id)} selecting={selecting} onToggle={() => toggleSel(item.id)} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className={cx('min-w-0 flex-1 lg-panel', selected ? 'flex flex-col max-lg:absolute max-lg:inset-0 max-lg:z-20' : 'hidden lg:flex lg:flex-col')} aria-label={t('item.details')}>
        {selected ? (
          <ItemDetail key={selected.id} item={selected} onBack={() => selectItem(null)} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-faint">{t('item.selectTitle')}</p>
          </div>
        )}
      </section>

      <MoveDialog open={moveOpen} onClose={() => setMoveOpen(false)} ids={selection} />
      <AddTagDialog open={tagOpen} onClose={() => setTagOpen(false)} ids={selection} />
    </div>
  );
}

function dragStart(e: React.DragEvent, item: VaultItem) {
  const sel = app.get().selection;
  const ids = sel.includes(item.id) ? sel : [item.id];
  e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids));
  e.dataTransfer.effectAllowed = 'move';
}

interface RowProps {
  item: VaultItem;
  category?: Collection;
  selected: boolean;
  checked: boolean;
  selecting: boolean;
  onToggle: () => void;
}

function ItemRow({ item, category, selected, checked, selecting, onToggle }: RowProps) {
  const t = useT();
  const sub = itemSubtitle(item, t(TYPE_LABEL_KEYS[item.type]));
  const TypeIcon = ITEM_TYPE_ICONS[item.type];
  return (
    <li>
      <div
        draggable={!item.trashedAt}
        onDragStart={(e) => dragStart(e, item)}
        className={cx('lg-row-host group relative flex items-center gap-3 rounded-[14px] px-2.5 py-2 transition-colors duration-200', selected ? 'bg-accent text-on-accent [&_.text-muted]:text-on-accent/75 [&_.text-fg]:text-on-accent [&_button]:text-on-accent' : checked ? 'bg-surface-2' : 'hover:bg-surface-2 active:bg-surface-3')}
      >
        {selecting && <input type="checkbox" checked={checked} onChange={onToggle} aria-label={t('select.item', { title: item.title })} className="size-4 shrink-0 cursor-pointer accent-[var(--accent)]" />}
        <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer" onClick={() => (selecting ? onToggle() : selectItem(item.id))} aria-current={selected ? 'true' : undefined}>
          <ItemAvatar item={item} category={category} size="sm" />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[14px] font-medium text-fg">{item.title}</p>
              {item.favorite && <Star className="size-3 shrink-0 fill-warning text-warning" aria-label={t('nav.favorites')} />}
            </div>
            <p className="flex items-center gap-1 truncate text-[13px] text-muted">
              {item.type !== 'login' && <TypeIcon className="size-3 shrink-0" aria-hidden />}
              <span className="truncate">{sub}</span>
            </p>
          </div>
        </button>
        {!selecting && !item.trashedAt && (
          <div className="flex shrink-0 items-center opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
            {item.type === 'login' && (item.username || item.email) && (
              <CopyButton value={(item.username || item.email)!} secret={false} label={item.username ? t('field.username') : t('field.email')} onCopied={() => void markUsed(item.id)} icon={<UserRound className="size-4" />} />
            )}
            {(item.password || item.licenseKey) && (
              <CopyButton
                value={(item.password || item.licenseKey)!}
                secret
                label={item.password ? t('field.password') : t('field.licenseKey')}
                beforeCopy={() => ensureItemAccess(item)}
                onCopied={() => void markUsed(item.id)}
                icon={<KeyRound className="size-4" />}
              />
            )}
          </div>
        )}
      </div>
    </li>
  );
}

function ListEmpty({ filter, search }: { filter: Filter; search: string }) {
  const t = useT();
  if (search)
    return (
      <EmptyState icon={<Search />} title={t('empty.search.title')}>
        {t('empty.search.body', { q: search })}
      </EmptyState>
    );
  if (filter.kind === 'trash')
    return (
      <EmptyState icon={<Trash2 />} title={t('empty.trash.title')}>
        {t('empty.trash.body')}
      </EmptyState>
    );
  if (filter.kind === 'archive')
    return (
      <EmptyState icon={<Archive />} title={t('empty.archive.title')}>
        {t('empty.archive.body')}
      </EmptyState>
    );
  if (filter.kind === 'favorites')
    return (
      <EmptyState icon={<Star />} title={t('empty.favorites.title')}>
        {t('empty.favorites.body')}
      </EmptyState>
    );
  return (
    <EmptyState
      icon={<KeyRound />}
      title={t('empty.items.title')}
      action={
        <Button variant="primary" onClick={() => openEditor({ mode: 'new', type: filter.kind === 'type' && filter.type === 'note' ? 'note' : 'login' })}>
          {t('item.addFirst')}
        </Button>
      }
    >
      {t('empty.items.body')}
    </EmptyState>
  );
}

function AddTagDialog({ open, onClose, ids }: { open: boolean; onClose: () => void; ids: string[] }) {
  const t = useT();
  const [value, setValue] = useState('');
  useEffect(() => {
    if (open) setValue('');
  }, [open]);
  const tags = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('tags.addTitle', { n: ids.length })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={!tags.length}
            onClick={() => {
              void addTags(ids, tags);
              onClose();
            }}
          >
            {t('action.addTag')}
          </Button>
        </>
      }
    >
      <TextField label={t('field.tags')} value={value} onChange={(e) => setValue(e.target.value)} placeholder={t('field.tagsPlaceholder')} autoFocus />
    </Modal>
  );
}
