# ROMS V1.0 — Order Editing & Cancellation (Phase 3B)

## Mutability Guard
All item edits (`updateOrderItem`), item removals (`removeOrderItem`), item additions (`addItemsToOrder`), seat moves (`moveOrderItem`), splits (`splitOrder`), and cancellations (`cancelOrder`) require:
- `order.status` in `['Draft', 'Confirmed']`
- `order.payment_status !== 'Paid'`
- Matching `expected_version` (`VERSION_CONFLICT` otherwise)

Attempting to mutate a `Paid`, `Cancelled`, or `Merged` order fails with `INVALID_STATE`.

## Item Editing (`updateOrderItem`)
- Editable fields: `quantity` (1–100), `topping_units` (0–20), `modifier_ids`, `custom_note`, `seat_id` (`DINE_IN` only).
- **Snapshot Preservation:** Recalculates `line_total_vnd` using the item's stored `unit_price_vnd` and `topping_unit_price_vnd` snapshots—subsequent menu price changes do not retroactively alter existing order items.
- Recalculates `Orders.table_numbers`, `subtotal_vnd`, `total_vnd`, increments `version` and `SyncRevision`, and logs `UPDATE_ORDER_ITEM`.

## Item Removal (`removeOrderItem`)
- Deletes the target `OrderItems` row only if at least 1 other item remains on the order (`items.length > 1`); otherwise returns `VALIDATION_ERROR` instructing staff to use `cancelOrder`.
- Recalculates `Orders.table_numbers`, `subtotal_vnd`, `total_vnd`, increments `version` and `SyncRevision`, and logs `REMOVE_ORDER_ITEM`.

## Order Cancellation (`cancelOrder`)
- Requires `cancel_reason` (minimum 2 non-whitespace characters).
- Sets `status = 'Cancelled'`, `cancelled_at`, `cancel_reason`, `cancelled_by`, increments `version` and `SyncRevision`, and logs `CANCEL_ORDER`.
- Preserves all `Orders` and `OrderItems` rows for audit and history; releases any occupied seats immediately.
