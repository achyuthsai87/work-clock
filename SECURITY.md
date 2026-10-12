# Security notes

Work Clock is a static site: no server, no accounts, no third-party scripts. Data lives in the
browser's `localStorage` on your phone, plus your own Google Sheet if sync is on.

## What the app does to protect you
- **Strict Content-Security-Policy**: only `app.js` from this site may run; injected inline scripts and
  `onerror=` handlers are blocked. Network access is limited to this site and `script.google.com`.
- **All data is validated** (storage, imported backups, sheet replies): bad IDs, impossible times and
  oversized values are dropped, so crafted data can't inject HTML or script.
- **Backups never include** the sync URL or secret, and **importing a backup never changes** sync/lock settings.
- **Sync URL must be a real `script.google.com/.../exec` URL**; secret must be 16+ characters.
- **Anti-framing**: the app refuses to run inside another site's frame (clickjacking).
- **Service worker** only caches successful same-origin files and never touches cross-origin traffic.
- **Optional app lock** (Settings → Privacy & security): Face ID / device passcode, covers the app in the
  app switcher. It stops casual snooping on an unlocked phone; it is not a substitute for your phone passcode.
- **Apps Script backend**: refuses the placeholder/weak secret, constant-time secret check, delays wrong guesses,
  validates every field, caps request sizes, writes plain text only (no spreadsheet formulas), leaks no errors.

## What YOU should do (the biggest remaining risk is your GitHub account)
Anyone who can push to this repo can change the code your phone runs. Protect it:
1. Turn on **two-factor authentication** (a passkey or authenticator app) for your GitHub account.
2. Keep the repo's **Settings → Branches → protect `main`** (optional) and review any access tokens/apps at
   Settings → Applications.
3. Keep your Apps Script **SECRET** long and random, and never paste it into the repo or share screenshots of it.
4. Lock your phone with a passcode / Face ID. Anyone who can unlock the phone can open any app on it.

## Limits (honest)
- A web app can't read other apps or "hack" your phone: iOS sandboxes it. Risks are to *this app's data*.
- `localStorage` isn't encrypted; protection relies on the phone's own encryption and passcode.
- The Sheets URL isn't secret; the SECRET is what protects it. Rotate the secret if you ever suspect a leak.
- Report issues by opening a private GitHub security advisory on this repo.
