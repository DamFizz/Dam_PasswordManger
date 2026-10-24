/** Unbiased cryptographically secure random integers (rejection sampling over Web Crypto). */

/** Uniform integer in [0, max). max must be ≤ 2^32. */
export function secureRandomInt(max: number): number {
  if (!Number.isInteger(max) || max <= 0 || max > 2 ** 32) throw new RangeError('Invalid range');
  if (max === 1) return 0;
  const limit = Math.floor(2 ** 32 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

export function secureChoice<T>(items: readonly T[]): T {
  if (items.length === 0) throw new RangeError('Cannot choose from an empty list');
  return items[secureRandomInt(items.length)];
}

/** Fisher–Yates shuffle using secure randomness (in place). */
export function secureShuffle<T>(items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = secureRandomInt(i + 1);
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
