# Backup & Rollback Procedures — ROMS V1.0

## 1. Automated & Manual Google Drive Backups (Implemented, Mock-Tested Only)
`backupDatabaseToDrive()` in `backend/src/DbSetup.gs`:
- Requires `ROMS_ENV` to be explicitly `LOCAL`, `STAGING`, or `PRODUCTION` (refuses to create a Drive copy if missing/invalid).
- Locates (or creates) the `ROMS_Backups` folder in Google Drive.
- Copies the **entire** active `<ENV>_SPREADSHEET_ID` spreadsheet (all 9 sheets, values, formulas, and headers) via `DriveApp.getFileById(ss.getId()).makeCopy(...)`.
- Names the backup `<SpreadsheetName>_<ENV>_backup_yyyyMMdd-HHmmss` (`Asia/Ho_Chi_Minh`) so staging and production backups are always distinguishable and cannot collide.
- Returns `{ ok: true, environment, fileId, fileName }` on success, or `{ ok: false, environment, error }` if `ROMS_ENV` is invalid or `DriveApp` fails.
- **Concurrency Note:** `backupDatabaseToDrive()` does **not** acquire `LockService.getScriptLock()`, so scheduled backups should run off-hours (e.g., 1:00 AM – 2:00 AM `Asia/Ho_Chi_Minh`).

### Staging Verification `[REQUIRES OWNER]`
1. Run `backupDatabaseToDrive()` manually in the Staging GAS editor.
2. Confirm `ROMS_Backups/ROMS_Database_Staging_backup_<timestamp>` is created in Google Drive.
3. Configure a daily time-driven trigger (1:00 AM – 2:00 AM `Asia/Ho_Chi_Minh`) before Production launch.

## 2. Database Rollback Procedure (Documented Manual Procedure Only — Not Implemented in Code)
> **Note:** Automated restore is **not** implemented in code and has **not** been executed against a real spreadsheet. The steps below are manual operator procedures:
1. Temporarily invalidate active sessions or pause staff usage (rotate `STAFF_PASSCODE` if needed).
2. Locate the latest clean snapshot in `ROMS_Backups/`.
3. Either:
   - Update `SPREADSHEET_ID` in GAS **Script Properties** to the restored copy's ID, or
   - Restore the backed-up sheet tabs into the target spreadsheet.
4. Run `verifyDatabaseIntegrity()` in GAS and confirm `{ ok: true, errors: [] }`.

## 3. Application Rollback Procedure
- **GAS Backend:** In Apps Script **Deploy → Manage deployments**, edit the active Web App deployment and select the previous known-good version.
- **GitHub Pages Frontend:** Revert the commit on `main` (e.g., `git revert <commit>`) and re-run `.github/workflows/deploy-pages.yml`.
- **Session Invalidation:** Changing `STAFF_PASSCODE` in Script Properties immediately prevents new logins with the old passcode; existing `CacheService` tokens expire within 6 hours (`SESSION_TTL_SECONDS = 21600`).
