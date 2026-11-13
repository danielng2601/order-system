# ROMS V1.0 – Order Lifecycle & State Machine

## 1. Order Statuses
- **`Draft`**: Initial active order (editable, can receive items, move seats, merge, split).
- **`Confirmed`**: Active kitchen/floor order (editable, can receive items, move seats, merge, split).
- **`Cancelled`**: Terminal inactive state. Excluded from floor occupancy and active order lists. Cannot be mutated.
- **`Merged`**: Terminal historical state for source orders consolidated into a destination order. `merged_into_order_id` points to the destination order; all `OrderItems` are reassigned to the destination order. Cannot be mutated, merged, or split again.

## 2. State Transition Table

| Current `status` | Current `payment_status` | `addItems` / `updateItem` / `removeItem` | `moveOrderItem` | `mergeOrders` | `splitOrder` | `settlePayment` | `cancelOrder` |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `Draft` | `Unpaid` | Allowed (`v+1`) | Allowed (`DINE_IN`, `v+1`) | Allowed -> `Merged` | Allowed (`v+1`) | Allowed -> `Paid` (`v+1`) | Allowed -> `Cancelled` (`v+1`) |
| `Confirmed` | `Unpaid` | Allowed (`v+1`) | Allowed (`DINE_IN`, `v+1`) | Allowed -> `Merged` | Allowed (`v+1`) | Allowed -> `Paid` (`v+1`) | Allowed -> `Cancelled` (`v+1`) |
| `Draft` / `Confirmed` | `Paid` | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE` in UI; immutable Paid order) | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) |
| `Cancelled` | Any | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) |
| `Merged` | Any | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) | **Rejected** (`INVALID_STATE`) |

## 3. Order Type Invariants
- **`DINE_IN`**: Every `OrderItem` must have a valid active `seat_id` (`T1-S1`..`T9-S4`). `Orders.table_numbers_json` is derived from its items.
- **`TAKEAWAY`**: `seat_id` is always empty; `table_numbers_json` is `[]`. `moveOrderItem` is rejected (`INVALID_STATE`). `DINE_IN` and `TAKEAWAY` orders cannot be merged together (`VALIDATION_ERROR`).
