# Live Browser & GAS Integration Test Checklist — ROMS V1.0

> **Note:** Automated tests in `tests/` use mocked Google Sheets and `CacheService`. Cross-origin CORS, GAS 302 redirects, and real Google Sheets latency **must** be verified with this live checklist after deployment.

## Pre-Flight Checks
1. Local `npm test` and `npm run preflight` pass.
2. `ROMS_ENV`, `SPREADSHEET_ID`, and `STAFF_PASSCODE` are set in GAS **Project Settings → Script Properties**.
3. `setupDatabase()` and `verifyDatabaseIntegrity()` both succeed in the GAS editor (`ok: true`).
4. GAS Web App is deployed (`Execute as: Me`, `Who has access: Anyone`).
5. GitHub Pages is deployed from `frontend/`.

## Live Browser Verification Steps (iPad / Phone / Desktop)
1. **Public Health Check:** Open `<GAS_WEB_APP_URL>?action=health` in a browser tab. Expect `{ "ok": true, "data": { "environment": "STAGING", "schemaVersion": "1.3.0", "printerEnabled": false, ... } }`.
2. **GET Credential Rejection:** Open `<GAS_WEB_APP_URL>?action=bootstrap`. Expect `METHOD_NOT_ALLOWED`.
3. **CORS & Login from GitHub Pages:** Open the GitHub Pages URL (e.g. `?env=staging`), verify `#env-badge` shows `STAGING`, enter the GAS URL and `STAFF_PASSCODE` in **Cài đặt**, click **Kết nối & Tải thực đơn**. Verify in DevTools Network tab:
   - `POST` `login` sends `Content-Type: text/plain;charset=utf-8` (no `OPTIONS` preflight).
   - 302 redirect to `script.googleusercontent.com` completes and returns `{ ok: true, data: { session_token, ... } }`.
   - `sessionStorage` contains environment-scoped `roms_staging_session_token`, NOT `STAFF_PASSCODE`.
4. **Menu & Sold-Out Sync:** Toggle `is_active = FALSE` on `QUAY` in `MenuItems` sheet, click **Tải lại thực đơn**, and verify `Quẩy` shows `Hết món` and disabled buttons. Restore `TRUE` afterward.
5. **DINE_IN Order Creation:** Select `Tại bàn`, `Bàn 1 - Ghế 1`, add `Mỳ Vằn Thắn` + `Không rau` + `1` topping (`60.000 VND`), submit, and verify `#YYMMDD-001` appears and rows are written to `Orders`, `OrderItems`, `IdempotencyKeys`, and `AuditLog`.
6. **TAKEAWAY Order Creation:** Switch to `Mang về`, add `Bún Thang`, submit, and verify `seat_id` is blank in `OrderItems`.
7. **Cart Preservation on Error:** Turn on Airplane Mode, try submitting an order, verify offline error appears and cart items remain intact.
8. **Floor Plan, Edit, Merge & Split (Phase 2/3B):** Open an active order on `Sơ đồ bàn`, test `+1`/`-1`, `Sửa`, `Xóa` (with ≥2 items), `Chuyển ghế`, `Tách đơn`, and `Gộp đơn`. Verify two devices see updates within ~15s polling and stale edits return `VERSION_CONFLICT`.
9. **Payment & Seat Release (Phase 3A):** Settle an order via `CASH` and another via `BANK`. Verify `Payments` row is written, seats are immediately `available` on `Sơ đồ bàn`, and the settled order becomes read-only.
10. **Cancellation, History, Reports & CSV (Phase 3B/3C/3D):** Cancel an unpaid order with a reason; open `Lịch sử`, verify KPI cards, `CASH`/`BANK` bar chart, filters, pagination, and download all 3 CSVs (open in Excel to verify Vietnamese diacritics).
