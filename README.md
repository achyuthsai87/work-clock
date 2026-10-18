# Work Clock

Offline time and earnings tracker. Clock in/out, add shifts manually, see daily/weekly/monthly earnings, export to Excel/JSON.
All data stays on your device (localStorage). Works fully offline once installed.

**Live:** https://achyuthsai87.github.io/work-clock/

## Install on your phone
- **iPhone (Safari):** Share → *Add to Home Screen*
- **Android (Chrome):** ⋮ → *Install app*

## Deploy
Static site. Push to `main`; GitHub Pages serves the repo root. Bump `CACHE` in `sw.js` when changing cached assets.

## What's in the app
- **Clock:** tap Clock In and a full-screen timer opens (Clock Out, or Minimise to get back to Home).
- **Calendar:** tap a day to add a shift, plan one (one day, or repeating weekly) or mark a day off. Planned shifts clock you in and out by themselves when you open the app. Days off are left out of averages and the on-pace projection.
- **Jobs:** extra jobs with their own hourly rate. The main job uses the Pay rate. Pick the job on Home before clocking in; History and Analytics can filter by job.
- **Premium rates:** a weekend % on new shifts, and a per-shift rate for holidays (edit the shift).
- **History:** search notes, dates and amounts, and filter by month or job.
- **Analytics:** tip yield (tips per hour by weekday and time of day).
- **Pay:** tax set-aside (a % of wages and tips) and expenses / mileage. Both stay at zero until you use them.
- **Backup:** every change syncs to your sheet; the app also asks iOS to keep its storage and reminds you to back up if sync is off.

## Google Sheets sync
Two-way backup (device ⇄ your sheet). One-time setup in [`apps-script/README.md`](apps-script/README.md).
After a reinstall: Settings → enter URL + secret → **Save & connect** restores every shift.

## Updating
The app updates itself when opened online (service worker, network-first). No need to delete/reinstall.
If something looks stale: Settings → App → **Update now** (keeps your data).

## Security
See [SECURITY.md](SECURITY.md). After updating `apps-script/Code.gs`, set a **16+ character** `SECRET` and redeploy (Manage deployments → New version).

## Clock in / out from an iPhone Shortcut

The sheet script accepts `punch` requests, so the free built-in Shortcuts app can clock you in and out (for example when you arrive at or leave work, or from the Action Button or a Lock Screen widget). Nothing leaves your phone except a request to **your own** script.

1. Paste the latest `Code.gs` into your Apps Script and deploy a new version.
2. In Shortcuts, make two shortcuts, **Clock In** and **Clock Out**. Each is one **Get Contents of URL** action: your web app URL, method **POST**, request body **JSON** with three text fields: `action` = `punch`, `kind` = `in` (or `out`), `secret` = your secret.
3. Optional: in Shortcuts → Automation, add **Arrive** / **Leave** at your workplace and run the shortcut.
4. Open Work Clock (Auto-sync on). The shift starts or ends at the exact time the request reached the script. The script keeps a hidden **Punches** tab until the app has picked them up.

A web app can't run while it's closed, so the shift appears the next time you open Work Clock. Hours are still counted from the real time.
