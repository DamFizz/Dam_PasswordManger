import { VaultDB, VaultRepository } from '../src/vault/db';
import { randomId } from '../src/lib/encoding';

let counter = 0;

/** Fresh, isolated IndexedDB database per test (fake-indexeddb). */
export function freshRepo(): VaultRepository {
  counter++;
  return new VaultRepository(new VaultDB(`myvault-test-${counter}-${randomId()}`));
}

export const STRONG_PASSWORD = 'Correct-Horse-Battery-42!';
