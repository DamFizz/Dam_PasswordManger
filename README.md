# MyVault

A local-first, end-to-end encrypted personal password manager. It is an installable Progressive Web App (PWA) that runs on Windows, Android, iPhone and any modern browser. It works offline, and it can optionally sync between your devices through **your own** Google Drive with no server of its own.

> **Status:** working and tested (see [What has been verified](#what-has-been-verified)). It has **not** been independently security-audited. Read [docs/SECURITY.md](docs/SECURITY.md) before storing your most important credentials, and keep encrypted backups.

## Features

| Area | What you get |
|---|---|
| Encryption | AES-256-GCM for every record and Argon2id (64 MiB, 3 passes) for the master password. A random 256-bit vault key is wrapped by the password key, with HKDF key separation and AAD binding. Each encryption uses a fresh random IV, so tampering is detected. |
| Unlock | Lock screen first, with no data or metadata shown before unlock. Master password unlock. Optional **Google Authenticator (TOTP)** that is mandatory once enabled. Single-use recovery codes. Emergency recovery key. Optional device unlock with Windows Hello, fingerprint or Face ID through WebAuthn PRF. |
| Locking | Auto-lock after inactivity and when the app is backgrounded. Lock-now button and keyboard shortcut. Locking one tab locks every tab. Throttling after repeated failed attempts. Privacy blur while the app is hidden. |
| Items | Logins (username and email kept separate), secure notes, Wi-Fi, recovery codes, software licences, custom records, custom fields, and recovery email and info. Passwords are hidden by default, can be revealed with a timed auto-hide, and can be copied without being revealed. Each entry can require the master password again. Password history with retention control. |
| Organisation | Categories with icon, colour, pin and order. Unlimited **nested sections**. Tags, favourites, archive, trash with restore and auto-purge, and duplicating entries. Drag items onto the sidebar to move them. Batch move, tag, favourite, archive and trash. Deleting a category never deletes its passwords. |
| Find | Instant search (Ctrl/⌘+K or /) that never searches passwords. Sort by name, modified, added or used. List and grid views. Recently added and recently used (device-local). |
| Generator | Uses a CSPRNG with unbiased rejection sampling. Settings for length, character sets, ambiguous characters and no repeats. Passphrases come from the 2048-word BIP-39 list. Shows an entropy and strength meter, and can save straight into an entry. |
| Security center | Local checks for weak, reused, duplicate, old and incomplete entries, plus a score. Optional HIBP breach check that sends only a 5-character SHA-1 prefix (k-anonymity). |
| Sync | Google Drive `appDataFolder` with the `drive.appdata` scope only, so only ciphertext is uploaded. Three-way merge per record. Conflicts keep both versions. Protection against rollback, concurrent writers and vault mismatches. Automatic and manual sync, plus offline queueing. |
| Backup | Encrypted `.myvault` export using a master or separate password. Restore by merge or replace, with corruption and tamper detection and automatic safety snapshots. CSV import from Bitwarden, Chrome/Edge, Firefox, 1Password, LastPass, KeePass and Proton Pass. |
| UX | Dark by default, light mode, 6 accent colours, English and **Bahasa Melayu**, reduced-motion support, compact density, a phone layout with bottom navigation and a floating add button, toasts with undo, and keyboard shortcuts. |
| PWA | Installable, offline app shell, and a prompt to update (it never silently reloads an open vault). Strict Content-Security-Policy, no trackers or analytics, and no third-party scripts. |

## Quick start (development)

Requirements: Node.js 20+ (tested with Node 24), npm.

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. The app works fully offline and locally without any configuration. Google Drive sync needs a free Google OAuth client ID (see [docs/GOOGLE_DRIVE_SETUP.md](docs/GOOGLE_DRIVE_SETUP.md)). You can paste it in **Sync → Google OAuth setup**, or put it in `.env.local`:

```bash
cp .env.example .env.local
```

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server (http://localhost:5173) |
| `npm run build` | Type-check and production build into `dist/` |
| `npm run preview` | Serve the production build (http://localhost:4173) |
| `npm run dev:phone` | Serve over HTTPS on your Wi-Fi so a phone can test it (self-signed certificate, see docs/MOBILE.md) |
| `npm test` | Unit, integration and UI tests (Vitest + Testing Library, ~10 s) |
| `npm run test:e2e` | End-to-end tests (Playwright) against the production build, desktop and phone viewports. Uses your installed Google Chrome. |
| `npm run typecheck` | TypeScript only |
| `npm run icons` | Regenerate PWA PNG icons from `public/favicon.svg` |

## Deploying and using it on your phone

1. Deploy `dist/` to free static HTTPS hosting. Cloudflare Pages is recommended: [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).
2. Configure Google Drive sync: [docs/GOOGLE_DRIVE_SETUP.md](docs/GOOGLE_DRIVE_SETUP.md).
3. Install on Android and iPhone, and move your vault to the phone: [docs/MOBILE.md](docs/MOBILE.md).

## Project structure

```
src/
  lib/            crypto.ts (AES-GCM, HKDF, Argon2id) · totp.ts (RFC 6238) · generator.ts · strength.ts
                  random.ts · csv.ts · security-analysis.ts · hibp.ts · clipboard.ts · encoding.ts
  vault/          types.ts · keys.ts (key hierarchy) · access.ts (create/unlock/2FA/recovery)
                  session.ts (encrypted CRUD) · db.ts (IndexedDB/Dexie) · backup.ts · quick-unlock.ts
                  throttle.ts · device.ts · defaults.ts · import-keys.ts
  sync/           engine.ts (merge + conflict resolution) · merge.ts · format.ts · drive.ts
                  google-auth.ts (OAuth popup/redirect) · bootstrap.ts (new device) · remote.ts
  state/          app.ts (in-memory store + actions) · sync-controller.ts · autolock.ts · prefs.ts · ui.ts
  i18n/           en.ts · ms.ts (type-checked: every key must exist in both)
  ui/             App, shell (sidebar, top bar, bottom nav), screens (onboarding, lock, sync),
                  views (dashboard, items, generator, security, settings, backup, organize), items, components
public/           oauth-callback.html/js, _headers (security headers), icons
tests/            crypto, TOTP, generator, vault, sync, backup/CSV/security, UI tests
e2e/              Playwright end-to-end test
docs/             ARCHITECTURE, SECURITY (threat model), GOOGLE_DRIVE_SETUP, DEPLOYMENT, MOBILE
```

## What has been verified

**Automated: 84 Vitest tests and 2 Playwright runs, all passing.**

- Crypto: AES-GCM round trip, a unique IV per operation, and rejection of modified ciphertext, tag, IV, wrong key, wrong AAD context and malformed data. Argon2id is deterministic, salt/password-separated and NFC-normalised.
- TOTP: the RFC 4226 and RFC 6238 reference vectors, ±30 s drift, expired-code rejection, replay rejection, and Google Authenticator `otpauth://` URIs.
- Vault: create, lock and unlock after reload. A wrong password is rejected. Throttling kicks in after 5 failures. No plaintext reaches IndexedDB. Tampered records are detected. Item create/edit/trash/restore/purge work with tombstones. Deleting a category keeps its items. Nested sections are re-parented when a parent is deleted.
- Second factor: it is mandatory once enabled, wrong, expired and replayed codes are rejected, recovery codes are single-use, a cancelled challenge cannot be completed, and a forged header cannot bypass it. Changing the master password works. The recovery key resets the password and still requires the Authenticator.
- Sync (against an in-memory Drive stand-in): only ciphertext is uploaded. Covers the PC → phone → PC round trip, the no-op sync, concurrent edits (conflict copy plus notice), delete propagation, edit beating delete, a concurrent writer during sync (retry, no lost update), rollback protection, a password change propagating, refusing a different vault, and skipping tampered remote records.
- Backup: export and replace-restore on a new device, the safety snapshot, wrong password, truncated, tampered and unsupported-version files, merge without overwrite, and merge from a different vault. CSV parsing and mapping (Bitwarden, Chrome) work. Covers the security analysis and the HIBP k-anonymity request format.
- UI (jsdom): full onboarding, adding a login, password masked in the form and the detail view, copy without reveal, reveal and hide, `javascript:` URLs rejected, lock wipes in-memory data, wrong and right unlock.
- End-to-end (real Chrome, production build, real Argon2id cost): vault creation, adding an item, no plaintext in IndexedDB or localStorage, reload locks, unlock, **offline reload and unlock through the service worker**, no horizontal overflow on a phone viewport, and **zero CSP violations**.

**Manually checked in a browser:** Authenticator enrollment (QR generated, code verified, recovery codes shown), the recovery-key screen, locking, the 2-step unlock with a recovery code (the count decreases), every page rendering without console errors, and the phone layout.

**Not verified by me, because it needs your accounts or devices:**
- Real Google Drive sync. The Drive REST client and the OAuth popup/redirect are implemented, but they can only be exercised once you create your OAuth client (the sync *engine* is fully tested against a stand-in).
- WebAuthn PRF device unlock on real hardware (Windows Hello, Android, iOS).
- Installing on a physical Android phone or iPhone.
- Breach check against the live HIBP API (the request format is tested).

## Licence

MIT. Third-party: React, Dexie, hash-wasm, qrcode, lucide-react, @scure/bip39 (BIP-39 word list), Inter and JetBrains Mono fonts (OFL).
