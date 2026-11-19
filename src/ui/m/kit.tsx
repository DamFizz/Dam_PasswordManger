/**
 * The Android app's UI kit (ui/glass/Components.kt) for the web: same shapes, sizes, colours and
 * behaviour, so both apps look and work the same.
 *
 *  - Glass is for the navigation layer (bars, buttons, sheets); content sits in quiet fills.
 *  - Inset groups: 24px rounded fills holding rows separated by inset dividers.
 *  - Large titles, uppercase section headers, 38px tinted icon tiles.
 */
import { forwardRef, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react';
import { Check, Eye, EyeOff, LoaderCircle } from 'lucide-react';
import { cx } from '../cx';
import { LiquidPill } from '../liquid';

// ---------------------------------------------------------------- text

export function LargeTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h1 className={cx('text-[34px] font-bold leading-[40px] tracking-[-0.4px] text-fg', className)}>{children}</h1>;
}

export function Title({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('text-[24px] font-bold leading-[30px] tracking-[-0.2px] text-fg', className)}>{children}</h2>;
}

export function Headline({ children, className }: { children: ReactNode; className?: string }) {
  return <h3 className={cx('text-[17px] font-semibold leading-[22px] text-fg', className)}>{children}</h3>;
}

export function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-[15px] leading-[21px] text-muted', className)}>{children}</p>;
}

export function Footnote({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cx('text-[13px] leading-[18px] text-faint', className)}>{children}</p>;
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="px-4 py-2.5 text-[13px] leading-[18px] text-danger">
      {children}
    </p>
  );
}

export function SectionHeader({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cx('px-4 pb-0.5 pt-2 text-[12px] font-medium uppercase leading-4 tracking-[0.02em] text-faint', className)}>{children}</h2>;
}

export function TextLink({ children, onClick, className, tone = 'accent' }: { children: ReactNode; onClick: () => void; className?: string; tone?: 'accent' | 'danger' | 'muted' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx(
        'self-start rounded-full px-3 py-2.5 text-[15px] font-medium leading-[21px] cursor-pointer',
        tone === 'danger' ? 'text-danger' : tone === 'muted' ? 'text-muted' : 'text-accent',
        className,
      )}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- groups and rows

export function InsetGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('m-group w-full overflow-hidden rounded-[24px] bg-surface', className)}>{children}</div>;
}

export function GroupDivider({ inset = 16 }: { inset?: number }) {
  return <div aria-hidden className="h-px bg-line" style={{ marginLeft: inset }} />;
}

/** 38px tile with a tinted rounded square and the icon in the tile's colour. */
export function IconTile({ icon, size = 38, color }: { icon: ReactNode; size?: number; color?: string }) {
  const c = color ?? 'var(--accent)';
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center [&>svg]:shrink-0"
      style={{ width: size, height: size, borderRadius: size * 0.3, background: `color-mix(in srgb, ${c} 18%, transparent)`, color: c }}
    >
      <span className="flex items-center justify-center" style={{ width: size * 0.55, height: size * 0.55 }}>
        {icon}
      </span>
    </span>
  );
}

export interface ListRowProps {
  title: ReactNode;
  subtitle?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
  onLongPress?: () => void;
  titleClassName?: string;
  className?: string;
  ariaLabel?: string;
  selected?: boolean;
  /** indent (nested folders) */
  indent?: number;
  disabled?: boolean;
  ariaCurrent?: boolean;
}

/** Long press (touch or mouse held ~450 ms) without blocking a normal click. */
function useLongPress(onLongPress?: () => void) {
  const timer = useRef(0);
  const fired = useRef(false);
  if (!onLongPress) return { handlers: {}, consumeClick: () => false };
  const start = () => {
    fired.current = false;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      fired.current = true;
      if (navigator.vibrate) navigator.vibrate(12);
      onLongPress();
    }, 450);
  };
  const cancel = () => window.clearTimeout(timer.current);
  return {
    handlers: {
      onPointerDown: (e: React.PointerEvent) => e.button === 0 && start(),
      onPointerUp: cancel,
      onPointerLeave: cancel,
      onPointerCancel: cancel,
      onContextMenu: (e: React.MouseEvent) => {
        e.preventDefault();
        cancel();
        fired.current = true;
        onLongPress();
      },
    },
    consumeClick: () => {
      const f = fired.current;
      fired.current = false;
      return f;
    },
  };
}

