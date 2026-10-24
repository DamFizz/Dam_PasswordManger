# MyVault security design, threat model and limitations

MyVault has **not** been independently audited. This document explains exactly what it protects against and what it does not, so that you can decide how much to trust it.

## 1. Cryptographic design

```
master password ──NFC──► Argon2id(salt 128-bit, 64 MiB, t=3, p=1) ──► 32 bytes
                         └─HKDF-SHA256("myvault/v1/kek/password", vaultId)──► KEK (AES-256-GCM)
KEK ──AES-256-GCM(AAD = wrap/password/vaultId)──► wraps the random 256-bit Vault Key (VK)
VK ──HKDF──► records key · security key · device-local key        (independent, non-extractable)
```

* **Primitives:** Web Crypto AES-256-GCM (96-bit random IV per operation, 128-bit tag), HKDF-SHA-256, SHA-256, HMAC-SHA-1 (TOTP only, as RFC 6238 requires), and Argon2id from `hash-wasm` (WebAssembly). No custom ciphers.
* **Records:** every item, category, section, setting and deletion tombstone is a separate ciphertext. Only `id`, `rev` (revision counter) and `vtag` (random version tag) are visible. These three are bound into the AES-GCM associated data together with the vault id, so a record cannot be swapped, renamed, rolled to another revision or moved into another vault without failing authentication. Titles, URLs, usernames, categories and even the *type* of each record are encrypted.
* **Header:** KDF parameters and salt, the wrapped vault key, the optional recovery-key wrap, and the encrypted *security config* (TOTP secret, recovery-code hashes). The security config is bound to the header's revision and version tag.
* **Versioned formats:** `myvault-vault v1`, `myvault-sync v1` and `myvault-backup v1`. Newer versions are refused rather than misread.
* **Master password change** re-wraps the vault key only. Item ciphertexts stay valid, so other devices keep working after they sync the new header.
* **Recovery key:** 160 random bits, shown once, that wrap the same vault key through HKDF. Anyone holding it can reset the master password, so store it offline.
* **Recovery codes:** 10 single-use codes of 50 bits each. They are stored only as SHA-256 hashes, inside the encrypted security config.
* **Backups** are double-encrypted. The outer layer is Argon2id from the backup password (fresh salt) with AES-GCM over the entire payload, which hides record counts. The inner layer is the vault exactly as stored.
* **Device quick unlock** uses a WebAuthn platform credential with the **PRF extension**. The authenticator derives a secret inside secure hardware after user verification, and that secret wraps the vault key for this device only. If the browser or authenticator does not return a PRF result, the feature refuses to enable. It never stores a weaker key.
* **In memory:** decrypted data exists only in JavaScript memory while unlocked. Raw key bytes are wiped with `Uint8Array.fill(0)` once non-extractable `CryptoKey` objects are derived. JavaScript strings, such as decrypted passwords shown in the UI, cannot be reliably wiped. They become garbage-collectable when the vault locks.

## 2. What is stored where

| Location | Contents |
|---|---|
| IndexedDB `meta` | Vault header (ciphertext and KDF parameters) |
| IndexedDB `records` | Encrypted records |
| IndexedDB `local` | Device id and name, failed-attempt counter, last TOTP step, sync bookkeeping (record ids, random version tags, timestamps), quick-unlock wrap (ciphertext), and *device secrets* encrypted with the vault's device key: Google access token, account email, recently-used timestamps, conflict notices |
| IndexedDB `snapshots` | Encrypted safety copies taken before restores and downloads |
| localStorage | Appearance and timer preferences, generator settings, and the Google OAuth **client ID** (public). No vault data. |
| sessionStorage | Briefly, during the OAuth redirect flow only: the OAuth `state`, and the access token until the vault is unlocked and it is encrypted |
| Google Drive `appDataFolder` | `myvault.vault.json`: header and encrypted records only |

## 3. Threat model

