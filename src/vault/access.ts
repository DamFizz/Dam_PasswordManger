/**
 * Vault creation, unlocking and security-sensitive operations.
 *
 * Unlock flow:
 *   1. Throttle check
 *   2. Master password → Argon2id → KEK → unwrap vault key (fails on wrong password: GCM auth)
 *   3. Decrypt security config. If an Authenticator is enrolled, the vault key stays in this
 *      module's closure until a valid TOTP code (or a single-use recovery code) is supplied —
 *      unless this device was trusted after an earlier successful code (see "trusted device").
 *      The trust token is local to this device, MAC'd with a key derived from the vault key,
 *      bound to the device id and the current Authenticator enrollment, and expires.
 *   4. Derive subkeys, wipe the raw vault key, open the session.
 */
import { DecryptionError, newKdfParams, openJson, sealJson } from '../lib/crypto';
import { base64ToBytes, bytesToBase64, randomId, utf8Encode, wipe } from '../lib/encoding';
import { detectClockDrift, verifyTotp } from '../lib/totp';
import type { VaultRepository } from './db';
import { starterCollections } from './defaults';
import { getDevice } from './device';
import {
  aad,
  deriveVaultKeys,
  deviceTrustKey,
  generateRecoveryCodes,
  generateRecoveryKey,
  generateVaultKey,
  hashRecoveryCode,
  importSecretKey,
  parseRecoveryKey,
  parseSecretKey,
  passwordKek,
  passwordSecretKek,
  secretKek,
  secretKeyFromStored,
  secretKeyId,
  secretKeyToStored,
  unwrapVaultKey,
  wrapVaultKey,
} from './keys';
import { forgetSecretKey, kekForHeader, RecoveryKeyRequiredError, rememberSecretKey, type SecretKeySource } from './secret-key';
import { VaultSession } from './session';
import { assertNotThrottled, recordFailure, recordSuccess } from './throttle';
import {
  DEFAULT_VAULT_SETTINGS,
  VAULT_FORMAT,
  VAULT_FORMAT_VERSION,
  VAULT_FORMAT_VERSION_SECRET_KEY,
  type SecurityConfig,
  type TotpSettings,
  type VaultHeader,
} from './types';

export class WrongPasswordError extends Error {
  constructor(message = 'Incorrect master password') {
    super(message);
    this.name = 'WrongPasswordError';
  }
}

export class InvalidCodeError extends Error {
  constructor(
    message = 'Invalid or expired code',
    readonly reason: 'invalid' | 'expired' | 'clock' = 'invalid',
    /** for reason 'clock': how far the authenticator's clock is ahead of this device (seconds) */
    readonly driftSeconds?: number,
  ) {
    super(message);
    this.name = 'InvalidCodeError';
  }
}

/** Build the error for a rejected TOTP code, detecting a wrong device clock when possible. */
async function totpCodeError(secret: string, code: string): Promise<InvalidCodeError> {
  const drift = await detectClockDrift(secret, code);
  if (drift !== null) {
    return new InvalidCodeError(`This device's clock differs from your authenticator by about ${Math.round(Math.abs(drift) / 60)} minute(s).`, 'clock', drift);
  }
  return new InvalidCodeError();
}

export class NoVaultError extends Error {
  constructor() {
    super('No vault exists on this device');
    this.name = 'NoVaultError';
  }
}

const SECOND_FACTOR_TTL_MS = 3 * 60_000;

// ----------------------------------------------------------------------------- creation

