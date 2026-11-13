# ROMS V1.0 — Phase 3.5 Test Report

## Summary
- **Command:** `npm test` (`node --test tests/*.test.js`)
- **Result:** **48/48 passed** (0 failed, 0 skipped).
- **Syntax Checks:** `node -c frontend/js/*.js` exited `0` on all 6 frontend JS files.
- **Formatting Check:** `git diff --check` exited `0`.

## New Phase 3.5 Audit Tests (`tests/phase3_5_audit.test.js`)
1. **Payment Fault Injection & Selective Seat Release:** Injected failures on `Payments`, `IdempotencyKeys`, and `AuditLog` during `settlePayment`; verified clean rollback, unchanged `SyncRevision`, timeout recovery with same `idempotency_key`, selective release of settled seats (`T1-S1`, `T2-S1`) without affecting `T1-S2`, and rejection of `moveOrderItem` on `Paid` orders.
2. **Concurrent Settlement & Lifecycle Rollback:** Simulated two devices racing with `expected_version=1` (second fails cleanly with `INVALID_STATE`); verified rollback on `AuditLog` failure for `updateOrderItem` and `cancelOrder`.
3. **Date Boundaries & CSV Formula Injection:** Verified `Asia/Ho_Chi_Minh` midnight boundary (`16:59:59Z` → `2026-05-10`, `17:00:00Z` → `2026-05-11`), reversed custom range swap, and neutralization of `=`, `+`, `-`, `@`, `\t` formula prefixes in `buildCsv`.
4. **v1.2.0 → v1.3.0 Migration & Integrity:** Simulated a pre-Phase-3 database with existing `Orders` and `OrderItems`, ran `setupDatabase()`, verified zero data loss, `Payments` creation, `verifyDatabaseIntegrity() === { ok: true, errors: [] }`, and detection of negative `OrderItems.line_total_vnd`.

## Distinction: Mocked vs. Live
All 48 tests run in Node.js against `tests/mock_sheets.js`. Live GAS, Google Sheets, and browser E2E tests have **not** been executed in this environment.
