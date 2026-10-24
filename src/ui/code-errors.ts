import type { TKey, TVars } from '../i18n';
import { InvalidCodeError } from '../vault/access';

/** User-facing text for a rejected Authenticator / recovery code, including clock-drift hints. */
export function codeErrorText(e: unknown, t: (k: TKey, v?: TVars) => string, fallback: TKey): string {
  if (e instanceof InvalidCodeError) {
    if (e.reason === 'clock' && e.driftSeconds) {
      const min = Math.max(1, Math.round(Math.abs(e.driftSeconds) / 60));
      // Positive drift: the phone is ahead, so this device's clock is behind.
      return t(e.driftSeconds > 0 ? 'totp.clockBehind' : 'totp.clockAhead', { min });
    }
    if (e.reason === 'expired') return t('lock.challengeExpired');
  }
  return t(fallback);
}