export async function createVault(repo: VaultRepository, password: string): Promise<VaultSession> {
  if (await repo.getHeader()) throw new Error('A vault already exists on this device');
  const vaultId = randomId();
  const now = Date.now();
  const vk = generateVaultKey();
  try {
    const kdf = newKdfParams();
    const kek = await passwordKek(password, kdf, vaultId);
    const keys = await deriveVaultKeys(vk, vaultId);
    const security: SecurityConfig = {
      totp: null,
      recoveryCodeHashes: [],
      recoveryCodesCreatedAt: null,
      recoveryKeyCreatedAt: null,
      passwordChangedAt: now,
    };
    const vtag = randomId();
    const header: VaultHeader = {
      format: VAULT_FORMAT,
      version: VAULT_FORMAT_VERSION,
      vaultId,
      createdAt: now,
      rev: 1,
      vtag,
      updatedAt: now,
      kdf,
      passwordWrap: await wrapVaultKey(kek, vk, vaultId, 'password'),
      recoveryWrap: null,
      security: await sealJson(keys.security, security, aad.security(vaultId, 1, vtag)),
    };
    await repo.putHeader(header);
    const device = await getDevice(repo);
    const session = await VaultSession.open(repo, keys, header, security, device);
    await session.saveCollections(starterCollections(now));
    await session.saveSettings({ ...DEFAULT_VAULT_SETTINGS });
    return session;
  } finally {
    wipe(vk);
  }
}

// ----------------------------------------------------------------------------- unlocking

export interface SecondFactorChallenge {
  expiresAt: number;
  /** remaining recovery codes (count only) */
  recoveryCodesLeft: number;
  /** `trustDays` > 0 skips the code on this device for that many days */
  verifyTotp(code: string, trustDays?: number): Promise<VaultSession>;
  useRecoveryCode(code: string): Promise<VaultSession>;
  cancel(): void;
}

export type UnlockStep =
  | { type: 'unlocked'; session: VaultSession; usedRecoveryCode?: boolean }
  | { type: 'second-factor'; challenge: SecondFactorChallenge };

type Finalizer = (vk: Uint8Array<ArrayBuffer>, header: VaultHeader) => Promise<VaultHeader>;

async function openSession(
  repo: VaultRepository,
  vk: Uint8Array<ArrayBuffer>,
  header: VaultHeader,
  security: SecurityConfig,
  finalize?: Finalizer,
): Promise<VaultSession> {
  try {
    let h = header;
    if (finalize) h = await finalize(vk, header);
    const keys = await deriveVaultKeys(vk, h.vaultId);
    const sec = h === header ? security : await openJson<SecurityConfig>(keys.security, h.security, aad.security(h.vaultId, h.rev, h.vtag));
    return await VaultSession.open(repo, keys, h, sec, await getDevice(repo));
  } finally {
    wipe(vk);
  }
}

// ----------------------------------------------------------------------------- trusted device

interface DeviceTrustToken {
  until: number;
  enrolledAt: number;
  mac: string;
}

const trustKeyName = (vaultId: string) => `totpTrust:${vaultId}`;
const trustMessage = (vaultId: string, deviceId: string, enrolledAt: number, until: number) =>
  utf8Encode(`myvault/v1/device-trust/${vaultId}/${deviceId}/${enrolledAt}/${until}`);

async function isDeviceTrusted(repo: VaultRepository, vk: Uint8Array<ArrayBuffer>, header: VaultHeader, totp: TotpSettings): Promise<boolean> {
  const token = await repo.getLocal<DeviceTrustToken>(trustKeyName(header.vaultId));
  if (!token) return false;
  if (token.until <= Date.now() || token.enrolledAt !== totp.enrolledAt) {
    await repo.deleteLocal(trustKeyName(header.vaultId));
    return false;
  }
  try {
    const device = await getDevice(repo);
    const key = await deviceTrustKey(vk, header.vaultId);
    return await crypto.subtle.verify('HMAC', key, base64ToBytes(token.mac), trustMessage(header.vaultId, device.id, token.enrolledAt, token.until));
  } catch {
    return false;
  }
}

async function trustDevice(repo: VaultRepository, vk: Uint8Array<ArrayBuffer>, header: VaultHeader, totp: TotpSettings, days: number): Promise<void> {
  const until = Date.now() + days * 86_400_000;
  const device = await getDevice(repo);
  const key = await deviceTrustKey(vk, header.vaultId);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, trustMessage(header.vaultId, device.id, totp.enrolledAt, until)));
  await repo.setLocal<DeviceTrustToken>(trustKeyName(header.vaultId), { until, enrolledAt: totp.enrolledAt, mac: bytesToBase64(mac) });
}

