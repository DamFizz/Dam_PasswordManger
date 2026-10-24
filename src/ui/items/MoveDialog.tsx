import { useEffect, useState } from 'react';
import { useT } from '../../i18n';
import { moveItems, useApp } from '../../state/app';
import { Button } from '../components/Button';
import { SelectField } from '../components/Field';
import { Modal } from '../components/Modal';
import { sectionOptions } from './helpers';

const KEEP = '__keep__';

/** Move one or many items to a section and/or category. */
export function MoveDialog({ open, onClose, ids }: { open: boolean; onClose: () => void; ids: string[] }) {
  const t = useT();
  const collections = useApp((s) => s.collections);
  const [section, setSection] = useState(KEEP);
  const [category, setCategory] = useState(KEEP);
  useEffect(() => {
    if (open) {
      setSection(KEEP);
      setCategory(KEEP);
    }
  }, [open]);
  const categories = collections.filter((c) => c.kind === 'category');
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('move.title', { n: ids.length })}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('action.cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={section === KEEP && category === KEEP}
            onClick={() => {
              const patch: { sectionId?: string | null; categoryId?: string | null } = {};
              if (section !== KEEP) patch.sectionId = section || null;
              if (category !== KEEP) patch.categoryId = category || null;
              void moveItems(ids, patch);
              onClose();
            }}
          >
            {t('action.move')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <SelectField
          label={t('field.section')}
          value={section}
          onChange={(e) => setSection(e.target.value)}
          options={[
            { value: KEEP, label: t('move.keep') },
            { value: '', label: t('field.none') },
            ...sectionOptions(collections).map(({ c, depth }) => ({ value: c.id, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${c.name}` })),
          ]}
        />
        <SelectField
          label={t('field.category')}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          options={[{ value: KEEP, label: t('move.keep') }, { value: '', label: t('field.none') }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
        />
      </div>
    </Modal>
  );
}
