import { en, type Dictionary } from './en';
import { ms } from './ms';
import { getPrefs, usePrefs } from '../state/prefs-store';
import type { Lang } from '../state/prefs';

export type TKey = keyof Dictionary;
export type TVars = Record<string, string | number>;

const dictionaries: Record<Lang, Dictionary> = { en, ms };

export function translate(lang: Lang, key: TKey, vars?: TVars): string {
  let s: string = dictionaries[lang]?.[key] ?? en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Translate using the current language preference (for non-React code such as toasts). */
export function t(key: TKey, vars?: TVars): string {
  return translate(getPrefs().lang, key, vars);
}

/** React hook: re-renders when the language changes. */
export function useT(): (key: TKey, vars?: TVars) => string {
  const { lang } = usePrefs();
  return (key, vars) => translate(lang, key, vars);
}

export function formatDate(ms: number | null | undefined, withTime = false): string {
  if (!ms) return '—';
  const lang = getPrefs().lang === 'ms' ? 'ms-MY' : undefined;
  return new Date(ms).toLocaleString(lang, withTime ? { dateStyle: 'medium', timeStyle: 'short' } : { dateStyle: 'medium' });
}

export function formatRelative(ms: number | null | undefined): string {
  if (!ms) return t('time.never');
  const diff = Date.now() - ms;
  const abs = Math.abs(diff);
  if (abs < 45_000) return t('time.justNow');
  const lang = getPrefs().lang === 'ms' ? 'ms' : 'en';
  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: 'auto' });
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ['year', 365 * 86_400_000],
    ['month', 30 * 86_400_000],
    ['week', 7 * 86_400_000],
    ['day', 86_400_000],
    ['hour', 3_600_000],
    ['minute', 60_000],
  ];
  for (const [unit, size] of units) {
    if (abs >= size) return rtf.format(-Math.round(diff / size), unit);
  }
  return t('time.justNow');
}
