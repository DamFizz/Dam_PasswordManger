import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { cx } from '../cx';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'subtle';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
  block?: boolean;
}

const variants: Record<Variant, string> = {
  primary:
    'bg-accent-gradient text-on-accent font-semibold shadow-soft hover:brightness-110 active:brightness-95 disabled:opacity-50 disabled:hover:brightness-100',
  secondary: 'bg-surface-2 text-fg border border-line hover:bg-surface-3 hover:border-line-strong disabled:opacity-50',
  ghost: 'text-muted hover:text-fg hover:bg-surface-2 disabled:opacity-40',
  subtle: 'bg-accent-soft text-accent hover:brightness-125 disabled:opacity-50',
  danger: 'bg-danger-soft text-danger border border-transparent hover:border-danger/40 disabled:opacity-50',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3 text-sm gap-1.5 rounded-lg',
  md: 'h-10 px-4 text-sm gap-2 rounded-xl',
  lg: 'h-12 px-5 text-base gap-2 rounded-xl',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, block, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex items-center justify-center whitespace-nowrap transition-[background,filter,border-color,color] duration-150 select-none cursor-pointer disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <LoaderCircle className="size-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md' | 'lg';
  active?: boolean;
  tone?: 'default' | 'danger' | 'accent';
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', active, tone = 'default', className, children, type = 'button', ...rest },
  ref,
) {
  const s = size === 'sm' ? 'size-8 rounded-lg' : size === 'lg' ? 'size-12 rounded-2xl' : 'size-10 rounded-xl';
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
        s,
        tone === 'danger' ? 'text-danger hover:bg-danger-soft' : tone === 'accent' ? 'text-accent hover:bg-accent-soft' : 'text-muted hover:text-fg hover:bg-surface-2',
        active && 'bg-surface-2 text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