export function ListRow({ title, subtitle, leading, trailing, onClick, onLongPress, titleClassName, className, ariaLabel, selected, indent = 0, disabled, ariaCurrent }: ListRowProps) {
  const lp = useLongPress(onLongPress);
  const content = (
    <>
      {leading && <span className="mr-3.5 flex shrink-0 items-center">{leading}</span>}
      <span className="min-w-0 flex-1 text-left">
        <span className={cx('block truncate text-[17px] leading-[23px] text-fg', titleClassName)}>{title}</span>
        {subtitle && <span className="line-clamp-2 block text-[13px] leading-[18px] text-muted">{subtitle}</span>}
      </span>
      {trailing && <span className="ml-2 flex shrink-0 items-center gap-1.5 text-faint">{trailing}</span>}
    </>
  );
  const base = cx('lg-row flex w-full min-h-[54px] items-center px-4 py-3', selected && 'bg-surface-3', className);
  const style = indent ? { paddingLeft: 16 + indent * 18 } : undefined;
  if (!onClick) return <div className={base} style={style}>{content}</div>;
  // A div with role="button" (not <button>) so rows can hold their own buttons (copy, move...).
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={ariaLabel}
      aria-current={ariaCurrent ? 'true' : undefined}
      aria-disabled={disabled || undefined}
      className={cx(base, 'cursor-pointer outline-none focus-visible:bg-surface-2', disabled && 'pointer-events-none opacity-45')}
      style={style}
      {...lp.handlers}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest('button, a, input, label') && e.target !== e.currentTarget) return;
        if (lp.consumeClick()) return;
        onClick();
      }}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {content}
    </div>
  );
}

/** Row with a title, optional subtitle and an iOS switch. */
export function ToggleRow({ title, subtitle, checked, onChange, disabled }: { title: ReactNode; subtitle?: ReactNode; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className={cx('flex min-h-[54px] items-center gap-3 px-4 py-3', disabled && 'opacity-50')}>
      <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
        <span className="block text-[17px] leading-[23px] text-fg">{title}</span>
        {subtitle && <span className="block text-[13px] leading-[18px] text-muted">{subtitle}</span>}
      </label>
      <GlassToggle id={id} checked={checked} onChange={onChange} disabled={disabled} label={typeof title === 'string' ? title : undefined} />
    </div>
  );
}

export function GlassToggle({ checked, onChange, disabled, id, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; id?: string; label?: string }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-[31px] w-[51px] shrink-0 rounded-full transition-colors duration-300 cursor-pointer disabled:cursor-not-allowed', checked ? 'bg-accent' : 'bg-[var(--switch-off)]')}
    >
      <span
        className={cx(
          'absolute left-[2px] top-[2px] size-[27px] rounded-full bg-white shadow-[0_3px_8px_rgb(0_0_0/0.15),0_1px_1px_rgb(0_0_0/0.16)] transition-transform duration-300 ease-[var(--ease-spring)]',
          checked ? 'translate-x-5' : 'translate-x-0',
        )}
      />
    </button>
  );
}

export function CheckMark({ on }: { on: boolean }) {
  return on ? <Check className="size-5 text-accent" aria-label="selected" /> : <span className="size-5" aria-hidden />;
}

/** Chevron used at the end of navigation rows. */
export function Chevron() {
  return (
    <svg aria-hidden viewBox="0 0 24 24" className="size-[22px] text-faint" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

// ---------------------------------------------------------------- buttons

export interface GlassButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  children: ReactNode;
  prominent?: boolean;
  destructive?: boolean;
  icon?: ReactNode;
  loading?: boolean;
  block?: boolean;
}

/** Capsule glass button, 52px tall. Prominent = accent-tinted glass. */
export const GlassButton = forwardRef<HTMLButtonElement, GlassButtonProps>(function GlassButton(
  { children, prominent = true, destructive, icon, loading, block, className, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'lg-wide inline-flex min-h-[52px] items-center justify-center gap-2 rounded-full px-[22px] py-3.5 text-[17px] font-semibold leading-[22px] select-none cursor-pointer',
        'disabled:opacity-45 disabled:cursor-not-allowed',
        prominent ? (destructive ? 'glass-tint m-btn-danger' : 'glass-tint') : 'glass-clear',
        !prominent && (destructive ? 'text-danger' : 'text-fg'),
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : icon && <span className="flex [&>svg]:size-5">{icon}</span>}
      <span className="truncate">{children}</span>
    </button>
  );
});

