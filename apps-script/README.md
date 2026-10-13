# Sheets sync setup (one time)

1. Create a Google Sheet (any name). Extensions > Apps Script.
2. Delete the existing code, paste `Code.gs`, change `SECRET` to a long random string (**16+ characters**; the script refuses to run with the placeholder or a short one).
3. Deploy > New deployment > type **Web app**. Execute as **Me**, access **Anyone**. Authorize.
4. Copy the **/exec** URL.
5. In Work Clock: Settings > Google Sheets sync > paste URL + the same secret > **Save & test**.

Updating the script later: Deploy > **Manage deployments** > edit > Version: New version
(a brand-new deployment gives a new URL).

## What the sheet looks like

- **Shifts** tab: Date, Day, Month, Clock in, Clock out, Hours, Tips, Earned (wages only), newest first, with currency formats. The `id`, `start` and `end` columns are hidden; the app needs them, so don't delete them.
- **Summary** tab (made automatically): hours, tips, earnings (wages, tips kept separate) and shift count per month, plus all-time totals and average pay per hour. It updates itself.
- If you used an older version of the script, its tab is kept as "Shifts (old …)" and a fresh one is created. In the app, tap **Upload all** afterwards.

## Settings and notes

A **Settings** tab keeps your pay rate, weekly goal, payday and unpaid-break settings, and the Shifts tab has a **Note** column. Tap **Restore** (or **Save & connect** on a fresh install) and the app returns to the last version saved in the sheet: shifts, tips, payments, notes and these numbers. Re-paste `Code.gs` and redeploy to get this.

## Rates

The Shifts tab has a **Rate** column: the hourly rate each shift was worked at. A raise only changes new shifts; older ones keep their rate, and a restore brings those rates back. Re-paste `Code.gs` and redeploy to get this.
