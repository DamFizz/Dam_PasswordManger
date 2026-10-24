# Architecture and key decisions

## Why a PWA (and not Tauri or Capacitor, for now)

| Requirement | PWA (chosen) | Tauri (desktop) + Capacitor (mobile) |
|---|---|---|
| Windows, Android, iPhone, browsers from one codebase | ✅ one build, one URL | ⚠️ three build pipelines; iOS needs a Mac, Xcode and a $99/yr Apple account to install outside development |
| Free deployment and updates | ✅ static hosting | ⚠️ signing certificates, store review or side-loading |
| Offline | ✅ service worker plus IndexedDB | ✅ |
| Strong crypto | ✅ Web Crypto plus Argon2id (WASM) | ✅ same, or native |
| Biometric unlock | ✅ via WebAuthn PRF, where supported (Windows Hello, Android, iOS 18+) | ✅ broader: OS keystore/Keychain plus biometric APIs on all versions |
| Hardware-backed key storage | ⚠️ only through a passkey PRF | ✅ Android Keystore / iOS Keychain / Windows DPAPI |
| Protection from a compromised web host | ❌ the host serves the code each update | ✅ signed binaries |
| Storage eviction risk | ⚠️ iOS can evict (mitigated by sync and backups) | ✅ app storage is persistent |

**Decision:** the PWA meets every functional requirement with zero cost and the simplest maintenance. The two real advantages of native wrappers are (1) OS keystore biometrics on all OS versions and (2) code signing that removes trust in the web host. The code is structured so the UI and vault layers can be wrapped by Tauri or Capacitor later: `src/vault` and `src/sync` have no DOM dependencies except Web Crypto, IndexedDB and WebAuthn, all available in WebViews. A future native wrapper would add a `quick-unlock` implementation backed by the OS keystore.

## Layers

```
UI (React)  ──►  state/app.ts (in-memory store, actions)  ──►  vault/session.ts (encrypt/decrypt)
                     │                                             │
                     ├─ state/sync-controller.ts ─► sync/engine.ts ┤─► vault/db.ts (IndexedDB, ciphertext)
                     │        └─ sync/drive.ts ─► Google Drive appDataFolder (ciphertext)
                     └─ state/autolock.ts (idle / hidden / cross-tab lock)
```

* `vault/access.ts` is the only module that ever holds the raw vault key. It holds it during unlock, during the second-factor challenge, and during re-authenticated operations, and wipes it afterwards.
* `VaultSession` holds non-extractable subkeys and decrypted records. `lock()` drops them, and the app store is reset to empty values.

## Sync algorithm (see `sync/merge.ts` and `sync/engine.ts`)

The remote file holds `{ header, records[] }`. Each device remembers, per record, the `vtag` both sides last agreed on (the *base*).

For each record id, comparing local L, remote R and base B:

| Case | Action |
|---|---|
| L = R | nothing |
| only L / only R | copy to the other side |
| L = B, R changed | take R (but if R.rev < L.rev, the remote is stale: keep L) |
| R = B, L changed | push L (re-sealed with a higher rev if needed) |
| both changed | **conflict**: identical content → no-op; delete vs edit → keep the edit; otherwise the newest wins at the original id and the other is saved as a "(conflict copy)" with a notice |

Then: verify every pulled record by authenticated decryption, re-check the remote version (retry the whole merge if another device wrote), apply locally (skipping records the user edited during the merge), upload, and store the new base. Header changes (password, TOTP, recovery) use the same three-way logic plus rollback protection.

## Data formats
* `VaultHeader` (vault/types.ts): `format`, `version`, `vaultId`, `rev`, `vtag`, `kdf`, `passwordWrap`, `recoveryWrap?`, `security` (sealed).
* `EncryptedRecord`: `{ id, rev, vtag, iv, ct }`.
* Sync file: `{ format: 'myvault-sync', version, writtenAt, writer, header, records }`.
* Backup: `{ format: 'myvault-backup', version, createdAt, appVersion, kdf, payload: sealed({ header, records }) }`.

## Future: browser autofill extension
A browser extension can reuse `src/vault` and `src/sync` unchanged. The safe design: the extension holds its own unlocked session, never injects into pages automatically, and fills only after the user picks an entry whose stored URL host matches the active tab's host (exact or registrable-domain match).
