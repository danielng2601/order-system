# ROMS V1.0 — Phase 3 Implementation

## Overview
Phase 3 completes the restaurant operational lifecycle on top of Phases 0–2.5:
- **Phase 3A — Payment & Settlement:** Single full settlement (`CASH` or `BANK`) via `settlePayment`, persisted to the `Payments` sheet and `Orders` (`payment_status`, `payment_method`, `paid_at`), releasing occupied seats on the floor plan and moving settled orders to History.
- **Phase 3B — Order Editing & Cancellation:** Item-level editing (`updateOrderItem`), item removal (`removeOrderItem`, requiring ≥1 remaining item), and order cancellation (`cancelOrder` with mandatory `cancel_reason`), preserving historical price snapshots and rejecting mutations on `Paid`, `Cancelled`, or `Merged` orders.
- **Phase 3C — Order History:** Replaced the `Lịch sử` placeholder tab with paginated history (`listOrderHistory`), date presets (`today`, `yesterday`, `custom`, `all` in `Asia/Ho_Chi_Minh`), status/payment/type/table/search filters, and read-only detail view with payment info, cancellation info, lineage, and `auditHistory`.
- **Phase 3D — Daily & Period Reports + CSV Export:** Server-side reporting (`getReports`) excluding `Cancelled` and `Merged` source orders from sales, computing actual collected `CASH` / `BANK` totals from `Payments`, daily breakdown bar chart, and UTF-8 BOM RFC-4180 CSV exports for Orders, Payments, and Reports.
- **Phase 3E — Database Schema & Integrity:** Bumped schema version to `1.3.0`, added `Payments` sheet and `Orders` payment/cancellation columns, and extended `verifyDatabaseIntegrity()` for payment invariants.

## Key Modules Added/Updated
- Backend (`backend/src/`): `Config.gs`, `DbSetup.gs`, `Repository.gs`, `OrderService.gs`, `FloorService.gs`, `PaymentAndLifecycleService.gs`, `HistoryAndReportService.gs`, `Code.gs`.
- Frontend (`frontend/`): `index.html`, `css/styles.css`, `js/format.js`, `js/api.js`, `js/app.js`.
- Tests (`tests/`): `mock_sheets.js`, `phase3.test.js` (44/44 automated tests passing).
