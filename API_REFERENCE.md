# API Reference — ROMS V1.0 (Google Apps Script Web App)

Base URL: `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`

## Transport & CORS Convention
- **GET requests:** Public `?action=health` only. Credentials are **never** accepted in URL query strings.
- **POST requests:** `Content-Type: text/plain;charset=utf-8` with JSON-stringified body `{ "action": "<action>", "session_token": "<token>", ... }`. Avoids CORS `OPTIONS` preflight requests.

## Implemented Endpoints (Phase 0 + Phase 1.5)

### `GET ?action=health`
Public liveness check.

### `POST` `{ "action": "login", "passcode": "<STAFF_PASSCODE>" }`
Validates `STAFF_PASSCODE` and returns `{ session_token, expires_at, expires_at_ms, ttl_seconds }` (6-hour TTL in `CacheService`).

### `POST` `{ "action": "bootstrap", "session_token": "<token>" }`
Returns allowlisted `settings`, `menuItems` (including `is_active: false`), `modifiers`, `tablesSeats`, `toppingUnitPriceVnd`, and `printerEnabled`.

### `POST` `{ "action": "menu", "session_token": "<token>" }`
Returns `{ menuItems, toppingUnitPriceVnd }`.

### `POST` `{ "action": "modifiers", "session_token": "<token>" }`
Returns `{ modifiers }` (active modifiers with `group_name` and `price_delta_vnd`).

### `POST` `{ "action": "ping", "session_token": "<token>" }`
Verifies cross-domain `POST` connectivity and session authentication.

### `POST` `{ "action": "createOrder", ... }`
Creates a new `DINE_IN` or `TAKEAWAY` order inside `LockService.getScriptLock()`.

**Request Body:**
```json
{
  "action": "createOrder",
  "passcode": "<STAFF_PASSCODE>",
  "idempotency_key": "550e8400-e29b-41d4-a716-446655440000",
  "order_type": "DINE_IN",
  "notes": "Khách quen",
  "items": [
    {
      "item_id": "MY_DAC_BIET",
      "quantity": 2,
      "seat_id": "T1-S1",
      "modifier_ids": ["NO_VEG", "MORE_NOODLES"],
      "topping_units": 1,
      "custom_note": "Nước dùng nóng"
    }
  ]
}
```

**Success Response:**
```json
{
  "ok": true,
  "data": {
    "order": {
      "order_id": "ORD-20261113-173000-AB12",
      "order_number": "#261113-001",
      "order_type": "DINE_IN",
      "status": "Confirmed",
      "payment_status": "Unpaid",
      "table_numbers": [1],
      "base_subtotal_vnd": 100000,
      "topping_subtotal_vnd": 30000,
      "subtotal_vnd": 130000,
      "total_vnd": 130000,
      "version": 1,
      "notes": "Khách quen",
      "created_at": "2026-11-13T17:30:00+07:00"
    },
    "items": [],
    "printStatus": { "printed": false, "skipped": true, "reason": "PrinterEnabled is false" },
    "replayed": false,
    "syncRevision": 2
  },
  "error": null
}
```

### Phase 2 Endpoints (Authenticated `POST`)

All Phase 2 endpoints authenticate via `staffPasscode` (or valid `sessionToken`) in the JSON body.

1. **`syncStatus`**
   - Body: `{ "action": "syncStatus", "staffPasscode": "..." }`
   - Returns: `{ syncRevision, serverTime, activeOrderCount }`
2. **`getFloorState`**
   - Body: `{ "action": "getFloorState", "staffPasscode": "..." }`
   - Returns: `{ syncRevision, summary, tables: [ { table_number, total_seats, occupied_seats, available_seats, unavailable_seats, active_orders_count, active_total_vnd, seats: [...], active_orders: [...] } ], takeaway_orders: [...] }`
3. **`listActiveOrders`**
   - Body: `{ "action": "listActiveOrders", "staffPasscode": "...", "filters": { "orderType": "DINE_IN|TAKEAWAY", "tableNumber": 1, "status": "Draft|Confirmed", "paymentStatus": "Unpaid|Paid", "search": "..." } }`
   - Returns: `{ syncRevision, orders: [...], total }`
4. **`getOrderDetail`**
   - Body: `{ "action": "getOrderDetail", "staffPasscode": "...", "orderId": "ORD-..." }`
   - Returns: `{ syncRevision, order, items, grouped_by_table_seat }`
5. **`addItemsToOrder`** *(Locked + Idempotent + Optimistic Version)*
   - Body: `{ "action": "addItemsToOrder", "staffPasscode": "...", "idempotency_key": "<uuid>", "orderId": "ORD-...", "expected_version": 1, "items": [...] }`
   - Returns: `{ order, items, added_items, replayed, syncRevision }`
6. **`moveOrderItem`** *(Locked + Idempotent + Optimistic Version)*
   - Body: `{ "action": "moveOrderItem", "staffPasscode": "...", "idempotency_key": "<uuid>", "orderId": "ORD-...", "orderItemId": "ORD-...-L01", "targetSeatId": "T2-S1", "expected_version": 2 }`
   - Returns: `{ order, items, moved_item, replayed, syncRevision }`
7. **`mergeOrders`** *(Locked + Idempotent + Optimistic Version Map)*
   - Body: `{ "action": "mergeOrders", "staffPasscode": "...", "idempotency_key": "<uuid>", "orderIds": ["ORD-A", "ORD-B"], "targetOrderId": "ORD-A", "expectedVersions": { "ORD-A": 1, "ORD-B": 1 } }`
   - Returns: `{ order, items, merged_order_ids, source_orders, replayed, syncRevision }`
8. **`splitOrder`** *(Locked + Idempotent + Optimistic Version)*
   - Body: `{ "action": "splitOrder", "staffPasscode": "...", "idempotency_key": "<uuid>", "orderId": "ORD-...", "expected_version": 1, "itemIds": ["ORD-...-L01"], "notes": "..." }`
   - Returns: `{ source_order, source_items, new_order, new_items, replayed, syncRevision }`

## Error Codes
- `BAD_REQUEST` — Invalid JSON, missing `action`, or missing `idempotency_key`.
- `METHOD_NOT_ALLOWED` — Attempted `GET` on a mutating action.
- `UNAUTHORIZED` — Missing/invalid `STAFF_PASSCODE` or unset Script Property.
- `SESSION_EXPIRED` — Session token expired or invalid.
- `NOT_FOUND` — Target `orderId` or `orderItemId` does not exist.
- `INVALID_STATE` — Order is `Cancelled` or `Merged`, or operation violates order type (e.g., moving a `TAKEAWAY` item to a seat).
- `VERSION_CONFLICT` — `expected_version` (or `expectedVersions[orderId]`) does not match current `Orders.version`. Client should refresh and retry.
- `VALIDATION_ERROR` — Unknown/sold-out item, invalid quantity (`1..100`), invalid topping (`0..20`), invalid modifier, missing/invalid `seat_id` for `DINE_IN`, or invalid split/merge selection.
- `LOCK_TIMEOUT` — `LockService.getScriptLock()` timed out after 15 seconds.
- `NOT_IMPLEMENTED` — Action scheduled for Phase 3.
- `INTERNAL_ERROR` — Unhandled server error or rolled-back database write failure.
