# Order Merge, Split & Lifecycle — ROMS V1.0

## Order Lifecycle States
- `Draft` (active)
- `Confirmed` (active)
- `Cancelled` (terminal — cannot add items, move items, merge, or split)
- `Merged` (terminal — source order merged into `merged_into_order_id`; cannot be edited, re-merged, or split)

## Merge Orders (`mergeOrders`)
1. Accepts 2 or more distinct active orders of the same `order_type` (`DINE_IN` or `TAKEAWAY`) with their `expected_version`.
2. Creates a new consolidated destination order (`version = 1`, `parent_order_ids_json = [sourceIds]`).
3. Copies all source items into the destination order preserving `seat_id`, `unit_price_vnd`, `item_name_snapshot`, `modifiers_json`, `topping_units`, `topping_unit_price_vnd`, `line_total_vnd`, and `custom_note`.
4. Marks all source orders `status = 'Merged'` with `merged_into_order_id = destOrderId` and `version + 1`.
5. Records `MERGE_ORDERS` in `AuditLog` and rolls back all writes if any step fails.

## Split Order (`splitOrder`)
1. Accepts `source_order_id`, `expected_version`, and `split_item_ids` (non-empty, no duplicates, must leave at least 1 item in the source order).
2. Creates a new order (`parent_order_ids_json = [source_order_id]`, `version = 1`).
3. Reassigns selected `OrderItems.order_id` rows to the new order without altering prices, snapshots, or `seat_id`.
4. Recomputes totals and `table_numbers_json` for both orders (`sourceTotal + newTotal === originalTotal`).
5. Records `SPLIT_ORDER` in `AuditLog` and rolls back on failure.
