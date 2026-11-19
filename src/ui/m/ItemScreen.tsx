/**
 * Item screen (Android DetailScreen): icon + title, grouped field rows with reveal / open / copy,
 * notes, password history, dates. Top bar: back, favourite, edit, more (duplicate, archive, trash).
 * Protected items stay locked until the master password is entered.
 */
import { useEffect, useMemo, useState } from 'react';
import { Archive, ArchiveRestore, Copy, CopyPlus, Ellipsis, ExternalLink, Eye, EyeOff, Lock, Pencil, RotateCcw, Star, Trash2 } from 'lucide-react';
import { formatDate, useT } from '../../i18n';
import { estimateStrength } from '../../lib/strength';
import { archiveItems, back, duplicateItem, markUsed, openEditor, purgeItems, restoreItems, toggleFavorite, trashItems, useApp } from '../../state/app';
import { usePrefs } from '../../state/prefs-store';
import { confirmDialog } from '../../state/ui';
import type { VaultItem } from '../../vault/types';
import { Modal } from '../components/Modal';
import { copyWithFeedback } from '../components/Secret';
import { cx } from '../cx';
import { ITEM_TYPE_ICONS } from '../icons';
import { safeHttpUrl } from '../items/helpers';
import { ensureItemAccess, isItemUnlocked } from '../items/reprompt';
import { Column, Footnote, GlassButton, GlassIconButton, GroupDivider, IconTile, InsetGroup, ListRow, RowIconButton, SectionHeader, Stack } from './kit';
import { PushedScreen } from './Shell';
import { typeLabelKey } from './VaultTab';

interface FieldSpec {
  label: string;
  value: string;
  secret?: boolean;
  mono?: boolean;
  multiline?: boolean;
  url?: string | null;
}

export function ItemScreen({ id }: { id: string }) {
  const item = useApp((s) => s.items.find((i) => i.id === id));
  useEffect(() => {
    if (!item) back();
  }, [item]);
  if (!item) return null;
  return <ItemBody item={item} />;
}