/** When this device stops skipping the two-step code, or null if it is not trusted. */
export async function deviceTrustedUntil(session: VaultSession): Promise<number | null> {
  const totp = session.security.totp;
  if (!totp) return null;
  const token = await session.repo.getLocal<DeviceTrustToken>(trustKeyName(session.vaultId));
  if (!token || token.until <= Date.now() || token.enrolledAt !== totp.enrolledAt) return null;
  return token.until;
}

/** Ask for the two-step code on this device again from the next unlock. */
export async function forgetDeviceTrust(session: VaultSession): Promise<void> {
  await session.repo.deleteLocal(trustKeyName(session.vaultId));
}

async function decryptSecurity(vk: Uint8Array<ArrayBuffer>, header: VaultHeader): Promise<SecurityConfig> {
  const keys = await deriveVaultKeys(vk, header.vaultId);
  return openJson<SecurityConfig>(keys.security, header.security, aad.security(header.vaultId, header.rev, header.vtag));
}

/** Shared continuation once the vault key has been unwrapped by any primary method. */
async function continueUnlock(
  repo: VaultRepository,
  vk: Uint8Array<ArrayBuffer>,
  header: VaultHeader,
  finalize?: Finalizer,
  allowTrustedDevice = true,
): Promise<UnlockStep> {
  let security: SecurityConfig;
  try {
    security = await decryptSecurity(vk, header);
  } catch (e) {
    wipe(vk);
    throw e;
  }

  if (!security.totp || (allowTrustedDevice && (await isDeviceTrusted(repo, vk, header, security.totp)))) {
    await recordSuccess(repo);
    return { type: 'unlocked', session: await openSession(repo, vk, header, security, finalize) };
  }

  // Second factor required. Keep the key in this closure only, with a short expiry.
  let held: Uint8Array<ArrayBuffer> | null = vk;
  const expiresAt = Date.now() + SECOND_FACTOR_TTL_MS;
  const timer = setTimeout(() => {
    wipe(held);
    held = null;
  }, SECOND_FACTOR_TTL_MS);
  const take = (): Uint8Array<ArrayBuffer> => {
    if (!held || Date.now() > expiresAt) throw new InvalidCodeError('This unlock attempt expired. Please start again.', 'expired');
    return held;
  };
  const release = () => {
    clearTimeout(timer);
    held = null;
  };
  const totpCfg = security.totp;

  const challenge: SecondFactorChallenge = {
    expiresAt,
    recoveryCodesLeft: security.recoveryCodeHashes.length,
    async verifyTotp(code, trustDays = 0) {
      await assertNotThrottled(repo);
      const key = take();
      const replayKey = `totpLastStep:${header.vaultId}`;
      const lastUsedStep = await repo.getLocal<number>(replayKey);
      const res = await verifyTotp(totpCfg.secret, code, { lastUsedStep });
      if (!res.ok) {
        await recordFailure(repo);
        throw await totpCodeError(totpCfg.secret, code);
      }
      await repo.setLocal(replayKey, res.step);
      await recordSuccess(repo);
      if (trustDays > 0) await trustDevice(repo, key, header, totpCfg, trustDays);
      release();
      return openSession(repo, key, header, security, finalize);
    },
    async useRecoveryCode(code) {
      await assertNotThrottled(repo);
      const key = take();
      const hash = await hashRecoveryCode(header.vaultId, code);
      if (!security.recoveryCodeHashes.includes(hash)) {
        await recordFailure(repo);
        throw new InvalidCodeError('Recovery code not recognised or already used');
      }
      await recordSuccess(repo);
      release();
      const session = await openSession(repo, key, header, security, finalize);
      // Consume the code (single use) — this is a synced header change.
      await session.commitHeader((_h, sec) => {
        sec.recoveryCodeHashes = sec.recoveryCodeHashes.filter((h) => h !== hash);
      });
      return session;
    },
    cancel() {
      clearTimeout(timer);
      wipe(held);
      held = null;
    },
  };
  return { type: 'second-factor', challenge };
}

async function requireHeader(repo: VaultRepository): Promise<VaultHeader> {
  const header = await repo.getHeader();
  if (!header) throw new NoVaultError();
  return header;
}

