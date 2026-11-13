# Table & Seat Management — ROMS V1.0

## Floor Layout
- **9 Tables × 4 Seats = 36 Seats:** `T1-S1` through `T9-S4` in `TablesSeats`.
- **Seat States:**
  - `available`: `is_active === true` and no active (`Draft` / `Confirmed`) `DINE_IN` order items assigned.
  - `occupied`: `is_active === true` and at least one active `DINE_IN` order item assigned.
  - `unavailable`: `is_active === false` (locked/disabled in `TablesSeats`).

## Multi-Table & Multi-Seat Orders
- An order is **not** bound to a single table. Each `OrderItems` row stores its own `seat_id`, `table_number`, and `seat_number`.
- `Orders.table_numbers_json` is derived automatically from the order's active items whenever items are created, added, moved, merged, or split.
- `TAKEAWAY` orders never assign `seat_id` and are rejected by `moveOrderItem`.
- `getOrderDetail` computes `seatSubtotals` and `tableSubtotals` server-side from item `line_total_vnd` snapshots.
