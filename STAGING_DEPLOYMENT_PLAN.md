# Staging Deployment Plan — ROMS V1.0 (Phase 4A)

> **Status:** Preparation complete locally. **No live deployment has been performed.** All steps below that push code or create/modify external Google/GitHub resources require explicit owner authorization.

## 1. Objectives
- Deploy ROMS V1.0 to an isolated **STAGING** environment (separate Google Sheet, separate GAS project/Web App deployment, separate `STAFF_PASSCODE`).
- Verify end-to-end browser ↔ GAS ↔ Google Sheets ↔ Google Drive behavior across iPad, iPhone, Android, and desktop before touching Production.

## 2. Environment Topology
| Component | STAGING | PRODUCTION (Future) |
|---|---|---|
| Frontend | GitHub Pages (`frontend/`, `?env=staging` or `ENV: 'STAGING'`) | GitHub Pages (`?env=production` or `ENV: 'PRODUCTION'`) |
| Backend | Standalone GAS Project (`ROMS_Backend_Staging`) | Standalone GAS Project (`ROMS_Backend_Prod`) |
| Database | Google Sheet (`ROMS_Database_Staging`) | Google Sheet (`ROMS_Database_Prod`) |
| Backups | Google Drive `ROMS_Backups` (`ROMS_Database_Staging_backup_*`) | Google Drive `ROMS_Backups` (`ROMS_Database_Prod_backup_*`) |
| Script Properties | `ROMS_ENV=STAGING`, `SPREADSHEET_ID=<STAGING_SHEET_ID>`, `STAFF_PASSCODE=<STAGING_PASSCODE>` | `ROMS_ENV=PRODUCTION`, `SPREADSHEET_ID=<PROD_SHEET_ID>`, `STAFF_PASSCODE=<PROD_PASSCODE>` |

## 3. Controlled Execution Sequence (Owner-Authorized)
1. **Local Verification (Completed in Phase 4A):**
   - Run `npm test` (`53/53` passing) and `npm run preflight`.
2. **Create Staging Database (`[REQUIRES OWNER]`):**
   - Follow [STAGING_DATABASE_SETUP.md](STAGING_DATABASE_SETUP.md) to create `ROMS_Database_Staging` (private).
3. **Create & Deploy Staging GAS Backend (`[REQUIRES OWNER]`):**
   - Follow [GAS_DEPLOYMENT_GUIDE.md](GAS_DEPLOYMENT_GUIDE.md) to push `backend/src/` (11 files), set Script Properties (`ROMS_ENV=STAGING`, `SPREADSHEET_ID`, `STAFF_PASSCODE`), run `setupDatabase()` and `verifyDatabaseIntegrity()`, and deploy the Staging Web App (`Execute as: Me`, `Who has access: Anyone`).
4. **Configure & Publish Frontend (`[REQUIRES OWNER]`):**
   - Push `main` to GitHub (`git push origin main`) so `.github/workflows/deploy-pages.yml` publishes `frontend/` to GitHub Pages, or test locally against the Staging GAS URL via **Cài đặt** (`sessionStorage`) or `frontend/js/config.js` (gitignored).
5. **Execute Staging Verification (`[REQUIRES OWNER]`):**
   - Complete [STAGING_TEST_PLAN.md](STAGING_TEST_PLAN.md) and [LIVE_TEST_CHECKLIST.md](LIVE_TEST_CHECKLIST.md).
6. **Production Readiness Sign-Off:**
   - Only after all staging checks pass and backups/rollback are verified per [BACKUP_AND_ROLLBACK.md](BACKUP_AND_ROLLBACK.md).
