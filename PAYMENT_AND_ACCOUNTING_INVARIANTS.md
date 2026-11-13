# ROMS V1.0 — Payment & Accounting Invariants

## Canonical Metric Definitions (`getReports` & `listOrderHistory`)
All date grouping and filtering uses `Asia/Ho_Chi_Minh` (`+07:00`).

| Metric | Definition |
| :--- | :--- |
| **Orders Created (Eligible)** | `Orders` where `status` is `Draft` or `Confirmed` (excludes `Cancelled` and `Merged` source orders). |
| **Paid Orders** | Eligible orders with `payment_status === 'Paid'`. |
| **Unpaid Orders** | Eligible orders with `payment_status === 'Unpaid'`. |
| **Cancelled Orders** | `Orders` with `status === 'Cancelled'` (preserved for audit; excluded from sales & collected revenue). |
| **Merged Source Orders** | `Orders` with `status === 'Merged'` (excluded from sales & order counts to prevent double-counting). |
| **Gross Order Value (`total_order_value_vnd`)** | Sum of `Orders.total_vnd` across eligible (`Draft` / `Confirmed`) orders. |
| **Actual Collected CASH (`cash_collected_vnd`)** | Sum of `Payments.amount_vnd` where `payment_status === 'Paid'` and `payment_method === 'CASH'` (excluding `Cancelled`/`Merged` parent orders). |
| **Actual Collected BANK (`bank_collected_vnd`)** | Sum of `Payments.amount_vnd` where `payment_status === 'Paid'` and `payment_method === 'BANK'`. |
| **Total Collected (`total_collected_vnd`)** | `cash_collected_vnd + bank_collected_vnd`. |

## Hard Invariants
1. Every `Paid` order has **exactly one** `Paid` record in `Payments` with `Payments.amount_vnd === Orders.total_vnd`.
2. `Unpaid`, `Cancelled`, and `Merged` orders have **zero** `Paid` records in `Payments`.
3. `Payments.amount_vnd` is always calculated server-side from `Orders.total_vnd`; client amounts are ignored.
4. `Paid`, `Cancelled`, and `Merged` orders are immutable across all endpoints.
