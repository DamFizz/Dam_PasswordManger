import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
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

  // Keep the content mounted while the closing animation plays (sheet slides down, window fades).
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open) {
      setMounted(true);
      delete d.dataset.closing;
      if (!d.open) d.showModal();
      return;
    }
    if (!d.open) {
      setMounted(false);
      return;
    }
    const reduced = document.documentElement.dataset.motion === 'reduced';
    d.dataset.closing = '';
    const id = window.setTimeout(() => {
      d.close();
      delete d.dataset.closing;
      setMounted(false);
    }, reduced ? 0 : 230);
    return () => window.clearTimeout(id);
  }, [open]);
  const show = open || mounted;

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
      {show && bare && (
        <div className={cx('glass-strong mv-dialog-panel flex h-full flex-col overflow-hidden', className)} inert={!open} aria-hidden={!open || undefined}>
          {children}
        </div>
      )}
      {show && !bare && (
        <div
          inert={!open}
          aria-hidden={!open || undefined}
          className={cx(
            'glass-strong mv-dialog-panel flex max-h-[90dvh] w-[calc(100vw-1.5rem)] flex-col overflow-hidden',
            sheet ? 'max-sm:w-full rounded-[30px]' : 'rounded-[30px]',
            widths[size],
            className,
          )}
        >
          {sheet && <div className="mx-auto mt-1.5 h-[5px] w-9 rounded-full bg-surface-3 sm:hidden" aria-hidden />}
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
          {footer && <div className="flex flex-wrap items-center justify-end gap-2 px-5 pb-5 pt-3 sm:px-6">{footer}</div>}
        </div>
      )}
    </dialog>
  );
}
