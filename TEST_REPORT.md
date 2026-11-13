# Automated Test Report — ROMS V1.0 (Phase 0 + Phase 1)

**Command:** `npm test` (`node --test tests/*.test.js`)  
**Result:** 19 passed, 0 failed, 0 skipped

## Important Distinction: Mocked vs. Live Integration
- All 19 tests run offline in Node.js (`vm` + `tests/mock_sheets.js`).
- **Mocked:** Google Sheets (`SpreadsheetApp`), `LockService`, `PropertiesService`, and `Utilities` are simulated in memory.
- **Not yet executed:** Live end-to-end HTTP calls from GitHub Pages to a deployed Google Apps Script Web App against a real Google Sheet (requires owner-provisioned `SPREADSHEET_ID`, `STAFF_PASSCODE`, and GAS deployment URL).

## Coverage Matrix

| Suite | Scenarios Covered | Status |
| :--- | :--- | :--- |
| `tests/phase0.test.js` | Phase 0 required files, `appsscript.json` (`Asia/Ho_Chi_Minh`, `V8`), 9×4 seats, 7 menu prices, `PrinterEnabled=false`, `health` & fail-closed `bootstrap` | Pass (5/5) |
| `tests/validation.test.js` | Seat ID validation (`T1-S1`..`T9-S4`), VND line calculation with toppings, `DINE_IN` vs `TAKEAWAY` rules, client price tampering, `generateOrderId`, `constantTimeEqual` | Pass (5/5) |
| `tests/phase1_backend.test.js` | Safe schema migration, `menu`/`modifiers` auth & prices, unknown/sold-out/zero/negative/large qty/invalid modifier/invalid seat rejection, multi-item `DINE_IN` persistence, `TAKEAWAY` persistence, idempotency replay, `LockService` contention, partial write rollback, `AuditLog` creation | Pass (6/6) |
| `tests/phase1_frontend.test.js` | `formatVnd`, `escapeHtml` XSS escaping, cart add/edit/duplicate/totals, cart preservation on failure, cart clearing on success | Pass (3/3) |
