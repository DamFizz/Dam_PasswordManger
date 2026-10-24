/** Toasts, confirmation dialogs and re-authentication prompts (promise based). */
import { randomId } from '../lib/encoding';
import { createStore } from './store';

export interface Toast {
  id: string;
  message: string;
  kind: 'success' | 'error' | 'info';
  action?: { label: string; run: () => void };
  duration: number;
}

export const toastStore = createStore<{ toasts: Toast[] }>({ toasts: [] });

export function toast(message: string, opts: Partial<Omit<Toast, 'id' | 'message'>> = {}): string {
  const t: Toast = { id: randomId(), message, kind: opts.kind ?? 'success', action: opts.action, duration: opts.duration ?? (opts.action ? 6000 : 3000) };
  toastStore.set((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
  window.setTimeout(() => dismissToast(t.id), t.duration);
  return t.id;
}

export function dismissToast(id: string): void {
  toastStore.set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function toastError(e: unknown, fallback = 'Something went wrong'): void {
  const message = e instanceof Error && e.message ? e.message : fallback;
  toast(message, { kind: 'error', duration: 5000 });
}

// ---------------------------------------------------------------- confirm

export interface ConfirmRequest {
  id: string;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** optional checkbox the user must tick (e.g. "I understand") */
  acknowledge?: string;
  resolve: (ok: boolean) => void;
}

export const confirmStore = createStore<{ request: ConfirmRequest | null }>({ request: null });

export function confirmDialog(opts: Omit<ConfirmRequest, 'id' | 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => {
    confirmStore.get().request?.resolve(false);
    confirmStore.set({
      request: {
        ...opts,
        id: randomId(),
        resolve: (ok) => {
          confirmStore.set({ request: null });
          resolve(ok);
        },
      },
    });
  });
}

// ---------------------------------------------------------------- re-authentication

export interface ReauthRequest {
  id: string;
  title: string;
  description?: string;
  /** also ask for an Authenticator / recovery code when TOTP is enabled */
  withSecondFactor: boolean;
  submitLabel?: string;
  /** performs the protected action; throws on wrong credentials (shown inline) */
  run: (password: string, code: string) => Promise<unknown>;
  resolve: (result: { ok: true; value: unknown } | { ok: false }) => void;
}

export const reauthStore = createStore<{ request: ReauthRequest | null }>({ request: null });

export function requestReauth<T>(opts: {
  title: string;
  description?: string;
  withSecondFactor?: boolean;
  submitLabel?: string;
  run: (password: string, code: string) => Promise<T>;
}): Promise<T | null> {
  return new Promise((resolve) => {
    reauthStore.get().request?.resolve({ ok: false });
    reauthStore.set({
      request: {
        id: randomId(),
        title: opts.title,
        description: opts.description,
        withSecondFactor: opts.withSecondFactor ?? false,
        submitLabel: opts.submitLabel,
        run: opts.run,
        resolve: (r) => {
          reauthStore.set({ request: null });
          resolve(r.ok ? (r.value as T) : null);
        },
      },
    });
  });
}