function ItemBody({ item }: { item: VaultItem }) {
  const t = useT();
  const { revealSeconds } = usePrefs();
  const [more, setMore] = useState(false);
  const [tick, setTick] = useState(0);
  const locked = item.reprompt && !isItemUnlocked(item.id) && tick >= 0;
  const trashed = !!item.trashedAt;
  const Icon = ITEM_TYPE_ICONS[item.type];

  const fields = useMemo(() => {
    const out: FieldSpec[] = [];
    const add = (labelKey: string, value: string | undefined, o: Partial<FieldSpec> = {}) => {
      if (value?.trim()) out.push({ label: t(labelKey as never), value, ...o });
    };
    add('a.field_username', item.username);
    add('a.field_email', item.email);
    add('a.field_password', item.password, { secret: true });
    add('a.field_url', item.url, { url: safeHttpUrl(item.url) });
    add('a.field_ssid', item.ssid);
    add('a.field_wifi_security', item.wifiSecurity);
    add('a.field_product', item.product);
    add('a.field_license_key', item.licenseKey, { secret: true });
    add('a.field_licensee', item.licensee);
    add('a.field_version', item.version);
    add('a.field_purchase_date', item.purchaseDate);
    add('a.field_service', item.service);
    add('a.field_codes', item.codes, { secret: true, mono: true, multiline: true });
    add('a.field_recovery_email', item.recoveryEmail);
    add('a.field_recovery_info', item.recoveryInfo, { secret: true });
    for (const f of item.customFields) if (f.value.trim()) out.push({ label: f.label.trim() || t('a.field_custom_value'), value: f.value, secret: f.hidden });
    return out;
  }, [item, t]);
  const notes: FieldSpec[] = [];
  if (item.notes?.trim()) notes.push({ label: t('a.field_notes'), value: item.notes, multiline: true });
  if (item.importantNotes?.trim()) notes.push({ label: t('a.field_important_notes'), value: item.importantNotes, multiline: true });
  if (item.tags.length) notes.push({ label: t('a.field_tags'), value: item.tags.join(', ') });
  const history = item.passwordHistory ?? [];
  const weak = !locked && item.type === 'login' && !!item.password && estimateStrength(item.password).score < 3;

  const unlock = async () => {
    if (await ensureItemAccess(item)) setTick((n) => n + 1);
  };
  const onCopy = async (f: FieldSpec) => {
    if (f.secret && !(await ensureItemAccess(item))) return;
    if (await copyWithFeedback(f.value, { secret: !!f.secret, label: f.label })) void markUsed(item.id);
  };

  return (
    <PushedScreen
      title={item.title}
      actions={
        <>
          {!trashed && (
            <>
              <GlassIconButton label={item.favorite ? t('a.action_unfavorite') : t('a.action_favorite')} onClick={() => void toggleFavorite([item.id])} aria-pressed={item.favorite}>
                <Star className={cx(item.favorite && 'fill-[var(--star)] text-[var(--star)]')} />
              </GlassIconButton>
              <GlassIconButton
                label={t('a.action_edit')}
                onClick={async () => {
                  if (locked && !(await ensureItemAccess(item))) return;
                  openEditor({ mode: 'edit', itemId: item.id });
                }}
              >
                <Pencil />
              </GlassIconButton>
            </>
          )}
          <GlassIconButton label={t('a.action_more')} onClick={() => setMore(true)}>
            <Ellipsis />
          </GlassIconButton>
        </>
      }
    >
      <Column>
        <Stack>
          <div className="flex items-center gap-4 px-1.5 py-1.5">
            <IconTile icon={Icon ? <Icon className="size-full" /> : null} size={58} />
            <div className="min-w-0">
              <h1 className="text-[24px] font-bold leading-[30px] tracking-[-0.2px] text-fg [overflow-wrap:anywhere]">{item.title || t('a.untitled')}</h1>
              <p className={cx('text-[13px]', trashed ? 'text-danger' : 'text-muted')}>
                {trashed ? t('a.item_in_trash') : item.archivedAt ? t('a.item_archived') : t(typeLabelKey(item.type) as never)}
              </p>
            </div>
          </div>

          {locked && (
            <>
              <InsetGroup>
                <ListRow title={t('a.detail_reprompt_title')} subtitle={t('a.detail_reprompt_body')} leading={<IconTile icon={<Lock className="size-full" />} />} />
              </InsetGroup>
              <GlassButton block icon={<Lock />} onClick={unlock}>
                {t('a.detail_unlock')}
              </GlassButton>
            </>
          )}
          {weak && <Footnote className="px-4 !text-[var(--star)]">{t('a.dash_weak')}</Footnote>}

          {fields.length > 0 && (
            <InsetGroup>
              {fields.map((f, i) => (
                <div key={f.label + i}>
                  {i > 0 && <GroupDivider />}
                  <FieldRow f={f} locked={locked && !!f.secret} revealSeconds={revealSeconds} onCopy={() => void onCopy(f)} onOpen={() => void markUsed(item.id)} itemId={item.id} />
                </div>
              ))}
            </InsetGroup>
          )}
          {notes.length > 0 && (
            <InsetGroup>
              {notes.map((f, i) => (
                <div key={f.label}>
                  {i > 0 && <GroupDivider />}
                  <FieldRow f={f} locked={false} revealSeconds={revealSeconds} onCopy={() => void onCopy(f)} onOpen={() => undefined} itemId={item.id} />
                </div>
              ))}
            </InsetGroup>
          )}
          {history.length > 0 && !locked && (
            <>
              <SectionHeader>{`${t('a.detail_history')} (${history.length})`}</SectionHeader>
              <InsetGroup>
                {history.map((h, i) => {
                  const f = { label: t('a.detail_replaced', { 1: formatDate(h.changedAt, true) }), value: h.password, secret: true };
                  return (
                    <div key={h.changedAt + i}>
                      {i > 0 && <GroupDivider />}
                      <FieldRow f={f} locked={false} revealSeconds={revealSeconds} onCopy={() => void onCopy(f)} onOpen={() => undefined} itemId={item.id} />
                    </div>
                  );
                })}
              </InsetGroup>
            </>
          )}
          <div className="px-4">
            <Footnote>{`${t('a.meta_created')}: ${formatDate(item.createdAt, true)}`}</Footnote>
            <Footnote>{`${t('a.meta_modified')}: ${formatDate(item.updatedAt, true)}`}</Footnote>
            {item.passwordChangedAt && <Footnote>{`${t('a.meta_password_changed')}: ${formatDate(item.passwordChangedAt, true)}`}</Footnote>}
          </div>
        </Stack>
      </Column>

      <Modal open={more} onClose={() => setMore(false)} size="sm" title={<span className="sr-only">{t('a.action_more')}</span>}>
        <InsetGroup className="mb-1">
          {trashed ? (
            <>
              <Action icon={<RotateCcw />} label={t('a.action_restore')} run={() => void restoreItems([item.id])} close={() => setMore(false)} />
              <GroupDivider inset={62} />
              <Action
                icon={<Trash2 />}
                label={t('a.action_delete_forever')}
                danger
                close={() => setMore(false)}
                run={async () => {
                  const ok = await confirmDialog({ title: t('a.purge_title'), message: t('a.purge_message'), confirmLabel: t('a.action_delete_forever'), danger: true });
                  if (ok) await purgeItems([item.id]);
                }}
              />
            </>
          ) : (
            <>
              <Action icon={<CopyPlus />} label={t('a.action_duplicate')} run={() => void duplicateItem(item.id)} close={() => setMore(false)} />
              <GroupDivider inset={62} />
              {item.archivedAt ? (
                <Action icon={<ArchiveRestore />} label={t('a.action_unarchive')} run={() => void archiveItems([item.id], false)} close={() => setMore(false)} />
              ) : (
                <Action icon={<Archive />} label={t('a.action_archive')} run={() => void archiveItems([item.id], true)} close={() => setMore(false)} />
              )}
              <GroupDivider inset={62} />
              <Action icon={<Trash2 />} label={t('a.action_trash')} danger run={() => void trashItems([item.id])} close={() => setMore(false)} />
            </>
          )}
        </InsetGroup>
      </Modal>
    </PushedScreen>
  );
}

