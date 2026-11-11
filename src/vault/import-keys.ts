import { DecryptionError, openJson } from '../lib/crypto';
import { wipe } from '../lib/encoding';
import { WrongPasswordError } from './access';
import { aad, deriveVaultKeys, importSecretKey, parseSecretKey, passwordKek, passwordSecretKek, secretKeyId, unwrapVaultKey } from './keys';
import { SecretKeyRequiredError, WrongSecretKeyError } from './secret-key';
import type { EncryptedRecord, RecordPayload, VaultHeader } from './types';

/**
 * Decrypt the records of a vault that is NOT the currently unlocked one (e.g. a backup of
 * another vault) with that vault's master password. Used only for merge-imports; the raw
 * vault key is wiped immediately after the subkeys are derived.
 */
export async function unwrapWithPasswordForImport(
  vault: { header: VaultHeader; records: EncryptedRecord[] },
  password: string,
  /** needed when the backed-up vault uses a Secret Key (format v2) */
  secretKey?: string,
): Promise<RecordPayload[]> {
  const { header } = vault;
  let kek: CryptoKey;
  if (header.secretKey) {
    if (!secretKey) throw new SecretKeyRequiredError(header.vaultId);
    const { raw } = await parseSecretKey(secretKey);
    if ((await secretKeyId(raw, header.vaultId)) !== header.secretKey.id) throw new WrongSecretKeyError();
    kek = await passwordSecretKek(password, header.kdf, header.vaultId, await importSecretKey(raw));
  } else {
    kek = await passwordKek(password, header.kdf, header.vaultId);
  }
  let vk: Uint8Array<ArrayBuffer>;
  try {
    vk = await unwrapVaultKey(kek, header.passwordWrap, header.vaultId, header.secretKey ? 'password-sk' : 'password');
  } catch (e) {
    if (e instanceof DecryptionError) throw new WrongPasswordError('Incorrect master password for this backup');
    throw e;
  }
  const keys = await deriveVaultKeys(vk, header.vaultId);
  wipe(vk);
  const out: RecordPayload[] = [];
  for (const r of vault.records) {
    try {
      out.push(await openJson<RecordPayload>(keys.records, r, aad.record(header.vaultId, r.id, r.rev, r.vtag)));
    } catch {
      /* skip records that fail authentication */
    }
  }
  return out;
}
