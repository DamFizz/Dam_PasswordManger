import { DecryptionError, openJson } from '../lib/crypto';
import { wipe } from '../lib/encoding';
import { WrongPasswordError } from './access';
import { aad, deriveVaultKeys, passwordKek, unwrapVaultKey } from './keys';
import type { EncryptedRecord, RecordPayload, VaultHeader } from './types';

/**
 * Decrypt the records of a vault that is NOT the currently unlocked one (e.g. a backup of
 * another vault) with that vault's master password. Used only for merge-imports; the raw
 * vault key is wiped immediately after the subkeys are derived.
 */
export async function unwrapWithPasswordForImport(
  vault: { header: VaultHeader; records: EncryptedRecord[] },
  password: string,
): Promise<RecordPayload[]> {
  const { header } = vault;
  const kek = await passwordKek(password, header.kdf, header.vaultId);
  let vk: Uint8Array<ArrayBuffer>;
  try {
    vk = await unwrapVaultKey(kek, header.passwordWrap, header.vaultId, 'password');
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
