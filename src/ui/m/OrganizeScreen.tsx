/**
 * Categories and folders (Android OrganizeScreen): Categories / Folders selector, rows with item
 * counts, pin, move up / down, tap to edit, + to create. Items are never deleted with a folder.
 */
import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronUp, Pin, Plus } from 'lucide-react';
import { useT } from '../../i18n';
import { requireSession, useApp } from '../../state/app';
import type { Collection } from '../../vault/types';
import { CollectionIcon } from '../icons';
import { Body, Column, FlowingSelector, GlassIconButton, GroupDivider, IconTile, InsetGroup, LargeTitle, ListRow, RowIconButton, Stack } from './kit';
import { PushedScreen } from './Shell';
import { CollectionEditor, newCollectionTemplate } from './CollectionEditor';

function siblings(c: Collection, all: Collection[]): Collection[] {
  return all.filter((x) => x.kind === c.kind && (c.kind === 'category' || (x.parentId ?? null) === (c.parentId ?? null))).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
}

async function moveCollection(c: Collection, dir: -1 | 1): Promise<void> {
  const session = requireSession();
  const s = siblings(c, session.collections());
  const i = s.findIndex((x) => x.id === c.id);
  if (i < 0 || i + dir < 0 || i + dir >= s.length) return;
  const order = s.map((_, idx) => idx);
  order[i] = i + dir;
  order[i + dir] = i;
  const now = Date.now();
  const changed = s.map((x, idx) => (x.order !== order[idx] ? { ...x, order: order[idx]!, updatedAt: now } : null)).filter((x): x is Collection => !!x);
  if (changed.length) await session.saveCollections(changed);
}

export function OrganizeScreen({ create }: { create?: 'section' | 'category' }) {
  const t = useT();
  const all = useApp((s) => s.collections);
  const items = useApp((s) => s.items);
  const [tab, setTab] = useState<'category' | 'section'>(create === 'section' ? 'section' : 'category');
  const [editing, setEditing] = useState<Collection | null>(null);
  useEffect(() => {
    if (create) setEditing(newCollectionTemplate(create, all));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [create]);

  const rows = useMemo(() => {
    if (tab === 'category') return all.filter((c) => c.kind === 'category').sort((a, b) => a.order - b.order || a.name.localeCompare(b.name)).map((c) => ({ c, depth: 0 }));
    const out: { c: Collection; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const f of all.filter((x) => x.kind === 'section' && (x.parentId ?? null) === parent).sort((a, b) => a.order - b.order || a.name.localeCompare(b.name))) {
        out.push({ c: f, depth });
        if (depth < 8) walk(f.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [all, tab]);
  const count = (c: Collection) => items.filter((i) => !i.trashedAt && (c.kind === 'category' ? i.categoryId === c.id : i.sectionId === c.id)).length;

  return (
    <PushedScreen
      title={t('a.org_title')}
      actions={
        <GlassIconButton label={tab === 'category' ? t('a.org_new_category') : t('a.org_new_folder')} onClick={() => setEditing(newCollectionTemplate(tab, all))}>
          <Plus />
        </GlassIconButton>
      }
    >
      <Column>
        <Stack gap={12}>
          <LargeTitle className="pl-1.5">{t('a.org_title')}</LargeTitle>
          <FlowingSelector
            label={t('a.org_title')}
            value={tab}
            onChange={setTab}
            options={[
              { value: 'category', label: t('a.org_categories') },
              { value: 'section', label: t('a.org_folders') },
            ]}
            className="lg-seg-accent"
          />
          {rows.length === 0 ? (
            <Body className="p-4">{tab === 'category' ? t('a.org_empty_cat') : t('a.org_empty_folder')}</Body>
          ) : (
            <InsetGroup>
              {rows.map(({ c, depth }, i) => {
                const sib = siblings(c, all);
                const idx = sib.findIndex((x) => x.id === c.id);
                return (
                  <div key={c.id}>
                    {i > 0 && <GroupDivider inset={66} />}
                    <ListRow
                      title={c.name}
                      subtitle={t('a.org_items', { 1: count(c) })}
                      indent={depth}
                      leading={<IconTile icon={<CollectionIcon name={c.icon} className="size-full" />} size={36} color={c.color} />}
                      trailing={
                        <>
                          {c.pinned && <Pin className="size-4 text-accent" aria-label={t('a.org_pin')} />}
                          {idx > 0 && (
                            <RowIconButton label={t('a.org_move_up')} tone="muted" onClick={() => void moveCollection(c, -1)}>
                              <ChevronUp />
                            </RowIconButton>
                          )}
                          {idx >= 0 && idx < sib.length - 1 && (
                            <RowIconButton label={t('a.org_move_down')} tone="muted" onClick={() => void moveCollection(c, 1)}>
                              <ChevronDown />
                            </RowIconButton>
                          )}
                        </>
                      }
                      onClick={() => setEditing(c)}
                    />
                  </div>
                );
              })}
            </InsetGroup>
          )}
        </Stack>
      </Column>
      <CollectionEditor value={editing} onChange={setEditing} />
    </PushedScreen>
  );
}
