# Staging Test Plan — ROMS V1.0

> **Scope:** Live verification against Staging GAS, Staging Google Sheet, and GitHub Pages (or local static preview) across iPad, iPhone, Android, and desktop. Automated Node.js tests use mocked Sheets/CacheService and do **not** replace this plan.

## 1. Environment & Security Gate
- [ ] `<STAGING_GAS_WEB_APP_URL>?action=health` returns `ok: true`, `environment: "STAGING"`, `schemaVersion: "1.3.0"`, `printerEnabled: false`.
- [ ] `<STAGING_GAS_WEB_APP_URL>?action=bootstrap` returns `METHOD_NOT_ALLOWED`.
- [ ] Frontend `#env-badge` shows `STAGING`.
- [ ] `?env=invalid` fails closed with `INVALID_ENV` and does not fall back to `PRODUCTION`.
- [ ] `sessionStorage` stores `roms_staging_session_token` (never `STAFF_PASSCODE`), isolated from `roms_production_*`.

## 2. Core POS & Multi-Device Functional Gate
- [ ] CORS & 302 redirect on `POST login`, `bootstrap`, `createOrder` succeed without `OPTIONS` preflight.
- [ ] `DINE_IN` multi-seat order (`T1-S1`, `T1-S2`) creates `#YYMMDD-001`, updates `Orders`, `OrderItems`, `IdempotencyKeys`, `AuditLog`.
- [ ] `TAKEAWAY` order creates without `seat_id`.
- [ ] Floor plan (`Sơ đồ bàn`), `addItemsToOrder`, `moveOrderItem`, `mergeOrders`, `splitOrder` work end-to-end.
- [ ] Two devices polling every 15s sync updates; stale edits return `VERSION_CONFLICT` without silent overwrite.
- [ ] `settlePayment` (`CASH` and `BANK`) writes `Payments`, releases seats immediately, and locks order as read-only.
- [ ] `updateOrderItem`, `removeOrderItem`, `cancelOrder` respect `Paid`/`Cancelled`/`Merged` guards.
- [ ] Order History, Reports (excluding `Cancelled`/`Merged`), and UTF-8 BOM CSV exports open cleanly in Excel.
- [ ] `backupDatabaseToDrive()` and `verifyDatabaseIntegrity()` both succeed on `ROMS_Database_Staging`.
