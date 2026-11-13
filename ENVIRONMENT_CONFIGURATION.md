# Environment Configuration — ROMS V1.0

## 1. Environment Separation Model
ROMS enforces strict separation across three explicit environments:
- `LOCAL` — Local static server testing (`http://localhost` / `http://127.0.0.1` allowed for local dev, or HTTPS GAS URL).
- `STAGING` — Controlled pre-production testing against `ROMS_Database_Staging`.
- `PRODUCTION` — Live restaurant operations against `ROMS_Database_Prod`.

## 2. Frontend Configuration (`frontend/js/config.example.js` & `frontend/js/env.js`)
- `frontend/js/config.example.js` defines `window.ROMS_CONFIG.ENVIRONMENTS` with placeholder URLs (`REPLACE_WITH_*_DEPLOYMENT_ID`).
- `frontend/js/env.js` (`ROMS_ENV`) resolves the active environment in priority order:
  1. URL query parameter `?env=local|staging|production`
  2. `window.ROMS_RUNTIME_CONFIG.ENV`
  3. `window.ROMS_CONFIG.ENV` (defaults to `STAGING`)
- **Fail-Closed Guarantees:**
  - Unknown `?env=` values return `INVALID_ENV` and block API requests.
  - Missing or placeholder URLs for `STAGING` or `LOCAL` return `UNCONFIGURED` and **never** fall back to `PRODUCTION`.
  - `sessionStorage` keys (`session_token`, `session_expires_ms`, `gas_url`) are prefixed per environment (`roms_local_`, `roms_staging_`, `roms_production_`) so tokens and URLs cannot leak across environments.
  - The header displays `#env-badge` (`LOCAL`, `STAGING`, or `PRODUCTION`).

## 3. Backend Configuration (`Script Properties` in GAS)
Set per-project in Google Apps Script **Project Settings → Script Properties**:
- `SPREADSHEET_ID`: `<STAGING_SPREADSHEET_ID>` or `<PROD_SPREADSHEET_ID>`
- `STAFF_PASSCODE`: `<STRONG_ENV_SPECIFIC_PASSCODE>` (never reuse staging passcodes in production)
- `ROMS_ENV`: `STAGING` or `PRODUCTION` (reported in `?action=health` for operator verification; non-secret)

## 4. Security Rules
- **Never** commit `frontend/js/config.js`, `backend/.clasp.json`, `.env`, passcodes, session tokens, or real `SPREADSHEET_ID` values.
- **Never** expose `STAFF_PASSCODE` or `SPREADSHEET_ID` in frontend files.
