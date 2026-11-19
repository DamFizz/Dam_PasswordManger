/**
 * My Space entry screen (Android SpaceDetailScreen): badge + name, holder / number (masked, reveal,
 * copy) / DuitNow ID, the payment QR on white (tap for full screen), notes, Share and Copy.
 */
import { useEffect, useRef, useState } from 'react';
import { Copy, Eye, EyeOff, ImagePlus, Pencil, Share, Star, Trash2 } from 'lucide-react';
import { useT } from '../../i18n';
import { assetDataUrl, assetIntact, groupedNumber, isMine, maskedNumber, spaceDisplayName } from '../../lib/space';
import { ImageImportError, importImage } from '../../lib/space-media';
import { back, deleteSpaceEntry, markUsed, navigate, saveSpaceWithImage, toggleSpaceFavorite, useApp } from '../../state/app';
import { usePrefs } from '../../state/prefs-store';
import { confirmDialog, toast } from '../../state/ui';
import type { SpaceEntry } from '../../vault/types';
import { copyWithFeedback } from '../components/Secret';
import { cx } from '../cx';
import { Column, Footnote, GlassButton, GlassIconButton, GroupDivider, IconTile, InsetGroup, ListRow, RowIconButton, SectionHeader, Stack } from './kit';
import { PushedScreen } from './Shell';
import { BankBadge, copyAccountNumber, QrBox, QrFullScreen } from './SpaceTab';
import { SpaceShareSheet, type ShareMode } from './SpaceShare';

export function accountTypeKey(type: string | null | undefined): string | null {
  if (!type) return null;
  return type === 'savings' ? 'a.space_type_savings' : type === 'current' ? 'a.space_type_current' : type === 'other' ? 'a.space_type_other' : null;
}

export function useImportErrorText(): (e: unknown) => string {
  const t = useT();
  return (e) => {
    const r = e instanceof ImageImportError ? e.reason : 'unreadable';
    return r === 'notImage' ? t('a.space_err_not_image') : r === 'tooLarge' ? t('a.space_err_too_large') : t('a.space_err_unreadable');
  };
}

export function SpaceItemScreen({ id }: { id: string }) {
  const e = useApp((s) => s.space.find((x) => x.id === id));
  useEffect(() => {
    if (!e) back();
  }, [e]);
  if (!e) return null;
  return <Body e={e} />;
}

