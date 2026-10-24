# Connecting Google Drive (free, about 10 minutes, one time)

MyVault syncs through **your own** Google Cloud OAuth client. Nothing is paid, and no MyVault server exists. You need your app's final address first (for example `https://myvault-abc.pages.dev`, see DEPLOYMENT.md). You can also add `http://localhost:5173` to test locally.

## 1. Create a Google Cloud project
1. Open https://console.cloud.google.com/ and sign in with the Google account that will hold your vault.
2. Use the project picker at the top to choose **New project**, name it `MyVault`, and select **Create**.

## 2. Enable the Google Drive API
**APIs & Services → Library**, search for **Google Drive API**, and select **Enable**.

## 3. Configure the OAuth consent screen
**APIs & Services → OAuth consent screen**. In newer consoles this is **Google Auth Platform → Branding / Audience / Data access**.
* User type: **External**.
* App name `MyVault`, plus your email as the support and developer contact.
* **Scopes / Data access:** add `https://www.googleapis.com/auth/drive.appdata` ("See, create, and delete its own configuration data in your Google Drive"). That is the **only** scope MyVault needs.
* **Audience / Test users:** add your own Google account. While the app is in *Testing*, only listed test users can sign in. This is ideal for personal use, and you do not need to publish or verify the app.

## 4. Create the OAuth client
**APIs & Services → Credentials → Create credentials → OAuth client ID**. In newer consoles this is **Google Auth Platform → Clients → Create client**.
* Application type: **Web application**
* **Authorised JavaScript origins:**
  * `https://YOUR-SITE` (for example `https://myvault-abc.pages.dev`)
  * `http://localhost:5173` (optional, for development)
* **Authorised redirect URIs:**
  * `https://YOUR-SITE/oauth-callback.html`
  * `http://localhost:5173/oauth-callback.html` (optional)

Select **Create** and copy the **Client ID**, which looks like `123456789-abc…apps.googleusercontent.com`.

> **Do not use or copy the client secret.** MyVault runs entirely in the browser and never needs it. A client ID is public by design.

## 5. Give MyVault the client ID
Use either option:
* In the app: **Sync → Google OAuth setup → paste the client ID → Save**. This is stored in this browser only, so do it on each device. Or:
* At build time: set `VITE_GOOGLE_CLIENT_ID` (in `.env.local` locally, or as an environment variable in Cloudflare Pages), then rebuild. Every device then has it automatically.

The Sync page shows the exact *origin* and *redirect URI* to register, with copy buttons.

## 6. Connect
1. On your PC: **Sync → Connect Google Drive**, choose your account and allow access. The first sync uploads the encrypted vault.
2. On your phone: install MyVault, choose **I already have a vault → Download from Google Drive**, sign in with the same Google account, then unlock with your **master password** (and Authenticator code if enabled).

## How it behaves
* **Automatic sync** runs after changes (a few seconds later), when you come back online, every 5 minutes while unlocked, and when you unlock.
* **Sign-in duration:** Google gives browser-only apps one-hour sessions without refresh tokens. When the session expires the status shows *Reconnect needed*. Tap **Reconnect**, which is usually one tap with no password. Your vault keeps working offline in the meantime, and changes sync after you reconnect.
* **Pop-up blocked or installed iPhone app:** use **Continue in this window**. The vault locks during sign-in, which is expected because keys live only in memory. Unlock afterwards and the connection is completed.
* **Different vault in the cloud:** MyVault refuses to merge two unrelated vaults. You choose to upload this device's vault (the other one is kept, renamed) or to use the cloud vault here (this device's vault is kept as a snapshot).
* **Disconnect** revokes the token and stops syncing. Neither the local vault nor the cloud copy is deleted. **Delete cloud copy** removes only the Drive file.

## Troubleshooting
| Message | Fix |
|---|---|
| `redirect_uri_mismatch` | The redirect URI must match `https://YOUR-SITE/oauth-callback.html` exactly, including https and with no trailing slash. |
| `access_denied` / "app not verified" | Add your account under *Test users*. On the warning screen choose *Continue*. |
| "Google Drive API is not enabled" | Do step 2 in the same project as the client ID. |
| `origin_mismatch` / `invalid_client` | Add the exact origin (scheme + host + port) under Authorised JavaScript origins. Wait about 5 minutes after saving. |
