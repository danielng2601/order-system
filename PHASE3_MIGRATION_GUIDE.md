# ROMS V1.0 — Phase 3 Migration Guide

## Schema Changes (`1.2.0` → `1.3.0`)
1. **`Orders` sheet:** Adds 4 new columns at the end of the header row:
   - `payment_method`
   - `cancelled_at`
   - `cancel_reason`
   - `cancelled_by`
2. **`Payments` sheet (new):**
   - Columns: `payment_id`, `order_id`, `amount_vnd`, `payment_method`, `payment_status`, `reference_note`, `created_at`, `created_by`, `idempotency_key`.
3. **`Settings` sheet:** Updates `SchemaVersion` to `1.3.0`.

## Safe Migration Steps
1. Push updated `backend/src/*.gs` files to the Google Apps Script project (`clasp push` or copy into GAS editor).
2. Run `setupDatabase()` once from the GAS editor:
   - `ensureSheetColumns_()` appends missing columns to `Orders` without disturbing existing rows.
   - Creates the `Payments` sheet with frozen header row if absent.
   - Updates `SchemaVersion` to `1.3.0`.
3. Run `verifyDatabaseIntegrity()` from the GAS editor and confirm `{ ok: true, errors: [] }`.
4. Deploy a new GAS Web App version and push updated `frontend/` static files to GitHub Pages.
5. **Backward Compatibility:** Existing Phase 1/2 `Orders` rows with blank `payment_method`, `cancelled_at`, `cancel_reason`, and `cancelled_by` are treated as `''` by `Repository.gs`.