function Action({ icon, label, danger, run, close }: { icon: React.ReactNode; label: string; danger?: boolean; run: () => void | Promise<void>; close: () => void }) {
  return (
    <ListRow
      title={label}
      titleClassName={danger ? '!text-danger' : undefined}
      leading={<IconTile icon={<span className="flex size-full [&>svg]:size-full">{icon}</span>} size={32} color={danger ? 'var(--danger)' : undefined} />}
      onClick={() => {
        close();
        void run();
      }}
    />
  );
}

function FieldRow({ f, locked, revealSeconds, onCopy, onOpen, itemId }: { f: FieldSpec; locked: boolean; revealSeconds: number; onCopy: () => void; onOpen: () => void; itemId: string }) {
  const t = useT();
  const [shown, setShown] = useState(false);
  // revealed secrets hide themselves again; also when the item changes
  useEffect(() => {
    if (!shown || revealSeconds <= 0) return;
    const id = window.setTimeout(() => setShown(false), revealSeconds * 1000);
    return () => window.clearTimeout(id);
  }, [shown, revealSeconds]);
  useEffect(() => setShown(false), [itemId]);
  const masked = f.secret && (locked || !shown);
  return (
    <div className="flex items-center py-2.5 pl-4 pr-1.5">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-[18px] text-faint">{f.label}</p>
        <p
          className={cx(
            'text-[17px] leading-[23px] text-fg select-text [overflow-wrap:anywhere]',
            (f.secret || f.mono) && 'font-mono',
            f.multiline && !masked ? 'whitespace-pre-wrap' : 'line-clamp-2',
          )}
        >
          {masked ? '••••••••••' : f.value}
        </p>
      </div>
      {!locked ? (
        <>
          {f.secret && (
            <RowIconButton label={`${shown ? t('a.detail_hide') : t('a.detail_reveal')} ${f.label}`} onClick={() => setShown((v) => !v)}>
              {shown ? <EyeOff /> : <Eye />}
            </RowIconButton>
          )}
          {f.url && (
            <a
              href={f.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onOpen}
              aria-label={t('a.action_open_website')}
              title={t('a.action_open_website')}
              className="flex size-10 items-center justify-center rounded-full text-accent hover:bg-surface-2 [&_svg]:size-[21px]"
            >
              <ExternalLink />
            </a>
          )}
          <RowIconButton label={`${t('a.detail_copy')} ${f.label}`} onClick={onCopy}>
            <Copy />
          </RowIconButton>
        </>
      ) : (
        <Lock className="mr-3 size-[18px] text-faint" aria-hidden />
      )}
    </div>
  );
}