/** Round glass button (46px) for top bars. */
export const GlassIconButton = forwardRef<HTMLButtonElement, { label: string; onClick?: () => void; children: ReactNode; size?: number; className?: string; tint?: 'default' | 'accent' } & Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'onClick'>>(
  function GlassIconButton({ label, onClick, children, size = 46, className, tint = 'default', ...rest }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        aria-label={label}
        title={label}
        onClick={onClick}
        className={cx('flex shrink-0 items-center justify-center rounded-full text-fg cursor-pointer [&_svg]:size-[22px]', tint === 'accent' ? 'glass-tint' : 'glass-clear', className)}
        style={{ width: size, height: size }}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

/** Small icon button inside rows (no glass). */
export function RowIconButton({ label, onClick, children, tone = 'accent', disabled }: { label: string; onClick: () => void; children: ReactNode; tone?: 'accent' | 'danger' | 'muted' | 'fg'; disabled?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      className={cx(
        'flex size-10 shrink-0 items-center justify-center rounded-full cursor-pointer hover:bg-surface-2 disabled:opacity-40 [&_svg]:size-[21px]',
        tone === 'danger' ? 'text-danger' : tone === 'muted' ? 'text-muted' : tone === 'fg' ? 'text-fg' : 'text-accent',
      )}
    >
      {children}
    </button>
  );
}

/** Rounded chip (filters, quick picks). */
export function Chip({ children, selected, onClick, icon }: { children: ReactNode; selected?: boolean; onClick: () => void; icon?: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cx(
        'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-semibold cursor-pointer [&_svg]:size-4',
        selected ? 'bg-accent text-on-accent' : 'bg-surface-2 text-fg',
      )}
    >
      {icon}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------- fields

export interface GlassTextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  secret?: boolean;
  mono?: boolean;
  leading?: ReactNode;
  onDone?: () => void;
  multiline?: boolean;
  /** visible label above the field (defaults to the placeholder for screen readers only) */
  label?: string;
  /** extra buttons at the end of the field */
  trailing?: ReactNode;
  error?: string;
}

export const GlassTextField = forwardRef<HTMLInputElement, GlassTextFieldProps>(function GlassTextField(
  { value, onChange, placeholder, secret, mono, leading, onDone, multiline, label, trailing, error, className, ...rest },
  ref,
) {
  const [shown, setShown] = useState(false);
  const id = useId();
  const box = 'flex w-full items-center rounded-[16px] bg-[var(--field)] pl-3.5 pr-1.5 min-h-[52px] focus-within:shadow-[0_0_0_3px_var(--accent-soft)]';
  return (
    <div className={cx('w-full', className)}>
      {label && (
        <label htmlFor={id} className="mb-1.5 block px-1 text-[13px] text-muted">
          {label}
        </label>
      )}
      <div className={box}>
        {leading && <span className="mr-2.5 flex text-faint [&_svg]:size-5">{leading}</span>}
        {multiline ? (
          <textarea
            id={id}
            aria-label={label ? undefined : placeholder}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={3}
            spellCheck={false}
            className={cx('min-h-[84px] w-full flex-1 resize-y bg-transparent py-3.5 text-[17px] leading-[23px] text-fg placeholder:text-faint focus:outline-none', mono && 'font-mono')}
          />
        ) : (
          <input
            ref={ref}
            id={id}
            aria-label={label ? undefined : placeholder}
            type={secret && !shown ? 'password' : 'text'}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoComplete={secret ? 'off' : rest.autoComplete ?? 'off'}
            spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && onDone) {
                e.preventDefault();
                onDone();
              }
            }}
            className={cx('h-full w-full min-w-0 flex-1 bg-transparent py-3.5 text-[17px] leading-[23px] text-fg placeholder:text-faint focus:outline-none', (mono || (secret && shown)) && 'font-mono')}
            {...rest}
          />
        )}
        {trailing}
        {secret ? (
          <RowIconButton label={shown ? `Hide ${label ?? placeholder}` : `Show ${label ?? placeholder}`} onClick={() => setShown((v) => !v)} tone="muted">
            {shown ? <EyeOff /> : <Eye />}
          </RowIconButton>
        ) : (
          !trailing && <span className="w-2" />
        )}
      </div>
      {error && <p className="px-3.5 pt-1 text-[13px] text-danger">{error}</p>}
    </div>
  );
});

// ---------------------------------------------------------------- selector with a flowing pill

/** Segmented control: a pill flows between the options (Android FlowingSelector). */
export function FlowingSelector<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  label: string;
  className?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="tablist" aria-label={label} className={cx('relative flex w-full rounded-full bg-[var(--seg-track)] p-1', className)}>
      <LiquidPill group="flow" className="lg-pill-thumb" />
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          data-liquid-active={value === o.value ? 'flow' : undefined}
          onClick={() => onChange(o.value)}
          className={cx(
            'relative flex flex-1 items-center justify-center gap-1.5 rounded-full font-semibold transition-colors duration-300 cursor-pointer [&_svg]:size-4',
            size === 'sm' ? 'h-9 text-[13px]' : 'h-11 text-[14px]',
            value === o.value ? 'text-fg' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Page column: same width rules everywhere (phone full width, desktop centred). */
export function Column({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return <div className={cx('mx-auto w-full px-4 sm:px-6', wide ? 'max-w-[1080px]' : 'max-w-[720px]', className)}>{children}</div>;
}

/** Stack with the Android spacing (14px between blocks). */
export function Stack({ children, className, gap = 14 }: { children: ReactNode; className?: string; gap?: number }) {
  return (
    <div className={cx('flex flex-col', className)} style={{ gap }}>
      {children}
    </div>
  );
}
