import { useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  CheckSquare,
  FolderInput,
  KeyRound,
  LayoutGrid,
  List,
  Pencil,
  RotateCcw,
  Search,
  Square,
  SquareCheck,
  Star,
  Tag,
  Trash2,
  UserRound,
  X,
} from 'lucide-react';
import { useT } from '../../i18n';
import {
  addTags,
  app,
  archiveItems,
  emptyTrash,
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
import type { Collection, VaultItem } from '../../vault/types';
import { Button, IconButton } from '../components/Button';
import { EmptyState } from '../components/Feedback';
import { TextField } from '../components/Field';
import { CollectionIcon, ITEM_TYPE_ICONS } from '../icons';
import { ItemAvatar } from '../components/Misc';
import { Modal } from '../components/Modal';
import { CopyButton } from '../components/Secret';
import { cx } from '../cx';
import { visibleItems } from '../filtering';
import { itemSubtitle, TYPE_LABEL_KEYS } from '../items/helpers';
import { ItemDetail } from '../items/ItemDetail';
import { MoveDialog } from '../items/MoveDialog';
import { ensureItemAccess } from '../items/reprompt';
import { DRAG_MIME } from '../shell/Sidebar';

function useFilterTitle(filter: Filter, collections: Collection[]): { title: string; icon?: React.ReactNode } {
  const t = useT();
  switch (filter.kind) {
    case 'all':
      return { title: t('nav.all') };
    case 'favorites':
      return { title: t('nav.favorites') };
    case 'recentAdded':
      return { title: t('nav.recentAdded') };
    case 'recentUsed':
      return { title: t('nav.recentUsed') };
    case 'type':
      return { title: filter.type === 'login' ? t('nav.passwords') : filter.type === 'note' ? t('nav.notes') : t('nav.otherItems') };
    case 'category':
    case 'section': {
      const c = collections.find((x) => x.id === filter.id);
      return { title: c?.name ?? '—', icon: c ? <CollectionIcon name={c.icon} color={c.color} className="size-5" /> : undefined };
    }
    case 'tag':
      return { title: `#${filter.tag}` };
    case 'uncategorized':
      return { title: t('nav.uncategorized') };
    case 'archive':
      return { title: t('nav.archive') };
    case 'trash':
      return { title: t('nav.trash') };
    case 'ids':
      return { title: filter.label };
  }
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
  const { title, icon } = useFilterTitle(filter, collections);

  const list = useMemo(() => visibleItems(items, filter, search, { collections, usage, sortBy: prefs.sortBy }), [items, filter, search, collections, usage, prefs.sortBy]);
  const selected = items.find((i) => i.id === selectedId) ?? null;
  const categoryById = useMemo(() => new Map(collections.map((c) => [c.id, c])), [collections]);
  const inTrash = filter.kind === 'trash';
  const inArchive = filter.kind === 'archive';
  const selecting = selectMode || selection.length > 0;

  useEffect(() => {
    if (selectedId && !items.some((i) => i.id === selectedId)) selectItem(null);
  }, [items, selectedId]);

  const toggleSel = (id: string) => app.set((s) => ({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id] }));
  const allSelected = list.length > 0 && list.every((i) => selection.includes(i.id));
  const editableCollection = filter.kind === 'category' || filter.kind === 'section' ? collections.find((c) => c.id === filter.id) : undefined;

  return (
    <div className="flex h-full">
      <section className={cx('flex min-w-0 flex-1 flex-col border-line lg:max-w-[460px] lg:border-r xl:max-w-[520px]', selected && 'max-lg:hidden')} aria-label={title}>
        <div className="flex flex-wrap items-center gap-2 px-4 pb-3 pt-5 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            {icon}
            <h1 className="truncate text-xl font-semibold tracking-tight">{search ? t('search.results') : title}</h1>
            <span className="text-sm tabular-nums text-faint">{list.length}</span>
            {editableCollection && (
              <IconButton label={t('organize.edit')} size="sm" onClick={() => navigate({ name: 'organize' })}>
                <Pencil className="size-3.5" />
              </IconButton>
            )}
          </div>
          <div className="flex items-center gap-1">
            <select
              aria-label={t('sort.label')}
              value={prefs.sortBy}
              onChange={(e) => setPrefs({ sortBy: e.target.value as typeof prefs.sortBy })}
              className="h-8 cursor-pointer rounded-lg border border-line bg-surface-2 px-2 text-xs text-muted hover:text-fg"
            >
              <option value="title">{t('sort.title')}</option>
              <option value="updated">{t('sort.updated')}</option>
              <option value="created">{t('sort.created')}</option>
              <option value="used">{t('sort.used')}</option>
            </select>
            <IconButton label={prefs.viewMode === 'list' ? t('view.grid') : t('view.list')} size="sm" onClick={() => setPrefs({ viewMode: prefs.viewMode === 'list' ? 'grid' : 'list' })}>
              {prefs.viewMode === 'list' ? <LayoutGrid className="size-4" /> : <List className="size-4" />}
            </IconButton>
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
          {inTrash && list.length > 0 && (
            <div className="flex w-full items-center justify-between gap-2 rounded-xl bg-surface-2 px-3 py-2 text-xs text-muted">
              <span>{t('trash.info', { days: app.get().settings.trashRetentionDays })}</span>
              <Button size="sm" variant="danger" onClick={() => void emptyTrash()}>
                {t('trash.empty')}
              </Button>
            </div>
          )}
        </div>

        {selecting && (
          <div className="mx-4 mb-2 flex flex-wrap items-center gap-1 rounded-2xl border border-line bg-surface-2 p-1.5 sm:mx-6">
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

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-28 sm:px-4 md:pb-8">
          {list.length === 0 ? (
            <ListEmpty filter={filter} search={search} />
          ) : prefs.viewMode === 'grid' ? (
            <div className="grid grid-cols-1 gap-2 p-2 min-[420px]:grid-cols-2">
              {list.map((item) => (
                <ItemCard key={item.id} item={item} category={item.categoryId ? categoryById.get(item.categoryId) : undefined} selected={item.id === selectedId} checked={selection.includes(item.id)} selecting={selecting} onToggle={() => toggleSel(item.id)} />
              ))}
            </div>
          ) : (
            <ul className="space-y-0.5 py-1" role="list">
              {list.map((item) => (
                <ItemRow key={item.id} item={item} category={item.categoryId ? categoryById.get(item.categoryId) : undefined} selected={item.id === selectedId} checked={selection.includes(item.id)} selecting={selecting} onToggle={() => toggleSel(item.id)} />
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className={cx('min-w-0 flex-1 bg-surface/30', selected ? 'flex flex-col max-lg:absolute max-lg:inset-0 max-lg:z-20 max-lg:bg-bg' : 'hidden lg:flex lg:flex-col')} aria-label={t('item.details')}>
        {selected ? (
          <ItemDetail key={selected.id} item={selected} onBack={() => selectItem(null)} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState icon={<KeyRound className="size-7" />} title={t('item.selectTitle')}>
              {t('item.selectBody')}
            </EmptyState>
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
        className={cx(
          'group relative flex items-center gap-3 rounded-2xl px-2.5 py-2 transition-colors',
          selected ? 'bg-accent-soft' : checked ? 'bg-surface-2' : 'hover:bg-surface-2',
        )}
      >
        {selecting && (
          <input type="checkbox" checked={checked} onChange={onToggle} aria-label={t('select.item', { title: item.title })} className="size-[18px] shrink-0 cursor-pointer accent-[var(--accent)]" />
        )}
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer"
          onClick={() => (selecting ? onToggle() : selectItem(item.id))}
          aria-current={selected ? 'true' : undefined}
        >
          <ItemAvatar item={item} category={category} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="truncate text-[15px] font-medium text-fg">{item.title}</p>
              {item.favorite && <Star className="size-3.5 shrink-0 fill-warning text-warning" aria-label={t('nav.favorites')} />}
            </div>
            <p className="flex items-center gap-1 truncate text-[13px] text-muted">
              {item.type !== 'login' && <TypeIcon className="size-3 shrink-0" aria-hidden />}
              <span className="truncate">{sub}</span>
            </p>
          </div>
        </button>
        {!selecting && !item.trashedAt && (
          <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
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

function ItemCard({ item, category, selected, checked, selecting, onToggle }: RowProps) {
  const t = useT();
  return (
    <div
      draggable={!item.trashedAt}
      onDragStart={(e) => dragStart(e, item)}
      className={cx('group relative rounded-2xl border p-3.5 transition-colors', selected ? 'border-accent bg-accent-soft' : checked ? 'border-line-strong bg-surface-2' : 'border-line bg-surface hover:border-line-strong')}
    >
      <button type="button" onClick={() => (selecting ? onToggle() : selectItem(item.id))} className="flex w-full items-start gap-3 text-left cursor-pointer">
        <ItemAvatar item={item} category={category} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-fg">{item.title}</p>
          <p className="truncate text-[13px] text-muted">{itemSubtitle(item, t(TYPE_LABEL_KEYS[item.type]))}</p>
        </div>
        {selecting ? (
          <input type="checkbox" checked={checked} onChange={onToggle} onClick={(e) => e.stopPropagation()} aria-label={t('select.item', { title: item.title })} className="size-[18px] cursor-pointer accent-[var(--accent)]" />
        ) : (
          item.favorite && <Star className="size-4 fill-warning text-warning" />
        )}
      </button>
      {!selecting && !item.trashedAt && (item.password || item.username || item.email) && (
        <div className="mt-3 flex items-center gap-1 border-t border-line pt-2">
          {(item.username || item.email) && <CopyButton value={(item.username || item.email)!} secret={false} label={item.username ? t('field.username') : t('field.email')} onCopied={() => void markUsed(item.id)} icon={<UserRound className="size-4" />} />}
          {item.password && <CopyButton value={item.password} secret label={t('field.password')} beforeCopy={() => ensureItemAccess(item)} onCopied={() => void markUsed(item.id)} icon={<KeyRound className="size-4" />} />}
          {category && (
            <span className="ml-auto inline-flex min-w-0 items-center gap-1 truncate text-xs text-faint">
              <CollectionIcon name={category.icon} color={category.color} className="size-3.5" />
              <span className="truncate">{category.name}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function ListEmpty({ filter, search }: { filter: Filter; search: string }) {
  const t = useT();
  if (search)
    return (
      <EmptyState icon={<Search className="size-7" />} title={t('empty.search.title')}>
        {t('empty.search.body', { q: search })}
      </EmptyState>
    );
  if (filter.kind === 'trash')
    return (
      <EmptyState icon={<Trash2 className="size-7" />} title={t('empty.trash.title')}>
        {t('empty.trash.body')}
      </EmptyState>
    );
  if (filter.kind === 'archive')
    return (
      <EmptyState icon={<Archive className="size-7" />} title={t('empty.archive.title')}>
        {t('empty.archive.body')}
      </EmptyState>
    );
  if (filter.kind === 'favorites')
    return (
      <EmptyState icon={<Star className="size-7" />} title={t('empty.favorites.title')}>
        {t('empty.favorites.body')}
      </EmptyState>
    );
  return (
    <EmptyState
      icon={<KeyRound className="size-7" />}
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
