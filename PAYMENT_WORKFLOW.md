# ROMS V1.0 — Payment Workflow (Phase 3A)

## Settlement Model
- **Single Full Settlement:** Each active unpaid order (`Draft` or `Confirmed` with `payment_status === 'Unpaid'`) can be settled once in full.
- **Supported Methods:** `CASH` (Tiền mặt) and `BANK` (Chuyển khoản).
- **Server-Calculated Amount:** `handleSettlePayment_()` ignores any client-supplied amount, verifies `Orders.total_vnd` against `OrderItems` via `computeOrderAggregatesFromItems_()`, and writes `amount_vnd = order.total_vnd` (integer VND) to the `Payments` sheet.

## Concurrency, Idempotency & Rollback
1. Requires `session_token`, `idempotency_key` (≥8 chars), `order_id`, integer `expected_version`, and `payment_method`.
2. Protected by `LockService.getScriptLock()`.
3. Checks `findIdempotentResponse_(ss, idempotency_key, 'settlePayment')` before mutating.
4. Rejects `Paid`, `Cancelled`, and `Merged` orders with `INVALID_STATE`, and stale versions with `VERSION_CONFLICT`.
5. Writes `Payments` row → updates `Orders` (`payment_status='Paid'`, `payment_method`, `paid_at`, `version+1`) → writes `IdempotencyKeys` → appends `AuditLog` (`SETTLE_PAYMENT`) → increments `SyncRevision`.
6. On any write failure, compensating rollback deletes the appended `Payments` / `IdempotencyKeys` row and restores the original `Orders` row.

## Post-Settlement Effects
- `getFloorState` and `listActiveOrders` filter out `payment_status === 'Paid'`, immediately freeing occupied seats for the next guests.
- Settled orders remain queryable in `listOrderHistory` and `getOrderDetail` (with `payment` and `auditHistory`).
