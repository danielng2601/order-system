# Phase 2 Implementation Summary — ROMS V1.0

## 1. Backend (`backend/src/`)
- **`Config.gs` & `DbSetup.gs` (Schema v1.2.0):** Added `Merged` order status, `Orders.merged_into_order_id`, `Orders.parent_order_ids_json`, and `Settings.SyncRevision` (monotonically incremented on every mutating write).
- **`Repository.gs`:** Added batch `loadAllOrdersAndItems_()`, `getSyncRevision_()`, `incrementSyncRevision_()`, `computeOrderAggregatesFromItems_()`, and row update helpers.
- **`FloorService.gs`:** Implemented `handleGetSyncStatus_()`, `handleGetFloorState_()`, `handleListActiveOrders_()`, `handleGetOrderDetail_()`, `handleAddItemsToOrder_()`, `handleMoveOrderItem_()`, `handleMergeOrders_()`, and `handleSplitOrder_()` with `LockService`, `expected_version` optimistic concurrency (`VERSION_CONFLICT`), `idempotency_key` replay protection, compensating rollbacks, and `AuditLog` entries.
- **`Code.gs`:** Dispatches all Phase 2 read and locked write actions via authenticated `POST`.

## 2. Frontend (`frontend/`)
- **`js/sync.js`:** Polling synchronization manager (`syncStatus` every 15s, pauses when tab is hidden, resumes on visibility/reconnect, preserves unsaved cart).
- **`js/cart.js`:** Added `setTargetOrder()` for adding items to an existing active order via `addItemsToOrder`.
- **`js/api.js`:** Added all 8 Phase 2 API methods.
- **`index.html`, `css/styles.css`, `js/app.js`:** Added 4-tab navigation (`Đặt món`, `Sơ đồ bàn`, `Đơn đang mở`, `Lịch sử` placeholder), 3×3 Floor Plan (9 tables × 4 seats), Active Orders list with filters, Order Detail modal with Table/Seat grouping and Move Item, Merge Orders modal, and Split Order modal.
