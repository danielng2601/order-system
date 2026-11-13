# API Reference — ROMS V1.0 (Google Apps Script Web App)

Base URL: `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`

## Transport & CORS Convention

- **GET requests:** Query string `?action=<action>&...`
- **POST requests:** `Content-Type: text/plain;charset=utf-8` with a JSON-stringified body containing `{ "action": "<action>", "passcode": "<staff_passcode>", ... }`. Using `text/plain` avoids CORS `OPTIONS` preflight requests, which GAS Web Apps do not support.

## Standard Response Envelope

```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

Error response:

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or missing staff passcode."
  }
}
```

## Phase 0 Endpoints (Implemented)

### `GET ?action=health`
Public liveness check. Does not require `passcode` or touch Google Sheets.

**Response:**
```json
{
  "ok": true,
  "data": {
    "service": "ROMS",
    "version": "1.0.0",
    "phase": "Phase 0",
    "timezone": "Asia/Ho_Chi_Minh",
    "currency": "VND",
    "printerEnabled": false,
    "serverTime": "2026-11-13T17:15:00+07:00"
  },
  "error": null
}
```

### `GET ?action=bootstrap&passcode=<STAFF_PASSCODE>`
Returns active `settings`, `menuItems`, `modifiers`, and `tablesSeats` from Google Sheets.

### `POST` `{ "action": "ping", "passcode": "<STAFF_PASSCODE>" }`
Verifies cross-domain `POST` connectivity and passcode authentication.

## Planned Endpoints (Phases 1–3)

| Phase | Method | Action | Description |
| :--- | :--- | :--- | :--- |
| Phase 1 | `POST` | `createOrder` | Create `DINE_IN` or `TAKEAWAY` order with server-calculated VND totals and `idempotency_key` |
| Phase 2 | `GET` | `listOrders` | Fetch active/recent orders and seat occupancy |
| Phase 3 | `POST` | `updateOrder` | Add/edit/remove items with `expected_version` optimistic lock |
| Phase 3 | `POST` | `mergeOrders` | Merge multiple orders into one target order |
| Phase 3 | `POST` | `splitOrder` | Split selected `order_item_id`s into a new order |
| Phase 3 | `POST` | `markPaid` | Mark order `Paid` and record `paid_at` |
| Phase 3 | `POST` | `cancelOrder` | Set order status to `Cancelled` with audit log |

## Error Codes

- `BAD_REQUEST` — Invalid JSON or missing/invalid parameters.
- `UNAUTHORIZED` — Missing or invalid `STAFF_PASSCODE` (or `STAFF_PASSCODE` not set in Script Properties).
- `LOCK_TIMEOUT` — `LockService.getScriptLock()` timed out after 15 seconds.
- `VERSION_CONFLICT` — Optimistic lock mismatch (`expected_version` is stale).
- `NOT_IMPLEMENTED` — Action reserved for Phase 1–3.
- `INTERNAL_ERROR` — Unhandled server exception.
