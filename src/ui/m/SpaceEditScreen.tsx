/**
 * Add or edit a My Space entry (Android SpaceEditorScreen): Mine / Someone else, bank picker,
 * nickname / holder / number (spaces and dashes removed, leading zeros kept), payment QR with the
 * QR check, Crop to QR, Replace and Remove, DuitNow ID, account type, notes, colour, favourite.
 */
import { useMemo, useRef, useState } from 'react';
import { Check, Crop, ImagePlus, Landmark, LoaderCircle, Trash2, X } from 'lucide-react';
import { useT } from '../../i18n';
import { assetDataUrl, bankById, BANKS, CUSTOM_BANK, isMine, newSpaceEntry, normalizeAccountNumber, SPACE_COLORS } from '../../lib/space';
import { cropToQr, importImage, type ImportedImage } from '../../lib/space-media';
import { app, back, navigate, saveSpaceWithImage, useApp } from '../../state/app';
import { confirmDialog, toast, toastError } from '../../state/ui';
import type { SpaceOwner, SpaceType } from '../../vault/types';
import { Modal } from '../components/Modal';
import { cx } from '../cx';
import { CheckMark, Chevron, Chip, Column, ErrorText, FlowingSelector, Footnote, GlassButton, GlassIconButton, GlassTextField, GroupDivider, IconTile, InsetGroup, LargeTitle, ListRow, SectionHeader, ToggleRow } from './kit';
import { TopBar } from './Shell';
import { QrBox, spaceSegment } from './SpaceTab';
import { useImportErrorText } from './SpaceItemScreen';

