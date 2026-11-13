# Database Migration & Integrity Guide — ROMS V1.0

## Running Migrations Safely
1. Always run `backupDatabaseToDrive()` in the Apps Script editor before applying a schema update on a live spreadsheet.
2. Run `setupDatabase()` in `backend/src/DbSetup.gs`.
   - Missing sheets are created with frozen header rows.
   - Missing columns are appended to the right of existing headers via `ensureSheetColumns_()` without moving or erasing existing rows.
   - Duplicate headers throw an error immediately to prevent silent column misalignment.
   - `MenuItems`, `Modifiers`, `TablesSeats`, and `Settings` are only seeded if empty; `Settings.SchemaVersion` is updated to `1.1.0`.
3. Run `verifyDatabaseIntegrity()` in `backend/src/DbSetup.gs` and confirm `{ ok: true, errors: [] }`.

## What `verifyDatabaseIntegrity()` Checks
- All 8 required sheets exist and have non-empty, duplicate-free header rows.
- All required columns from `SCHEMA_HEADERS` are present.
- No duplicate primary keys in `MenuItems` (`item_id`), `Modifiers` (`modifier_id`), `TablesSeats` (`seat_id`), or `Orders` (`order_id`).
- All `MenuItems.price_vnd` values are non-negative integers.
- Every `OrderItems.order_id` references an existing `Orders.order_id`.
