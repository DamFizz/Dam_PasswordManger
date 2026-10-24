import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  AMBIGUOUS,
  CHARSETS,
  DEFAULT_PASSWORD_OPTIONS,
  generatePassphrase,
  generatePassword,
  passphraseEntropy,
  PASSPHRASE_WORDLIST,
} from '../src/lib/generator';
import { secureRandomInt } from '../src/lib/random';
import { estimateStrength, isAcceptableMasterPassword } from '../src/lib/strength';

afterEach(() => vi.restoreAllMocks());

describe('password generator', () => {
  it('never uses Math.random', () => {
    const spy = vi.spyOn(Math, 'random');
    for (let i = 0; i < 50; i++) generatePassword(DEFAULT_PASSWORD_OPTIONS);
    generatePassphrase({ words: 6, separator: '-', capitalize: true, includeNumber: true });
    expect(spy).not.toHaveBeenCalled();
  });

  it('respects length and includes every selected class', () => {
    for (let i = 0; i < 100; i++) {
      const pw = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 16 });
      expect(pw).toHaveLength(16);
      expect(/[A-Z]/.test(pw)).toBe(true);
      expect(/[a-z]/.test(pw)).toBe(true);
      expect(/[0-9]/.test(pw)).toBe(true);
      expect([...pw].some((c) => CHARSETS.symbols.includes(c))).toBe(true);
    }
  });

  it('only uses selected character types', () => {
    const pw = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, upper: false, symbols: false, length: 64, avoidRepeats: false });
    expect(pw).toMatch(/^[a-z0-9]+$/);
  });

  it('excludes ambiguous characters when asked', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 40, excludeAmbiguous: true, avoidRepeats: false });
      expect([...pw].some((c) => AMBIGUOUS.has(c))).toBe(false);
    }
  });

  it('avoids repeated characters where practical', () => {
    for (let i = 0; i < 50; i++) {
      const pw = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 20, avoidRepeats: true });
      expect(new Set(pw).size).toBe(pw.length);
    }
    // Pool too small for uniqueness: still no consecutive repeats
    const digits = generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, upper: false, lower: false, symbols: false, length: 30, avoidRepeats: true, excludeAmbiguous: false });
    for (let i = 1; i < digits.length; i++) expect(digits[i]).not.toBe(digits[i - 1]);
  });

  it('throws when no character type is selected', () => {
    expect(() => generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, upper: false, lower: false, digits: false, symbols: false })).toThrow();
  });

  it('clamps length', () => {
    expect(generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 1 })).toHaveLength(4);
    expect(generatePassword({ ...DEFAULT_PASSWORD_OPTIONS, length: 1000, avoidRepeats: false })).toHaveLength(128);
  });
});

describe('passphrase generator', () => {
  it('uses the 2048-word list and the requested format', () => {
    expect(PASSPHRASE_WORDLIST).toHaveLength(2048);
    const phrase = generatePassphrase({ words: 5, separator: '.', capitalize: false, includeNumber: false });
    const words = phrase.split('.');
    expect(words).toHaveLength(5);
    for (const w of words) expect(PASSPHRASE_WORDLIST).toContain(w);
  });

  it('adds a digit and capitalises when asked', () => {
    const phrase = generatePassphrase({ words: 4, separator: '-', capitalize: true, includeNumber: true });
    expect(phrase).toMatch(/\d/);
    for (const w of phrase.split('-')) expect(w[0]).toBe(w[0].toUpperCase());
  });

  it('reports entropy', () => {
    expect(passphraseEntropy({ words: 6, separator: '-', capitalize: false, includeNumber: false })).toBe(66);
  });
});

describe('secureRandomInt', () => {
  it('stays in range and covers all values', () => {
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = secureRandomInt(7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(7);
      seen.add(v);
    }
    expect(seen.size).toBe(7);
  });
});

describe('strength estimation', () => {
  it('flags common and short passwords as very weak', () => {
    expect(estimateStrength('password').score).toBe(0);
    expect(estimateStrength('123456').score).toBe(0);
    expect(estimateStrength('P@ssw0rd').score).toBe(0);
    expect(estimateStrength('abc').score).toBe(0);
  });
  it('penalises patterns', () => {
    expect(estimateStrength('qwertyuiop123').score).toBeLessThanOrEqual(1);
    expect(estimateStrength('aaaaaaaaaaaa').score).toBe(0);
    expect(estimateStrength('Summer2024!').score).toBeLessThanOrEqual(2);
  });
  it('rates generated passwords as very strong', () => {
    expect(estimateStrength(generatePassword(DEFAULT_PASSWORD_OPTIONS)).score).toBe(4);
  });
  it('enforces a sensible master password minimum', () => {
    expect(isAcceptableMasterPassword('short1!')).toBe(false);
    expect(isAcceptableMasterPassword('password123')).toBe(false);
    expect(isAcceptableMasterPassword('Correct-Horse-Battery-42!')).toBe(true);
  });
});
