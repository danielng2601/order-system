# ROMS V1.0 – Concurrency & Idempotency Specification

## 1. Concurrency Control Layers
1. **Serialization (`LockService.getScriptLock()`):** All 5 mutating endpoints acquire a 15-second script lock before reading or writing Sheets.
2. **Optimistic Concurrency (`expected_version`):** Updates to existing orders require matching `Orders.version`. Stale versions fail with `VERSION_CONFLICT` and return `latestOrder`.
3. **Idempotency (`IdempotencyKeys`):** Every mutating request requires a client-generated UUID (`idempotency_key`). Retries after network timeouts replay the cached JSON response (`replayed: true`) without repeating the mutation.
4. **Compensating Rollback:** If any write fails (including `AuditLog` or `IdempotencyKeys`), all modified `Orders`, `OrderItems`, and `IdempotencyKeys` rows are rolled back before returning `INTERNAL_ERROR`.

## 2. Mutating Operations Matrix

| Action | Lock | Optimistic Version Check | Idempotency Key | SyncRevision Increment |
| :--- | :--- | :--- | :--- | :--- |
| `createOrder` | Yes | N/A (new order, `v=1`) | Required (`>= 8` chars) | `+1` on success only |
| `addItemsToOrder` | Yes | `expected_version == order.version` | Required (`>= 8` chars) | `+1` on success only |
| `moveOrderItem` | Yes | `expected_version == order.version` | Required (`>= 8` chars) | `+1` on success only |
| `mergeOrders` | Yes | `expected_version` per source order | Required (`>= 8` chars) | `+1` on success only |
| `splitOrder` | Yes | `expected_version == sourceOrder.version` | Required (`>= 8` chars) | `+1` on success only |
