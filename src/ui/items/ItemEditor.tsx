import { useMemo, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Plus, Star, Trash2, X } from 'lucide-react';
import { useT } from '../../i18n';
import { randomId } from '../../lib/encoding';
import { app, closeEditor, navigate, newItemTemplate, saveItem, selectItem, useApp, type EditorState } from '../../state/app';
import { confirmDialog, toast, toastError } from '../../state/ui';
import type { CustomField, ItemType, VaultItem } from '../../vault/types';
import { Button, IconButton } from '../components/Button';
import { SelectField, Switch, TextArea, TextField, inputClass } from '../components/Field';
import { Modal } from '../components/Modal';
import { PasswordInput } from '../components/Secret';
import { cx } from '../cx';
import { ITEM_TYPE_ICONS } from '../icons';
import { allTags, safeHttpUrl, sectionOptions, TYPE_LABEL_KEYS } from './helpers';
import { ITEM_TYPES } from './NewItemMenu';

const WIFI_SECURITY = ['WPA3', 'WPA2', 'WPA/WPA2', 'WEP', 'Open'];

function TagInput({ value, onChange, suggestions }: { value: string[]; onChange: (v: string[]) => void; suggestions: string[] }) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const add = (raw: string) => {
    const tags = raw
      .split(',')
      .map((s) => s.trim().slice(0, 40))
      .filter(Boolean);
    if (tags.length) onChange([...new Set([...value, ...tags])]);
    setDraft('');
  };
  const matching = draft ? suggestions.filter((s) => s.toLowerCase().startsWith(draft.toLowerCase()) && !value.includes(s)).slice(0, 5) : [];
  return (
    <div>
      <label htmlFor="tag-input" className="mb-1.5 block text-[13px] font-medium text-muted">
        {t('field.tags')}
      </label>
      <div className={cx(inputClass, 'flex h-auto min-h-11 flex-wrap items-center gap-1.5 py-1.5')}>
        {value.map((tag) => (
          <span key={tag} className="inline-flex items-center gap-1 rounded-lg bg-accent-soft px-2 py-0.5 text-sm text-accent">
            {tag}
            <button type="button" aria-label={t('action.removeTag', { tag })} onClick={() => onChange(value.filter((x) => x !== tag))} className="rounded hover:text-fg cursor-pointer">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          id="tag-input"
          value={draft}
          onChange={(e) => {
            if (e.target.value.endsWith(',')) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft && add(draft)}
          placeholder={value.length ? '' : t('field.tagsPlaceholder')}
          className="min-w-24 flex-1 bg-transparent text-[15px] outline-none placeholder:text-faint"
        />
      </div>
      {matching.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {matching.map((s) => (
            <button key={s} type="button" onClick={() => add(s)} className="rounded-lg border border-line px-2 py-0.5 text-xs text-muted hover:text-fg cursor-pointer">
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CustomFieldsEditor({ fields, onChange }: { fields: CustomField[]; onChange: (f: CustomField[]) => void }) {
  const t = useT();
  const update = (id: string, patch: Partial<CustomField>) => onChange(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  return (
    <div className="space-y-3">
      {fields.map((f) => (
        <div key={f.id} className="rounded-2xl border border-line bg-surface-2/50 p-3">
          <div className="flex items-end gap-2">
            <TextField label={t('field.customLabel')} value={f.label} onChange={(e) => update(f.id, { label: e.target.value })} wrapClassName="flex-1" placeholder={t('field.customLabelPlaceholder')} />
            <IconButton label={t('action.removeField')} tone="danger" onClick={() => onChange(fields.filter((x) => x.id !== f.id))} className="mb-0.5">
              <Trash2 className="size-4" />
            </IconButton>
          </div>
          <div className="mt-2">
            {f.hidden ? (
              <PasswordInput label={t('field.customValue')} value={f.value} onValueChange={(v) => update(f.id, { value: v })} />
            ) : (
              <TextField label={t('field.customValue')} value={f.value} onChange={(e) => update(f.id, { value: e.target.value })} />
            )}
          </div>
          <div className="mt-1">
            <Switch checked={f.hidden} onChange={(v) => update(f.id, { hidden: v })} label={t('field.customHidden')} />
          </div>
        </div>
      ))}
      <Button size="sm" icon={<Plus className="size-4" />} onClick={() => onChange([...fields, { id: randomId(), label: '', value: '', hidden: false }])}>
        {t('field.addCustom')}
      </Button>
    </div>
  );
}

function Disclosure({ title, children, defaultOpen }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(!!defaultOpen);
  return (
    <div className="rounded-2xl border border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-medium text-fg cursor-pointer">
        {open ? <ChevronDown className="size-4 text-muted" /> : <ChevronRight className="size-4 text-muted" />}
        {title}
      </button>
      {open && <div className="space-y-4 border-t border-line p-4">{children}</div>}
    </div>
  );
}

export function ItemEditor({ editor }: { editor: EditorState }) {
  const t = useT();
  const items = useApp((s) => s.items);
  const collections = useApp((s) => s.collections);
  const initial = useMemo<VaultItem>(() => {
    if (editor.mode === 'edit' && editor.itemId) {
      const existing = app.get().items.find((i) => i.id === editor.itemId);
      if (existing) return structuredClone(existing);
    }
    return newItemTemplate(editor.type ?? 'login', editor.preset);
  }, [editor]);
  const [item, setItem] = useState<VaultItem>(initial);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<{ title?: string; url?: string }>({});
  const isNew = editor.mode === 'new';
  const dirty = JSON.stringify(item) !== JSON.stringify(initial);
  const set = <K extends keyof VaultItem>(k: K, v: VaultItem[K]) => setItem((i) => ({ ...i, [k]: v }));
  const categories = collections.filter((c) => c.kind === 'category');
  const sections = sectionOptions(collections);
  const tagSuggestions = useMemo(() => allTags(items), [items]);
  const TypeIcon = ITEM_TYPE_ICONS[item.type];

  const close = async () => {
    if (dirty && !(await confirmDialog({ title: t('editor.discard.title'), message: t('editor.discard.message'), confirmLabel: t('editor.discard.confirm'), danger: true }))) return;
    closeEditor();
  };

  const submit = async () => {
    const next = { ...item };
    const errs: typeof errors = {};
    if (next.url) {
      const safe = safeHttpUrl(next.url);
      if (!safe) errs.url = t('editor.error.url');
      else next.url = safe;
    }
    if (!next.title.trim()) {
      if (next.url && !errs.url) next.title = new URL(next.url).hostname.replace(/^www\./, '');
      else if (next.ssid) next.title = next.ssid;
      else if (next.product) next.title = next.product;
      else errs.title = t('editor.error.title');
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    next.customFields = next.customFields.filter((f) => f.label.trim() || f.value);
    setBusy(true);
    try {
      await saveItem(next);
      closeEditor();
      if (app.get().route.name !== 'items') navigate({ name: 'items', filter: { kind: 'all' } });
      selectItem(next.id);
      toast(isNew ? t('toast.itemCreated') : t('toast.itemSaved'));
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const orgFields = (
    <div className="grid gap-4 sm:grid-cols-2">
      <SelectField
        label={t('field.category')}
        value={item.categoryId ?? ''}
        onChange={(e) => set('categoryId', e.target.value || null)}
        options={[{ value: '', label: t('field.none') }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
      />
      <SelectField
        label={t('field.section')}
        value={item.sectionId ?? ''}
        onChange={(e) => set('sectionId', e.target.value || null)}
        options={[{ value: '', label: t('field.none') }, ...sections.map(({ c, depth }) => ({ value: c.id, label: `${'  '.repeat(depth)}${depth ? '└ ' : ''}${c.name}` }))]}
      />
      <div className="sm:col-span-2">
        <TagInput value={item.tags} onChange={(v) => set('tags', v)} suggestions={tagSuggestions} />
      </div>
    </div>
  );

  return (
    <Modal
      open
      onClose={() => void close()}
      size="lg"
      title={
        <span className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent">
            <TypeIcon className="size-4" />
          </span>
          {isNew ? t('editor.newTitle', { type: t(TYPE_LABEL_KEYS[item.type]) }) : t('editor.editTitle')}
        </span>
      }
      footer={
        <>
          <button
            type="button"
            onClick={() => set('favorite', !item.favorite)}
            aria-pressed={item.favorite}
            className={cx('mr-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm cursor-pointer', item.favorite ? 'text-warning' : 'text-muted hover:text-fg')}
          >
            <Star className={cx('size-4', item.favorite && 'fill-current')} />
            {t('field.favorite')}
          </button>
          <Button variant="ghost" onClick={() => void close()}>
            {t('action.cancel')}
          </Button>
          <Button variant="primary" loading={busy} onClick={() => void submit()}>
            {isNew ? t('action.create') : t('action.save')}
          </Button>
        </>
      }
    >
      <form
        className="space-y-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        autoComplete="off"
      >
        {isNew && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="radiogroup" aria-label={t('editor.type')}>
            {ITEM_TYPES.map((type) => {
              const Icon = ITEM_TYPE_ICONS[type];
              const active = item.type === type;
              return (
                <button
                  key={type}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => set('type', type as ItemType)}
                  className={cx('inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm cursor-pointer', active ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:text-fg')}
                >
                  <Icon className="size-4" />
                  {t(TYPE_LABEL_KEYS[type])}
                </button>
              );
            })}
          </div>
        )}

        <TextField label={t('field.title')} value={item.title} onChange={(e) => set('title', e.target.value)} placeholder={t(`editor.titlePlaceholder.${item.type}` as 'editor.titlePlaceholder.login')} autoFocus={isNew} error={errors.title} maxLength={200} />

        {item.type === 'login' && (
          <>
            <TextField label={t('field.url')} value={item.url ?? ''} onChange={(e) => set('url', e.target.value)} placeholder="https://instagram.com" inputMode="url" autoCapitalize="none" spellCheck={false} error={errors.url} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label={t('field.username')} value={item.username ?? ''} onChange={(e) => set('username', e.target.value)} autoCapitalize="none" spellCheck={false} autoComplete="off" />
              <TextField label={t('field.email')} type="email" value={item.email ?? ''} onChange={(e) => set('email', e.target.value)} autoCapitalize="none" spellCheck={false} autoComplete="off" />
            </div>
            <PasswordInput label={t('field.password')} value={item.password ?? ''} onValueChange={(v) => set('password', v)} showStrength allowGenerate autoComplete="new-password" />
          </>
        )}

        {item.type === 'wifi' && (
          <>
            <TextField label={t('field.ssid')} value={item.ssid ?? ''} onChange={(e) => set('ssid', e.target.value)} />
            <PasswordInput label={t('field.wifiPassword')} value={item.password ?? ''} onValueChange={(v) => set('password', v)} allowGenerate showStrength />
            <SelectField label={t('field.wifiSecurity')} value={item.wifiSecurity ?? 'WPA2'} onChange={(e) => set('wifiSecurity', e.target.value)} options={WIFI_SECURITY.map((w) => ({ value: w, label: w }))} />
          </>
        )}

        {item.type === 'license' && (
          <>
            <TextField label={t('field.product')} value={item.product ?? ''} onChange={(e) => set('product', e.target.value)} />
            <PasswordInput label={t('field.licenseKey')} value={item.licenseKey ?? ''} onValueChange={(v) => set('licenseKey', v)} />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField label={t('field.licensee')} value={item.licensee ?? ''} onChange={(e) => set('licensee', e.target.value)} />
              <TextField label={t('field.email')} type="email" value={item.email ?? ''} onChange={(e) => set('email', e.target.value)} />
              <TextField label={t('field.version')} value={item.version ?? ''} onChange={(e) => set('version', e.target.value)} />
              <TextField label={t('field.purchaseDate')} type="date" value={item.purchaseDate ?? ''} onChange={(e) => set('purchaseDate', e.target.value)} />
            </div>
            <TextField label={t('field.url')} value={item.url ?? ''} onChange={(e) => set('url', e.target.value)} inputMode="url" autoCapitalize="none" error={errors.url} />
          </>
        )}

        {item.type === 'recoveryCodes' && (
          <>
            <TextField label={t('field.service')} value={item.service ?? ''} onChange={(e) => set('service', e.target.value)} />
            <TextArea label={t('field.codes')} value={item.codes ?? ''} onChange={(e) => set('codes', e.target.value)} rows={6} className="secret" spellCheck={false} help={t('field.codesHelp')} />
          </>
        )}

        <TextArea
          label={item.type === 'note' ? t('field.noteContent') : t('field.notes')}
          value={item.notes ?? ''}
          onChange={(e) => set('notes', e.target.value)}
          rows={item.type === 'note' ? 10 : 3}
        />

        {orgFields}

        {(item.type === 'login' || item.type === 'custom') && (
          <Disclosure title={t('editor.more')} defaultOpen={item.type === 'custom' || !!(item.recoveryEmail || item.recoveryInfo || item.importantNotes || item.customFields.length)}>
            {item.type === 'login' && (
              <>
                <TextField label={t('field.recoveryEmail')} type="email" value={item.recoveryEmail ?? ''} onChange={(e) => set('recoveryEmail', e.target.value)} autoCapitalize="none" />
                <TextArea label={t('field.recoveryInfo')} value={item.recoveryInfo ?? ''} onChange={(e) => set('recoveryInfo', e.target.value)} rows={2} help={t('field.recoveryInfoHelp')} />
                <TextArea label={t('field.importantNotes')} value={item.importantNotes ?? ''} onChange={(e) => set('importantNotes', e.target.value)} rows={2} />
              </>
            )}
            <div>
              <p className="mb-2 text-[13px] font-medium text-muted">{t('field.customFields')}</p>
              <CustomFieldsEditor fields={item.customFields} onChange={(f) => set('customFields', f)} />
            </div>
          </Disclosure>
        )}
        {item.type !== 'login' && item.type !== 'custom' && (
          <Disclosure title={t('field.customFields')} defaultOpen={item.customFields.length > 0}>
            <CustomFieldsEditor fields={item.customFields} onChange={(f) => set('customFields', f)} />
          </Disclosure>
        )}

        <div className="rounded-2xl border border-line px-4 py-1">
          <Switch checked={item.reprompt} onChange={(v) => set('reprompt', v)} label={t('field.reprompt')} description={t('field.repromptHelp')} />
        </div>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
