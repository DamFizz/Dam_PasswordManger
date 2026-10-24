import { describe, expect, it } from 'vitest';
import { base32Decode, base32Encode, generateTotpSecret, hotp, otpauthUri, totp, verifyTotp } from '../src/lib/totp';
import { utf8Encode } from '../src/lib/encoding';

// RFC 6238 Appendix B test secret (SHA-1): ASCII "12345678901234567890"
const RFC_SECRET = base32Encode(utf8Encode('12345678901234567890'));

describe('base32', () => {
  it('round-trips', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
    expect([...base32Decode(base32Encode(bytes))]).toEqual([...bytes]);
  });
  it('matches RFC 4648 vectors', () => {
    expect(base32Encode(utf8Encode('foobar'))).toBe('MZXW6YTBOI');
    expect(new TextDecoder().decode(base32Decode('MZXW6YTBOI'))).toBe('foobar');
    expect(new TextDecoder().decode(base32Decode('mzxw 6ytb-oi'))).toBe('foobar');
  });
  it('rejects invalid characters', () => {
    expect(() => base32Decode('ABC1')).toThrow();
  });
});

describe('HOTP (RFC 4226 Appendix D)', () => {
  it('produces the reference values', async () => {
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    const secret = utf8Encode('12345678901234567890');
    for (let i = 0; i < expected.length; i++) expect(await hotp(secret, i)).toBe(expected[i]);
  });
});

describe('TOTP (RFC 6238 Appendix B, SHA-1)', () => {
  it('produces the reference values (8 digits)', async () => {
    const cases: [number, string][] = [
      [59, '94287082'],
      [1111111109, '07081804'],
      [1111111111, '14050471'],
      [1234567890, '89005924'],
      [2000000000, '69279037'],
      [20000000000, '65353130'],
    ];
    for (const [t, code] of cases) expect(await totp(RFC_SECRET, t * 1000, 8)).toBe(code);
  });

  it('accepts the current code and ±1 step drift', async () => {
    const now = 1_700_000_000_000;
    const secret = generateTotpSecret();
    for (const offset of [-30_000, 0, 30_000]) {
      const code = await totp(secret, now + offset);
      expect((await verifyTotp(secret, code, { nowMs: now })).ok).toBe(true);
    }
  });

  it('rejects expired codes (older than one step of drift)', async () => {
    const now = 1_700_000_000_000;
    const secret = generateTotpSecret();
    const old = await totp(secret, now - 90_000);
    expect((await verifyTotp(secret, old, { nowMs: now })).ok).toBe(false);
  });

  it('rejects malformed and wrong codes', async () => {
    const secret = generateTotpSecret();
    expect((await verifyTotp(secret, '12345')).ok).toBe(false);
    expect((await verifyTotp(secret, 'abcdef')).ok).toBe(false);
    const real = await totp(secret);
    const wrong = String((Number(real) + 1) % 1_000_000).padStart(6, '0');
    expect((await verifyTotp(secret, wrong, { window: 0 })).ok).toBe(false);
  });

  it('prevents replay of an already-used code', async () => {
    const now = 1_700_000_000_000;
    const secret = generateTotpSecret();
    const code = await totp(secret, now);
    const first = await verifyTotp(secret, code, { nowMs: now });
    expect(first.ok).toBe(true);
    expect((await verifyTotp(secret, code, { nowMs: now, lastUsedStep: first.step })).ok).toBe(false);
  });

  it('generates 160-bit secrets and a Google Authenticator compatible URI', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    const uri = otpauthUri(secret, 'me@example.com');
    expect(uri.startsWith('otpauth://totp/MyVault%3Ame%40example.com?')).toBe(true);
    expect(uri).toContain(`secret=${secret}`);
    expect(uri).toContain('issuer=MyVault');
    expect(uri).toContain('digits=6');
    expect(uri).toContain('period=30');
  });
});
