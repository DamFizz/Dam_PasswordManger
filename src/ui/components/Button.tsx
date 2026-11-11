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
  primary: 'glass-tint font-semibold hover:brightness-110 disabled:opacity-40 disabled:hover:brightness-100',
  secondary: 'glass-clear text-fg font-medium hover:brightness-110 disabled:opacity-40',
  ghost: 'text-accent font-medium hover:bg-accent-soft disabled:opacity-40',
  subtle: 'bg-accent-soft text-accent font-semibold hover:brightness-110 disabled:opacity-40',
  danger: 'bg-danger-soft text-danger font-medium hover:brightness-110 disabled:opacity-40',
};

const sizes: Record<Size, string> = {
  sm: 'h-8 px-3.5 text-[13px] gap-1.5 rounded-full',
  md: 'h-10 px-5 text-[15px] gap-2 rounded-full',
  lg: 'h-[52px] px-6 text-[17px] gap-2 rounded-full',
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
        'pressable inline-flex items-center justify-center whitespace-nowrap select-none cursor-pointer disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        (block || size !== 'sm') && 'lg-wide',
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
  const s = size === 'sm' ? 'size-8 rounded-full' : size === 'lg' ? 'size-11 rounded-full' : 'size-9 rounded-full';
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'pressable inline-flex shrink-0 items-center justify-center cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed',
        s,
        tone === 'danger' ? 'text-danger hover:bg-danger-soft' : tone === 'accent' ? 'text-accent hover:bg-accent-soft' : 'text-accent hover:bg-accent-soft',
        active && 'bg-surface-2 text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