function Body({ e }: { e: SpaceEntry }) {
  const t = useT();
  const { revealSeconds } = usePrefs();
  const asset = useApp((s) => (e.qrAssetId ? s.session?.asset(e.qrAssetId) : undefined));
  const [revealed, setRevealed] = useState(false);
  const [share, setShare] = useState<ShareMode | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [intact, setIntact] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const importError = useImportErrorText();
  const name = spaceDisplayName(e);
  const hasNumber = !!e.accountNumber;
  const typeKey = accountTypeKey(e.accountType);
  const sub = [!isMine(e) ? t('a.space_someone_else') : null, e.bankName && e.bankName !== name ? e.bankName : null, typeKey ? t(typeKey as never) : e.accountType || null].filter(Boolean).join(' · ');

  useEffect(() => {
    if (!revealed || revealSeconds <= 0) return;
    const id = window.setTimeout(() => setRevealed(false), revealSeconds * 1000);
    return () => window.clearTimeout(id);
  }, [revealed, revealSeconds]);
  useEffect(() => {
    let alive = true;
    if (asset) void assetIntact(asset).then((ok) => alive && setIntact(ok));
    return () => {
      alive = false;
    };
  }, [asset]);

  const copyPlain = async (label: string, value: string) => {
    await copyWithFeedback(value, { secret: true, label });
  };

  return (
    <PushedScreen
      title={name}
      actions={
        <>
          <GlassIconButton label={e.favorite ? t('a.action_unfavorite') : t('a.action_favorite')} onClick={() => void toggleSpaceFavorite(e.id)} aria-pressed={e.favorite}>
            <Star className={cx(e.favorite && 'fill-[var(--star)] text-[var(--star)]')} />
          </GlassIconButton>
          <GlassIconButton label={t('a.action_edit')} onClick={() => navigate({ name: 'spaceEdit', id: e.id, type: e.type, owner: isMine(e) ? 'me' : 'other' })}>
            <Pencil />
          </GlassIconButton>
          <GlassIconButton
            label={t('a.space_delete')}
            className="!text-danger"
            onClick={async () => {
              const ok = await confirmDialog({ title: t('a.space_delete_title'), message: t('a.space_delete_body'), confirmLabel: t('a.space_delete'), danger: true });
              if (ok) await deleteSpaceEntry(e.id);
            }}
          >
            <Trash2 />
          </GlassIconButton>
        </>
      }
    >
      <Column>
        <Stack gap={12}>
          <div className="flex items-center gap-3.5 pb-1 pl-1">
            <BankBadge e={e} size={56} />
            <div className="min-w-0 flex-1">
              <h1 className="line-clamp-2 text-[24px] font-bold leading-[30px] tracking-[-0.2px] text-fg">{name}</h1>
              {sub && <p className="text-[15px] text-muted">{sub}</p>}
            </div>
          </div>

          {(hasNumber || e.holder || e.duitNowId) && (
            <InsetGroup>
              {e.holder && (
                <ListRow
                  title={e.holder}
                  subtitle={t('a.space_holder')}
                  trailing={
                    <RowIconButton label={`${t('a.space_copy')} ${t('a.space_holder')}`} onClick={() => void copyPlain(t('a.space_holder'), e.holder!)}>
                      <Copy />
                    </RowIconButton>
                  }
                />
              )}
              {hasNumber && (
                <>
                  {e.holder && <GroupDivider />}
                  <div className="flex items-center py-2.5 pl-4 pr-1">
                    <div className="min-w-0 flex-1">
                      <p className="font-mono text-[21px] font-bold leading-[28px] text-fg select-text">{revealed ? groupedNumber(e.accountNumber) : maskedNumber(e.accountNumber)}</p>
                      <p className="text-[13px] text-muted">{t('a.space_account_number')}</p>
                    </div>
                    <RowIconButton label={revealed ? t('a.detail_hide') : t('a.detail_reveal')} onClick={() => setRevealed((v) => !v)} tone="muted">
                      {revealed ? <EyeOff /> : <Eye />}
                    </RowIconButton>
                    <RowIconButton label={t('a.space_copy_number')} onClick={() => void copyAccountNumber(e, t('a.space_account_number'))}>
                      <Copy />
                    </RowIconButton>
                  </div>
                </>
              )}
              {e.duitNowId && (
                <>
                  <GroupDivider />
                  <ListRow
                    title={e.duitNowId}
                    subtitle={t('a.space_duitnow')}
                    trailing={
                      <RowIconButton label={`${t('a.space_copy')} ${t('a.space_duitnow')}`} onClick={() => void copyPlain('DuitNow', e.duitNowId!)}>
                        <Copy />
                      </RowIconButton>
                    }
                  />
                </>
              )}
            </InsetGroup>
          )}

          <SectionHeader>{t('a.space_payment_qr')}</SectionHeader>
          {asset ? (
            <>
              <QrBox
                src={assetDataUrl(asset)}
                className="mx-auto w-full max-w-[360px]"
                onClick={() => {
                  void markUsed(e.id);
                  setQrOpen(true);
                }}
              />
              {!intact && <Footnote className="px-4 !text-danger">{t('a.space_qr_damaged')}</Footnote>}
              <Footnote className="text-center">{t('a.space_qr_tap_hint')}</Footnote>
            </>
          ) : (
            <InsetGroup>
              <ListRow
                title={importing ? t('a.space_importing') : t('a.space_add_qr')}
                subtitle={t('a.space_add_qr_hint')}
                leading={<IconTile icon={<ImagePlus className="size-full" />} size={34} />}
                onClick={() => !importing && fileInput.current?.click()}
              />
            </InsetGroup>
          )}
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
                await saveSpaceWithImage(e, await importImage(f), false);
              } catch (err) {
                toast(importError(err), { kind: 'error' });
              } finally {
                setImporting(false);
              }
            }}
          />

          {e.notes && (
            <>
              <SectionHeader>{t('a.field_notes')}</SectionHeader>
              <InsetGroup>
                <p className="whitespace-pre-wrap p-4 text-[17px] leading-[23px] text-fg select-text">{e.notes}</p>
              </InsetGroup>
            </>
          )}

          <div className="mt-1 flex gap-2.5">
            <GlassButton className="flex-1" icon={<Share />} onClick={() => setShare(hasNumber ? 'number' : 'qr')}>
              {t('a.space_share')}
            </GlassButton>
            {hasNumber && (
              <GlassButton className="flex-1" prominent={false} icon={<Copy />} onClick={() => void copyAccountNumber(e, t('a.space_account_number'))}>
                {t('a.space_copy')}
              </GlassButton>
            )}
          </div>
          <Footnote className="px-2">{t('a.space_share_note')}</Footnote>
        </Stack>
      </Column>
      <SpaceShareSheet e={share ? e : null} initialMode={share ?? 'number'} onClose={() => setShare(null)} />
      <QrFullScreen e={qrOpen ? e : null} onClose={() => setQrOpen(false)} />
    </PushedScreen>
  );
}
