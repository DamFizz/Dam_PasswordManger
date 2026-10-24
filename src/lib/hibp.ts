/**
 * Optional breach check against Have I Been Pwned "Pwned Passwords" using k-anonymity:
 * only the first 5 hex characters of the password's SHA-1 hash are sent; the comparison of
 * the remaining 35 characters happens locally. Padding is requested so response sizes don't
 * leak the prefix popularity. The password itself never leaves the device.
 * Runs only when the user explicitly starts it.
 */
import { bytesToHex, utf8Encode } from './encoding';

export async function sha1Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-1', utf8Encode(value));
  return bytesToHex(new Uint8Array(digest)).toUpperCase();
}

/** Returns how many times the password appears in known breach corpora (0 = not found). */
export async function pwnedCount(password: string, fetchImpl: typeof fetch = fetch): Promise<number> {
  const hash = await sha1Hex(password);
  const prefix = hash.slice(0, 5);
  const suffix = hash.slice(5);
  const res = await fetchImpl(`https://api.pwnedpasswords.com/range/${prefix}`, {
    headers: { 'Add-Padding': 'true' },
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    credentials: 'omit',
  });
  if (!res.ok) throw new Error(`Breach check service returned ${res.status}`);
  const body = await res.text();
  for (const line of body.split('\n')) {
    const [s, count] = line.trim().split(':');
    if (s === suffix) return Number(count) || 0;
  }
  return 0;
}
