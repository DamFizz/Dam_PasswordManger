/**
 * My Space tab (Android SpaceScreens.SpaceTab): your bank accounts and payment QR codes, and
 * other people's (Mine / Others), with Copy / QR / Share one tap away. Long-press a card for
 * the everyday actions. MyVault never connects to a bank and never makes a QR from a number.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { Copy, Landmark, Pencil, QrCode, Share, Star, StickyNote, UserPlus, Users, Wallet } from 'lucide-react';
import { useT } from '../../i18n';
import { markUsed, navigate, useApp } from '../../state/app';
import { bankBadge, isMine, maskedNumber, personInitials, searchSpace, sortPeople, sortSpace, spaceDisplayName, assetDataUrl } from '../../lib/space';
import { createStore, useStore } from '../../state/store';
import type { SpaceEntry } from '../../vault/types';
import { Modal } from '../components/Modal';
import { copyWithFeedback } from '../components/Secret';
import { cx } from '../cx';
import { Body, Chip, Column, FlowingSelector, Footnote, GlassButton, GroupDivider, Headline, IconTile, InsetGroup, LargeTitle, ListRow, SectionHeader, Stack } from './kit';
import { useSpaceSearch } from './Shell';
import { SpaceShareSheet, type ShareMode } from './SpaceShare';

/** Which list is shown: your own (0) or other people's (1). Kept while the app is open. */
export const spaceSegment = createStore<{ seg: 0 | 1 }>({ seg: 0 });

