# ROMS V1.0 — Phase 3 Test Report

## Automated Test Summary
- **Command:** `npm test` (`node --test tests/*.test.js`)
- **Result:** **44/44 passed** (0 failed, 0 skipped) across Phases 0–3.
- **Environment:** Node.js `vm` sandbox with `tests/mock_sheets.js` (in-memory Google Sheets, `LockService`, `CacheService`, `PropertiesService`, `Utilities.formatDate` in `+07:00`).

## Phase 3 Coverage (`tests/phase3.test.js`)
1. **Phase 3A (`settlePayment`):**
   - Full `CASH` and `BANK` settlement on `DINE_IN` and `TAKEAWAY` orders.
   - Server-side `amount_vnd` integrity (ignores client-supplied `amount_vnd`).
   - Idempotent replay (`replayed: true`) without duplicate `Payments` rows.
   - Rejection of duplicate payment, invalid method, stale `expected_version`, `Cancelled`/`Merged` orders.
   - Fault-injection rollback on `AuditLog` write failure and clean retry with same `idempotency_key`.
   - Seat release on `getFloorState` and removal from `listActiveOrders` after settlement.
2. **Phase 3B (`updateOrderItem`, `removeOrderItem`, `cancelOrder`):**
   - Item quantity, topping, modifier, note, and seat edits with `unit_price_vnd` snapshot preservation after `MenuItems` price change.
   - Item removal and rejection when removing the last remaining item.
   - Order cancellation with mandatory `cancel_reason`, seat release, and history preservation.
   - `INVALID_STATE` guard on `Paid`, `Cancelled`, and `Merged` orders; `VERSION_CONFLICT` on stale version.
3. **Phase 3C & 3D (History, Reports, CSV):**
   - `listOrderHistory` filtering (`status`, `payment_status`) and pagination.
   - `getReports` exclusion of `Cancelled` and `Merged` source orders, `CASH`/`BANK` totals from `Payments`.
   - `Asia/Ho_Chi_Minh` (`+07:00`) date boundary verification (`2026-05-10T17:30:00Z` → `2026-05-11`).
   - `ROMS_FORMAT.buildCsv` UTF-8 BOM (`\uFEFF`) and RFC-4180 escaping with Vietnamese diacritics.
4. **Phase 3E & 3G (Integrity, Auth, Sync):**
   - `verifyDatabaseIntegrity()` passes on clean Phase 3 DB and detects `Payments.amount_vnd` mismatch.
   - Protected Phase 3 endpoints reject missing tokens and raw `STAFF_PASSCODE`.
   - `SyncRevision` increments on writes and remains stable on reads.

## Not Executed in This Environment
- Live Google Apps Script Web App deployment, live Google Sheets I/O, and live browser UI/tablet interaction tests.
