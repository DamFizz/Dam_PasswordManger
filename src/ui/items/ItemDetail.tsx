import { useState, type ReactNode } from 'react';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CopyPlus,
  Ellipsis,
  ExternalLink,
  FolderInput,
  History,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Star,
  Trash2,
} from 'lucide-react';
import { formatDate, formatRelative, useT } from '../../i18n';
import { estimateStrength } from '../../lib/strength';
import {
  archiveItems,
  duplicateItem,
  markUsed,
  openEditor,
  purgeItems,
  restoreItems,
  selectItem,
  toggleFavorite,
  trashItems,
  useApp,
} from '../../state/app';
import type { VaultItem } from '../../vault/types';
import { Button, IconButton } from '../components/Button';
import { Badge, CollectionChip, ItemAvatar, Menu, MenuItem } from '../components/Misc';
import { CopyButton, SecretValue } from '../components/Secret';
import { cx } from '../cx';
import { displayHost, safeHttpUrl, TYPE_LABEL_KEYS } from './helpers';
import { ensureItemAccess } from './reprompt';
import { MoveDialog } from './MoveDialog';
import { navigate } from '../../state/app';

function Row({ label, children, actions }: { label: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="group flex items-start gap-3 px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-faint">{label}</p>
        <div className="mt-0.5 min-w-0 text-[15px] text-fg">{children}</div>
      </div>
      {actions && <div className="flex shrink-0 items-center gap-0.5 self-center">{actions}</div>}
    </div>
  );
}

function PlainRow({ label, value, copyLabel }: { label: string; value?: string; copyLabel?: string }) {
  if (!value) return null;
  return (
    <Row label={label} actions={<CopyButton value={value} secret={false} label={copyLabel ?? label} />}>
      <span className="block truncate select-text">{value}</span>
    </Row>
  );
}

