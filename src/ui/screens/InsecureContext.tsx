import { ShieldAlert } from 'lucide-react';
import { useT } from '../../i18n';
import { Logo } from '../components/Misc';

/**
 * Shown when the page is not a secure context (plain http:// on a LAN address, for example).
 * Browsers disable Web Crypto there, so the vault could not be encrypted — refuse clearly.
 */
export function InsecureContext() {
  const t = useT();
  const https = `https://${location.host}${location.pathname}`;
  return (
    <div className="ambient flex min-h-full items-center justify-center px-5 py-10">
      <div className="w-full max-w-md text-center">
        <Logo className="mx-auto mb-6 size-14" />
        <div className="card p-6 text-left">
          <div className="flex items-center gap-3">
            <ShieldAlert className="size-6 shrink-0 text-warning" />
            <h1 className="text-lg font-semibold">{t('insecure.title')}</h1>
          </div>
          <p className="mt-3 text-sm leading-relaxed text-muted">{t('insecure.body')}</p>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted">
            <li>
              {t('insecure.tryHttps')}{' '}
              <a href={https} className="break-all font-medium text-accent underline">
                {https}
              </a>
            </li>
            <li>{t('insecure.deploy')}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}

export function isSecureEnough(): boolean {
  return typeof window !== 'undefined' && window.isSecureContext && !!globalThis.crypto?.subtle && typeof indexedDB !== 'undefined';
}
