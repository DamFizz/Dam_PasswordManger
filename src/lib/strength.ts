/**
 * Local, heuristic password strength estimation. It never sends data anywhere.
 * This is an estimate, not a guarantee: it penalises common passwords, repeats, sequences,
 * keyboard walks, dates and dictionary words, then maps the remaining entropy to a 0–4 score.
 */

const COMMON_PASSWORDS = new Set(
  (
    '123456 123456789 12345678 password qwerty 12345 qwerty123 1q2w3e 111111 1234567 123123 1234567890 ' +
    '000000 abc123 password1 iloveyou 1234 qwertyuiop 654321 555555 lovely 7777777 welcome 888888 princess ' +
    'dragon 123qwe sunshine 666666 football monkey charlie aa123456 donald password123 qwe123 admin letmein ' +
    'baseball master shadow michael superman batman trustno1 hello freedom whatever starwars passw0rd ' +
    'zaq12wsx login access flower hottie loveme jordan23 mustang 121212 asdfgh asdfghjkl zxcvbnm 112233 ' +
    'secret google samsung computer internet jesus ninja azerty solo abcdef abcd1234 changeme default ' +
    'root toor test test123 guest pass 1qaz2wsx q1w2e3r4 summer winter spring autumn liverpool chelsea ' +
    'arsenal killer pokemon minecraft fortnite roblox naruto anime soccer hunter ranger buster thomas ' +
    'jennifer jessica ashley daniel andrew joshua michelle matthew hannah amanda nicole family friends ' +
    'malaysia kualalumpur sayang cinta rahsia katalaluan password! p@ssw0rd p@ssword admin123 user123'
  ).split(' '),
);

const DICTIONARY_WORDS = [
  'password', 'passw0rd', 'admin', 'welcome', 'love', 'dragon', 'monkey', 'qwerty', 'letmein', 'football',
  'baseball', 'sunshine', 'master', 'shadow', 'princess', 'secret', 'login', 'hello', 'summer', 'winter',
  'google', 'facebook', 'instagram', 'apple', 'samsung', 'computer', 'internet', 'super', 'star', 'angel',
  'sayang', 'cinta', 'rahsia', 'malaysia', 'iloveyou', 'freedom', 'pokemon', 'gaming', 'player', 'user',
];

const KEYBOARD_ROWS = ['1234567890', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1qaz2wsx3edc4rfv', 'qazwsxedc'];

export interface StrengthResult {
  /** 0 very weak … 4 very strong */
  score: 0 | 1 | 2 | 3 | 4;
  /** estimated effective entropy in bits */
  bits: number;
  label: 'veryWeak' | 'weak' | 'fair' | 'strong' | 'veryStrong';
  warnings: StrengthWarning[];
}

export type StrengthWarning =
  | 'common'
  | 'short'
  | 'repeats'
  | 'sequence'
  | 'keyboard'
  | 'dictionary'
  | 'year'
  | 'singleClass';

function charsetSize(pw: string): number {
  let size = 0;
  if (/[a-z]/.test(pw)) size += 26;
  if (/[A-Z]/.test(pw)) size += 26;
  if (/[0-9]/.test(pw)) size += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) size += 33;
  // Non-ASCII characters widen the space considerably
  if (/[^\x00-\x7f]/.test(pw)) size += 100;
  return Math.max(size, 1);
}

function deleet(s: string): string {
  return s
    .replace(/[@4]/g, 'a')
    .replace(/3/g, 'e')
    .replace(/[1!|]/g, 'i')
    .replace(/0/g, 'o')
    .replace(/[$5]/g, 's')
    .replace(/7/g, 't');
}

export function estimateStrength(password: string): StrengthResult {
  const warnings = new Set<StrengthWarning>();
  if (!password) return { score: 0, bits: 0, label: 'veryWeak', warnings: [] };

  const lower = password.toLowerCase();
  const stripped = lower.replace(/[^a-z]+$/, '').replace(/^[^a-z]+/, '');
  if (COMMON_PASSWORDS.has(lower) || COMMON_PASSWORDS.has(deleet(lower)) || (stripped.length >= 4 && COMMON_PASSWORDS.has(stripped) && password.length < 12)) {
    return { score: 0, bits: 8, label: 'veryWeak', warnings: ['common'] };
  }

  const perChar = Math.log2(charsetSize(password));
  const chars = [...password];
  const costs = new Array<number>(chars.length).fill(perChar);

  // Repeats and simple sequences cost very little to guess
  for (let i = 1; i < chars.length; i++) {
    const a = chars[i - 1].codePointAt(0)!;
    const b = chars[i].codePointAt(0)!;
    if (a === b) {
      costs[i] = 1;
      warnings.add('repeats');
    } else if (Math.abs(a - b) === 1 && /[a-z0-9]/i.test(chars[i]) && /[a-z0-9]/i.test(chars[i - 1])) {
      costs[i] = Math.min(costs[i], 2);
      if (i >= 2 && Math.abs(chars[i - 2].codePointAt(0)! - a) === 1) warnings.add('sequence');
    }
  }

  // Keyboard walks of length ≥ 4
  for (const row of KEYBOARD_ROWS) {
    for (let len = Math.min(row.length, lower.length); len >= 4; len--) {
      for (let start = 0; start + len <= row.length; start++) {
        const walk = row.slice(start, start + len);
        let idx = lower.indexOf(walk);
        if (idx < 0) idx = lower.indexOf([...walk].reverse().join(''));
        if (idx >= 0) {
          warnings.add('keyboard');
          for (let k = idx + 1; k < idx + len; k++) costs[k] = Math.min(costs[k], 1);
        }
      }
    }
  }

  // Dictionary words (including leetspeak variants)
  const normalized = deleet(lower);
  for (const word of DICTIONARY_WORDS) {
    const idx = normalized.indexOf(word);
    if (idx >= 0) {
      warnings.add('dictionary');
      for (let k = idx; k < idx + word.length; k++) costs[k] = 0;
      costs[idx] = 11; // ~ choosing a word from a few thousand common words
    }
  }

  // Years
  const year = /(19|20)\d{2}/.exec(password);
  if (year) {
    warnings.add('year');
    for (let k = year.index; k < year.index + 4; k++) costs[k] = 0;
    costs[year.index] = 7;
  }

  let bits = costs.reduce((a, b) => a + b, 0);
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((r) => r.test(password)).length;
  if (classes === 1 && password.length < 16) warnings.add('singleClass');
  if (password.length < 8) {
    warnings.add('short');
    bits = Math.min(bits, 30);
  } else if (password.length < 12) {
    warnings.add('short');
  }

  bits = Math.round(bits);
  const score: StrengthResult['score'] = bits < 28 ? 0 : bits < 40 ? 1 : bits < 60 ? 2 : bits < 80 ? 3 : 4;
  const labels = ['veryWeak', 'weak', 'fair', 'strong', 'veryStrong'] as const;
  return { score, bits, label: labels[score], warnings: [...warnings] };
}

/** Minimum standard for a master password: fair strength and at least 10 characters. */
export function isAcceptableMasterPassword(password: string): boolean {
  return password.length >= 10 && estimateStrength(password).score >= 2;
}
