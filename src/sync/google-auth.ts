/**
 * Google OAuth 2.0 for a browser-only app (no backend, no client secret).
 *
 * Uses the OAuth 2.0 token ("implicit") flow in a popup, which is what Google Identity
 * Services uses for browser apps. No Google JavaScript is loaded into the vault page:
 * the popup returns to /oauth-callback.html on our own origin, which hands the result back
 * over a same-origin BroadcastChannel. Only the `drive.appdata` scope is requested, which
 * grants access to this app's private, hidden Drive folder — not to the user's files.
 *
 * Access tokens are valid for ~1 hour and are kept encrypted with the vault key on the device.
 * Google does not issue refresh tokens to browser-only clients, so after expiry the user is
 * asked to reconnect with one tap.
 */
import { randomId } from '../lib/encoding';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const CLIENT_ID_KEY = 'myvault.googleClientId';
const STATE_KEY = 'myvault.oauthState';
const RESULT_KEY = 'myvault.oauthResult';
const MODE_KEY = 'myvault.oauthMode';
const CHANNEL = 'myvault-oauth';

export interface GoogleToken {
  accessToken: string;
  expiresAt: number;
  scope: string;
}

export class OAuthError extends Error {
  constructor(
    readonly code: 'no-client-id' | 'popup-blocked' | 'cancelled' | 'denied' | 'state-mismatch' | 'scope' | 'timeout' | 'unknown',
    message: string,
  ) {
    super(message);
    this.name = 'OAuthError';
  }
}

export function getClientId(): string {
  let stored = '';
  try {
    stored = localStorage.getItem(CLIENT_ID_KEY) ?? '';
  } catch {
    /* storage unavailable */
  }
  return (stored || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || '').trim();
}

export function setClientId(id: string): void {
  try {
    if (id.trim()) localStorage.setItem(CLIENT_ID_KEY, id.trim());
    else localStorage.removeItem(CLIENT_ID_KEY);
  } catch {
    /* storage unavailable */
  }
}

export function isValidClientId(id: string): boolean {
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(id.trim());
}

export function redirectUri(): string {
  return `${location.origin}/oauth-callback.html`;
}

function buildAuthUrl(clientId: string, state: string, opts: { prompt?: string; loginHint?: string }): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri(),
    response_type: 'token',
    scope: DRIVE_SCOPE,
    state,
    include_granted_scopes: 'false',
  });
  if (opts.prompt) params.set('prompt', opts.prompt);
  if (opts.loginHint) params.set('login_hint', opts.loginHint);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

function parseResult(payload: Record<string, string>, expectedState: string | null): GoogleToken {
  if (!expectedState || payload.state !== expectedState) {
    throw new OAuthError('state-mismatch', 'Sign-in response could not be verified. Please try again.');
  }
  if (payload.error) {
    const denied = payload.error === 'access_denied';
    throw new OAuthError(denied ? 'denied' : 'unknown', denied ? 'Google access was not granted.' : `Google sign-in failed (${payload.error}).`);
  }
  const scope = payload.scope ?? '';
  if (!scope.split(' ').includes(DRIVE_SCOPE)) {
    throw new OAuthError('scope', 'Permission to store the encrypted vault in Google Drive was not granted.');
  }
  const expiresIn = Number(payload.expires_in ?? '3600');
  if (!payload.access_token) throw new OAuthError('unknown', 'Google did not return an access token.');
  return {
    accessToken: payload.access_token,
    expiresAt: Date.now() + Math.max(60, expiresIn - 60) * 1000,
    scope,
  };
}

/** Interactive sign-in via popup. Must be called from a user gesture (click). */
export function requestTokenPopup(opts: { prompt?: 'consent' | 'select_account' | ''; loginHint?: string } = {}): Promise<GoogleToken> {
  const clientId = getClientId();
  if (!clientId) return Promise.reject(new OAuthError('no-client-id', 'Add your Google OAuth client ID first (see the setup guide).'));
  const state = randomId();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(MODE_KEY, 'popup');
  const url = buildAuthUrl(clientId, state, { prompt: opts.prompt || undefined, loginHint: opts.loginHint });
  const w = 480;
  const h = 640;
  const left = Math.max(0, (window.screenX ?? 0) + (window.outerWidth - w) / 2);
  const top = Math.max(0, (window.screenY ?? 0) + (window.outerHeight - h) / 2);
  const popup = window.open(url, 'myvault-google-auth', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  if (!popup) return Promise.reject(new OAuthError('popup-blocked', 'The sign-in window was blocked. Allow pop-ups for MyVault or use “Continue in this window”.'));

  return new Promise<GoogleToken>((resolve, reject) => {
    const channel = new BroadcastChannel(CHANNEL);
    // Note: popup.closed is unreliable here — Google's Cross-Origin-Opener-Policy severs the
    // opener relationship, so a timeout plus an explicit cancel in the UI is used instead.
    const timeout = window.setTimeout(() => finish(new OAuthError('timeout', 'Google sign-in timed out.')), 5 * 60_000);
    const finish = (err: Error | null, token?: GoogleToken) => {
      window.clearTimeout(timeout);
      channel.close();
      window.removeEventListener('myvault-oauth-cancel', onCancel);
      sessionStorage.removeItem(STATE_KEY);
      sessionStorage.removeItem(MODE_KEY);
      if (err) reject(err);
      else resolve(token!);
    };
    const onCancel = () => finish(new OAuthError('cancelled', 'Sign-in cancelled.'));
    window.addEventListener('myvault-oauth-cancel', onCancel);
    channel.onmessage = (ev: MessageEvent) => {
      const data = ev.data as { type?: string; payload?: Record<string, string> };
      if (data?.type !== 'myvault-oauth' || !data.payload) return;
      try {
        finish(null, parseResult(data.payload, state));
      } catch (e) {
        finish(e as Error);
      }
    };
  });
}

export function cancelPendingSignIn(): void {
  window.dispatchEvent(new Event('myvault-oauth-cancel'));
}

/**
 * Full-page redirect alternative for environments where popups don't work well
 * (some installed iOS web apps). The vault locks during the redirect (keys live in memory);
 * after unlocking, consumeRedirectResult() picks the token up.
 */
export function startRedirectSignIn(opts: { loginHint?: string } = {}): void {
  const clientId = getClientId();
  if (!clientId) throw new OAuthError('no-client-id', 'Add your Google OAuth client ID first.');
  const state = randomId();
  sessionStorage.setItem(STATE_KEY, state);
  sessionStorage.setItem(MODE_KEY, 'redirect');
  location.assign(buildAuthUrl(clientId, state, { loginHint: opts.loginHint }));
}

export function consumeRedirectResult(): GoogleToken | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(RESULT_KEY);
    sessionStorage.removeItem(RESULT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  const expected = sessionStorage.getItem(STATE_KEY);
  sessionStorage.removeItem(STATE_KEY);
  try {
    const { payload, at } = JSON.parse(raw) as { payload: Record<string, string>; at: number };
    if (Date.now() - at > 10 * 60_000) return null;
    return parseResult(payload, expected);
  } catch {
    return null;
  }
}

export function hasPendingRedirectResult(): boolean {
  try {
    return sessionStorage.getItem(RESULT_KEY) !== null;
  } catch {
    return false;
  }
}

/** Revoke the token at Google (best effort) when disconnecting. */
export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
    });
  } catch {
    /* offline or blocked: the token expires within an hour anyway */
  }
}
