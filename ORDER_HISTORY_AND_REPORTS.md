# ROMS V1.0 — Order History & Reporting (Phase 3C & 3D)

## Timezone & Date Boundaries
- All date grouping and filtering uses `Asia/Ho_Chi_Minh` (`+07:00`) via `formatLocalDateOnly_()` and `toLocalDateStr_()`.
- Supported `date_preset` values: `today`, `yesterday`, `custom` (`date_from` / `date_to` in `yyyy-MM-dd`), and `all`.

## Order History (`listOrderHistory`)
- Filters: `date_preset`/`date_from`/`date_to`, `status`, `payment_status`, `order_type`, `table_number`, `search` (matches `order_number`, `order_id`, `notes`).
- Sorted newest-first (`created_at` descending) with server-side pagination (`page`, `page_size` up to 100, default 25).
- Selecting an order opens the read-only detail modal (`getOrderDetail`) showing items, seat/table subtotals, `payment` record (if Paid), cancellation reason/timestamp (if Cancelled), `parent_order_ids` lineage, and `auditHistory`.

## Reports (`getReports`)
- **Double-Count & Cancellation Rules:**
  - `Cancelled` orders are excluded from `total_orders`, `total_order_value_vnd`, and `average_order_value_vnd`, and counted separately in `cancelled_orders`.
  - `Merged` source orders (`status === 'Merged'`) are excluded from `total_orders` and `total_order_value_vnd` so merged totals are never double-counted; counted separately in `merged_source_orders`.
- **Actual Collected Amounts:** `total_collected_vnd`, `cash_collected_vnd`, and `bank_collected_vnd` are summed strictly from `Payments` records (`payment_status === 'Paid'`) whose parent order is not `Cancelled` or `Merged`.
- Includes `dailyBreakdown` for the UI bar chart (`CASH` vs `BANK`) and `payments` list for CSV export.

## CSV Exports
- Client-side `ROMS_FORMAT.buildCsv(headers, rows)` prepends UTF-8 BOM (`\uFEFF`) for Excel compatibility with Vietnamese diacritics and applies RFC-4180 quoting (`escapeCsvCell`).
- Three exports available in the `Lịch sử` tab: Orders CSV, Payments CSV, and Daily/Summary Report CSV.
