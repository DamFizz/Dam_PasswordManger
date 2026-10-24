# Free deployment

MyVault is a static site. The host only delivers the app files and never receives vault data. PWA installation and service workers require **HTTPS**. Free tiers can change, so no host promises permanent availability. That is fine here: your vault lives on your devices, and a hosting outage only stops *new* devices from loading the app until you redeploy elsewhere.

## Recommended: Cloudflare Pages (free)

Cloudflare Pages honours `public/_headers`, so you get the full security headers (CSP, `frame-ancestors 'none'`, HSTS and others).

### Option A — upload a build from your PC
```bash
npm ci
```
```bash
npm run build
```
```bash
npx wrangler pages deploy dist --project-name myvault
```
The first run opens a browser to log in to your free Cloudflare account. You get `https://myvault-xxxx.pages.dev`.

### Option B — Git integration (automatic builds)
1. Push this folder to a **private** GitHub/GitLab repository.
2. Cloudflare dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. Build command `npm run build`, output directory `dist`, environment variable `NODE_VERSION=22` (or newer). Optionally set `VITE_GOOGLE_CLIENT_ID`.
4. Deploy. Every push redeploys automatically. Review changes before pushing, because whoever can push can change the code your devices run.

After deploying, add the site URL to your Google OAuth client (GOOGLE_DRIVE_SETUP.md, step 4).

## Alternatives
| Host | Notes |
|---|---|
| Netlify (free) | Also honours `public/_headers`. Build `npm run build`, publish `dist`. |
| GitHub Pages | Works, but custom headers are not supported. The CSP still applies through the `<meta>` tag injected at build time, but `frame-ancestors` and HSTS are not sent. Serve from the domain root (e.g. `username.github.io`) or adjust `base` in `vite.config.ts`. |
| Your own PC on the LAN | `npm run preview -- --host` serves over plain HTTP. Phones will not install a PWA or allow WebCrypto/service workers on non-HTTPS origins other than `localhost`, so use this for testing only. |

## Updating
Build and deploy again. Open apps show **"A new version of MyVault is ready → Update"**. Nothing reloads until you choose to.

## Security checklist for your deployment
- [ ] Use an account only you control, with 2FA enabled on the hosting and Git provider.
- [ ] Keep the repository private, or at least review every change.
- [ ] Never commit `.env.local`, backups (`*.myvault`) or CSV exports. `.gitignore` already excludes them.
- [ ] Run `npm audit` before updating dependencies.
