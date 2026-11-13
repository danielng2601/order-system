# ROMS V1.0 — Production Readiness & Deployment Sequence

## Readiness Status
- **Code & Mocked Verification:** Internally consistent across Phases 0–4A (**53/53** automated tests passing in Node.js `vm` + mocked Sheets, plus `npm run preflight` passing).
- **Live Validation:** Pending controlled live staging verification against real Google Sheets, Google Apps Script, and target devices (iPad, iPhone, Android, desktop).

## Remaining Known Limitations
- **15-Second Polling Sync:** Multi-device updates propagate via `syncStatus` polling every 15 seconds (not WebSockets). Optimistic `expected_version` prevents silent overwrites.
- **No Offline Queue:** Devices must be online to submit orders, edits, cancellations, or settlements.
- **Single Shared Staff Passcode:** `STAFF_PASSCODE` authenticates all staff devices as `'staff'` without per-user accounts.
- **Printer Disabled:** `PRINTER_ENABLED` remains `false` (Phase 4 hardware integration).

## Recommended Controlled Deployment Sequence
1. **Preflight:** Run `npm test` and `npm run preflight` locally.
2. **Staging First:** Follow [STAGING_DEPLOYMENT_PLAN.md](STAGING_DEPLOYMENT_PLAN.md) and [STAGING_TEST_PLAN.md](STAGING_TEST_PLAN.md) with an isolated staging spreadsheet.
3. **Backup:** If an existing spreadsheet has data, run `backupDatabaseToDrive()` in GAS before deploying (see [BACKUP_AND_ROLLBACK.md](BACKUP_AND_ROLLBACK.md)).
4. **Backend Push:** Copy/push all 11 files in `backend/src/` to the GAS project.
5. **Script Properties:** Confirm `ROMS_ENV`, `SPREADSHEET_ID`, and a strong `STAFF_PASSCODE` are set.
6. **Migrate & Verify:** Run `setupDatabase()` once, then run `verifyDatabaseIntegrity()` and confirm `{ ok: true, errors: [] }`.
7. **Deploy GAS Web App:** Deploy a new version (`Execute as: Me`, `Who has access: Anyone`).
8. **Frontend Publish:** Deploy `frontend/` to GitHub Pages.
9. **Live Verification:** Complete [LIVE_TEST_CHECKLIST.md](LIVE_TEST_CHECKLIST.md) before opening for live restaurant service.
