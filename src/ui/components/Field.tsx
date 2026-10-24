import { forwardRef, useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from '../cx';

export const inputClass =
  'w-full min-w-0 bg-surface-2 border border-line rounded-xl px-3.5 h-11 text-[15px] text-fg placeholder:text-faint transition-[border-color,box-shadow] duration-150 hover:border-line-strong focus:border-accent focus:shadow-[0_0_0_3px_var(--accent-soft)] disabled:opacity-60';

export function Label({ htmlFor, children, hint }: { htmlFor?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-1.5 flex items-baseline justify-between gap-2">
      <label htmlFor={htmlFor} className="text-[13px] font-medium text-muted">
        {children}
      </label>
      {hint && <span className="text-xs text-faint">{hint}</span>}
    </div>
  );
}

interface FieldWrapProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  help?: ReactNode;
  className?: string;
  id: string;
  children: ReactNode;
}

export function FieldWrap({ label, hint, error, help, className, id, children }: FieldWrapProps) {
  return (
    <div className={cx('min-w-0', className)}>
      {label && (
        <Label htmlFor={id} hint={hint}>
          {label}
        </Label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="mt-1.5 text-[13px] text-danger">
          {error}
        </p>
      ) : help ? (
        <p id={`${id}-help`} className="mt-1.5 text-[13px] text-faint">
          {help}
        </p>
      ) : null}
    </div>
  );
}

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  help?: ReactNode;
  wrapClassName?: string;
  trailing?: ReactNode;
  leading?: ReactNode;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, help, wrapClassName, trailing, leading, className, id, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap label={label} hint={hint} error={error} help={help} className={wrapClassName} id={fid}>
      <div className="relative flex items-center">
        {leading && <div className="pointer-events-none absolute left-3 flex items-center text-faint">{leading}</div>}
        <input
          ref={ref}
          id={fid}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fid}-error` : help ? `${fid}-help` : undefined}
          className={cx(inputClass, !!leading && 'pl-10', !!trailing && 'pr-24', !!error && 'border-danger', className)}
          {...rest}
        />
        {trailing && <div className="absolute right-1.5 flex items-center gap-0.5">{trailing}</div>}
      </div>
    </FieldWrap>
  );
});

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  help?: ReactNode;
  wrapClassName?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, help, wrapClassName, className, id, rows = 4, ...rest },
  ref,
) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap label={label} hint={hint} error={error} help={help} className={wrapClassName} id={fid}>
      <textarea
        ref={ref}
        id={fid}
        rows={rows}
        className={cx(inputClass, 'h-auto py-2.5 leading-relaxed resize-y min-h-[5rem]', className)}
        {...rest}
      />
    </FieldWrap>
  );
});

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  help?: ReactNode;
  wrapClassName?: string;
  options: { value: string; label: string }[];
}

export function SelectField({ label, help, wrapClassName, options, className, id, ...rest }: SelectFieldProps) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <FieldWrap label={label} help={help} className={wrapClassName} id={fid}>
      <select id={fid} className={cx(inputClass, 'appearance-none pr-9 cursor-pointer bg-[length:16px] bg-no-repeat bg-[right_0.75rem_center] select-chevron', className)} {...rest}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </FieldWrap>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  id?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={cx('flex items-start justify-between gap-4 py-2', disabled && 'opacity-50')}>
      <div className="min-w-0">
        <label htmlFor={fid} className="block text-[15px] font-medium text-fg cursor-pointer">
          {label}
        </label>
        {description && <p className="mt-0.5 text-[13px] text-muted">{description}</p>}
      </div>
      <button
        id={fid}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors duration-200 cursor-pointer',
          checked ? 'bg-accent border-transparent' : 'bg-surface-3 border-line-strong',
        )}
      >
        <span
          className={cx(
            'absolute left-0 top-px size-5 rounded-full bg-white shadow transition-transform duration-200',
            checked ? 'translate-x-5' : 'translate-x-0.5',
          )}
        />
      </button>
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-xl bg-surface-2 border border-line p-1 gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'inline-flex items-center gap-1.5 rounded-lg font-medium transition-colors cursor-pointer',
            size === 'sm' ? 'px-2.5 h-7 text-xs' : 'px-3 h-8 text-sm',
            value === o.value ? 'bg-surface text-fg shadow-soft' : 'text-muted hover:text-fg',
          )}
        >
          {o.icon}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Checkbox({ checked, onChange, label, id }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode; id?: string }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <label htmlFor={fid} className="flex cursor-pointer items-start gap-3 text-[14px] text-fg">
      <input id={fid} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-[18px] shrink-0 cursor-pointer accent-[var(--accent)]" />
      <span>{label}</span>
    </label>
  );
}
