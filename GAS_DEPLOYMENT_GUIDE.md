# Google Apps Script Deployment Guide — ROMS V1.0

> **Note:** All steps below that push to GAS or create deployments `[REQUIRES OWNER]` authorization.

## 1. Deployment Layout & Files (`backend/src/`)
- **Canonical Manifest:** `backend/src/appsscript.json` (no root `appsscript.json` exists).
  - `timeZone`: `"Asia/Ho_Chi_Minh"`, `runtimeVersion`: `"V8"`, `webapp.executeAs`: `"USER_DEPLOYING"`, `webapp.access`: `"ANYONE_ANONYMOUS"`.
  - `oauthScopes` is omitted so GAS infers scopes automatically (`SpreadsheetApp`, `DriveApp`, `PropertiesService`, `CacheService`, `LockService`, `Utilities`, `ContentService`).
- **Source Root:** `backend/src/` (configured via `"rootDir": "src"` in `backend/.clasp.json.example`). All `clasp` commands **must** be executed from `backend/`.

All 10 `.gs` files + `appsscript.json` (11 files total) in `backend/src/` must be present in the GAS project:
1. `appsscript.json`
2. `Config.gs` (`PRINTER_ENABLED: false`, `SCHEMA_VERSION: "1.3.0"`)
3. `Validation.gs`
4. `DbSetup.gs`
5. `PrinterService.gs`
6. `Repository.gs`
7. `OrderService.gs`
8. `FloorService.gs`
9. `PaymentAndLifecycleService.gs`
10. `HistoryAndReportService.gs`
11. `Code.gs`

## 2. Deploying via `clasp` or Apps Script Editor `[REQUIRES OWNER]`
1. Create a standalone GAS project named `ROMS_Backend_Staging` at `https://script.google.com`.
2. Copy `backend/.clasp.json.example` to `backend/.clasp.json` (gitignored) and set `"scriptId": "<STAGING_SCRIPT_ID>"`.
3. From `backend/`, push source files:
   ```bash
   clasp push
   ```
   *(Or copy-paste each file in `backend/src/` manually into the Apps Script editor.)*
4. Open **Project Settings → Script Properties** and add:
   - `ROMS_ENV` = `STAGING`
   - `SPREADSHEET_ID` = `<STAGING_SPREADSHEET_ID>`
   - `STAFF_PASSCODE` = `<STAGING_STAFF_PASSCODE>`
5. Initialize and verify the database in the Apps Script editor:
   - Run `setupDatabase()` (grant Google Sheets and Google Drive permissions).
   - Run `verifyDatabaseIntegrity()` and confirm `{ ok: true, errors: [] }`.
6. Deploy Web App (**Deploy → New deployment → Web app**):
   - **Execute as:** `Me` (`USER_DEPLOYING`)
   - **Who has access:** `Anyone` (`ANYONE_ANONYMOUS`)
7. Record the Web App URL (`https://script.google.com/macros/s/<STAGING_DEPLOYMENT_ID>/exec`).

## 3. Smoke-Check Health Endpoint
Open `<STAGING_GAS_WEB_APP_URL>?action=health` and verify:
- `ok: true`
- `data.environment === "STAGING"`
- `data.schemaVersion === "1.3.0"`
- `data.timezone === "Asia/Ho_Chi_Minh"`
- `data.currency === "VND"`
- `data.printerEnabled === false`
