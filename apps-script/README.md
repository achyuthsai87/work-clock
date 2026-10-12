# Sheets sync setup (one time)

1. Create a Google Sheet (any name). Extensions > Apps Script.
2. Delete the existing code, paste `Code.gs`, change `SECRET` to a long random string.
3. Deploy > New deployment > type **Web app**. Execute as **Me**, access **Anyone**. Authorize.
4. Copy the **/exec** URL.
5. In Work Clock: Settings > Google Sheets sync > paste URL + the same secret > **Save & test**.

Updating the script later: Deploy > **Manage deployments** > edit > Version: New version
(a brand-new deployment gives a new URL).
