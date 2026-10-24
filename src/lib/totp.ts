/**
 * RFC 4226 (HOTP) / RFC 6238 (TOTP) implementation on top of Web Crypto HMAC.
 * Compatible with Google Authenticator: SHA-1, 6 digits, 30 second period, base32 secret.
 */
import { randomBytes } from './encoding';

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  if (!/^[A-Z2-7]*$/.test(clean)) throw new Error('Invalid base32 secret');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    value = (value << 5) | B32.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

export interface TotpConfig {
  /** base32 secret */
  secret: string;
  digits: 6;
  period: 30;
  algorithm: 'SHA1';
}

/** 160-bit secret, as recommended by RFC 4226 for HMAC-SHA-1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export async function hotp(secret: Uint8Array<ArrayBuffer>, counter: number, digits = 6): Promise<string> {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const msg = new Uint8Array(8);
  // 64-bit big-endian counter (safe for counters < 2^53)
  let c = counter;
  for (let i = 7; i >= 0; i--) {
    msg[i] = c & 0xff;
    c = Math.floor(c / 256);
  }
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

export function timeStep(nowMs: number, period = 30): number {
  return Math.floor(nowMs / 1000 / period);
}

export async function totp(secretB32: string, nowMs = Date.now(), digits = 6, period = 30): Promise<string> {
  return hotp(base32Decode(secretB32), timeStep(nowMs, period), digits);
}

export interface TotpVerifyResult {
  ok: boolean;
  /** time step that matched (used for replay protection) */
  step?: number;
}

/**
 * Verify a code allowing ±`window` steps of clock drift (default ±30 s).
 * Codes at or before `lastUsedStep` are rejected to prevent replay.
 */
export async function verifyTotp(
  secretB32: string,
  code: string,
  opts: { nowMs?: number; window?: number; lastUsedStep?: number; digits?: number; period?: number } = {},
): Promise<TotpVerifyResult> {
  const digits = opts.digits ?? 6;
  const period = opts.period ?? 30;
  const normalized = code.replace(/\s/g, '');
  if (!new RegExp(`^\\d{${digits}}$`).test(normalized)) return { ok: false };
  const secret = base32Decode(secretB32);
  const current = timeStep(opts.nowMs ?? Date.now(), period);
  const window = opts.window ?? 1;
  let matched: number | undefined;
  // Check every candidate (no early exit) to keep timing independent of which step matched.
  for (let d = -window; d <= window; d++) {
    const step = current + d;
    const candidate = await hotp(secret, step, digits);
    if (timingSafeStringEqual(candidate, normalized) && matched === undefined) matched = step;
  }
  if (matched === undefined) return { ok: false };
  if (opts.lastUsedStep !== undefined && matched <= opts.lastUsedStep) return { ok: false };
  return { ok: true, step: matched };
}

function timingSafeStringEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function otpauthUri(secretB32: string, account: string, issuer = 'MyVault'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Group a base32 secret into blocks of four for easier manual entry. */
export function formatSecretForDisplay(secretB32: string): string {
  return secretB32.replace(/(.{4})/g, '$1 ').trim();
}
