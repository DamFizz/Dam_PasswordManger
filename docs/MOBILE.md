# Using MyVault on your phone

MyVault is a Progressive Web App: you install it from the browser and it then opens full-screen like a normal app, works offline, and gets its own home-screen icon. It must be served over **HTTPS** (see DEPLOYMENT.md).

## Try it on your phone right now (same Wi-Fi, no deployment)
Browsers only allow MyVault's encryption on `https://` pages, so a plain `http://192.168…` address shows an "Open MyVault over HTTPS" warning instead of the app. For quick testing, serve it over HTTPS from your PC:

1. On the PC, run:
   ```bash
   npm run dev:phone
   ```
   It prints addresses such as `https://192.168.100.127:5173`. Use the **Wi-Fi** one.
2. If Windows Defender Firewall asks whether Node.js may accept connections, allow it on **Private networks**.
3. On the phone, connected to the same Wi-Fi, open that `https://` address.
4. The phone warns that the certificate is not trusted, because it is a self-signed test certificate:
   * **Android Chrome:** Advanced → Proceed to 192.168… (unsafe)
   * **iPhone Safari:** Show Details → visit this website → Visit Website

This mode is for **testing only**. Installing to the home screen and offline use need a trusted certificate. A vault created at this address is stored under that address and is separate from your real deployed site. For everyday use, deploy it (DEPLOYMENT.md) and open the `https://….pages.dev` address.

## Android (Chrome, Edge, Samsung Internet)
1. Open `https://YOUR-SITE` in **Chrome**.
2. Tap **Install app** in the banner, or **⋮ → Install app / Add to Home screen**.
3. Open MyVault from the home screen and choose **I already have a vault → Download from Google Drive**, or **Restore a backup file**.
4. Optional: **Settings → Security → Unlock with this device** uses your fingerprint or face through a passkey. This needs a recent Chrome and Google Play services. If it is unavailable, MyVault says so instead of enabling a weaker option.

## iPhone / iPad (iOS 16.4+ recommended)
1. Open `https://YOUR-SITE` in **Safari**. Only Safari can add web apps to the Home Screen on older iOS versions.
2. Tap **Share → Add to Home Screen → Add**.
3. Open MyVault **from the Home Screen icon**.
4. Restore your vault (Google Drive or backup file) and unlock.

### iPhone differences to know
* **Separate storage:** an installed Home Screen app and Safari tabs have *separate* storage on iOS. Set up the vault inside the installed app, not in a Safari tab.
* **Google sign-in:** if the Google window does not return to the app, use **Sync → Continue in this window**. The vault locks during sign-in, so unlock again afterwards.
* **Storage eviction:** iOS may delete website data for apps not used for several weeks. MyVault requests persistent storage, but iOS decides. Keep sync enabled or export encrypted backups regularly, so that the phone can always be restored.
* **Face ID unlock** (WebAuthn PRF) needs iOS 18 or newer. On older versions, use the master password.
* **Clipboard clearing:** Safari does not let apps verify clipboard contents, so automatic clearing only happens if you enable "clear even when unverified". iOS also clears the clipboard by itself after a while.

## Moving your vault to the phone without Google
1. On the PC: **Backup & restore → Export encrypted backup** to download a `.myvault` file.
2. Transfer the file to the phone (cable, AirDrop, or a private chat with yourself). It is encrypted, but treat it as sensitive anyway.
3. On the phone: **I already have a vault → Restore a backup file**.

Changes then do not sync automatically. Repeat the process, or set up Google Drive sync.

## Recommended phone settings (Settings → Locking & privacy)
* Lock when app is hidden: **Immediately** or **30 s**
* Auto-lock after inactivity: **2–5 min**
* Clear copied passwords after: **30 s**

## Windows desktop app
In Chrome or Edge, open the site and choose **Install MyVault** in the address bar (or **⋯ → Apps → Install**). MyVault then appears in the Start menu and can be pinned to the taskbar. Windows Hello can be used for **Unlock with this device**.
