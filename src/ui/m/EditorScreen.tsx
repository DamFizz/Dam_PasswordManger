/**
 * Item editor as a full screen (Android EditorScreen): close and Save in the top bar, a large
 * title, labelled glass fields per type, Organise group (category, folder, favourite, ask for
 * master password), tags, More (logins), custom fields.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Check, Plus, WandSparkles, X } from 'lucide-react';
import { useT } from '../../i18n';
import { randomId } from '../../lib/encoding';
import { DEFAULT_PASSWORD_OPTIONS, generatePassword } from '../../lib/generator';
import { app, closeEditor, navigate, newItemTemplate, saveItem, useApp } from '../../state/app';
import { confirmDialog, toast, toastError } from '../../state/ui';
import type { CustomField, VaultItem } from '../../vault/types';
import { Modal } from '../components/Modal';
import { StrengthMeter } from '../components/Secret';
import { safeHttpUrl, sectionOptions } from '../items/helpers';
import { CheckMark, Chevron, Column, Footnote, GlassButton, GlassIconButton, GlassTextField, GroupDivider, InsetGroup, LargeTitle, ListRow, RowIconButton, SectionHeader, ToggleRow } from './kit';
import { TopBar } from './Shell';
import { typeLabelKey } from './VaultTab';

function Labeled({ label, error, children }: { label: string; error?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="pl-3.5 text-[13px] leading-[18px] text-muted">{label}</p>
      {children}
      {error && <p className="pl-3.5 text-[13px] leading-[18px] text-danger">{error}</p>}
    </div>
  );
}

export function EditorScreen() {
  const editor = useApp((s) => s.editor);
  const [snapshot] = useState(editor);
  const e = editor ?? snapshot;
  if (!e) return null;
  return <EditorBody key={`${e.mode}-${e.itemId ?? ''}-${e.type ?? ''}`} />;
}

function EditorBody() {
  const t = useT();
  const editor = useApp((s) => s.editor) ?? { mode: 'new' as const, type: 'login' as const };
  const collections = useApp((s) => s.collections);
  const initial = useMemo<VaultItem>(() => {
    if (editor.mode === 'edit' && editor.itemId) {
      const existing = app.get().items.find((i) => i.id === editor.itemId);
      if (existing) return structuredClone(existing);
    }
    return newItemTemplate(editor.type ?? 'login', editor.preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [item, setItem] = useState<VaultItem>(initial);
  const [tagsText, setTagsText] = useState(initial.tags.join(', '));
  const [errors, setErrors] = useState<{ title?: string; url?: string }>({});
  const [busy, setBusy] = useState(false);
  const [pickCategory, setPickCategory] = useState(false);
  const [pickFolder, setPickFolder] = useState(false);
  const isNew = editor.mode === 'new';
  const set = (patch: Partial<VaultItem>) => setItem((i) => ({ ...i, ...patch }));
  const txt = (v: string) => v || undefined;
  const categories = collections.filter((c) => c.kind === 'category');
  const folders = sectionOptions(collections);
  const dirty = JSON.stringify(item) !== JSON.stringify(initial) || tagsText !== initial.tags.join(', ');

  const tryClose = async () => {
    if (dirty && !(await confirmDialog({ title: t('a.discard_title'), message: t('a.discard_message'), confirmLabel: t('a.discard_confirm'), danger: true }))) return;
    closeEditor();
  };

  const save = async () => {
    const next: VaultItem = {
      ...item,
      tags: [...new Set(tagsText.split(',').map((s) => s.trim().slice(0, 40)).filter(Boolean))],
      customFields: item.customFields.filter((f) => f.label.trim() || f.value),
    };
    const errs: typeof errors = {};
    if (next.url) {
      const safe = safeHttpUrl(next.url);
      if (!safe) errs.url = t('a.err_url');
      else next.url = safe;
    }
    if (!next.title.trim()) {
      if (next.url && !errs.url) next.title = new URL(next.url).hostname.replace(/^www\./, '');
      else if (next.ssid) next.title = next.ssid;
      else if (next.product) next.title = next.product;
      else errs.title = t('a.err_title');
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    try {
      await saveItem(next);
      closeEditor();
      const r = app.get().route;
      if (!(r.name === 'item' && r.id === next.id)) navigate({ name: 'item', id: next.id });
      toast(t('a.toast_saved'));
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const field = (label: string, key: keyof VaultItem, o: { secret?: boolean; mono?: boolean; multiline?: boolean; placeholder?: string; inputMode?: 'url' | 'email'; error?: string; trailing?: ReactNode } = {}) => (
    <Labeled label={label} error={o.error}>
      <GlassTextField
        value={(item[key] as string | undefined) ?? ''}
        onChange={(v) => set({ [key]: txt(v) } as Partial<VaultItem>)}
        placeholder={o.placeholder ?? label}
        aria-label={label}
        secret={o.secret}
        mono={o.mono}
        multiline={o.multiline}
        inputMode={o.inputMode}
        trailing={o.trailing}
        autoCapitalize="none"
      />
    </Labeled>
  );
  const generate = (
    <RowIconButton label={t('generator.generate')} onClick={() => set({ password: generatePassword(DEFAULT_PASSWORD_OPTIONS) })}>
      <WandSparkles />
    </RowIconButton>
  );

  return (
    <div className="lg-editor relative h-full overflow-y-auto overscroll-contain">
      <TopBar
        left={
          <GlassIconButton label={t('a.cancel')} onClick={() => void tryClose()}>
            <X />
          </GlassIconButton>
        }
      >
        <GlassButton icon={<Check />} loading={busy} onClick={() => void save()} className="!min-h-[46px] !py-2.5">
          {t('a.action_save')}
        </GlassButton>
      </TopBar>
      <div className="pb-16 pt-[calc(env(safe-area-inset-top)+76px)]">
        <Column>
          <form
            className="flex flex-col gap-3"
            autoComplete="off"
            onSubmit={(ev) => {
              ev.preventDefault();
              void save();
            }}
          >
            <LargeTitle className="pl-1.5">{isNew ? t('a.editor_new', { 1: t(typeLabelKey(item.type) as never) }) : t('a.editor_edit')}</LargeTitle>
            {field(t('a.field_title'), 'title', { error: errors.title })}
            {item.type === 'login' && (
              <>
                {field(t('a.field_url'), 'url', { placeholder: 'example.com', inputMode: 'url', error: errors.url })}
                {field(t('a.field_username'), 'username')}
                {field(t('a.field_email'), 'email', { inputMode: 'email' })}
                {field(t('a.field_password'), 'password', { secret: true, trailing: generate })}
                {item.password && <StrengthMeter password={item.password} className="px-3.5" />}
              </>
            )}
            {item.type === 'wifi' && (
              <>
                {field(t('a.field_ssid'), 'ssid')}
                {field(t('a.field_password'), 'password', { secret: true, trailing: generate })}
                {field(t('a.field_wifi_security'), 'wifiSecurity', { placeholder: 'WPA2 / WPA3' })}
              </>
            )}
            {item.type === 'recoveryCodes' && (
              <>
                {field(t('a.field_service'), 'service')}
                {field(t('a.field_codes'), 'codes', { mono: true, multiline: true, placeholder: t('a.field_codes_help') })}
              </>
            )}
            {item.type === 'license' && (
              <>
                {field(t('a.field_product'), 'product')}
                {field(t('a.field_license_key'), 'licenseKey', { secret: true })}
                {field(t('a.field_licensee'), 'licensee')}
                {field(t('a.field_version'), 'version')}
                {field(t('a.field_purchase_date'), 'purchaseDate', { placeholder: '2026-01-31' })}
              </>
            )}
            {field(item.type === 'note' ? t('a.field_note') : t('a.field_notes'), 'notes', { multiline: true, placeholder: t('a.field_notes') })}

            <SectionHeader>{t('a.field_organize')}</SectionHeader>
            <InsetGroup>
              <ListRow
                title={t('a.field_category')}
                trailing={
                  <>
                    <span className="text-[15px] text-muted">{categories.find((c) => c.id === item.categoryId)?.name ?? t('a.field_none')}</span>
                    <Chevron />
                  </>
                }
                onClick={() => setPickCategory(true)}
              />
              <GroupDivider />
              <ListRow
                title={t('a.field_folder')}
                trailing={
                  <>
                    <span className="text-[15px] text-muted">{folders.find((f) => f.c.id === item.sectionId)?.c.name ?? t('a.field_none')}</span>
                    <Chevron />
                  </>
                }
                onClick={() => setPickFolder(true)}
              />
              <GroupDivider />
              <ToggleRow title={t('a.field_favorite')} checked={item.favorite} onChange={(v) => set({ favorite: v })} />
              <GroupDivider />
              <ToggleRow title={t('a.field_reprompt')} subtitle={t('a.field_reprompt_help')} checked={item.reprompt} onChange={(v) => set({ reprompt: v })} />
            </InsetGroup>
            <Labeled label={t('a.field_tags')}>
              <GlassTextField value={tagsText} onChange={setTagsText} placeholder={t('a.field_tags_hint')} />
            </Labeled>

            {item.type === 'login' && (
              <>
                <SectionHeader>{t('a.field_more')}</SectionHeader>
                {field(t('a.field_recovery_email'), 'recoveryEmail', { inputMode: 'email' })}
                {field(t('a.field_recovery_info'), 'recoveryInfo', { multiline: true })}
                {field(t('a.field_important_notes'), 'importantNotes', { multiline: true })}
              </>
            )}

            <SectionHeader>{t('a.field_custom_fields')}</SectionHeader>
            {item.customFields.map((f) => (
              <CustomFieldEditor
                key={f.id}
                f={f}
                onChange={(n) => set({ customFields: item.customFields.map((x) => (x.id === f.id ? n : x)) })}
                onRemove={() => set({ customFields: item.customFields.filter((x) => x.id !== f.id) })}
              />
            ))}
            <GlassButton block prominent={false} icon={<Plus />} onClick={() => set({ customFields: [...item.customFields, { id: randomId(), label: '', value: '', hidden: false }] })}>
              {t('a.field_add_custom')}
            </GlassButton>
            <button type="submit" hidden />
          </form>
        </Column>
      </div>

      <Modal open={pickCategory} onClose={() => setPickCategory(false)} title={t('a.field_category')} size="sm">
        <InsetGroup className="mb-1">
          <ListRow title={t('a.field_none')} trailing={<CheckMark on={!item.categoryId} />} onClick={() => (set({ categoryId: null }), setPickCategory(false))} />
          {categories.map((c) => (
            <div key={c.id}>
              <GroupDivider />
              <ListRow title={c.name} trailing={<CheckMark on={item.categoryId === c.id} />} onClick={() => (set({ categoryId: c.id }), setPickCategory(false))} />
            </div>
          ))}
        </InsetGroup>
      </Modal>
      <Modal open={pickFolder} onClose={() => setPickFolder(false)} title={t('a.field_folder')} size="sm">
        <InsetGroup className="mb-1">
          <ListRow title={t('a.field_none')} trailing={<CheckMark on={!item.sectionId} />} onClick={() => (set({ sectionId: null }), setPickFolder(false))} />
          {folders.map(({ c, depth }) => (
            <div key={c.id}>
              <GroupDivider />
              <ListRow title={c.name} indent={depth} trailing={<CheckMark on={item.sectionId === c.id} />} onClick={() => (set({ sectionId: c.id }), setPickFolder(false))} />
            </div>
          ))}
        </InsetGroup>
      </Modal>
    </div>
  );
}

function CustomFieldEditor({ f, onChange, onRemove }: { f: CustomField; onChange: (f: CustomField) => void; onRemove: () => void }) {
  const t = useT();
  return (
    <InsetGroup>
      <div className="flex flex-col gap-2 p-2.5">
        <GlassTextField value={f.label} onChange={(v) => onChange({ ...f, label: v })} placeholder={t('a.field_custom_label')} />
        <GlassTextField value={f.value} onChange={(v) => onChange({ ...f, value: v })} placeholder={t('a.field_custom_value')} secret={f.hidden} />
      </div>
      <ToggleRow title={t('a.field_custom_hidden')} checked={f.hidden} onChange={(v) => onChange({ ...f, hidden: v })} />
      <GroupDivider />
      <ListRow title={t('a.action_remove')} titleClassName="!text-danger" onClick={onRemove} />
      <Footnote className="hidden">{f.id}</Footnote>
    </InsetGroup>
  );
}
