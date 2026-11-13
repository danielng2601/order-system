# ROMS V1.0 — Phase 3.5 Production Readiness Audit

## Audit Scope
Full source-code and invariant audit across Phases 0–3:
- `backend/src/`: `Config.gs`, `Validation.gs`, `DbSetup.gs`, `Repository.gs`, `OrderService.gs`, `FloorService.gs`, `PaymentAndLifecycleService.gs`, `HistoryAndReportService.gs`, `PrinterService.gs`, `Code.gs`
- `frontend/`: `index.html`, `css/styles.css`, `js/format.js`, `js/cart.js`, `js/api.js`, `js/sync.js`, `js/app.js`
- `tests/`: `mock_sheets.js` and all 8 test files

## Defects Discovered & Fixed
1. **`handleMoveOrderItem_` allowed moving items on `Paid` orders (`backend/src/FloorService.gs`):**
   - *Cause:* Checked `isActiveOrderStatus_(order.status)` without checking `order.payment_status === 'Paid'`.
   - *Fix:* Added `if (order.payment_status === 'Paid')` guard returning `INVALID_STATE`.
2. **CSV Formula Injection (`frontend/js/format.js`):**
   - *Cause:* `escapeCsvCell()` did not neutralize leading `=`, `+`, `-`, `@`, `\t`, or `\r`.
   - *Fix:* Prefixes formula-triggering cells with `'` before RFC-4180 quoting.
3. **Payment/Cancel Retry After Browser Timeout (`frontend/js/app.js`):**
   - *Cause:* `submitPayment()` and `submitCancelOrder()` generated a new `idempotency_key` on every click, causing retries after a network timeout to fail with `INVALID_STATE` instead of replaying.
   - *Fix:* Persist `state.pendingPayKey` / `state.pendingCancelKey` across retries until success, modal reopen, or payment method change; also added session-expiry handling (`handleSessionErrorIfAny`).
4. **Orders CSV Truncation at 100 Rows (`frontend/js/app.js`):**
   - *Cause:* `exportOrdersCsv()` only requested page 1 (`page_size: 100`).
   - *Fix:* Loops through `totalPages` (up to 10 pages / 1,000 rows).
5. **KPI Card & Bar Chart CSS Mismatch (`frontend/css/styles.css`):**
   - *Cause:* `.kpi-val` did not match `.kpi-value` in `app.js`; `.bar-track` lacked `display: flex`, stacking `CASH` and `BANK` bars vertically; status/payment badges lacked pill padding.
   - *Fix:* Renamed to `.kpi-value`, added `display: flex` to `.bar-track`, improved `.bar-row` grid responsiveness, and styled badge pills.
6. **Reversed Custom Date Range (`backend/src/HistoryAndReportService.gs`):**
   - *Cause:* `date_from > date_to` returned empty results without normalizing.
   - *Fix:* Swaps `dateFrom` and `dateTo` when `dateFrom > dateTo`.
7. **`OrderItems` Integer VND Checks (`backend/src/DbSetup.gs`):**
   - *Cause:* `verifyDatabaseIntegrity()` checked `Orders` totals and `Payments` amounts, but not `OrderItems` integer quantity/topping/VND fields directly.
   - *Fix:* Added explicit integer and non-negative checks on `OrderItems`.