/**
 * Unwrap the raw vault key with the master password (and the Secret Key for format-v2 vaults).
 * Caller owns (and must wipe) the result.
 */
async function unwrapWithPassword(
  repo: VaultRepository,
  header: VaultHeader,
  password: string,
  src: SecretKeySource = {},
): Promise<Uint8Array<ArrayBuffer>> {
  await assertNotThrottled(repo);
  const { kek, purpose, supplied } = await kekForHeader(repo, header, password, src);
  let vk: Uint8Array<ArrayBuffer>;
  try {
    vk = await unwrapVaultKey(kek, header.passwordWrap, header.vaultId, purpose);
  } catch (e) {
    if (e instanceof DecryptionError) {
      await recordFailure(repo);
      throw new WrongPasswordError();
    }
    throw e;
  }
  // A Secret Key typed by the user is kept only once the master password proved correct.
  if (supplied && src.rememberSecretKey !== false) await rememberSecretKey(repo, header.vaultId, supplied);
  return vk;
}

/**
 * For a format-v2 vault the Secret Key comes from this device, or from `opts.secretKey`
 * (typed / scanned). Throws SecretKeyRequiredError when neither is available.
 */
export async function unlockWithPassword(repo: VaultRepository, password: string, opts: SecretKeySource = {}): Promise<UnlockStep> {
  const header = await requireHeader(repo);
  const vk = await unwrapWithPassword(repo, header, password, opts);
  return continueUnlock(repo, vk, header);
}

/** New master-password wrap for `header`, keeping the vault's current mode (v1 or Secret Key). */
async function passwordWrapFor(
  header: VaultHeader,
  security: SecurityConfig,
  password: string,
  vk: Uint8Array<ArrayBuffer>,
  kdf = newKdfParams(),
): Promise<{ kdf: VaultHeader['kdf']; passwordWrap: VaultHeader['passwordWrap'] }> {
  if (!header.secretKey) {
    const kek = await passwordKek(password, kdf, header.vaultId);
    return { kdf, passwordWrap: await wrapVaultKey(kek, vk, header.vaultId, 'password') };
  }
  if (!security.secretKey) throw new Error('Vault is corrupted: the Secret Key copy is missing');
  const kek = await passwordSecretKek(password, kdf, header.vaultId, await importSecretKey(secretKeyFromStored(security.secretKey)));
  return { kdf, passwordWrap: await wrapVaultKey(kek, vk, header.vaultId, 'password-sk') };
}

/** Unlock with a vault key unwrapped by another primary method (e.g. device passkey). */
export async function unlockWithUnwrappedKey(repo: VaultRepository, vk: Uint8Array<ArrayBuffer>): Promise<UnlockStep> {
  const header = await requireHeader(repo);
  return continueUnlock(repo, vk, header);
}

/**
 * Forgotten master password: the emergency recovery key unwraps the vault key and a new
 * master password is set. A mandatory Authenticator is still enforced (TOTP or recovery code).
 */
export async function unlockWithRecoveryKey(
  repo: VaultRepository,
  recoveryKey: string,
  newPassword: string,
  opts: { rememberSecretKey?: boolean } = {},
): Promise<UnlockStep> {
  await assertNotThrottled(repo);
  const header = await requireHeader(repo);
  if (!header.recoveryWrap) throw new Error('No recovery key was set up for this vault');
  let raw: Uint8Array<ArrayBuffer>;
  try {
    raw = parseRecoveryKey(recoveryKey);
  } catch {
    await recordFailure(repo);
    throw new InvalidCodeError('That does not look like a valid recovery key');
  }
  let vk: Uint8Array<ArrayBuffer>;
  try {
    const kek = await secretKek(raw, 'recovery', header.vaultId);
    vk = await unwrapVaultKey(kek, header.recoveryWrap, header.vaultId, 'recovery');
  } catch {
    await recordFailure(repo);
    throw new InvalidCodeError('Recovery key is incorrect');
  } finally {
    wipe(raw);
  }
  return continueUnlock(repo, vk, header, async (key, h) => {
    const keys = await deriveVaultKeys(key, h.vaultId);
    const sec = await openJson<SecurityConfig>(keys.security, h.security, aad.security(h.vaultId, h.rev, h.vtag));
    sec.passwordChangedAt = Date.now();
    // Secret Key vaults: the key is recovered from inside the vault and kept on this device.
    const { kdf, passwordWrap } = await passwordWrapFor(h, sec, newPassword, key);
    if (h.secretKey && sec.secretKey && opts.rememberSecretKey !== false) {
      await rememberSecretKey(repo, h.vaultId, secretKeyFromStored(sec.secretKey));
    }
    const next: VaultHeader = {
      ...h,
      kdf,
      passwordWrap,
      rev: h.rev + 1,
      vtag: randomId(),
      updatedAt: Date.now(),
    };
    next.security = await sealJson(keys.security, sec, aad.security(next.vaultId, next.rev, next.vtag));
    await repo.putHeader(next);
    return next;
  }, false); // a forgotten password always needs the two-step code, even on a trusted device
}

