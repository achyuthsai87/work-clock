# Sheets sync setup (one time)

1. Create a Google Sheet (any name). Extensions > Apps Script.
2. Delete the existing code, paste `Code.gs`, change `SECRET` to a long random string (**16+ characters**; the script refuses to run with the placeholder or a short one).
3. Deploy > New deployment > type **Web app**. Execute as **Me**, access **Anyone**. Authorize.
4. Copy the **/exec** URL.
5. In Work Clock: Settings > Google Sheets sync > **Add a sheet** > type a name (or leave it blank to use the file's name), paste the URL and the same secret > **Save & connect**.

## Updating to a newer Code.gs (keeps your data and your /exec URL)

1. In the Apps Script editor, copy your current `SECRET` line somewhere safe (or pick a new secret and re-enter it in the app afterwards).
2. Select everything in the editor, paste the new `Code.gs`, then put your `SECRET` back on the `const SECRET = ...` line.
3. Deploy > **Manage deployments** > the pencil (edit) > Version: **New version** > Deploy. Do not make a new deployment: that gives a new URL.
4. In the app: Settings > Google Sheets sync > **Sync now**.

The script upgrades your existing tabs in place: it adds the new columns (Break, Break paid on Shifts; Gross, Job on Payments) and never deletes data. Old rows keep working; they just have those cells empty.

## What the sheet looks like

- **Shifts** tab: Date, Day, Month, Clock in, Clock out, Hours, Tips, Earned (wages only), newest first, with currency formats. The `id`, `start` and `end` columns are hidden; the app needs them, so don't delete them.
- **Summary** tab (made automatically): hours, tips, earnings (wages, tips kept separate) and shift count per month, plus all-time totals and average pay per hour. It updates itself.
- If you used an older version of the script, its tab is kept as "Shifts (old …)" and a fresh one is created. In the app, tap **Upload all** afterwards.

## Settings and notes

A **Settings** tab keeps your pay rate, weekly goal, payday and unpaid-break settings, and the Shifts tab has a **Note** column. Tap **Restore** (or **Save & connect** on a fresh install) and the app returns to the last version saved in the sheet: shifts, tips, payments, notes and these numbers. Re-paste `Code.gs` and redeploy to get this.

## Rates

The Shifts tab has a **Rate** column: the hourly rate each shift was worked at. A raise only changes new shifts; older ones keep their rate, and a restore brings those rates back. Re-paste `Code.gs` and redeploy to get this.

## Jobs, breaks and payments

- Shifts keep their **Job**, **Break** (minutes) and **Break paid** (1 if the break was paid). Hours already has an unpaid break taken off.
- Payments keep their **Job** (blank = your main job) and **Gross** (if you track take-home pay).
- Your jobs, planned shifts, days off, expenses and pay options are saved on the **AppData** tab as small JSON entries. Leave it alone; **Restore** reads it.
- The Summary tab is for you to read. The app never reads it back.

## More than one sheet (extra backups)

Each Google Sheet has its own script, URL and secret. Repeat the setup above for a second sheet (ideally in another Google account or folder), then in Work Clock tap **Add another sheet** and paste that sheet's URL and secret. Up to 5 sheets.

- The first sheet is the **main** sheet: your shifts are restored from it, and Shortcuts clock-ins are read from it. Open any sheet in the list to rename it, restore from it, make it the main sheet, or remove it.
- Every change goes to all sheets. If one is unreachable its changes wait, and **Sync now** catches it up.
- Names and URLs must be different for each sheet.