### Protected against
* **Theft of the encrypted vault** (lost laptop or phone without your OS session, a copied browser profile, a compromised Google account, a Google-side leak, stolen backup files). The attacker must brute-force Argon2id. With a strong master password (for example a 5+ word random passphrase) this is infeasible.
* **Tampering** with stored or synced data. Authentication fails and the record is ignored rather than silently accepted (the app shows a "could not be decrypted" warning).
* **Rollback of the cloud file.** Per-record revision counters stop an older remote copy from overwriting newer local data. The newest header revision a device has seen is remembered.
* **Concurrent edits.** Both versions survive (conflict copy), and an edit beats a delete.
* **Shoulder surfing and casual exposure.** Secrets are masked by default and auto-hidden. A fixed-length mask hides the true length. Search never matches passwords. The app is blurred when backgrounded and auto-locks. Optional re-prompt per item.
* **Online guessing through the app.** Throttling applies after 5 failures, with exponential back-off up to 15 minutes.
* **Malicious entries.** Only `http:` and `https:` URLs can be opened, so a synced or imported `javascript:` URL cannot run. React escapes all text. There is no `dangerouslySetInnerHTML`.
* **Third-party code at runtime.** The strict CSP allows `script-src 'self'` only (no inline, no eval except WebAssembly compilation for Argon2). The app has no CDN scripts, analytics, ads or favicon fetching. Google's JavaScript SDK is not loaded either: OAuth uses a plain redirect to Google and back to our own callback page.

### NOT protected against (inherent limits — be aware)
* **Malware, keyloggers or a compromised OS or browser on an unlocked device.** Nothing running in a browser can defend against this.
* **Malicious browser extensions** with access to the MyVault page can read the decrypted DOM. Install MyVault as an app, use a browser profile with few extensions, and keep extensions to ones you trust.
* **A compromised hosting provider or build pipeline.** Whoever controls the files served to you can serve modified code that steals your master password the next time you type it. Host it yourself on an account you control (see DEPLOYMENT.md), keep dependencies pinned (`package-lock.json`), and review updates. The service worker only updates after you click *Update*, but it cannot verify updates cryptographically.
* **Supply-chain attacks on npm dependencies.** Dependencies are few and well known (React, Dexie, hash-wasm, qrcode, lucide-react, @scure/bip39). Run `npm audit` and review lockfile changes.
* **A weak master password.** Argon2id slows guessing but cannot save "password123". The app enforces a minimum strength.

## 4. Google Authenticator (TOTP) — honest limitations

A 6-digit code cannot encrypt anything: it has only about 20 bits and changes every 30 seconds. MyVault therefore:

1. **Always** encrypts the vault with a key derived from the master password.
2. Stores the TOTP secret **encrypted inside the vault**. Unlocking means: password → unwrap vault key (held only in a closure, never exposed) → decrypt the TOTP secret → verify the code → only then open the vault. There is no password-only button. Recovery uses single-use recovery codes, and the recovery key still requires the TOTP or a recovery code.

Because MyVault has **no server**, the second factor is enforced by the app, not by cryptography. Someone who has **both** your master password **and** a copy of the encrypted data can decrypt the vault with their own code without a TOTP code. TOTP in MyVault therefore protects against someone who learned your master password (shoulder-surfed or phished) and tries to open MyVault on your device or with your Google account. It does **not** add cryptographic strength against offline attacks. Your master password must stand on its own.

## 5. Synchronisation and Google

* Scope: `https://www.googleapis.com/auth/drive.appdata` only. MyVault cannot see your Drive files, and the vault file is invisible in Drive's UI.
* Signing in to Google never replaces the master password.
* Browser-only apps receive one-hour access tokens and no refresh tokens. The token is kept encrypted on the device and you reconnect when it expires. It is revoked when you disconnect.
* Metadata visible to Google: file size, modification times, number of records, and per-record revision counters and random tags. No titles, URLs or usernames are visible.
* A small race remains between the version check and the upload (Drive v3 has no compare-and-swap). The merge is idempotent and revision-aware, so the next sync repairs it without data loss.

## 6. Clipboard

Browsers offer no guaranteed clipboard erasure. MyVault clears the clipboard after a configurable delay, and only if it can confirm the clipboard still holds the value it copied. Firefox and Safari do not allow that check, so there MyVault does not clear unless you enable "clear even when unverified". OS clipboard history (Windows Win+V, some phone keyboards) keeps its own copies.

## 7. Recovery — there is no backdoor

If you lose the master password, have no recovery key, and have no backup whose password you know, **the data cannot be recovered by anyone**. This is deliberate. Keep:
* an encrypted backup (`.myvault`) on separate media,
* the printed recovery key and recovery codes, stored apart from your phone.

## 8. Reporting issues

This is a personal project. If you find a vulnerability, fix it in your fork, or open a private advisory if you publish the repository.
