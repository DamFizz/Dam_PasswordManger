/**
 * Edit or create a category / folder in a sheet (Android: SettingsScreens.CollectionEditor).
 * Deleting never deletes items: they are left without that category/folder or moved.
 */
import { useState } from 'react';
import { useT } from '../../i18n';
import { deleteCollection, saveCollection, useApp } from '../../state/app';
import { toastError } from '../../state/ui';
import { randomId } from '../../lib/encoding';
import type { Collection } from '../../vault/types';
import { Modal } from '../components/Modal';
import { cx } from '../cx';
import { COLLECTION_COLORS, COLLECTION_ICONS, CollectionIcon } from '../icons';
import { descendantSectionIds } from '../filtering';
import { Body, CheckMark, Footnote, GlassButton, GlassTextField, GroupDivider, InsetGroup, ListRow, ToggleRow } from './kit';

export function newCollectionTemplate(kind: Collection['kind'], existing: Collection[]): Collection {
  const now = Date.now();
  return {
    id: randomId(),
    kind,
    name: '',
    icon: kind === 'section' ? 'folder' : 'key',
    color: COLLECTION_COLORS[existing.length % COLLECTION_COLORS.length]!,
    parentId: null,
    pinned: false,
    order: existing.filter((c) => c.kind === kind).length,
    createdAt: now,
    updatedAt: now,
  };
}

function isDuplicate(c: Collection, all: Collection[]): boolean {
  return all.some((o) => o.id !== c.id && o.kind === c.kind && o.name.trim().toLowerCase() === c.name.trim().toLowerCase() && (o.parentId ?? null) === (c.parentId ?? null));
}

export function CollectionEditor({ value, onChange }: { value: Collection | null; onChange: (c: Collection | null) => void }) {
  const t = useT();
  const all = useApp((s) => s.collections);
  const items = useApp((s) => s.items);
  const [deleting, setDeleting] = useState<Collection | null>(null);
  const [moveTo, setMoveTo] = useState<string | null>(null);
  const [pickParent, setPickParent] = useState(false);
  const e = value;
  const isNew = !!e && !all.some((c) => c.id === e.id);
  const duplicate = !!e && isDuplicate(e, all);
  const parents = e ? all.filter((c) => c.kind === 'section' && !descendantSectionIds(all, e.id).has(c.id)) : [];
  const d = deleting;
  const count = d ? items.filter((i) => !i.trashedAt && (d.kind === 'category' ? i.categoryId === d.id : i.sectionId === d.id)).length : 0;

  return (
    <>
      <Modal
        open={!!e}
        onClose={() => onChange(null)}
        size="sm"
        title={e ? (!isNew ? t('a.org_edit') : e.kind === 'category' ? t('a.org_new_category') : t('a.org_new_folder')) : ''}
      >
        {e && (
          <div className="flex flex-col gap-3 pb-1">
            <GlassTextField value={e.name} onChange={(v) => onChange({ ...e, name: v.slice(0, 60) })} placeholder={t('a.org_name')} leading={<CollectionIcon name={e.icon} />} autoFocus />
            {duplicate && <Footnote className="pl-3.5 !text-danger">{t('a.org_duplicate')}</Footnote>}
            {e.kind === 'section' && (
              <InsetGroup>
                <ListRow
                  title={t('a.org_parent')}
                  trailing={<span className="text-[15px] text-muted">{parents.find((p) => p.id === e.parentId)?.name ?? t('a.org_top_level')}</span>}
                  onClick={() => setPickParent((v) => !v)}
                />
                {pickParent && (
                  <>
                    <GroupDivider />
                    <ListRow
                      title={t('a.org_top_level')}
                      trailing={<CheckMark on={!e.parentId} />}
                      onClick={() => {
                        onChange({ ...e, parentId: null });
                        setPickParent(false);
                      }}
                    />
                    {parents.map((p) => (
                      <div key={p.id}>
                        <GroupDivider />
                        <ListRow
                          title={p.name}
                          trailing={<CheckMark on={e.parentId === p.id} />}
                          onClick={() => {
                            onChange({ ...e, parentId: p.id });
                            setPickParent(false);
                          }}
                        />
                      </div>
                    ))}
                  </>
                )}
              </InsetGroup>
            )}
            <Footnote className="pl-3.5">{t('a.org_color')}</Footnote>
            <div className="grid grid-cols-8 gap-2 px-1">
              {COLLECTION_COLORS.map((hex) => (
                <button
                  key={hex}
                  type="button"
                  aria-label={hex}
                  aria-pressed={e.color === hex}
                  onClick={() => onChange({ ...e, color: hex })}
                  className={cx('size-8 justify-self-center rounded-full cursor-pointer', e.color === hex && 'ring-[3px] ring-fg ring-offset-2 ring-offset-transparent')}
                  style={{ background: hex }}
                />
              ))}
            </div>
            <Footnote className="pl-3.5">{t('a.org_icon')}</Footnote>
            <div className="grid grid-cols-7 gap-2 px-1">
              {Object.keys(COLLECTION_ICONS).map((name) => (
                <button
                  key={name}
                  type="button"
                  aria-label={name}
                  aria-pressed={e.icon === name}
                  onClick={() => onChange({ ...e, icon: name })}
                  className={cx('flex size-10 items-center justify-center justify-self-center rounded-[12px] cursor-pointer', e.icon === name ? 'bg-accent-soft text-accent' : 'bg-[var(--field)] text-muted')}
                >
                  <CollectionIcon name={name} className="size-[22px]" />
                </button>
              ))}
            </div>
            <InsetGroup>
              <ToggleRow title={t('a.org_pin')} checked={e.pinned} onChange={(v) => onChange({ ...e, pinned: v })} />
            </InsetGroup>
            <GlassButton
              block
              disabled={!e.name.trim() || duplicate}
              onClick={async () => {
                try {
                  await saveCollection({ ...e, name: e.name.trim() });
                  onChange(null);
                } catch (err) {
                  toastError(err);
                }
              }}
            >
              {t('a.action_save')}
            </GlassButton>
            {!isNew && (
              <GlassButton
                block
                prominent={false}
                destructive
                onClick={() => {
                  onChange(null);
                  setMoveTo(null);
                  setDeleting(e);
                }}
              >
                {t('a.org_delete')}
              </GlassButton>
            )}
          </div>
        )}
      </Modal>

      <Modal open={!!d} onClose={() => setDeleting(null)} size="sm" title={d ? t('a.org_delete_title', { 1: d.name }) : ''}>
        {d && (
          <div className="flex flex-col gap-3 pb-1">
            <Body>{count === 0 ? t('a.org_delete_empty') : t('a.org_delete_body', { 1: count })}</Body>
            {count > 0 && (
              <InsetGroup>
                <ListRow title={t('a.org_leave')} trailing={<CheckMark on={moveTo === null} />} onClick={() => setMoveTo(null)} />
                {all
                  .filter((o) => o.kind === d.kind && o.id !== d.id && !descendantSectionIds(all, d.id).has(o.id))
                  .map((o) => (
                    <div key={o.id}>
                      <GroupDivider />
                      <ListRow title={o.name} trailing={<CheckMark on={moveTo === o.id} />} onClick={() => setMoveTo(o.id)} />
                    </div>
                  ))}
              </InsetGroup>
            )}
            <GlassButton
              block
              destructive
              onClick={async () => {
                try {
                  await deleteCollection(d.id, moveTo);
                  setDeleting(null);
                } catch (err) {
                  toastError(err);
                }
              }}
            >
              {t('a.org_delete')}
            </GlassButton>
          </div>
        )}
      </Modal>
    </>
  );
}
