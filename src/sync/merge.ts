/**
 * Three-way record merge used by synchronization. Pure and deterministic (unit tested).
 *
 * For every record id we compare the local version (L), the remote version (R) and the
 * version both sides last agreed on (base, stored per device after each successful sync):
 *
 *   L == R                      → unchanged
 *   only L / only R             → new on one side → copy to the other
 *   L == base, R changed        → remote edit      → pull R (unless R is an older revision → push L)
 *   R == base, L changed        → local edit       → push L
 *   both changed                → CONFLICT         → resolved by the sync engine without losing data
 *
 * Revision counters (`rev`) protect against stale/rolled-back remote files: an older remote
 * revision never overwrites a newer local one that was already synced.
 */
import type { EncryptedRecord } from '../vault/types';

export interface RecordConflict {
  id: string;
  local: EncryptedRecord;
  remote: EncryptedRecord;
}

export interface MergeResult {
  /** final record set for the remote file (conflicts still hold the local version) */
  merged: Map<string, EncryptedRecord>;
  /** remote records that must be written locally */
  pull: EncryptedRecord[];
  /** ids whose chosen local version must be re-sealed with rev > remote rev before pushing */
  bump: { id: string; minRev: number }[];
  conflicts: RecordConflict[];
  /** true when the remote file differs from `merged` and must be rewritten */
  remoteChanged: boolean;
  pushed: number;
}

export function mergeRecords(
  local: EncryptedRecord[],
  remote: EncryptedRecord[],
  base: Record<string, string>,
): MergeResult {
  const L = new Map(local.map((r) => [r.id, r]));
  const R = new Map(remote.map((r) => [r.id, r]));
  const ids = new Set([...L.keys(), ...R.keys()]);
  const merged = new Map<string, EncryptedRecord>();
  const pull: EncryptedRecord[] = [];
  const bump: { id: string; minRev: number }[] = [];
  const conflicts: RecordConflict[] = [];
  let remoteChanged = false;
  let pushed = 0;

  for (const id of [...ids].sort()) {
    const l = L.get(id);
    const r = R.get(id);
    const b = base[id];

    if (l && !r) {
      merged.set(id, l);
      remoteChanged = true;
      pushed++;
      continue;
    }
    if (r && !l) {
      merged.set(id, r);
      pull.push(r);
      continue;
    }
    if (!l || !r) continue;

    if (l.vtag === r.vtag) {
      merged.set(id, l);
      continue;
    }
    if (l.vtag === b) {
      if (r.rev < l.rev) {
        // Remote went backwards (stale or rolled-back file): keep the newer local revision.
        merged.set(id, l);
        remoteChanged = true;
        pushed++;
      } else {
        merged.set(id, r);
        pull.push(r);
      }
      continue;
    }
    if (r.vtag === b) {
      merged.set(id, l);
      if (l.rev <= r.rev) bump.push({ id, minRev: r.rev + 1 });
      remoteChanged = true;
      pushed++;
      continue;
    }
    conflicts.push({ id, local: l, remote: r });
    merged.set(id, l);
    remoteChanged = true;
  }

  return { merged, pull, bump, conflicts, remoteChanged, pushed };
}

/** Build the per-device base map after a successful sync. */
export function baseFromRecords(records: Iterable<EncryptedRecord>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of records) out[r.id] = r.vtag;
  return out;
}
