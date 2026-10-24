/**
 * Optional device quick unlock using a platform passkey (Windows Hello, Android biometrics,
 * Face ID / Touch ID) with the WebAuthn PRF extension.
 *
 * The authenticator derives a secret from (credential, salt) inside secure hardware only after
 * user verification. That secret wraps the vault key for THIS device only. If PRF is not
 * supported we refuse to enable the feature rather than storing a weaker key.
 * A mandatory Authenticator (TOTP) is still enforced after a quick unlock.
 */
import type { Sealed } from '../lib/crypto';
import { base64ToBytes, bytesToBase64, bytesToBase64Url, base64UrlToBytes, randomBytes, wipe } from '../lib/encoding';
import { withMasterPassword, unlockWithUnwrappedKey, type UnlockStep } from './access';
import type { VaultRepository } from './db';
import { secretKek, unwrapVaultKey, wrapVaultKey } from './keys';
import type { VaultSession } from './session';

interface QuickUnlockRecord {
  vaultId: string;
  credentialId: string;
  prfSalt: string;
  wrap: Sealed;
  createdAt: number;
}

export class QuickUnlockUnsupportedError extends Error {
  constructor(message = 'This device or browser does not support secure passkey unlock (WebAuthn PRF).') {
    super(message);
    this.name = 'QuickUnlockUnsupportedError';
  }
}

const recordKey = (vaultId: string) => `quickUnlock:${vaultId}`;

type PrfResults = { enabled?: boolean; results?: { first?: BufferSource } };

function prfOutput(cred: Credential | null): Uint8Array<ArrayBuffer> | null {
  if (!cred || !(cred instanceof PublicKeyCredential)) return null;
  const ext = cred.getClientExtensionResults() as { prf?: PrfResults };
  const first = ext.prf?.results?.first;
  if (!first) return null;
  const bytes = first instanceof ArrayBuffer ? new Uint8Array(first) : new Uint8Array((first as ArrayBufferView).buffer.slice(0));
  return bytes as Uint8Array<ArrayBuffer>;
}

export async function isQuickUnlockPossible(): Promise<boolean> {
  try {
    if (typeof PublicKeyCredential === 'undefined' || !window.isSecureContext) return false;
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function getQuickUnlock(repo: VaultRepository, vaultId: string): Promise<QuickUnlockRecord | undefined> {
  return repo.getLocal<QuickUnlockRecord>(recordKey(vaultId));
}

async function evaluatePrf(credentialId: Uint8Array<ArrayBuffer>, salt: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      rpId: location.hostname,
      allowCredentials: [{ id: credentialId, type: 'public-key' }],
      userVerification: 'required',
      timeout: 60_000,
      extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
    },
  });
  const out = prfOutput(assertion);
  if (!out) throw new QuickUnlockUnsupportedError();
  return out;
}

export async function enableQuickUnlock(session: VaultSession, password: string): Promise<void> {
  if (!(await isQuickUnlockPossible())) throw new QuickUnlockUnsupportedError('No platform authenticator (biometrics / device PIN) is available.');
  await withMasterPassword(session, password, async (vk) => {
    const salt = randomBytes(32);
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: randomBytes(32),
        rp: { name: 'MyVault', id: location.hostname },
        user: { id: randomBytes(16), name: `MyVault (${session.device.name})`, displayName: 'MyVault quick unlock' },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 },
          { type: 'public-key', alg: -257 },
        ],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
        timeout: 60_000,
        extensions: { prf: { eval: { first: salt } } } as AuthenticationExtensionsClientInputs,
      },
    });
    if (!cred || !(cred instanceof PublicKeyCredential)) throw new QuickUnlockUnsupportedError();
    const credentialId = new Uint8Array(cred.rawId);
    // Some platforms only return PRF output during an assertion, not at creation.
    let secret = prfOutput(cred) ?? (await evaluatePrf(credentialId, salt));
    try {
      const credId = bytesToBase64Url(credentialId);
      const kek = await secretKek(secret, 'device', session.vaultId);
      const wrap = await wrapVaultKey(kek, vk, session.vaultId, `device:${credId}`);
      const rec: QuickUnlockRecord = { vaultId: session.vaultId, credentialId: credId, prfSalt: bytesToBase64(salt), wrap, createdAt: Date.now() };
      await session.repo.setLocal(recordKey(session.vaultId), rec);
    } finally {
      wipe(secret);
      secret = new Uint8Array(0);
    }
  });
}

export async function disableQuickUnlock(repo: VaultRepository, vaultId: string): Promise<void> {
  await repo.deleteLocal(recordKey(vaultId));
}

export async function quickUnlock(repo: VaultRepository): Promise<UnlockStep> {
  const header = await repo.getHeader();
  if (!header) throw new Error('No vault on this device');
  const rec = await getQuickUnlock(repo, header.vaultId);
  if (!rec) throw new Error('Quick unlock is not set up on this device');
  const secret = await evaluatePrf(base64UrlToBytes(rec.credentialId), base64ToBytes(rec.prfSalt));
  let vk: Uint8Array<ArrayBuffer>;
  try {
    const kek = await secretKek(secret, 'device', header.vaultId);
    vk = await unwrapVaultKey(kek, rec.wrap, header.vaultId, `device:${rec.credentialId}`);
  } finally {
    wipe(secret);
  }
  return unlockWithUnwrappedKey(repo, vk);
}
