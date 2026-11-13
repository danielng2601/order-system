# Automated Test Report — ROMS V1.0 (Phase 0 + Phase 1 + Phase 1.5)

**Command:** `npm test` (`node --test tests/*.test.js`)  
**Result:** 25 passed, 0 failed, 0 skipped

## Important Distinction: Mocked vs. Live Integration
- All 25 tests run offline in Node.js (`vm` + `tests/mock_sheets.js`).
- **Mocked:** Google Sheets (`SpreadsheetApp`), `CacheService`, `LockService`, `PropertiesService`, and `Utilities` are simulated in memory.
- **Not yet executed:** Live end-to-end HTTP calls from GitHub Pages to a deployed Google Apps Script Web App against a real Google Sheet (see `LIVE_TEST_CHECKLIST.md`).

## Coverage Matrix

| Suite | Type | Scenarios Covered | Status |
| :--- | :--- | :--- | :--- |
| `tests/phase0.test.js` | Unit + Mocked GAS | Phase 0 files, `appsscript.json`, 9×4 seats, 7 menu prices, `PrinterEnabled=false`, `health`, `METHOD_NOT_ALLOWED` on `GET bootstrap` | Pass (5/5) |
| `tests/validation.test.js` | Unit | Seat ID validation, VND line calculation, `DINE_IN` vs `TAKEAWAY`, client price tampering, `generateOrderId`, `constantTimeEqual` | Pass (5/5) |
| `tests/phase1_backend.test.js` | Integration (Mocked Sheets) | Schema migration, `menu`/`modifiers` auth & prices, validation rejections, `DINE_IN`/`TAKEAWAY` persistence, idempotency, `LockService` contention, `OrderItems` rollback, `AuditLog` | Pass (6/6) |
| `tests/phase1_frontend.test.js` | Unit | `formatVnd`, `escapeHtml` XSS escaping, cart add/edit/duplicate/totals, preserve-on-failure, clear-on-success | Pass (3/3) |
| `tests/phase1_5_hardening.test.js` | Security & Hardening (Mocked GAS/Fetch) | `login` `session_token` & expiry, `GET` credential rejection, unset `STAFF_PASSCODE` fail-closed, malformed/non-object JSON, `AuditLog`/`IdempotencyKeys` rollback, `verifyDatabaseIntegrity()`, frontend offline/non-JSON/`SESSION_EXPIRED` | Pass (6/6) |

## Phase 2.5 Integration Audit Summary (2026-11-13)
- **Automated Node.js + Mocked GAS/Sheets Suite:** **39/39 tests passing** (`npm test`), including 6 new end-to-end integration & fault-injection tests in `tests/phase2_5_audit.test.js`.
- **Distinction:** All automated tests run against `tests/mock_sheets.js` in Node.js `vm`. Live Google Apps Script + Google Sheets + multi-device browser tests remain pending manual execution per `LIVE_TEST_CHECKLIST.md`.
