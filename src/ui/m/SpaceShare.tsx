/**
 * Share sheet (Android SpaceShareSheet): Number, QR, or Both (image + text, or one payment-card
 * image). Shows exactly what will be sent, then opens the system share sheet where available
 * (Web Share); otherwise the text is copied and/or the image downloaded.
 */
import { useEffect, useState } from 'react';
import { LoaderCircle, Share } from 'lucide-react';
import { useT } from '../../i18n';
import { assetDataUrl, assetIntact, base64ToBytesStd, shareText, spaceDisplayName } from '../../lib/space';
import { extFor, paymentCard, shareContent } from '../../lib/space-media';
import { markUsed, useApp } from '../../state/app';
import { toast } from '../../state/ui';
import type { SpaceEntry } from '../../vault/types';
import { Modal } from '../components/Modal';
import { FlowingSelector, Footnote, GlassButton, GroupDivider, Headline, InsetGroup, ToggleRow } from './kit';
import { copyAccountNumber, QrBox, spaceColor } from './SpaceTab';

export type ShareMode = 'number' | 'qr' | 'both';

export function SpaceShareSheet({ e, initialMode, onClose }: { e: SpaceEntry | null; initialMode: ShareMode; onClose: () => void }) {
  return (
    <Modal open={!!e} onClose={onClose} size="sm" title={<span className="sr-only">Share</span>}>
      {e && <Body key={`${e.id}-${initialMode}`} e={e} initialMode={initialMode} />}
    </Modal>
  );
}