export function SpaceEditScreen({ id, type, owner }: { id?: string; type: SpaceType; owner: SpaceOwner }) {
  const t = useT();
  const all = useApp((s) => s.space);
  const original = useMemo(() => (id ? app.get().space.find((e) => e.id === id) : undefined), [id]);
  const existingAsset = useApp((s) => (original?.qrAssetId ? s.session?.asset(original.qrAssetId) : undefined));
  const [base] = useState(() => original ?? newSpaceEntry(type, owner));
  const isBank = base.type === 'bank';
  const knownCustom = !!original && (original.bankId === CUSTOM_BANK || (!!original.bankId && !bankById(original.bankId)) || (!original.bankId && !!original.bankName));

  const [bankId, setBankId] = useState<string | null>(original?.bankId ?? (knownCustom ? CUSTOM_BANK : null));
  const [customBank, setCustomBank] = useState(knownCustom ? original?.bankName ?? '' : '');
  const [title, setTitle] = useState(original?.title ?? '');
  const [holder, setHolder] = useState(original?.holder ?? '');
  const [number, setNumber] = useState(original?.accountNumber ?? '');
  const [duitNow, setDuitNow] = useState(original?.duitNowId ?? '');
  const [accountType, setAccountType] = useState<string | null>(original?.accountType ?? null);
  const [notes, setNotes] = useState(original?.notes ?? '');
  const [color, setColor] = useState(original?.color ?? SPACE_COLORS[all.length % SPACE_COLORS.length]!);
  const [favorite, setFavorite] = useState(original?.favorite ?? false);
  const [isOther, setIsOther] = useState(original ? !isMine(original) : owner === 'other');
  const [newImage, setNewImage] = useState<ImportedImage | null>(null);
  const [removeImage, setRemoveImage] = useState(false);
  const [importing, setImporting] = useState(false);
  const [bankSheet, setBankSheet] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const importError = useImportErrorText();

  const bankName = !bankId ? '' : bankId === CUSTOM_BANK ? customBank.trim() : (bankById(bankId)?.name ?? customBank.trim());
  const normalized = normalizeAccountNumber(number);
  const newUrl = useMemo(() => (newImage ? URL.createObjectURL(new Blob([newImage.bytes], { type: newImage.mime })) : null), [newImage]);
  const shownSrc = newUrl ?? (existingAsset && !removeImage ? assetDataUrl(existingAsset) : null);
  const dirty = original
    ? bankName !== (original.bankName ?? '') ||
      title !== original.title ||
      holder !== (original.holder ?? '') ||
      normalized !== (original.accountNumber ?? '') ||
      duitNow !== (original.duitNowId ?? '') ||
      accountType !== (original.accountType ?? null) ||
      notes !== (original.notes ?? '') ||
      color !== original.color ||
      favorite !== original.favorite ||
      !!newImage ||
      removeImage ||
      isOther === isMine(original)
    : !!bankId || !!title.trim() || !!holder.trim() || !!number.trim() || !!newImage || !!notes.trim();

  const tryClose = async () => {
    if (dirty && !(await confirmDialog({ title: t('a.discard_title'), message: t('a.discard_message'), confirmLabel: t('a.discard_confirm'), cancelLabel: t('a.space_keep_editing'), danger: true }))) return;
    back();
  };

  const pick = () => !importing && fileInput.current?.click();

  const save = async () => {
    const hasQr = !!shownSrc;
    const err = isBank && !bankName ? t('a.space_err_need_bank') : isBank && !normalized && !hasQr ? t('a.space_err_need_number_or_qr') : !isBank && !hasQr ? t('a.space_err_need_qr') : null;
    setError(err);
    if (err) return;
    setBusy(true);
    try {
      const entry = {
        ...base,
        title: title.trim(),
        bankId: isBank ? bankId : null,
        bankName: isBank ? bankName : null,
        holder: holder.trim() || null,
        accountNumber: isBank ? normalized || null : null,
        duitNowId: duitNow.trim() || null,
        accountType,
        notes: notes.trim() || null,
        color,
        favorite,
        owner: isOther ? ('other' as const) : original?.owner === 'me' ? ('me' as const) : null,
      };
      const savedId = await saveSpaceWithImage(entry, newImage, removeImage && !newImage);
      spaceSegment.set({ seg: isOther ? 1 : 0 });
      // replace the editor with the entry screen
      app.set({ route: { name: 'space' }, stack: [] });
      navigate({ name: 'spaceItem', id: savedId });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  const heading = original ? t('a.space_edit_title') : isOther && isBank ? t('a.space_add_other_bank') : isOther ? t('a.space_add_other_qr') : isBank ? t('a.space_add_bank') : t('a.space_add_qr_entry');
  const box = newImage?.qrBox;
  const canCrop = !!newImage && !!box && box.w * box.h < newImage.width * newImage.height * 0.8;

  return (
    <div className="relative min-h-full">
      <TopBar
        left={
          <GlassIconButton label={t('a.cancel')} onClick={() => void tryClose()}>
            <X />
          </GlassIconButton>
        }
      >
        <GlassIconButton label={t('a.action_save')} onClick={() => void save()} className="!text-accent">
          {busy ? <LoaderCircle className="animate-spin" /> : <Check />}
        </GlassIconButton>
      </TopBar>
      <div className="pb-16 pt-[calc(env(safe-area-inset-top)+76px)]">
        <Column>
          <div className="flex flex-col gap-2.5">
            <LargeTitle className="pb-1.5 pl-1.5">{heading}</LargeTitle>
            <FlowingSelector
              label={t('a.space_owner_mine')}
              value={isOther ? 'other' : 'mine'}
              onChange={(v) => setIsOther(v === 'other')}
              options={[
                { value: 'mine', label: t('a.space_owner_mine') },
                { value: 'other', label: t('a.space_owner_other') },
              ]}
              className="lg-seg-accent"
            />
            <ErrorText>{error}</ErrorText>
            {isBank ? (
              <>
                <SectionHeader>{t('a.space_section_account')}</SectionHeader>
                <InsetGroup>
                  <ListRow
                    title={t('a.space_bank')}
                    leading={<IconTile icon={<Landmark className="size-full" />} size={34} />}
                    trailing={
                      <>
                        <span className="text-[15px] text-muted">{bankName || t('a.space_choose_bank')}</span>
                        <Chevron />
                      </>
                    }
                    onClick={() => setBankSheet(true)}
                  />
                </InsetGroup>
                {bankId === CUSTOM_BANK && <GlassTextField value={customBank} onChange={(v) => setCustomBank(v.slice(0, 60))} placeholder={t('a.space_custom_bank')} />}
                {isOther ? (
                  <>
                    <GlassTextField value={holder} onChange={(v) => setHolder(v.slice(0, 80))} placeholder={t('a.space_other_name')} />
                    <GlassTextField value={title} onChange={(v) => setTitle(v.slice(0, 60))} placeholder={t('a.space_other_label')} />
                  </>
                ) : (
                  <>
                    <GlassTextField value={title} onChange={(v) => setTitle(v.slice(0, 60))} placeholder={t('a.space_nickname')} />
                    <GlassTextField value={holder} onChange={(v) => setHolder(v.slice(0, 80))} placeholder={t('a.space_holder')} />
                  </>
                )}
                <GlassTextField value={number} onChange={(v) => setNumber(v.slice(0, 40))} placeholder={t('a.space_account_number')} mono inputMode="numeric" />
                {number && normalized !== number && <Footnote className="px-4">{t('a.space_number_saved_as', { 1: normalized })}</Footnote>}
              </>
            ) : (
              <>
                {isOther && <GlassTextField value={holder} onChange={(v) => setHolder(v.slice(0, 80))} placeholder={t('a.space_other_name')} />}
                <GlassTextField value={title} onChange={(v) => setTitle(v.slice(0, 60))} placeholder={isOther ? t('a.space_other_label') : t('a.space_qr_name')} />
              </>
            )}

            <SectionHeader>{t('a.space_payment_qr')}</SectionHeader>
            {shownSrc ? (
              <>
                <QrBox src={shownSrc} className="mx-auto w-full max-w-[320px]" />
                {newImage && <Footnote className={cx('px-4', newImage.qrFound ? '!text-muted' : '!text-danger')}>{newImage.qrFound ? t('a.space_qr_detected') : t('a.space_qr_not_detected')}</Footnote>}
                <div className="flex flex-wrap gap-2 px-1">
                  <Chip icon={<ImagePlus />} onClick={pick}>
                    {t('a.space_replace_qr')}
                  </Chip>
                  {canCrop && (
                    <Chip
                      icon={<Crop />}
                      onClick={async () => {
                        setImporting(true);
                        try {
                          setNewImage(await cropToQr(newImage!));
                        } catch {
                          /* keep the original */
                        } finally {
                          setImporting(false);
                        }
                      }}
                    >
                      {t('a.space_crop_qr')}
                    </Chip>
                  )}
                  <Chip
                    icon={<Trash2 />}
                    onClick={() => {
                      setNewImage(null);
                      setRemoveImage(true);
                    }}
                  >
                    {t('a.space_remove_qr')}
                  </Chip>
                </div>
              </>
            ) : (
              <InsetGroup>
                <ListRow title={importing ? t('a.space_importing') : t('a.space_add_qr')} subtitle={t('a.space_add_qr_hint')} leading={<IconTile icon={<ImagePlus className="size-full" />} size={34} />} onClick={pick} />
              </InsetGroup>
            )}
            {importing && <LoaderCircle className="mx-auto size-[22px] animate-spin text-accent" />}
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={async (ev) => {
                const f = ev.target.files?.[0];
                ev.target.value = '';
                if (!f) return;
                setImporting(true);
                try {
                  setNewImage(await importImage(f));
                  setRemoveImage(false);
                } catch (err) {
                  toast(importError(err), { kind: 'error' });
                } finally {
                  setImporting(false);
                }
              }}
            />
            <Footnote className="px-4">{t('a.space_qr_real_only')}</Footnote>

            <SectionHeader>{t('a.space_section_more')}</SectionHeader>
            {isBank && (
              <>
                <GlassTextField value={duitNow} onChange={(v) => setDuitNow(v.slice(0, 60))} placeholder={t('a.space_duitnow')} />
                <div className="flex flex-wrap gap-2 px-1">
                  {(
                    [
                      ['savings', t('a.space_type_savings')],
                      ['current', t('a.space_type_current')],
                      ['other', t('a.space_type_other')],
                    ] as const
                  ).map(([key, label]) => (
                    <Chip key={key} selected={accountType === key} onClick={() => setAccountType(accountType === key ? null : key)}>
                      {label}
                    </Chip>
                  ))}
                </div>
              </>
            )}
            <GlassTextField value={notes} onChange={(v) => setNotes(v.slice(0, 2000))} placeholder={t('a.field_notes')} multiline />
            <InsetGroup>
              <div className="flex flex-col gap-2.5 px-4 py-3">
                <p className="text-[17px] text-fg">{t('a.space_colour')}</p>
                <div className="flex flex-wrap gap-2.5">
                  {SPACE_COLORS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      aria-label={hex}
                      aria-pressed={color === hex}
                      onClick={() => setColor(hex)}
                      className={cx('size-8 rounded-full cursor-pointer', color === hex && 'ring-[3px] ring-fg')}
                      style={{ background: hex }}
                    />
                  ))}
                </div>
              </div>
              <GroupDivider />
              <ToggleRow title={t('a.space_favourite')} checked={favorite} onChange={setFavorite} />
            </InsetGroup>
            <GlassButton block className="mt-1" loading={busy} onClick={() => void save()}>
              {t('a.action_save')}
            </GlassButton>
          </div>
        </Column>
      </div>

      <Modal open={bankSheet} onClose={() => setBankSheet(false)} title={t('a.space_choose_bank')} size="sm">
        <div className="flex flex-col gap-3 pb-1">
          <InsetGroup>
            {BANKS.map((b, i) => (
              <div key={b.id}>
                {i > 0 && <GroupDivider />}
                <ListRow
                  title={b.name}
                  trailing={<CheckMark on={bankId === b.id} />}
                  onClick={() => {
                    setBankId(b.id);
                    setBankSheet(false);
                  }}
                />
              </div>
            ))}
          </InsetGroup>
          <InsetGroup>
            <ListRow
              title={t('a.space_other_bank')}
              trailing={<CheckMark on={bankId === CUSTOM_BANK} />}
              onClick={() => {
                setBankId(CUSTOM_BANK);
                setBankSheet(false);
              }}
            />
          </InsetGroup>
        </div>
      </Modal>
    </div>
  );
}
