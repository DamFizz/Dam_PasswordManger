/**
 * Password and passphrase generation. All randomness comes from crypto.getRandomValues via
 * secureRandomInt (rejection sampling, no modulo bias). Math.random is never used.
 */
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { secureRandomInt, secureShuffle } from './random';

export const CHARSETS = {
  upper: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower: 'abcdefghijklmnopqrstuvwxyz',
  digits: '0123456789',
  symbols: '!@#$%^&*()-_=+[]{};:,.?/~',
} as const;

/** Characters easily confused with each other when read or typed by hand. */
export const AMBIGUOUS = new Set('Il1O0o|`\'"5S2Z8B'.split(''));

export interface PasswordOptions {
  length: number;
  upper: boolean;
  lower: boolean;
  digits: boolean;
  symbols: boolean;
  excludeAmbiguous: boolean;
  avoidRepeats: boolean;
}

export const DEFAULT_PASSWORD_OPTIONS: PasswordOptions = {
  length: 20,
  upper: true,
  lower: true,
  digits: true,
  symbols: true,
  excludeAmbiguous: true,
  avoidRepeats: true,
};

export const MIN_LENGTH = 4;
export const MAX_LENGTH = 128;

function classPools(opts: PasswordOptions): string[][] {
  const pools: string[][] = [];
  for (const key of ['upper', 'lower', 'digits', 'symbols'] as const) {
    if (!opts[key]) continue;
    let chars = CHARSETS[key].split('');
    if (opts.excludeAmbiguous) chars = chars.filter((c) => !AMBIGUOUS.has(c));
    pools.push(chars);
  }
  return pools;
}

export function passwordPoolSize(opts: PasswordOptions): number {
  return classPools(opts).reduce((n, p) => n + p.length, 0);
}

/** Approximate entropy in bits of a password produced with these options. */
export function generatedPasswordEntropy(opts: PasswordOptions): number {
  const pool = passwordPoolSize(opts);
  return pool > 1 ? opts.length * Math.log2(pool) : 0;
}

/**
 * Generate a password containing at least one character of every selected class.
 * Uses rejection sampling over uniformly random candidates, so every valid password is
 * equally likely. With `avoidRepeats`, no character is reused when the pool is large enough;
 * otherwise only consecutive repeats are avoided.
 */
export function generatePassword(input: PasswordOptions): string {
  const opts = { ...input, length: Math.min(MAX_LENGTH, Math.max(MIN_LENGTH, Math.floor(input.length))) };
  const pools = classPools(opts);
  if (pools.length === 0) throw new Error('Select at least one character type');
  const all = pools.flat();
  const classes = pools.map((p) => new Set(p));
  const noReuse = opts.avoidRepeats && all.length >= opts.length * 2;

  for (let attempt = 0; attempt < 10000; attempt++) {
    let chars: string[];
    if (noReuse) {
      chars = secureShuffle([...all]).slice(0, opts.length);
    } else {
      chars = [];
      while (chars.length < opts.length) {
        const c = all[secureRandomInt(all.length)];
        if (opts.avoidRepeats && chars[chars.length - 1] === c) continue;
        chars.push(c);
      }
    }
    if (opts.length >= classes.length && !classes.every((set) => chars.some((c) => set.has(c)))) continue;
    return chars.join('');
  }
  throw new Error('Could not generate a password with these settings');
}

export interface PassphraseOptions {
  words: number;
  separator: string;
  capitalize: boolean;
  includeNumber: boolean;
}

export const DEFAULT_PASSPHRASE_OPTIONS: PassphraseOptions = {
  words: 5,
  separator: '-',
  capitalize: true,
  includeNumber: true,
};

export const PASSPHRASE_WORDLIST: readonly string[] = wordlist;

/** Entropy in bits: log2(2048) = 11 bits per word, plus the digit and its position. */
export function passphraseEntropy(opts: PassphraseOptions): number {
  let bits = opts.words * Math.log2(PASSPHRASE_WORDLIST.length);
  if (opts.includeNumber) bits += Math.log2(10 * opts.words);
  return bits;
}

/** Diceware-style passphrase from the 2048-word BIP-39 English list (unique, unambiguous words). */
export function generatePassphrase(input: PassphraseOptions): string {
  const count = Math.min(12, Math.max(3, Math.floor(input.words)));
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    let w = PASSPHRASE_WORDLIST[secureRandomInt(PASSPHRASE_WORDLIST.length)];
    if (input.capitalize) w = w[0].toUpperCase() + w.slice(1);
    words.push(w);
  }
  if (input.includeNumber) {
    const idx = secureRandomInt(count);
    words[idx] = words[idx] + String(secureRandomInt(10));
  }
  return words.join(input.separator);
}
