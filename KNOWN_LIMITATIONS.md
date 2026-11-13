# Known Limitations — ROMS V1.0 (Phase 1)

1. **Shared Staff Passcode Model:** Because GitHub Pages is a static public host without a backend session server, staff authentication uses a shared `STAFF_PASSCODE` stored in `window.sessionStorage` during the browser session and verified by GAS `PropertiesService`. Individual per-staff accounts and role-based permissions are not implemented.
2. **Passcode in `GET` Query String:** `doGet` actions (`bootstrap`, `menu`, `modifiers`) pass `passcode` as a URL query parameter because GAS Web Apps do not allow custom `Authorization` headers without triggering CORS preflight `OPTIONS` requests (which GAS does not support). Avoid sharing or bookmarking raw API URLs containing the passcode.
3. **Google Sheets Concurrency Ceiling:** `LockService.getScriptLock()` serializes mutations cleanly for a single-restaurant tablet POS, but high-concurrency bursts (>10 simultaneous writes) may hit the 15-second lock timeout and require staff retry.
4. **Phase 2 & 3 Scope Deferred:** Table occupancy board, order editing/merging/splitting on existing orders, and `Unpaid` → `Paid` settlement are scheduled for Phases 2 and 3.
5. **Live GAS Execution Pending:** Automated tests use `tests/mock_sheets.js` in Node.js; live GAS deployment and Google Sheet smoke testing must be performed by the owner following `DEPLOYMENT.md`.
6. **Printer Integration:** `PrinterService.gs` is a non-blocking stub with `PrinterEnabled = false`; physical thermal printing requires a future local print bridge or webhook adapter.
