# Phase 1.5 Hardening Summary — ROMS V1.0

## Defects Discovered & Fixed
1. **Passcode in `GET` Query Strings:** `bootstrap`, `menu`, and `modifiers` previously sent `passcode` in URL query parameters. **Fixed:** Moved all three to `POST` with `session_token` in the JSON body; `GET` now rejects them with `METHOD_NOT_ALLOWED`.
2. **Repeated Passcode Transmission & No Session Expiry:** Frontend previously kept `STAFF_PASSCODE` in `sessionStorage` and sent it on every request. **Fixed:** Added `POST { action: "login", passcode }` backed by `CacheService.getScriptCache()` (6-hour TTL) and `SESSION_EXPIRED` handling.
3. **Raw `Settings` Exposure in `bootstrap`:** `handleGetBootstrap_` previously returned all `Settings` rows. **Fixed:** Allowlisted only public runtime fields (`schemaVersion`, `timezone`, `currency`, `tableCount`, `seatsPerTable`).
4. **Incomplete Multi-Sheet Rollback:** `persistOrderAtomically_()` previously rolled back `Orders` if `OrderItems` failed, but would leave orphan `OrderItems` if `IdempotencyKeys` or `AuditLog` failed. **Fixed:** Reverse-order rollback across `IdempotencyKeys`, `OrderItems`, and `Orders`, plus post-flush verification on all three.
5. **Order ID Collision Single-Retry:** `handleCreateOrder_` only retried `orderIdExists_` once. **Fixed:** Retries up to `MAX_ORDER_ID_RETRIES` (5) times.
6. **Non-JSON / Offline / Timeout Frontend Errors:** `api.js` previously threw raw `SyntaxError` on HTML error pages. **Fixed:** Added `parseSafeJson()`, `navigator.onLine` check, `AbortController` timeout handling, and structured `code` errors while preserving the cart.
7. **Duplicate Header Risk in Migrations:** `ensureSheetColumns_()` now detects duplicate headers and fails loudly instead of silently appending misaligned columns, and `verifyDatabaseIntegrity()` validates all 8 sheets, PKs, VND types, and `OrderItems -> Orders` foreign keys.