// ----------------------------------------------------------------------------- re-authentication

/**
 * Verify the master password for a sensitive action. Returns the raw vault key, which the
 * callback receives and which is wiped afterwards — it never leaves this function.
 */
export async function withMasterPassword<T>(
  session: VaultSession,
  password: string,
  fn: (vk: Uint8Array<ArrayBuffer>) => Promise<T>,
): Promise<T> {
  const vk = await unwrapWithPassword(session.repo, session.header, password, { stored: session.security.secretKey ?? null });
  try {
    await recordSuccess(session.repo);
    return await fn(vk);
  } finally {
    wipe(vk);
  }
}

/** Plain verification (e.g. before revealing a protected item). */
export async function verifyMasterPassword(session: VaultSession, password: string): Promise<void> {
  await withMasterPassword(session, password, async () => undefined);
}

/** Verify the current second factor during re-authentication for security changes. */
export async function verifySecondFactor(session: VaultSession, code: string): Promise<void> {
  const totpCfg = session.security.totp;
  if (!totpCfg) return;
  await assertNotThrottled(session.repo);
  const replayKey = `totpLastStep:${session.vaultId}`;
  const lastUsedStep = await session.repo.getLocal<number>(replayKey);
  const res = await verifyTotp(totpCfg.secret, code, { lastUsedStep });
  if (res.ok) {
    await session.repo.setLocal(replayKey, res.step);
    await recordSuccess(session.repo);
    return;
  }
  const hash = await hashRecoveryCode(session.vaultId, code);
  if (session.security.recoveryCodeHashes.includes(hash)) {
    await session.commitHeader((_h, sec) => {
      sec.recoveryCodeHashes = sec.recoveryCodeHashes.filter((h) => h !== hash);
    });
    await recordSuccess(session.repo);
    return;
  }
  await recordFailure(session.repo);
  throw await totpCodeError(totpCfg.secret, code);
}

// ----------------------------------------------------------------------------- security changes

export async function changeMasterPassword(session: VaultSession, currentPassword: string, newPassword: string): Promise<void> {
  await withMasterPassword(session, currentPassword, async (vk) => {
    const { kdf, passwordWrap } = await passwordWrapFor(session.header, session.security, newPassword, vk);
    await session.commitHeader((h, sec) => {
      h.kdf = kdf;
      h.passwordWrap = passwordWrap;
      sec.passwordChangedAt = Date.now();
    });
  });
}

/** Step 1 of Authenticator enrollment happens in the UI (secret + QR). Step 2 verifies and stores. */
export async function enableTotp(session: VaultSession, secret: string, code: string): Promise<string[]> {
  const res = await verifyTotp(secret, code);
  if (!res.ok) throw await totpCodeError(secret, code);
  await session.repo.setLocal(`totpLastStep:${session.vaultId}`, res.step);
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map((c) => hashRecoveryCode(session.vaultId, c)));
  const totp: TotpSettings = { secret, digits: 6, period: 30, algorithm: 'SHA1', enrolledAt: Date.now() };
  await session.commitHeader((_h, sec) => {
    sec.totp = totp;
    sec.recoveryCodeHashes = hashes;
    sec.recoveryCodesCreatedAt = Date.now();
  });
  return codes;
}