const PALETTE = ['#2563eb', '#0d9488', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#475569', '#ca8a04'];

export function spaceColor(e: SpaceEntry): string {
  if (e.color && /^#[0-9a-f]{6}$/i.test(e.color)) return e.color;
  let h = 0;
  for (const ch of e.id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

/** Round badge: your own entries show the bank's short letters (never a logo); someone else's show their initials on a ring. */
export function BankBadge({ e, size }: { e: SpaceEntry; size: number }) {
  const color = spaceColor(e);
  if (!isMine(e)) {
    return (
      <span
        aria-hidden
        className="flex shrink-0 items-center justify-center rounded-full font-bold text-fg"
        style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 22%, transparent)`, border: `2px solid ${color}`, fontSize: size * 0.34 }}
      >
        {personInitials(e)}
      </span>
    );
  }
  const text = bankBadge(e).slice(0, 4);
  return (
    <span aria-hidden className="flex shrink-0 items-center justify-center rounded-full font-bold text-white" style={{ width: size, height: size, background: color, fontSize: size * (text.length > 3 ? 0.26 : 0.32) }}>
      {e.type === 'qr' ? <QrCode style={{ width: size * 0.52, height: size * 0.52 }} /> : text}
    </span>
  );
}

export async function copyAccountNumber(e: SpaceEntry, label: string): Promise<void> {
  if (!e.accountNumber) return;
  if (await copyWithFeedback(e.accountNumber, { secret: true, label })) void markUsed(e.id);
}

export function SpaceTab() {
  const t = useT();
  const everything = useApp((s) => s.space);
  const usage = useApp((s) => s.usage);
  const seg = useStore(spaceSegment, (s) => s.seg);
  const query = useSpaceSearch();
  const [actionsFor, setActionsFor] = useState<string | null>(null);
  const [shareFor, setShareFor] = useState<{ id: string; mode: ShareMode } | null>(null);
  const [qrFor, setQrFor] = useState<string | null>(null);

  const mineCount = everything.filter(isMine).length;
  const othersCount = everything.length - mineCount;
  const others = seg === 1;
  const all = everything.filter((e) => isMine(e) !== others);
  const shown = useMemo(() => searchSpace(everything, query), [everything, query]);
  const recent = useMemo(
    () =>
      all
        .filter((e) => usage[e.id])
        .sort((a, b) => (usage[b.id] ?? 0) - (usage[a.id] ?? 0))
        .slice(0, 4),
    [all, usage],
  );
  const byId = (id: string | null) => (id ? everything.find((e) => e.id === id) ?? null : null);
  const card = (e: SpaceEntry) => (
    <BankCard
      key={e.id}
      e={e}
      onQr={() => {
        void markUsed(e.id);
        setQrFor(e.id);
      }}
      onShare={() => setShareFor({ id: e.id, mode: e.type === 'qr' ? 'qr' : 'number' })}
      onActions={() => setActionsFor(e.id)}
    />
  );

  const favs = sortSpace(all.filter((e) => e.favorite));
  const banks = others ? sortPeople(all.filter((e) => !e.favorite)) : sortSpace(all.filter((e) => !e.favorite && e.type === 'bank'));
  const qrs = others ? [] : sortSpace(all.filter((e) => !e.favorite && e.type === 'qr'));

  return (
    <Column>
      <Stack gap={12}>
        <div className="pb-1 pl-1.5">
          <LargeTitle>{t('a.space_title')}</LargeTitle>
          <Footnote className="!text-muted">{t('a.space_tagline')}</Footnote>
        </div>
        {everything.length > 0 && !query.trim() && (
          <FlowingSelector
            label={t('a.space_title')}
            value={others ? 'others' : 'mine'}
            onChange={(v) => spaceSegment.set({ seg: v === 'others' ? 1 : 0 })}
            options={[
              { value: 'mine', label: t('a.space_seg_mine', { 1: mineCount }) },
              { value: 'others', label: t('a.space_seg_others', { 1: othersCount }) },
            ]}
            className="lg-seg-accent"
          />
        )}
        {everything.length === 0 ? (
          <Empty others={false} />
        ) : query.trim() ? (
          <>
            {shown.length === 0 && <Body className="p-4">{t('a.space_no_results')}</Body>}
            {shown.map(card)}
          </>
        ) : (
          <>
            {recent.length > 0 && all.length > 2 && (
              <>
                <SectionHeader>{t('a.space_recent')}</SectionHeader>
                <div className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1">
                  {recent.map((e) => (
                    <Chip
                      key={`r-${e.id}`}
                      icon={e.type === 'qr' ? <QrCode /> : <Landmark />}
                      onClick={() => {
                        void markUsed(e.id);
                        navigate({ name: 'spaceItem', id: e.id });
                      }}
                    >
                      {spaceDisplayName(e)}
                    </Chip>
                  ))}
                </div>
              </>
            )}
            {all.length === 0 && <Empty others={others} />}
            {favs.length > 0 && (
              <>
                <SectionHeader>{t('a.space_favourites')}</SectionHeader>
                {favs.map(card)}
              </>
            )}
            {banks.length > 0 && (
              <>
                <SectionHeader>{others ? t('a.space_people') : t('a.space_bank_accounts')}</SectionHeader>
                {banks.map(card)}
              </>
            )}
            {qrs.length > 0 && (
              <>
                <SectionHeader>{t('a.space_payment_qrs')}</SectionHeader>
                {qrs.map(card)}
              </>
            )}
          </>
        )}
      </Stack>

      <ActionsSheet
        e={byId(actionsFor)}
        onClose={() => setActionsFor(null)}
        onShare={(id, mode) => {
          setActionsFor(null);
          setShareFor({ id, mode });
        }}
      />
      <SpaceShareSheet e={byId(shareFor?.id ?? null)} initialMode={shareFor?.mode ?? 'number'} onClose={() => setShareFor(null)} />
      <QrFullScreen e={byId(qrFor)} onClose={() => setQrFor(null)} />
    </Column>
  );
}

function Empty({ others }: { others: boolean }) {
  const t = useT();
  return (
    <InsetGroup>
      <div className="flex flex-col gap-3 p-5">
        <IconTile icon={others ? <Users className="size-full" /> : <Wallet className="size-full" />} size={46} />
        <Headline>{others ? t('a.space_others_empty_title') : t('a.space_empty_title')}</Headline>
        <Body>{others ? t('a.space_others_empty_body') : t('a.space_empty_body')}</Body>
        {others ? (
          <>
            <GlassButton block icon={<UserPlus />} onClick={() => navigate({ name: 'spaceEdit', type: 'bank', owner: 'other' })}>
              {t('a.space_add_other_bank')}
            </GlassButton>
            <GlassButton block prominent={false} icon={<QrCode />} onClick={() => navigate({ name: 'spaceEdit', type: 'qr', owner: 'other' })}>
              {t('a.space_add_other_qr')}
            </GlassButton>
          </>
        ) : (
          <>
            <GlassButton block icon={<Landmark />} onClick={() => navigate({ name: 'spaceEdit', type: 'bank', owner: 'me' })}>
              {t('a.space_add_bank')}
            </GlassButton>
            <GlassButton block prominent={false} icon={<QrCode />} onClick={() => navigate({ name: 'spaceEdit', type: 'qr', owner: 'me' })}>
              {t('a.space_add_qr_entry')}
            </GlassButton>
          </>
        )}
      </div>
    </InsetGroup>
  );
}

/** "+" on the My Space tab: what to add, yours or someone else's. */
export function SpaceAddSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const seg = useStore(spaceSegment, (s) => s.seg);
  const go = (type: 'bank' | 'qr', owner: 'me' | 'other') => {
    onClose();
    spaceSegment.set({ seg: owner === 'other' ? 1 : 0 });
    navigate({ name: 'spaceEdit', type, owner });
  };
  const mine = (
    <div key="mine" className="flex flex-col gap-1.5">
      <SectionHeader>{t('a.space_owner_mine')}</SectionHeader>
      <InsetGroup>
        <ListRow title={t('a.space_add_bank')} subtitle={t('a.space_add_bank_sub')} leading={<IconTile icon={<Landmark className="size-full" />} />} onClick={() => go('bank', 'me')} />
        <GroupDivider inset={68} />
        <ListRow title={t('a.space_add_qr_entry')} subtitle={t('a.space_add_qr_sub')} leading={<IconTile icon={<QrCode className="size-full" />} />} onClick={() => go('qr', 'me')} />
      </InsetGroup>
    </div>
  );
  const theirs = (
    <div key="theirs" className="flex flex-col gap-1.5">
      <SectionHeader>{t('a.space_owner_other')}</SectionHeader>
      <InsetGroup>
        <ListRow title={t('a.space_add_other_bank')} subtitle={t('a.space_add_other_bank_sub')} leading={<IconTile icon={<UserPlus className="size-full" />} />} onClick={() => go('bank', 'other')} />
        <GroupDivider inset={68} />
        <ListRow title={t('a.space_add_other_qr')} subtitle={t('a.space_add_other_qr_sub')} leading={<IconTile icon={<QrCode className="size-full" />} />} onClick={() => go('qr', 'other')} />
      </InsetGroup>
    </div>
  );
  return (
    <Modal open={open} onClose={onClose} title={t('a.space_add_title')} size="sm">
      <div className="flex flex-col gap-3 pb-1">{seg === 1 ? [theirs, mine] : [mine, theirs]}</div>
    </Modal>
  );
}

/** Account card: content, not glass (solid fill with a colour wash). Shows only the last 4 digits. */
function BankCard({ e, onQr, onShare, onActions }: { e: SpaceEntry; onQr: () => void; onShare: () => void; onActions: () => void }) {
  const t = useT();
  const color = spaceColor(e);
  const hasQr = !!e.qrAssetId;
  const name = spaceDisplayName(e);
  const sub = [e.bankName && e.bankName !== name ? e.bankName : null, e.holder && e.holder !== name ? e.holder : null].filter(Boolean).join(' · ');
  const timer = useMemo(() => ({ id: 0, fired: false }), []);
  const open = () => {
    void markUsed(e.id);
    navigate({ name: 'spaceItem', id: e.id });
  };
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={name}
      onClick={(ev) => {
        if ((ev.target as HTMLElement).closest('button')) return;
        if (timer.fired) {
          timer.fired = false;
          return;
        }
        open();
      }}
      onKeyDown={(ev) => {
        if (ev.key === 'Enter' && ev.target === ev.currentTarget) open();
      }}
      onPointerDown={(ev) => {
        if (ev.button !== 0 || (ev.target as HTMLElement).closest('button')) return;
        timer.fired = false;
        window.clearTimeout(timer.id);
        timer.id = window.setTimeout(() => {
          timer.fired = true;
          onActions();
        }, 480);
      }}
      onPointerUp={() => window.clearTimeout(timer.id)}
      onPointerLeave={() => window.clearTimeout(timer.id)}
      onContextMenu={(ev) => {
        ev.preventDefault();
        onActions();
      }}
      className="lg-card flex w-full cursor-pointer flex-col gap-3 rounded-[26px] bg-surface p-4"
      style={{ backgroundImage: `linear-gradient(90deg, color-mix(in srgb, ${color} var(--card-wash, 22%), transparent), transparent)` }}
    >
      <div className="flex items-center">
        <BankBadge e={e} size={44} />
        <div className="ml-3 min-w-0 flex-1">
          <p className="truncate text-[17px] font-semibold leading-[22px] text-fg">{name}</p>
          {sub && <p className="truncate text-[13px] leading-[18px] text-muted">{sub}</p>}
        </div>
        {e.favorite && <Star className="size-[18px] fill-[var(--star)] text-[var(--star)]" aria-label={t('a.space_favourite')} />}
        {hasQr && <QrCode className="ml-1.5 size-5 text-muted" aria-label={t('a.space_has_qr')} />}
      </div>
      {e.accountNumber && <p className="font-mono text-[22px] font-bold leading-[30px] text-fg">{maskedNumber(e.accountNumber)}</p>}
      <div className="flex flex-wrap gap-2">
        {e.accountNumber && (
          <Chip icon={<Copy />} onClick={() => void copyAccountNumber(e, t('a.space_account_number'))}>
            {t('a.space_copy')}
          </Chip>
        )}
        {hasQr && (
          <Chip icon={<QrCode />} onClick={onQr}>
            {t('a.space_view_qr')}
          </Chip>
        )}
        <Chip icon={<Share />} onClick={onShare}>
          {t('a.space_share')}
        </Chip>
      </div>
    </div>
  );
}

/** Long-press menu: the everyday actions without opening the entry. */
function ActionsSheet({ e, onClose, onShare }: { e: SpaceEntry | null; onClose: () => void; onShare: (id: string, mode: ShareMode) => void }) {
  const t = useT();
  const rows: ReactNode[] = [];
  if (e) {
    const hasNumber = !!e.accountNumber;
    const hasQr = !!e.qrAssetId;
    const row = (key: string, label: string, icon: ReactNode, run: () => void) => (
      <div key={key}>
        {rows.length > 0 && <GroupDivider inset={64} />}
        <ListRow title={label} leading={<IconTile icon={<span className="flex size-full [&>svg]:size-full">{icon}</span>} size={34} />} onClick={run} />
      </div>
    );
    if (hasNumber) {
      rows.push(row('copy', t('a.space_copy_number'), <Copy />, () => (void copyAccountNumber(e, t('a.space_account_number')), onClose())));
      rows.push(row('sn', t('a.space_share_number'), <StickyNote />, () => onShare(e.id, 'number')));
    }
    if (hasQr) rows.push(row('sq', t('a.space_share_qr'), <QrCode />, () => onShare(e.id, 'qr')));
    if (hasNumber && hasQr) rows.push(row('sb', t('a.space_share_both'), <Share />, () => onShare(e.id, 'both')));
    rows.push(
      row('edit', t('a.action_edit'), <Pencil />, () => {
        onClose();
        navigate({ name: 'spaceEdit', id: e.id, type: e.type, owner: isMine(e) ? 'me' : 'other' });
      }),
    );
  }
  return (
    <Modal open={!!e} onClose={onClose} size="sm" title={<span className="sr-only">{e ? spaceDisplayName(e) : ''}</span>}>
      {e && (
        <div className="flex flex-col gap-3 pb-1">
          <div className="flex items-center gap-3">
            <BankBadge e={e} size={40} />
            <Headline className="truncate">{spaceDisplayName(e)}</Headline>
          </div>
          <InsetGroup>{rows}</InsetGroup>
        </div>
      )}
    </Modal>
  );
}

/** Large, readable QR on white (never under glass or tint). Tap anywhere to close. */
export function QrFullScreen({ e, onClose }: { e: SpaceEntry | null; onClose: () => void }) {
  const t = useT();
  const asset = useApp((s) => (e?.qrAssetId ? s.session?.asset(e.qrAssetId) : undefined));
  return (
    <Modal open={!!e && !!asset} onClose={onClose} bare className="lg-qr-full !bg-transparent !shadow-none" sheet={false}>
      {e && asset && (
        <button type="button" onClick={onClose} className="flex h-full w-full cursor-pointer flex-col items-center justify-center gap-3.5 p-5" aria-label={t('a.space_qr_close_hint')}>
          <span className="text-center text-[24px] font-bold text-white">{spaceDisplayName(e)}</span>
          <QrBox src={assetDataUrl(asset)} className="w-full max-w-[420px]" />
          <span className="text-[13px] text-white/70">{t('a.space_qr_close_hint')}</span>
        </button>
      )}
    </Modal>
  );
}

/** The QR itself: always on white, sharp when scaled up. */
export function QrBox({ src, className, onClick }: { src: string; className?: string; onClick?: () => void }) {
  const t = useT();
  const img = <img src={src} alt={t('a.space_qr')} className="block h-auto w-full [image-rendering:pixelated]" draggable={false} />;
  return onClick ? (
    <button type="button" onClick={onClick} className={cx('block rounded-[22px] bg-white p-3.5 cursor-zoom-in', className)}>
      {img}
    </button>
  ) : (
    <span className={cx('block rounded-[22px] bg-white p-3.5', className)}>{img}</span>
  );
}
