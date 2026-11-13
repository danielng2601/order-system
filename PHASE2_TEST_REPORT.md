# Phase 2 Automated Test Report — ROMS V1.0

**Command:** `npm test` (`node --test tests/*.test.js`)  
**Result:** 33 passed, 0 failed, 0 skipped

## Mocked vs. Live Distinction
- All 33 tests execute offline in Node.js (`vm` + `tests/mock_sheets.js`).
- Live Google Apps Script + Google Sheets + multi-device browser tests remain manual (see `LIVE_TEST_CHECKLIST.md`).

## Phase 2 Coverage (`tests/phase2.test.js`)
- **Floor & Seat Management:** 36 seats, `available` / `occupied` / `unavailable` states, multi-seat and multi-table totals.
- **Active Orders & Detail:** Filter by `order_type`, `table_number`, `seat_id`, `order_number`; server-computed `seatSubtotals` and `tableSubtotals`.
- **Add Items & Move Item:** Original item price snapshot preservation after menu price change, `version` increment, `VERSION_CONFLICT` on stale version, moving items across tables, rejecting `TAKEAWAY` seat moves.
- **Merge Orders:** Merging 3 orders, lineage (`parent_order_ids`, `merged_into_order_id`), idempotent replay, rejecting re-merge of `Merged` orders.
- **Split Order:** Splitting by item/seat across tables, `sourceTotal + newTotal === originalTotal`, rejecting full-order or duplicate-item splits.
- **Multi-Device Sync & Cart Add-Mode:** `SyncRevision` stability on reads and increment on writes, `ROMS_SYNC` remote change detection & offline skip, `cart.setTargetOrder()` preserving cart on `VERSION_CONFLICT`.