export function ItemDetail({ item, onBack }: { item: VaultItem; onBack?: () => void }) {
  const t = useT();
  const collections = useApp((s) => s.collections);
  const usage = useApp((s) => s.usage);
  const [moveOpen, setMoveOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const category = collections.find((c) => c.id === item.categoryId);
  const section = collections.find((c) => c.id === item.sectionId);
  const url = safeHttpUrl(item.url);
  const guard = () => ensureItemAccess(item);
  const used = () => void markUsed(item.id);
  const weak = item.password && item.type === 'login' ? estimateStrength(item.password).score < 3 : false;
  const inTrash = !!item.trashedAt;

  const secret = (label: string, value: string | undefined, multiline = false) =>
    value ? (
      <Row label={label}>
        <SecretValue value={value} label={label} beforeReveal={guard} onCopied={used} multiline={multiline} resetKey={item.id} />
      </Row>
    ) : null;

  return (
    <div className="animate-fade-in flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-3 py-2 sm:px-4">
        {onBack && (
          <IconButton label={t('action.back')} onClick={onBack} className="lg:hidden">
            <ArrowLeft className="size-5" />
          </IconButton>
        )}
        <div className="ml-auto flex items-center gap-1">
          {!inTrash && (
            <>
              <IconButton label={item.favorite ? t('action.unfavorite') : t('action.favorite')} onClick={() => void toggleFavorite([item.id])} className={item.favorite ? 'text-warning hover:text-warning' : ''} aria-pressed={item.favorite}>
                <Star className={cx('size-[18px]', item.favorite && 'fill-current')} />
              </IconButton>
              <Button size="sm" icon={<Pencil className="size-4" />} onClick={() => openEditor({ mode: 'edit', itemId: item.id })}>
                {t('action.edit')}
              </Button>
            </>
          )}
          <Menu
            trigger={(p) => (
              <IconButton label={t('action.more')} {...p}>
                <Ellipsis className="size-[18px]" />
              </IconButton>
            )}
          >
            {(close) =>
              inTrash ? (
                <>
                  <MenuItem icon={<RotateCcw />} onSelect={() => { close(); void restoreItems([item.id]); }}>
                    {t('action.restore')}
                  </MenuItem>
                  <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => { close(); void purgeItems([item.id]); }}>
                    {t('action.deleteForever')}
                  </MenuItem>
                </>
              ) : (
                <>
                  {url && (
                    <MenuItem icon={<ExternalLink />} onSelect={() => { close(); used(); window.open(url, '_blank', 'noopener,noreferrer'); }}>
                      {t('action.openWebsite')}
                    </MenuItem>
                  )}
                  <MenuItem icon={<CopyPlus />} onSelect={() => { close(); void duplicateItem(item.id); }}>
                    {t('action.duplicate')}
                  </MenuItem>
                  <MenuItem icon={<FolderInput />} onSelect={() => { close(); setMoveOpen(true); }}>
                    {t('action.move')}
                  </MenuItem>
                  {item.archivedAt ? (
                    <MenuItem icon={<ArchiveRestore />} onSelect={() => { close(); void archiveItems([item.id], false); }}>
                      {t('action.unarchive')}
                    </MenuItem>
                  ) : (
                    <MenuItem icon={<Archive />} onSelect={() => { close(); void archiveItems([item.id], true); }}>
                      {t('action.archive')}
                    </MenuItem>
                  )}
                  <MenuItem icon={<Trash2 />} tone="danger" onSelect={() => { close(); void trashItems([item.id]); }}>
                    {t('action.moveToTrash')}
                  </MenuItem>
                </>
              )
            }
          </Menu>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-10 pt-6 sm:px-6">
        <div className="flex items-start gap-4">
          <ItemAvatar item={item} category={category} size="lg" />
          <div className="min-w-0 flex-1">
            <h2 className="break-words text-xl font-semibold tracking-tight text-fg">{item.title}</h2>
            <p className="mt-0.5 text-sm text-muted">{t(TYPE_LABEL_KEYS[item.type])}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {category && <CollectionChip c={category} onClick={() => navigate({ name: 'items', filter: { kind: 'category', id: category.id } })} />}
              {section && <CollectionChip c={section} onClick={() => navigate({ name: 'items', filter: { kind: 'section', id: section.id } })} />}
              {item.tags.map((tag) => (
                <button key={tag} type="button" onClick={() => navigate({ name: 'items', filter: { kind: 'tag', tag } })} className="rounded-lg bg-surface-2 px-2 py-0.5 text-xs text-muted hover:text-fg cursor-pointer">
                  #{tag}
                </button>
              ))}
              {item.reprompt && <Badge tone="accent">{t('item.protected')}</Badge>}
              {item.archivedAt && <Badge>{t('item.archived')}</Badge>}
              {inTrash && <Badge tone="danger">{t('item.inTrash')}</Badge>}
            </div>
          </div>
        </div>

        {weak && (
          <div className="mt-5 flex items-center gap-3 rounded-2xl border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-fg">
            <ShieldAlert className="size-5 shrink-0 text-warning" />
            <span className="min-w-0 flex-1">{t('item.weakWarning')}</span>
          </div>
        )}

        <div className="mt-6 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
          {item.type === 'login' && (
            <>
              <PlainRow label={t('field.username')} value={item.username} />
              <PlainRow label={t('field.email')} value={item.email} />
              {secret(t('field.password'), item.password)}
              {item.url && (
                <Row
                  label={t('field.website')}
                  actions={
                    <>
                      <CopyButton value={item.url} secret={false} label={t('field.url')} />
                      {url && (
                        <IconButton label={t('action.openWebsite')} size="sm" onClick={() => { used(); window.open(url, '_blank', 'noopener,noreferrer'); }}>
                          <ExternalLink className="size-4" />
                        </IconButton>
                      )}
                    </>
                  }
                >
                  <span className="block truncate text-accent">{displayHost(item.url)}</span>
                </Row>
              )}
            </>
          )}
          {item.type === 'wifi' && (
            <>
              <PlainRow label={t('field.ssid')} value={item.ssid} />
              {secret(t('field.wifiPassword'), item.password)}
              <PlainRow label={t('field.wifiSecurity')} value={item.wifiSecurity} />
            </>
          )}
          {item.type === 'license' && (
            <>
              <PlainRow label={t('field.product')} value={item.product} />
              {secret(t('field.licenseKey'), item.licenseKey)}
              <PlainRow label={t('field.licensee')} value={item.licensee} />
              <PlainRow label={t('field.email')} value={item.email} />
              <PlainRow label={t('field.version')} value={item.version} />
              <PlainRow label={t('field.purchaseDate')} value={item.purchaseDate} />
              <PlainRow label={t('field.url')} value={item.url} />
            </>
          )}
          {item.type === 'recoveryCodes' && (
            <>
              <PlainRow label={t('field.service')} value={item.service} />
              {secret(t('field.codes'), item.codes, true)}
            </>
          )}
          {item.type === 'note' && secret(t('field.noteContent'), item.notes, true)}
          {item.customFields.map((f) =>
            f.hidden ? (
              <div key={f.id}>{secret(f.label || t('field.customField'), f.value)}</div>
            ) : (
              <PlainRow key={f.id} label={f.label || t('field.customField')} value={f.value} />
            ),
          )}
        </div>

        {item.type !== 'note' && item.notes && (
          <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <p className="text-xs font-medium text-faint">{t('field.notes')}</p>
            <p className="mt-1 whitespace-pre-wrap break-words text-[15px] text-fg select-text">{item.notes}</p>
          </div>
        )}

        {(item.recoveryEmail || item.recoveryInfo || item.importantNotes) && (
          <div className="mt-4 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
            <PlainRow label={t('field.recoveryEmail')} value={item.recoveryEmail} />
            {item.recoveryInfo && secret(t('field.recoveryInfo'), item.recoveryInfo, true)}
            {item.importantNotes && (
              <Row label={t('field.importantNotes')}>
                <p className="whitespace-pre-wrap break-words select-text">{item.importantNotes}</p>
              </Row>
            )}
          </div>
        )}

        {item.passwordHistory && item.passwordHistory.length > 0 && (
          <div className="mt-4 rounded-2xl border border-line bg-surface">
            <button type="button" onClick={() => setHistoryOpen((o) => !o)} aria-expanded={historyOpen} className="flex w-full items-center gap-2 px-4 py-3 text-sm font-medium text-fg cursor-pointer">
              <History className="size-4 text-muted" />
              {t('item.passwordHistory', { n: item.passwordHistory.length })}
            </button>
            {historyOpen && (
              <div className="divide-y divide-line border-t border-line">
                {item.passwordHistory.map((h, i) => (
                  <Row key={i} label={t('item.changedOn', { date: formatDate(h.changedAt, true) })}>
                    <SecretValue value={h.password} label={t('field.oldPassword')} beforeReveal={guard} resetKey={item.id} />
                  </Row>
                ))}
              </div>
            )}
          </div>
        )}

        <dl className="mt-6 grid grid-cols-2 gap-x-4 gap-y-3 px-1 text-xs">
          <div>
            <dt className="text-faint">{t('meta.created')}</dt>
            <dd className="mt-0.5 text-muted">{formatDate(item.createdAt, true)}</dd>
          </div>
          <div>
            <dt className="text-faint">{t('meta.modified')}</dt>
            <dd className="mt-0.5 text-muted">{formatDate(item.updatedAt, true)}</dd>
          </div>
          {item.passwordChangedAt && (
            <div>
              <dt className="text-faint">{t('meta.passwordChanged')}</dt>
              <dd className="mt-0.5 text-muted">{formatRelative(item.passwordChangedAt)}</dd>
            </div>
          )}
          <div>
            <dt className="text-faint">{t('meta.lastUsed')}</dt>
            <dd className="mt-0.5 text-muted">{usage[item.id] ? formatRelative(usage[item.id]) : t('time.never')}</dd>
          </div>
        </dl>
      </div>
      <MoveDialog open={moveOpen} onClose={() => setMoveOpen(false)} ids={[item.id]} />
    </div>
  );
}

export function closeDetail(): void {
  selectItem(null);
}
