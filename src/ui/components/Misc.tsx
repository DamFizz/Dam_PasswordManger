import { useEffect, useRef, useState, type ReactNode } from 'react';
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
  const dims = size === 'sm' ? 'size-8 rounded-lg text-xs' : size === 'lg' ? 'size-14 rounded-2xl text-xl' : 'size-10 rounded-xl text-sm';
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
  return <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide', tones[tone], className)}>{children}</span>;
}

/** Minimal accessible popover menu. */
export function Menu({ trigger, children, align = 'end', className }: { trigger: (props: { onClick: () => void; 'aria-expanded': boolean; 'aria-haspopup': 'menu' }) => ReactNode; children: (close: () => void) => ReactNode; align?: 'start' | 'end'; className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
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
  }, [open]);
  return (
    <div ref={ref} className={cx('relative', className)}>
      {trigger({ onClick: () => setOpen((o) => !o), 'aria-expanded': open, 'aria-haspopup': 'menu' })}
      {open && (
        <div
          role="menu"
          className={cx('animate-fade-in absolute z-40 mt-1 min-w-52 overflow-hidden rounded-xl border border-line bg-surface-2 p-1 shadow-strong', align === 'end' ? 'right-0' : 'left-0')}
        >
          {children(() => setOpen(false))}
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
        'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm outline-none transition-colors cursor-pointer disabled:opacity-40',
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
    <section className={cx('card p-5 sm:p-6', className)}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-base font-semibold text-fg">{title}</h2>}
            {description && <p className="mt-1 text-sm text-muted">{description}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="flex min-w-0 items-center gap-3">
        {icon && <div className="hidden size-11 shrink-0 items-center justify-center rounded-2xl bg-accent-soft text-accent sm:flex">{icon}</div>}
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden>
      <defs>
        <linearGradient id="mv-logo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--accent)' }} />
          <stop offset="1" style={{ stopColor: 'var(--accent-2)' }} />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#mv-logo-g)" />
      <path d="M24 11.5 14 15.6v7.6c0 6.6 4.2 11.6 10 13.3 5.8-1.7 10-6.7 10-13.3v-7.6Z" fill="rgb(0 0 0 / 0.18)" />
      <path d="M24 13.5 15.8 17v6.3c0 5.5 3.4 9.6 8.2 11.1 4.8-1.5 8.2-5.6 8.2-11.1V17Z" fill="none" stroke="white" strokeWidth="2.2" strokeLinejoin="round" />
      <circle cx="24" cy="22.6" r="2.6" fill="white" />
      <path d="M24 24.6v4.4" stroke="white" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}
