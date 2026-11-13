# ROMS V1.0 – Database Integrity Report

## 1. Integrity Checker (`verifyDatabaseIntegrity()`)
Implemented in `backend/src/DbSetup.gs` as a **strictly read-only** diagnostic function that inspects all 8 Google Sheets without modifying or silently repairing any user data.

## 2. Verified Invariants
1. **Schema & Headers:** All 8 sheets (`Settings`, `MenuItems`, `Modifiers`, `TablesSeats`, `Orders`, `OrderItems`, `AuditLog`, `IdempotencyKeys`) exist with all required columns and no duplicate headers.
2. **Primary Key Uniqueness:** Unique `item_id`, `modifier_id`, `seat_id`, `order_id`, and `order_item_id`.
3. **Monetary Integrity:** `MenuItems.price_vnd` are non-negative integers; for all non-`Merged` orders, `Orders.total_vnd` equals the sum of `OrderItems.line_total_vnd`.
4. **Table & Seat Integrity:** `DINE_IN` items reference valid `TablesSeats.seat_id` values; `TAKEAWAY` items have empty `seat_id`; `Orders.table_numbers_json` matches the sorted unique table numbers derived from `OrderItems`.
5. **Merge & Split Lineage:**
   - `Merged` source orders must have a valid `merged_into_order_id` referencing an existing `Orders.order_id` and must have **0** `OrderItems` still assigned to them.
   - All `parent_order_ids_json` entries must reference existing `Orders.order_id` records.
6. **Referential Integrity:** Every `OrderItems.order_id` and `IdempotencyKeys.order_id` references an existing `Orders.order_id`.
