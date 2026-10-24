import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, FolderTree, Pencil, Pin, PinOff, Plus, Tags, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import { randomId } from '../../lib/encoding';
import { deleteCollection, navigate, saveCollection, useApp } from '../../state/app';
import { toast, toastError } from '../../state/ui';
import type { Collection, CollectionKind } from '../../vault/types';
import { Button, IconButton } from '../components/Button';
import { SelectField, Segmented, Switch, TextField } from '../components/Field';
import { PageHeader, SectionCard } from '../components/Misc';
import { Modal } from '../components/Modal';
import { cx } from '../cx';
import { descendantSectionIds } from '../filtering';
import { COLLECTION_COLORS, COLLECTION_ICONS, CollectionIcon } from '../icons';
import { sectionOptions } from '../items/helpers';

function CollectionEditor({ value, onClose }: { value: Collection | null; onClose: () => void }) {
  const t = useT();
  const collections = useApp((s) => s.collections);
  const [c, setC] = useState<Collection | null>(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => setC(value), [value]);
  if (!c) return null;
  const isNew = !collections.some((x) => x.id === c.id);
  const blocked = c.kind === 'section' ? descendantSectionIds(collections, c.id) : new Set<string>();
  const parents = sectionOptions(collections).filter(({ c: s }) => !blocked.has(s.id));
  const duplicate = collections.some((x) => x.id !== c.id && x.kind === c.kind && x.name.trim().toLowerCase() === c.name.trim().toLowerCase() && (x.parentId ?? null) === (c.parentId ?? null));
  return (
    <Modal
      open={!!value}
      onClose={onClose}
      title={isNew ? (c.kind === 'category' ? t('organize.newCategory') : t('organize.newSection')) : t('organize.edit')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!c.name.trim() || duplicate}
            onClick={async () => {
              setBusy(true);
              try {
                await saveCollection({ ...c, name: c.name.trim().slice(0, 60) });
                toast(isNew ? t('organize.created') : t('action.saved'));
                onClose();
              } catch (e) {
                toastError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {isNew ? t('action.create') : t('action.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div className="flex items-center gap-3 rounded-2xl border border-line bg-surface-2 p-3">
          <div className="flex size-11 items-center justify-center rounded-xl" style={{ backgroundColor: `color-mix(in oklab, ${c.color} 18%, transparent)` }}>
            <CollectionIcon name={c.icon} color={c.color} className="size-5" />
          </div>
          <TextField value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} placeholder={t('organize.namePlaceholder')} aria-label={t('organize.name')} wrapClassName="flex-1" autoFocus error={duplicate ? t('organize.duplicate') : undefined} maxLength={60} />
        </div>
        {c.kind === 'section' && (
          <SelectField
            label={t('organize.parent')}
            value={c.parentId ?? ''}
            onChange={(e) => setC({ ...c, parentId: e.target.value || null })}
            options={[{ value: '', label: t('organize.topLevel') }, ...parents.map(({ c: s, depth }) => ({ value: s.id, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${s.name}` }))]}
          />
        )}
        <div>
          <p className="mb-2 text-[13px] font-medium text-muted">{t('organize.icon')}</p>
          <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-11" role="radiogroup" aria-label={t('organize.icon')}>
            {Object.keys(COLLECTION_ICONS).map((name) => (
              <button
                key={name}
                type="button"
                role="radio"
                aria-checked={c.icon === name}
                aria-label={name}
                onClick={() => setC({ ...c, icon: name })}
                className={cx('flex aspect-square items-center justify-center rounded-xl border transition-colors cursor-pointer', c.icon === name ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:text-fg')}
              >
                <CollectionIcon name={name} className="size-[18px]" />
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-[13px] font-medium text-muted">{t('organize.color')}</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={t('organize.color')}>
            {COLLECTION_COLORS.map((col) => (
              <button
                key={col}
                type="button"
                role="radio"
                aria-checked={c.color === col}
                aria-label={col}
                onClick={() => setC({ ...c, color: col })}
                className={cx('size-8 rounded-full ring-offset-2 ring-offset-surface transition-transform hover:scale-110 cursor-pointer', c.color === col && 'ring-2 ring-fg')}
                style={{ backgroundColor: col }}
              />
            ))}
          </div>
        </div>
        <Switch checked={c.pinned} onChange={(v) => setC({ ...c, pinned: v })} label={t('organize.pin')} description={t('organize.pinHelp')} />
      </div>
    </Modal>
  );
}

function DeleteCollectionDialog({ target, onClose }: { target: Collection | null; onClose: () => void }) {
  const t = useT();
  const collections = useApp((s) => s.collections);
  const items = useApp((s) => s.items);
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setMoveTo(''), [target]);
  if (!target) return null;
  const field = target.kind === 'category' ? 'categoryId' : 'sectionId';
  const count = items.filter((i) => i[field] === target.id).length;
  const others = target.kind === 'category' ? collections.filter((c) => c.kind === 'category' && c.id !== target.id).map((c) => ({ value: c.id, label: c.name })) : sectionOptions(collections).filter(({ c }) => c.id !== target.id).map(({ c, depth }) => ({ value: c.id, label: `${'  '.repeat(depth)}${c.name}` }));
  return (
    <Modal
      open={!!target}
      onClose={onClose}
      size="sm"
      title={t('organize.deleteTitle', { name: target.name })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await deleteCollection(target.id, moveTo || null);
                toast(t('organize.deleted', { name: target.name }));
                onClose();
              } catch (e) {
                toastError(e);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t('action.delete')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">{count > 0 ? t('organize.deleteHasItems', { n: count }) : t('organize.deleteEmpty')}</p>
        {count > 0 && <SelectField label={t('organize.moveItemsTo')} value={moveTo} onChange={(e) => setMoveTo(e.target.value)} options={[{ value: '', label: target.kind === 'category' ? t('organize.leaveUncategorized') : t('organize.leaveNoSection') }, ...others]} />}
        {target.kind === 'section' && collections.some((c) => c.parentId === target.id) && <p className="text-xs text-faint">{t('organize.childrenMoved')}</p>}
        <p className="text-xs font-medium text-success">{t('organize.itemsSafe')}</p>
      </div>
    </Modal>
  );
}

export function OrganizeView({ create }: { create?: 'section' | 'category' }) {
  const t = useT();
  const collections = useApp((s) => s.collections);
  const items = useApp((s) => s.items);
  const [tab, setTab] = useState<CollectionKind>(create ?? 'category');
  const [editing, setEditing] = useState<Collection | null>(null);
  const [deleting, setDeleting] = useState<Collection | null>(null);

  const blank = (kind: CollectionKind): Collection => {
    const now = Date.now();
    return { id: randomId(), kind, name: '', icon: kind === 'section' ? 'folder' : 'key', color: COLLECTION_COLORS[collections.length % COLLECTION_COLORS.length], parentId: null, pinned: false, order: collections.filter((c) => c.kind === kind).length, createdAt: now, updatedAt: now };
  };

  useEffect(() => {
    if (create) {
      setTab(create);
      setEditing(blank(create));
    }
  }, [create]);

  const list = tab === 'category' ? collections.filter((c) => c.kind === 'category').sort((a, b) => a.order - b.order) : sectionOptions(collections).map((x) => x.c);
  const depthOf = new Map(sectionOptions(collections).map(({ c, depth }) => [c.id, depth]));

  const move = async (c: Collection, dir: -1 | 1) => {
    const siblings = (tab === 'category' ? list : list.filter((x) => (x.parentId ?? null) === (c.parentId ?? null))).sort((a, b) => a.order - b.order);
    const idx = siblings.findIndex((x) => x.id === c.id);
    const swap = siblings[idx + dir];
    if (!swap) return;
    const reordered = siblings.map((x, i) => ({ ...x, order: i }));
    reordered[idx].order = idx + dir;
    reordered[idx + dir].order = idx;
    for (const x of reordered) if (x.order !== siblings.find((s) => s.id === x.id)!.order) await saveCollection(x);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-4 pb-28 pt-6 sm:px-6 md:pb-10">
        <PageHeader
          title={t('organize.title')}
          subtitle={t('organize.subtitle')}
          icon={<FolderTree className="size-5" />}
          actions={
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing(blank(tab))}>
              {tab === 'category' ? t('organize.newCategory') : t('organize.newSection')}
            </Button>
          }
        />
        <div className="mb-4">
          <Segmented
            label={t('organize.title')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'category', label: t('nav.categories'), icon: <Tags className="size-4" /> },
              { value: 'section', label: t('nav.sections'), icon: <FolderTree className="size-4" /> },
            ]}
          />
        </div>
        <SectionCard description={tab === 'category' ? t('organize.categoriesHelp') : t('organize.sectionsHelp')}>
          {list.length === 0 ? (
            <p className="py-6 text-center text-sm text-faint">{tab === 'category' ? t('organize.noCategories') : t('organize.noSections')}</p>
          ) : (
            <ul className="divide-y divide-line">
              {list.map((c) => {
                const field = c.kind === 'category' ? 'categoryId' : 'sectionId';
                const n = items.filter((i) => i[field] === c.id && !i.trashedAt).length;
                const depth = c.kind === 'section' ? depthOf.get(c.id) ?? 0 : 0;
                return (
                  <li key={c.id} className="flex items-center gap-2 py-2.5" style={{ paddingLeft: depth * 20 }}>
                    <button type="button" onClick={() => navigate({ name: 'items', filter: { kind: c.kind, id: c.id } })} className="flex min-w-0 flex-1 items-center gap-3 text-left cursor-pointer">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ backgroundColor: `color-mix(in oklab, ${c.color} 18%, transparent)` }}>
                        <CollectionIcon name={c.icon} color={c.color} className="size-[18px]" />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[15px] font-medium text-fg">{c.name}</span>
                        <span className="text-xs text-faint">{t('organize.itemCount', { n })}</span>
                      </span>
                    </button>
                    <IconButton label={c.pinned ? t('organize.unpin') : t('organize.pin')} size="sm" onClick={() => void saveCollection({ ...c, pinned: !c.pinned })} className={c.pinned ? 'text-accent' : ''}>
                      {c.pinned ? <Pin className="size-4" /> : <PinOff className="size-4" />}
                    </IconButton>
                    <IconButton label={t('organize.moveUp')} size="sm" onClick={() => void move(c, -1)}>
                      <ArrowUp className="size-4" />
                    </IconButton>
                    <IconButton label={t('organize.moveDown')} size="sm" onClick={() => void move(c, 1)}>
                      <ArrowDown className="size-4" />
                    </IconButton>
                    <IconButton label={t('action.edit')} size="sm" onClick={() => setEditing(c)}>
                      <Pencil className="size-4" />
                    </IconButton>
                    <IconButton label={t('action.delete')} size="sm" tone="danger" onClick={() => setDeleting(c)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </li>
                );
              })}
            </ul>
          )}
        </SectionCard>
        <p className="mt-4 text-xs leading-relaxed text-faint">{t('organize.dragHint')}</p>
      </div>
      <CollectionEditor value={editing} onClose={() => setEditing(null)} />
      <DeleteCollectionDialog target={deleting} onClose={() => setDeleting(null)} />
    </div>
  );
}
