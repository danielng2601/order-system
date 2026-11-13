# ROMS V1.0 – Phase 2.5 Full System Integration Audit

**Audit Date:** 2026-11-13  
**Scope:** Phases 0, 1, 1.5, and 2 (`backend/src/`, `frontend/`, `tests/`, documentation)

## 1. Executive Summary
A comprehensive source-level integration audit was conducted across all backend Google Apps Script modules, frontend POS modules, database schema, authentication, concurrency, and multi-device synchronization. **8 defects** were discovered, reproduced, fixed, and covered with automated regression tests.

## 2. Defects Discovered & Fixed

| ID | Area | Defect | Fix |
| :--- | :--- | :--- | :--- |
| **D1** | Authentication (`Code.gs`) | `isAuthorizedPost_()` accepted raw `payload.passcode` on normal endpoints instead of requiring `session_token` exclusively. | Removed `payload.passcode` fallback from `isAuthorizedPost_()`. Only `action === 'login'` accepts `passcode`. Updated all test callers. |
| **D2** | Bootstrap Sync (`OrderService.gs`) | `handleGetBootstrap_()` omitted `syncRevision`, causing `ROMS_SYNC` to initialize at `1` instead of the current `Settings.SyncRevision`. | Added `syncRevision: getSyncRevision_(ss)` to `handleGetBootstrap_()`. |
| **D3** | Order Merge (`FloorService.gs`) | `handleMergeOrders_()` copied `OrderItems` into new rows while leaving original rows on `Merged` source orders, duplicating items in `OrderItems`. | Updated `handleMergeOrders_()` to reassign existing `OrderItems` rows in-place (`order_id = destOrderId`) preserving `order_item_id` uniqueness and preventing duplicate items. |
| **D4** | Payment Ownership (`FloorService.gs`) | `addItemsToOrder`, `mergeOrders`, and `splitOrder` did not reject `payment_status === 'Paid'` orders, risking ambiguous payment state. | Added `INVALID_STATE` guard rejecting mutations on `Paid` orders. |
| **D5** | Rollback Atomicity (`FloorService.gs`) | `addItemsToOrder`, `moveOrderItem`, `mergeOrders`, and `splitOrder` did not roll back `IdempotencyKeys` if `AuditLog` or `SyncRevision` failed. | Tracked `idempRowIdx` and deleted the `IdempotencyKeys` row in catch rollback blocks so failed requests can be safely retried. |
| **D6** | Order Creation (`Validation.gs`) | `validateAndPriceOrderPayload()` allowed `status: 'Merged'` or `'Cancelled'` on `createOrder`. | Restricted `createOrder` initial status to `ACTIVE_ORDER_STATUSES` (`Draft`, `Confirmed`). |
| **D7** | DB Integrity (`DbSetup.gs`) | `verifyDatabaseIntegrity()` lacked checks for duplicate `order_item_id`, invalid `seat_id`, `total_vnd`/`table_numbers_json` mismatches, items on `Merged` orders, and broken lineage. | Expanded `verifyDatabaseIntegrity()` with full read-only Phase 2 referential, total, table, seat, and lineage checks. |
| **D8** | Frontend UX (`app.js`) | Checkout modal lacked seat/table subtotals breakdown; `openOrderDetail` and `moveOrderItem` didn't update `syncManager`; inactive seats weren't disabled in dropdowns. | Added seat/table subtotals in `openCheckoutModal()`, `syncManager.setRevision()` updates, and `TablesSeats.is_active` filtering in `initSeatSelectors()`. |
