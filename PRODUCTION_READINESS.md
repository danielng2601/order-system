# ROMS V1.0 — Production Readiness & Deployment Sequence

## Readiness Status
- **Code & Mocked Verification:** Internally consistent across Phases 0–3.5 (**48/48** automated tests passing in Node.js `vm` + mocked Sheets).
- **Live Validation:** Pending controlled live staging verification against real Google Sheets, Google Apps Script, and target devices (iPad, iPhone, Android, desktop).

## Remaining Known Limitations
- **15-Second Polling Sync:** Multi-device updates propagate via `syncStatus` polling every 15 seconds (not WebSockets). Optimistic `expected_version` prevents silent overwrites.
- **No Offline Queue:** Devices must be online to submit orders, edits, cancellations, or settlements.
- **Single Shared Staff Passcode:** `STAFF_PASSCODE` authenticates all staff devices as `'staff'` without per-user accounts.
- **Printer Disabled:** `PRINTER_ENABLED` remains `false` (Phase 4).

## Recommended Controlled Deployment Sequence
1. **Backup:** If an existing spreadsheet has data, run `backupDatabaseToDrive()` in GAS before deploying.
2. **Backend Push:** Copy/push all 11 files in `backend/src/` to the GAS project.
3. **Script Properties:** Confirm `SPREADSHEET_ID` and a strong `STAFF_PASSCODE` are set.
4. **Migrate & Verify:** Run `setupDatabase()` once, then run `verifyDatabaseIntegrity()` and confirm `{ ok: true, errors: [] }`.
5. **Deploy GAS Web App:** Deploy a new version (`Execute as: Me`, `Who has access: Anyone`).
6. **Frontend Publish:** Deploy `frontend/` to GitHub Pages.
7. **Staging Verification:** Complete [LIVE_TEST_CHECKLIST.md](LIVE_TEST_CHECKLIST.md) before opening for live restaurant service.
