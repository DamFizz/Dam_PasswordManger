import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { cx } from '../cx';
import { CollectionIcon, ITEM_TYPE_ICONS } from '../icons';
import type { Collection, VaultItem } from '../../vault/types';

const MONO_COLORS = ['#2dd4bf', '#60a5fa', '#a78bfa', '#f472b6', '#fb7185', '#fb923c', '#fbbf24', '#34d399', '#22d3ee', '#818cf8'];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * Item avatar: a monogram or type icon. Website favicons are deliberately NOT fetched —
 * that would tell a third party which sites are in your vault.
 */
export function ItemAvatar({ item, category, size = 'md' }: { item: VaultItem; category?: Collection; size?: 'sm' | 'md' | 'lg' }) {
  const color = category?.color ?? MONO_COLORS[hashString(item.title || item.id) % MONO_COLORS.length];
  const dims = size === 'sm' ? 'size-9 rounded-[9px] text-sm' : size === 'lg' ? 'size-16 rounded-[16px] text-2xl' : 'size-10 rounded-[10px] text-sm';
  const TypeIcon = ITEM_TYPE_ICONS[item.type];
  const letter = (item.title.trim()[0] ?? '?').toUpperCase();
  return (
    <div
      className={cx('relative flex shrink-0 items-center justify-center font-semibold', dims)}
      style={{ backgroundColor: `color-mix(in oklab, ${color} 18%, transparent)`, color }}
      aria-hidden
    >
      {item.type === 'login' ? letter : <TypeIcon className={size === 'lg' ? 'size-6' : 'size-[18px]'} />}
    </div>
  );
}

export function CollectionChip({ c, onClick }: { c: Collection; onClick?: () => void }) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx('inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted', onClick && 'hover:text-fg cursor-pointer')}
    >
      <CollectionIcon name={c.icon} className="size-3.5 shrink-0" color={c.color} />
      <span className="truncate">{c.name}</span>
    </Tag>
  );
}

export function Badge({ children, tone = 'default', className }: { children: ReactNode; tone?: 'default' | 'danger' | 'warning' | 'success' | 'accent'; className?: string }) {
  const tones = {
    default: 'bg-surface-3 text-muted',
    danger: 'bg-danger-soft text-danger',
    warning: 'bg-warning-soft text-warning',
    success: 'bg-success-soft text-success',
    accent: 'bg-accent-soft text-accent',
  };
  return <span className={cx('inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

/** Minimal accessible popover menu. */
export function Menu({ trigger, children, align = 'end', className }: { trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const closeTimer = useRef(0);
  const close = useCallback(() => {
    if (document.documentElement.dataset.motion === 'reduced') {
      setOpen(false);
      return;
    }
    setClosing(true);
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      setOpen(false);
      setClosing(false);
    }, 160);
  }, []);
  useEffect(() => () => window.clearTimeout(closeTimer.current), []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
        const idx = items.indexOf(document.activeElement as HTMLElement);
        const next = e.key === 'ArrowDown' ? items[(idx + 1) % items.length] : items[(idx - 1 + items.length) % items.length];
        next?.focus();
        e.preventDefault();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.setTimeout(() => ref.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus(), 0);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return (
    <div ref={ref} className={cx('relative', className)}>
      {trigger({ onClick: () => (open && !closing ? close() : (window.clearTimeout(closeTimer.current), setClosing(false), setOpen(true))), 'aria-expanded': open && !closing, 'aria-haspopup': 'menu' })}
      {open && (
        <div
          data-closing={closing ? '' : undefined}
          inert={closing}
          role="menu"
          className={cx('animate-menu glass-strong lg-menu absolute z-40 mt-2 min-w-52 overflow-hidden rounded-[22px] p-1.5', align === 'end' ? 'right-0 origin-top-right' : 'left-0 origin-top-left')}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

export function MenuItem({ icon, children, onSelect, tone, disabled }: { icon?: ReactNode; children: ReactNode; onSelect: () => void; tone?: 'danger'; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        'lg-row flex w-full items-center gap-2.5 rounded-[14px] px-3 py-2 text-left text-sm outline-none cursor-pointer disabled:opacity-40',
        tone === 'danger' ? 'text-danger hover:bg-danger-soft focus:bg-danger-soft' : 'text-fg hover:bg-surface-3 focus:bg-surface-3',
      )}
    >
      {icon && <span className="text-muted [&>svg]:size-4">{icon}</span>}
      {children}
    </button>
  );
}

export function SectionCard({ title, description, children, actions, className }: { title?: ReactNode; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
  return (
    <section className={className}>
      {(title || actions) && (
        <div className="mb-1.5 flex flex-wrap items-end justify-between gap-3 px-4">
          <div className="min-w-0">
            {title && <h2 className="text-[13px] font-normal uppercase tracking-wide text-muted">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      <div className="card px-4 py-3 sm:px-5">{children}</div>
    </section>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="truncate text-[30px] font-bold leading-tight tracking-tight text-fg md:text-[26px]">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="var(--accent)" />
      <rect width="32" height="16" rx="9" fill="#fff" opacity="0.18" />
      <circle cx="16" cy="13.5" r="4.25" fill="var(--on-accent)" />
      <path d="M14.1 16.2h3.8l1.1 7.3h-6Z" fill="var(--on-accent)" />
    </svg>
  );
}
