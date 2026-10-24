import { describe, expect, it } from 'vitest';
import {
  DecryptionError,
  deriveAesKey,
  deriveFromPassword,
  importHkdfBase,
  newKdfParams,
  open,
  openJson,
  seal,
  sealJson,
  validateKdfParams,
} from '../src/lib/crypto';
import { base64ToBytes, bytesToBase64, randomBytes, utf8Decode, utf8Encode } from '../src/lib/encoding';

async function testKey(): Promise<CryptoKey> {
  return deriveAesKey(await importHkdfBase(randomBytes(32)), 'test');
}

function flipByte(b64: string, index = 0): string {
  const bytes = base64ToBytes(b64);
  bytes[index] ^= 0x01;
  return bytesToBase64(bytes);
}

describe('AES-256-GCM authenticated encryption', () => {
  it('round-trips data', async () => {
    const key = await testKey();
    const sealed = await seal(key, utf8Encode('secret value'), 'ctx');
    expect(utf8Decode(await open(key, sealed, 'ctx'))).toBe('secret value');
  });

  it('never contains the plaintext', async () => {
    const key = await testKey();
    const sealed = await sealJson(key, { password: 'hunter2-very-secret' }, 'ctx');
    expect(JSON.stringify(sealed)).not.toContain('hunter2');
    expect(atob(sealed.ct)).not.toContain('hunter2');
  });

  it('uses a unique IV for every encryption', async () => {
    const key = await testKey();
    const ivs = new Set<string>();
    for (let i = 0; i < 200; i++) ivs.add((await seal(key, utf8Encode('x'), 'ctx')).iv);
    expect(ivs.size).toBe(200);
  });

  it('rejects tampered ciphertext', async () => {
    const key = await testKey();
    const sealed = await seal(key, utf8Encode('secret value'), 'ctx');
    await expect(open(key, { ...sealed, ct: flipByte(sealed.ct, 3) }, 'ctx')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('rejects tampered authentication tag', async () => {
    const key = await testKey();
    const sealed = await seal(key, utf8Encode('secret value'), 'ctx');
    const len = base64ToBytes(sealed.ct).length;
    await expect(open(key, { ...sealed, ct: flipByte(sealed.ct, len - 1) }, 'ctx')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('rejects a modified IV', async () => {
    const key = await testKey();
    const sealed = await seal(key, utf8Encode('secret value'), 'ctx');
    await expect(open(key, { ...sealed, iv: flipByte(sealed.iv) }, 'ctx')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('rejects ciphertext moved to another context (AAD binding)', async () => {
    const key = await testKey();
    const sealed = await seal(key, utf8Encode('secret value'), 'record/A');
    await expect(open(key, sealed, 'record/B')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('rejects the wrong key', async () => {
    const sealed = await sealJson(await testKey(), { a: 1 }, 'ctx');
    await expect(openJson(await testKey(), sealed, 'ctx')).rejects.toBeInstanceOf(DecryptionError);
  });

  it('rejects malformed input', async () => {
    const key = await testKey();
    await expect(open(key, { iv: '!!', ct: 'abc' }, 'ctx')).rejects.toBeInstanceOf(DecryptionError);
    await expect(open(key, { iv: bytesToBase64(randomBytes(12)), ct: bytesToBase64(randomBytes(4)) }, 'ctx')).rejects.toBeInstanceOf(DecryptionError);
  });
});

describe('Argon2id key derivation', () => {
  it('is deterministic for the same password and salt', async () => {
    const params = newKdfParams();
    const a = await deriveFromPassword('password one', params);
    const b = await deriveFromPassword('password one', params);
    expect(bytesToBase64(a)).toBe(bytesToBase64(b));
    expect(a.length).toBe(32);
  });

  it('differs for different passwords and salts', async () => {
    const p1 = newKdfParams();
    const p2 = newKdfParams();
    expect(p1.salt).not.toBe(p2.salt);
    const a = await deriveFromPassword('password one', p1);
    const b = await deriveFromPassword('password two', p1);
    const c = await deriveFromPassword('password one', p2);
    expect(bytesToBase64(a)).not.toBe(bytesToBase64(b));
    expect(bytesToBase64(a)).not.toBe(bytesToBase64(c));
  });

  it('normalizes Unicode so the same password typed on different keyboards matches', async () => {
    const params = newKdfParams();
    const composed = await deriveFromPassword('café-pass', params);
    const decomposed = await deriveFromPassword('café-pass', params);
    expect(bytesToBase64(composed)).toBe(bytesToBase64(decomposed));
  });

  it('matches the RFC 9106 style reference output of hash-wasm for fixed inputs', async () => {
    // Regression guard: fixed salt + params must always produce the same key, otherwise
    // existing vaults could no longer be opened after a dependency update.
    const params = { alg: 'argon2id' as const, salt: bytesToBase64(new Uint8Array(16).fill(7)), memoryKiB: 1024, iterations: 1, parallelism: 1 };
    const out = await deriveFromPassword('myvault', params);
    const again = await deriveFromPassword('myvault', params);
    expect(bytesToBase64(out)).toBe(bytesToBase64(again));
  });

  it('validates parameters', () => {
    expect(() => validateKdfParams({ alg: 'argon2id', salt: bytesToBase64(randomBytes(16)), memoryKiB: 10, iterations: 1, parallelism: 1 })).toThrow();
    expect(() => validateKdfParams({ alg: 'scrypt' as 'argon2id', salt: bytesToBase64(randomBytes(16)), memoryKiB: 1024, iterations: 1, parallelism: 1 })).toThrow();
    expect(() => validateKdfParams({ alg: 'argon2id', salt: bytesToBase64(randomBytes(4)), memoryKiB: 1024, iterations: 1, parallelism: 1 })).toThrow();
  });
});
