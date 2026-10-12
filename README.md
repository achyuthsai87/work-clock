# Work Clock

Offline time and earnings tracker. Clock in/out, add shifts manually, see daily/weekly/monthly earnings, export to Excel/JSON.
All data stays on your device (localStorage). Works fully offline once installed.

**Live:** https://achyuthsai87.github.io/work-clock/

## Install on your phone
- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** ⋮ → *Install app*

## Deploy
Static site. Push to `main`; GitHub Pages serves the repo root. Bump `CACHE` in `sw.js` when changing cached assets.

## Google Sheets sync
Two-way backup (device ⇄ your sheet). One-time setup in [`apps-script/README.md`](apps-script/README.md).
After a reinstall: Settings → enter URL + secret → **Save & connect** restores every shift.

## Updating
The app updates itself when opened online (service worker, network-first). No need to delete/reinstall.
If something looks stale: Settings → App → **Update now** (keeps your data).