export async function disableTotp(session: VaultSession): Promise<void> {
  await session.commitHeader((_h, sec) => {
    sec.totp = null;
    sec.recoveryCodeHashes = [];
    sec.recoveryCodesCreatedAt = null;
  });
}

export async function regenerateRecoveryCodes(session: VaultSession): Promise<string[]> {
  const codes = generateRecoveryCodes();
  const hashes = await Promise.all(codes.map((c) => hashRecoveryCode(session.vaultId, c)));
  await session.commitHeader((_h, sec) => {
    sec.recoveryCodeHashes = hashes;
    sec.recoveryCodesCreatedAt = Date.now();
  });
  return codes;
}

/** Create (or replace) the emergency recovery key. Requires the master password. */
export async function createRecoveryKey(session: VaultSession, password: string): Promise<string> {
  return withMasterPassword(session, password, async (vk) => {
    const { display, raw } = generateRecoveryKey();
    try {
      const kek = await secretKek(raw, 'recovery', session.vaultId);
      const recoveryWrap = await wrapVaultKey(kek, vk, session.vaultId, 'recovery');
      await session.commitHeader((h, sec) => {
        h.recoveryWrap = recoveryWrap;
        sec.recoveryKeyCreatedAt = Date.now();
      });
      return display;
    } finally {
      wipe(raw);
    }
  });
}

export async function removeRecoveryKey(session: VaultSession): Promise<void> {
  await session.commitHeader((h, sec) => {
    h.recoveryWrap = null;
    sec.recoveryKeyCreatedAt = null;
  });
}

// ----------------------------------------------------------------------------- Secret Key (format v2)

/**
 * Turn on (or rotate) the Secret Key. `secretKey` is the display form the user has just saved in
 * their Emergency Kit (see generateSecretKey). Requires the master password and an existing
 * recovery key; the UI must also verify the second factor (verifySecondFactor) first.
 * Other devices keep their open session and ask for the Secret Key at their next unlock.
 */
export async function enableSecretKey(
  session: VaultSession,
  password: string,
  secretKey: string,
  opts: { rememberOnDevice?: boolean } = {},
): Promise<void> {
  if (!session.header.recoveryWrap) throw new RecoveryKeyRequiredError();
  const { raw } = await parseSecretKey(secretKey);
  await withMasterPassword(session, password, async (vk) => {
    const kek = await passwordSecretKek(password, session.header.kdf, session.vaultId, await importSecretKey(raw));
    const passwordWrap = await wrapVaultKey(kek, vk, session.vaultId, 'password-sk');
    const id = await secretKeyId(raw, session.vaultId);
    await session.commitHeader((h, sec) => {
      h.version = Math.max(h.version, VAULT_FORMAT_VERSION_SECRET_KEY);
      h.passwordWrap = passwordWrap;
      h.secretKey = { id, createdAt: Date.now() };
      sec.secretKey = secretKeyToStored(raw);
    });
  });
  if (opts.rememberOnDevice === false) await forgetSecretKey(session.repo, session.vaultId);
  else await rememberSecretKey(session.repo, session.vaultId, raw);
}

/** Go back to master-password-only protection of the cloud copy (the header stays version 2). */
export async function disableSecretKey(session: VaultSession, password: string): Promise<void> {
  await withMasterPassword(session, password, async (vk) => {
    const kek = await passwordKek(password, session.header.kdf, session.vaultId);
    const passwordWrap = await wrapVaultKey(kek, vk, session.vaultId, 'password');
    await session.commitHeader((h, sec) => {
      h.passwordWrap = passwordWrap;
      h.secretKey = null;
      sec.secretKey = null;
    });
  });
  await forgetSecretKey(session.repo, session.vaultId);
}

/**
 * The Secret Key of an unlocked vault, for "Add a device" (QR) or a new Emergency Kit.
 * The UI must re-verify the master password and second factor before calling this.
 */
export function currentSecretKey(session: VaultSession): Uint8Array<ArrayBuffer> | null {
  return session.header.secretKey && session.security.secretKey ? secretKeyFromStored(session.security.secretKey) : null;
}
