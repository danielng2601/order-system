# API Reference — ROMS V1.0 (Google Apps Script Web App)

Base URL: `https://script.google.com/macros/s/<DEPLOYMENT_ID>/exec`

## Transport & CORS Convention
- **GET requests:** Query string `?action=<action>&passcode=<STAFF_PASSCODE>`
- **POST requests:** `Content-Type: text/plain;charset=utf-8` with JSON-stringified body `{ "action": "<action>", "passcode": "<staff_passcode>", ... }`. Avoids CORS `OPTIONS` preflight requests.

## Implemented Endpoints (Phase 0 + Phase 1)

### `GET ?action=health`
Public liveness check.

### `GET ?action=bootstrap&passcode=<STAFF_PASSCODE>`
Returns `settings`, `menuItems` (including `is_active: false` for sold-out display), `modifiers`, `tablesSeats`, `toppingUnitPriceVnd`, and `printerEnabled`.

### `GET ?action=menu&passcode=<STAFF_PASSCODE>`
Returns `{ menuItems, toppingUnitPriceVnd }`.

### `GET ?action=modifiers&passcode=<STAFF_PASSCODE>`
Returns `{ modifiers }` (active modifiers with `group_name` and `price_delta_vnd`).

### `POST` `{ "action": "ping", "passcode": "<STAFF_PASSCODE>" }`
Verifies cross-domain `POST` connectivity and passcode authentication.

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
    "replayed": false
  },
  "error": null
}
```

## Error Codes
- `BAD_REQUEST` — Invalid JSON, missing `action`, or missing `idempotency_key`.
- `UNAUTHORIZED` — Missing/invalid `STAFF_PASSCODE` or unset Script Property.
- `VALIDATION_ERROR` — Unknown/sold-out item, invalid quantity (`1..100`), invalid topping (`0..20`), invalid modifier, or missing/invalid `seat_id` for `DINE_IN`.
- `LOCK_TIMEOUT` — `LockService.getScriptLock()` timed out after 15 seconds.
- `NOT_IMPLEMENTED` — Action scheduled for Phase 2–3.
- `INTERNAL_ERROR` — Unhandled server error or rolled-back database write failure.