function Body({ e, initialMode }: { e: SpaceEntry; initialMode: ShareMode }) {
  const t = useT();
  const asset = useApp((s) => (e.qrAssetId ? s.session?.asset(e.qrAssetId) : undefined));
  const hasNumber = !!e.accountNumber;
  const hasQr = !!asset;
  const [mode, setMode] = useState<ShareMode>(
    initialMode === 'both' && hasNumber && hasQr ? 'both' : initialMode === 'qr' && hasQr ? 'qr' : hasNumber ? 'number' : 'qr',
  );
  const [includeBank, setIncludeBank] = useState(true);
  const [includeHolder, setIncludeHolder] = useState(true);
  const [asCard, setAsCard] = useState(false);
  const [working, setWorking] = useState(false);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const labels = { bank: t('a.space_bank'), holder: t('a.space_holder'), number: t('a.space_account_number') };
  const text = shareText(e, { includeBank, includeHolder }, labels);
  const title = t('a.space_share_title', { 1: spaceDisplayName(e) });
  const cardLabels = { holder: t('a.space_holder'), number: t('a.space_account_number'), footer: t('a.space_card_footer') };
  const qr = asset ? { bytes: base64ToBytesStd(asset.data), mime: asset.mime } : null;

  // The payment card is drawn only when that format is chosen.
  useEffect(() => {
    if (mode !== 'both' || !asCard) return;
    let url: string | null = null;
    let alive = true;
    void paymentCard(e, qr, spaceColor(e), cardLabels).then((blob) => {
      if (!alive) return;
      url = URL.createObjectURL(blob);
      setCardUrl(url);
    });
    return () => {
      alive = false;
      if (url) URL.revokeObjectURL(url);
      setCardUrl(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, asCard, e.id, asset?.id]);

  const report = (r: Awaited<ReturnType<typeof shareContent>>) => {
    if (r === 'copied') toast(t('clipboard.copied', { label: t('a.space_share') }));
    else if (r === 'downloaded') toast(t('a.space_share_note'));
  };
  const guardQr = async () => {
    if (!asset || !(await assetIntact(asset))) {
      toast(t('a.space_qr_damaged'), { kind: 'error' });
      return false;
    }
    return true;
  };
  const run = async (fn: () => Promise<void>) => {
    if (working) return;
    setWorking(true);
    try {
      await fn();
    } finally {
      setWorking(false);
    }
  };

  const toggles = (
    <InsetGroup>
      <ToggleRow title={t('a.space_include_bank')} checked={includeBank} onChange={setIncludeBank} />
      <GroupDivider />
      <ToggleRow title={t('a.space_include_holder')} checked={includeHolder} onChange={setIncludeHolder} />
    </InsetGroup>
  );

  return (
    <div className="flex flex-col gap-3 pb-1">
      <div>
        <Headline>{t('a.space_share')}</Headline>
        <p className="text-[13px] text-muted">{spaceDisplayName(e)}</p>
      </div>
      <FlowingSelector
        label={t('a.space_share')}
        value={mode}
        onChange={(m) => {
          if (m === 'number' && !hasNumber) toast(t('a.space_err_no_number'), { kind: 'error' });
          else if (m !== 'number' && !hasQr) toast(t('a.space_err_no_qr'), { kind: 'error' });
          else setMode(m);
        }}
        options={[
          { value: 'number', label: t('a.space_mode_number') },
          { value: 'qr', label: t('a.space_mode_qr') },
          { value: 'both', label: t('a.space_mode_both') },
        ]}
        className="lg-seg-accent"
      />

      {mode === 'number' && (
        <>
          {toggles}
          <PreviewText text={text} />
          <div className="flex gap-2.5">
            <GlassButton
              className="flex-1"
              icon={<Share />}
              onClick={() =>
                run(async () => {
                  void markUsed(e.id);
                  report(await shareContent({ title, text }));
                })
              }
            >
              {t('a.space_share')}
            </GlassButton>
            <GlassButton className="flex-1" prominent={false} onClick={() => void copyAccountNumber(e, labels.number)}>
              {t('a.space_copy')}
            </GlassButton>
          </div>
        </>
      )}

      {mode === 'qr' && asset && (
        <>
          <QrBox src={assetDataUrl(asset)} className="mx-auto w-full max-w-[280px]" />
          <GlassButton
            block
            icon={working ? <LoaderCircle className="animate-spin" /> : <Share />}
            onClick={() =>
              run(async () => {
                if (!(await guardQr())) return;
                void markUsed(e.id);
                report(await shareContent({ title, file: { blob: new Blob([qr!.bytes], { type: asset.mime }), name: `payment-qr.${extFor(asset.mime)}` } }));
              })
            }
          >
            {t('a.space_share_qr')}
          </GlassButton>
        </>
      )}

      {mode === 'both' && asset && (
        <>
          <FlowingSelector
            label={t('a.space_mode_both')}
            size="sm"
            value={asCard ? 'card' : 'image'}
            onChange={(v) => setAsCard(v === 'card')}
            options={[
              { value: 'image', label: t('a.space_both_image_text') },
              { value: 'card', label: t('a.space_both_card') },
            ]}
          />
          {!asCard ? (
            <>
              <QrBox src={assetDataUrl(asset)} className="mx-auto w-full max-w-[240px]" />
              {toggles}
              <PreviewText text={text} />
              <Footnote className="px-2">{t('a.space_both_hint')}</Footnote>
            </>
          ) : (
            <>
              <div className="mx-auto w-full max-w-[300px] overflow-hidden rounded-[18px] bg-white">
                {cardUrl ? <img src={cardUrl} alt={t('a.space_both_card')} className="block h-auto w-full" /> : <div className="flex aspect-[0.7] items-center justify-center"><LoaderCircle className="size-6 animate-spin text-accent" /></div>}
              </div>
              <Footnote className="px-2">{t('a.space_card_hint')}</Footnote>
            </>
          )}
          <GlassButton
            block
            icon={working ? <LoaderCircle className="animate-spin" /> : <Share />}
            onClick={() =>
              run(async () => {
                if (!(await guardQr())) return;
                void markUsed(e.id);
                if (asCard) {
                  const blob = await paymentCard(e, qr, spaceColor(e), cardLabels);
                  report(await shareContent({ title, file: { blob, name: 'payment-details.png' } }));
                } else {
                  report(await shareContent({ title, text, file: { blob: new Blob([qr!.bytes], { type: asset.mime }), name: `payment-qr.${extFor(asset.mime)}` } }));
                }
              })
            }
          >
            {t('a.space_share')}
          </GlassButton>
        </>
      )}
      <Footnote className="px-2">{t('a.space_share_note')}</Footnote>
    </div>
  );
}

function PreviewText({ text }: { text: string }) {
  const t = useT();
  return (
    <div className="rounded-[18px] bg-[var(--field)] p-3.5">
      <p className="text-[12px] font-medium text-faint">{t('a.space_preview')}</p>
      <pre className="mt-1.5 whitespace-pre-wrap font-mono text-[15px] leading-[21px] text-fg">{text}</pre>
    </div>
  );
}
