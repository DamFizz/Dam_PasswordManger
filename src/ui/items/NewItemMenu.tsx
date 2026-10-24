import { ChevronDown, Plus } from 'lucide-react';
import { useT } from '../../i18n';
import { openEditor } from '../../state/app';
import type { ItemType } from '../../vault/types';
import { Button } from '../components/Button';
import { Menu, MenuItem } from '../components/Misc';
import { Modal } from '../components/Modal';
import { ITEM_TYPE_ICONS } from '../icons';
import { TYPE_DESC_KEYS, TYPE_LABEL_KEYS } from './helpers';

export const ITEM_TYPES: ItemType[] = ['login', 'note', 'wifi', 'recoveryCodes', 'license', 'custom'];

export function NewItemMenu() {
  const t = useT();
  return (
    <div className="flex">
      <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => openEditor({ mode: 'new', type: 'login' })} className="rounded-r-none">
        {t('item.new')}
      </Button>
      <Menu
        trigger={(p) => (
          <Button variant="primary" {...p} aria-label={t('item.newType')} className="rounded-l-none border-l border-black/10 px-2.5">
            <ChevronDown className="size-4" />
          </Button>
        )}
      >
        {(close) =>
          ITEM_TYPES.map((type) => {
            const Icon = ITEM_TYPE_ICONS[type];
            return (
              <MenuItem
                key={type}
                icon={<Icon />}
                onSelect={() => {
                  close();
                  openEditor({ mode: 'new', type });
                }}
              >
                {t(TYPE_LABEL_KEYS[type])}
              </MenuItem>
            );
          })
        }
      </Menu>
    </div>
  );
}

export function NewItemPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (t: ItemType) => void }) {
  const t = useT();
  return (
    <Modal open={open} onClose={onClose} title={t('item.newTitle')} size="md">
      <div className="grid gap-2 sm:grid-cols-2">
        {ITEM_TYPES.map((type) => {
          const Icon = ITEM_TYPE_ICONS[type];
          return (
            <button
              key={type}
              type="button"
              onClick={() => onPick(type)}
              className="flex items-start gap-3 rounded-2xl border border-line bg-surface-2 p-4 text-left transition-colors hover:border-accent/50 hover:bg-surface-3 cursor-pointer"
            >
              <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Icon className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="font-medium text-fg">{t(TYPE_LABEL_KEYS[type])}</p>
                <p className="mt-0.5 text-xs leading-relaxed text-muted">{t(TYPE_DESC_KEYS[type])}</p>
              </div>
            </button>
          );
        })}
      </div>
    </Modal>
  );
}
