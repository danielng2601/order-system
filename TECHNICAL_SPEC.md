# Technical Specification — ROMS V1.0

## 1. System Architecture

ROMS V1.0 separates the public static frontend from the private Google Apps Script (GAS) backend:

```text
[iPad / Phone / Desktop Browser]
        │  HTTPS (GET / POST text/plain JSON)
        ▼
[GitHub Pages: frontend/]
        │  fetch() -> script.google.com/macros/s/<id>/exec
        ▼
[Google Apps Script Web App: backend/src/]
        │  LockService + Server Validation + VND Pricing
        ▼
[Google Sheets Database] ──(daily trigger)──▶ [Google Drive: ROMS_Backups]
```

### Key Design Decisions

- **No GAS HTML Service:** The production UI is served exclusively from GitHub Pages for fast load times, clean caching, and separation of concerns.
- **Integer VND Arithmetic:** All prices, topping fees, and totals are stored and computed as non-negative integers in VND. No floating-point currency math is used.
- **Server-Calculated Pricing:** The frontend sends item IDs, quantities, modifier IDs, and topping unit counts. The GAS backend looks up authoritative prices from `MenuItems` and `Settings` (`ToppingPriceVnd = 15000`) and ignores any client-provided prices.
- **Printer Module (`PrinterService.gs`):** `PrinterEnabled` defaults to `false`. Printing is a non-blocking hook after order confirmation and is never required to complete an order.

## 2. Security & Authentication Assumptions

Because GitHub Pages serves static assets publicly, **no secrets, API keys, service credentials, or Google Sheet IDs may exist in `frontend/`**.

1. **GAS Execution Identity:** The Web App is deployed with `executeAs: USER_DEPLOYING` and `access: ANYONE_ANONYMOUS`. Only the owner's Google account has direct access to the Google Sheet; the browser never receives the `SPREADSHEET_ID`.
2. **Staff Passcode Gate:** Protected endpoints (`bootstrap`, `ping`, and Phase 1–3 order mutations) require a `passcode` verified in GAS against `PropertiesService.getScriptProperties().getProperty('STAFF_PASSCODE')` using `constantTimeEqual()`.
3. **Fail-Closed Default:** If `STAFF_PASSCODE` is not configured in GAS Script Properties, all protected requests return `UNAUTHORIZED`.
4. **Session-Only Client Storage:** Staff enter the passcode at runtime; `frontend/js/api.js` stores it only in `window.sessionStorage`, never in `localStorage` or source files.
5. **Auditability:** All mutations write an immutable record to `AuditLog` with timestamp (`Asia/Ho_Chi_Minh`), action, entity ID, actor, and request ID.

## 3. Technical Risks & Mitigations

### Risk 1: Cross-Domain CORS with Google Apps Script
- **Problem:** Browsers send a CORS `OPTIONS` preflight for `POST` requests with `Content-Type: application/json`. GAS Web Apps do not support `doOptions()`, causing preflight requests to fail.
- **Mitigation:** `frontend/js/api.js` sends `POST` requests with `Content-Type: text/plain;charset=utf-8` and a JSON-stringified body. This qualifies as a CORS simple request (no `OPTIONS` preflight). GAS parses `JSON.parse(e.postData.contents)` and returns `ContentService.createTextOutput(...).setMimeType(ContentService.MimeType.JSON)`.

### Risk 2: Concurrent Order Updates
- **Problem:** Multiple staff tablets may create, edit, merge, or pay orders simultaneously, risking race conditions or lost updates in Google Sheets.
- **Mitigation:**
  1. **Script Lock:** Every mutating `doPost` request acquires `LockService.getScriptLock().tryLock(15000)` and calls `SpreadsheetApp.flush()` before releasing the lock.
  2. **Optimistic Concurrency (`version`):** Every `Orders` row carries an integer `version` incremented on each mutation. Phase 1–3 updates must supply `expected_version`, returning `VERSION_CONFLICT` if another device modified the order first.
  3. **Idempotency (`idempotency_key`):** Mutating requests include a client-generated UUID `idempotency_key` checked against `IdempotencyKeys` inside the script lock to prevent duplicate orders from double-taps or network retries.

### Risk 3: Google Sheets Latency & Quotas
- **Problem:** Cell-by-cell reads/writes are slow and risk hitting GAS 6-minute/quota limits.
- **Mitigation:** Batch sheet reads (`getDataRange().getValues()`) and batch writes (`setValues()` / `appendRow()`) within locked sections.

## 4. Business Rules Summary (Verified in `Config.gs` & `Validation.gs`)

- **Tables & Seats:** 9 tables × 4 seats = 36 seats (`T1-S1` to `T9-S4`).
- **Dine-In vs Takeaway:** `DINE_IN` items require a valid `seat_id`; `TAKEAWAY` items leave `seat_id` empty.
- **Modifiers:** Default `0 VND` price delta (`Không rau`, `Không thịt`, `Không sủi cảo`, `Không sủi rán`, `Nhiều mỳ`, `Ít mỳ`, plus `custom_note`).
- **Paid Toppings:** Separate `topping_units` integer per item at `15,000 VND` per unit.
- **Statuses:** Order `Draft` | `Confirmed` | `Cancelled`; Payment `Unpaid` | `Paid`.
