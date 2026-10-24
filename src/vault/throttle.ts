import type { VaultRepository } from './db';

/**
 * Failed-attempt throttling for unlock, second-factor and re-authentication attempts.
 * After 5 consecutive failures each further failure doubles a lockout window
 * (30 s, 60 s, 2 min … capped at 15 min). State is per device.
 *
 * Note: this slows guessing through the app UI only. Offline attacks against stolen
 * ciphertext are slowed by Argon2id, not by this counter.
 */
const KEY = 'throttle';
const FREE_ATTEMPTS = 5;
const BASE_MS = 30_000;
const MAX_MS = 15 * 60_000;

interface ThrottleState {
  failures: number;
  lockedUntil: number;
}

export class ThrottledError extends Error {
  constructor(readonly retryAt: number) {
    super('Too many attempts. Please wait before trying again.');
    this.name = 'ThrottledError';
  }
}

export async function assertNotThrottled(repo: VaultRepository, now = Date.now()): Promise<void> {
  const s = await repo.getLocal<ThrottleState>(KEY);
  if (s && s.lockedUntil > now) throw new ThrottledError(s.lockedUntil);
}

export async function recordFailure(repo: VaultRepository, now = Date.now()): Promise<ThrottleState> {
  const s = (await repo.getLocal<ThrottleState>(KEY)) ?? { failures: 0, lockedUntil: 0 };
  const failures = s.failures + 1;
  let lockedUntil = 0;
  if (failures >= FREE_ATTEMPTS) {
    const ms = Math.min(MAX_MS, BASE_MS * 2 ** (failures - FREE_ATTEMPTS));
    lockedUntil = now + ms;
  }
  const next = { failures, lockedUntil };
  await repo.setLocal(KEY, next);
  return next;
}

export async function recordSuccess(repo: VaultRepository): Promise<void> {
  await repo.deleteLocal(KEY);
}

export async function getThrottleState(repo: VaultRepository): Promise<ThrottleState> {
  return (await repo.getLocal<ThrottleState>(KEY)) ?? { failures: 0, lockedUntil: 0 };
}
