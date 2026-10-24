import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx } from '../cx';
import { IconButton } from './Button';
import { useT } from '../../i18n';

/**
 * Accessible modal built on the native <dialog> element: focus is trapped, the page behind is
 * inert, Escape closes it. On phones it is presented as a bottom sheet.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  sheet = true,
  dismissible = true,
  className,
  placement = 'center',
  bare = false,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  sheet?: boolean;
  dismissible?: boolean;
  className?: string;
  /** 'left' renders a full-height navigation drawer */
  placement?: 'center' | 'left';
  /** no header/padding: the children provide their own layout */
  bare?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const t = useT();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      if (dismissible) onCloseRef.current();
    };
    d.addEventListener('cancel', onCancel);
    return () => d.removeEventListener('cancel', onCancel);
  }, [dismissible]);

  const widths = { sm: 'sm:w-[420px]', md: 'sm:w-[540px]', lg: 'sm:w-[680px]', xl: 'sm:w-[860px]' };

  return (
    <dialog
      ref={ref}
      className={cx('mv-dialog', sheet && placement === 'center' && 'mv-sheet', placement === 'left' && 'mv-drawer')}
      aria-labelledby={title ? titleId : undefined}
      onMouseDown={(e) => {
        if (dismissible && e.target === ref.current) onClose();
      }}
    >
      {open && bare && (
        <div className={cx('mv-dialog-panel flex h-full flex-col overflow-hidden border border-line bg-surface shadow-strong', className)}>{children}</div>
      )}
      {open && !bare && (
        <div
          className={cx(
            'mv-dialog-panel flex max-h-[92dvh] w-[calc(100vw-1.5rem)] flex-col overflow-hidden border border-line bg-surface shadow-strong',
            sheet ? 'max-sm:w-screen max-sm:rounded-t-3xl max-sm:rounded-b-none max-sm:border-b-0 sm:rounded-2xl' : 'rounded-2xl',
            widths[size],
            className,
          )}
        >
          {sheet && <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />}
          {(title || dismissible) && (
            <div className="flex items-start gap-3 px-5 pt-4 pb-2 sm:px-6 sm:pt-5">
              <div className="min-w-0 flex-1">
                {title && (
                  <h2 id={titleId} className="text-lg font-semibold tracking-tight text-fg">
                    {title}
                  </h2>
                )}
                {description && <p className="mt-1 text-sm text-muted">{description}</p>}
              </div>
              {dismissible && (
                <IconButton label={t('action.close')} size="sm" onClick={onClose} className="-mr-1">
                  <X className="size-4" />
                </IconButton>
              )}
            </div>
          )}
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-2 sm:px-6">{children}</div>
          {footer && <div className="safe-bottom flex flex-wrap items-center justify-end gap-2 border-t border-line bg-surface px-5 py-3 sm:px-6">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
