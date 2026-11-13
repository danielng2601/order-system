# Live Browser & GAS Integration Test Checklist — ROMS V1.0

> **Note:** Automated tests in `tests/` use mocked Google Sheets and `CacheService`. Cross-origin CORS, GAS 302 redirects, and real Google Sheets latency **must** be verified with this live checklist after deployment.

## Pre-Flight Checks
1. `SPREADSHEET_ID` and `STAFF_PASSCODE` are set in GAS **Project Settings → Script Properties**.
2. `setupDatabase()` and `verifyDatabaseIntegrity()` both succeed in the GAS editor (`ok: true`).
3. GAS Web App is deployed (`Execute as: Me`, `Who has access: Anyone`).
4. GitHub Pages is deployed from `frontend/`.

## Live Browser Verification Steps (iPad / Phone / Desktop)
1. **Public Health Check:** Open `<GAS_WEB_APP_URL>?action=health` in a browser tab. Expect `{ "ok": true, "data": { "phase": "Phase 1.5", ... } }`.
2. **GET Credential Rejection:** Open `<GAS_WEB_APP_URL>?action=bootstrap`. Expect `METHOD_NOT_ALLOWED`.
3. **CORS & Login from GitHub Pages:** Open the GitHub Pages URL, enter the GAS URL and `STAFF_PASSCODE` in **Cài đặt**, click **Kết nối & Tải thực đơn**. Verify in DevTools Network tab:
   - `POST` `login` sends `Content-Type: text/plain;charset=utf-8` (no `OPTIONS` preflight).
   - 302 redirect to `script.googleusercontent.com` completes and returns `{ ok: true, data: { session_token, ... } }`.
   - `sessionStorage` contains `roms_session_token`, NOT `STAFF_PASSCODE`.
4. **Menu & Sold-Out Sync:** Toggle `is_active = FALSE` on `QUAY` in `MenuItems` sheet, click **Tải lại thực đơn**, and verify `Quẩy` shows `Hết món` and disabled buttons. Restore `TRUE` afterward.
5. **DINE_IN Order Creation:** Select `Tại bàn`, `Bàn 1 - Ghế 1`, add `Mỳ Vằn Thắn` + `Không rau` + `1` topping (`60.000 VND`), submit, and verify `#YYMMDD-001` appears and rows are written to `Orders`, `OrderItems`, `IdempotencyKeys`, and `AuditLog`.
6. **TAKEAWAY Order Creation:** Switch to `Mang về`, add `Bún Thang`, submit, and verify `seat_id` is blank in `OrderItems`.
7. **Cart Preservation on Error:** Turn on Airplane Mode, try submitting an order, verify offline error appears and cart items remain intact.
