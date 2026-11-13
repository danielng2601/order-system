# Deployment Guide — ROMS V1.0

## 1. Google Sheets Database Setup

1. Create a new Google Sheet (e.g., `ROMS_Database_Prod`) in the restaurant owner's Google Drive.
2. Copy the Spreadsheet ID from the URL:
   `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`
3. Keep the Google Sheet private (do not share publicly).

## 2. Google Apps Script Backend Setup

1. Create a standalone Apps Script project at [script.google.com](https://script.google.com) (or via `clasp create --type standalone`).
2. Copy all files from `backend/src/` (`appsscript.json`, `Config.gs`, `Validation.gs`, `DbSetup.gs`, `PrinterService.gs`, `Code.gs`) into the Apps Script project (or copy `backend/.clasp.json.example` to `backend/.clasp.json`, fill in `scriptId`, and run `clasp push`).
3. In Apps Script **Project Settings → Script Properties**, add:
   - `SPREADSHEET_ID`: `<your Google Sheet ID>`
   - `STAFF_PASSCODE`: `<strong passcode for restaurant staff>`
4. In the Apps Script editor, select `setupDatabase` and click **Run** (grant Sheets & Drive permissions when prompted). Verify all 8 sheets are created and seeded.
5. Deploy as Web App (**Deploy → New deployment → Web app**):
   - **Execute as:** `Me` (`USER_DEPLOYING`)
   - **Who has access:** `Anyone` (`ANYONE_ANONYMOUS`)
6. Copy the resulting Web App URL (`https://script.google.com/macros/s/.../exec`).

## 3. Google Drive Automated Backup Trigger

1. In the Apps Script editor, open **Triggers** (clock icon).
2. Add a trigger for `backupDatabaseToDrive`:
   - **Event source:** Time-driven
   - **Type:** Day timer (e.g., 1:00 AM – 2:00 AM `Asia/Ho_Chi_Minh`)
3. Backups are saved in the `ROMS_Backups` folder in Google Drive.

## 4. GitHub Pages Frontend Deployment

1. In the GitHub repository **Settings → Pages**, set **Source** to **GitHub Actions**.
2. Pushing changes under `frontend/` to `main` triggers `.github/workflows/deploy-pages.yml` automatically.
3. For local/initial testing, copy `frontend/js/config.example.js` to `frontend/js/config.js` (gitignored) and set `GAS_WEB_APP_URL`, or paste the GAS Web App URL and Staff Passcode directly in the Phase 0 UI (stored in `sessionStorage` only).
