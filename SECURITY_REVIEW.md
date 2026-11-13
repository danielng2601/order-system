# Security Review — ROMS V1.0 (Phase 1.5)

## 1. Authentication & Credential Lifecycle
1. **No Credentials in URL Query Strings:** `doGet` only serves `?action=health`. Authenticated reads (`bootstrap`, `menu`, `modifiers`) and writes (`createOrder`) are `POST`-only; `GET` requests to those actions are rejected with `METHOD_NOT_ALLOWED`.
2. **Short-Lived Session Tokens:** `POST { action: "login", passcode }` validates `STAFF_PASSCODE` in `PropertiesService` using `constantTimeEqual()`, then issues a 6-hour (`21,600s`) `session_token` stored in `CacheService.getScriptCache()`.
3. **Browser Storage:** `frontend/js/api.js` stores only `session_token` and `expires_at_ms` in `window.sessionStorage` and never stores `STAFF_PASSCODE`. `frontend/js/app.js` clears the passcode input immediately after login.
4. **Fail-Closed Default:** If `STAFF_PASSCODE` is unset or empty in GAS Script Properties, `isValidPasscode_()` returns `false` and rejects all login and protected requests.
5. **No Secret Logging:** Passcodes and session tokens are never logged, echoed in responses, or written to `AuditLog`.

## 2. Input Validation & XSS Protection
- Backend `sanitizeText()` strips ASCII control characters and enforces length limits on all string inputs (`notes`, `custom_note`, `action`, `idempotency_key`).
- All prices, topping fees, and totals are calculated server-side in integer `VND`; client-submitted prices are ignored.
- Frontend `ROMS_FORMAT.escapeHtml()` escapes `&`, `<`, `>`, `"`, and `'` on every dynamic value rendered into HTML.

## 3. Remaining Security Limitations (Honest Assessment)
- **Shared Passcode:** Staff share one `STAFF_PASSCODE`; individual staff attribution is not available until per-user accounts are introduced.
- **Public Static Origin:** Because GitHub Pages is public, anyone who obtains `STAFF_PASSCODE` can log in from any browser. GAS `ANYONE_ANONYMOUS` access is required because Google OAuth is not used on the frontend.
- **Rate Limiting:** GAS `CacheService` does not enforce per-IP login brute-force lockouts; strong passcodes (8+ mixed characters) are recommended.

## Phase 2.5 Security Audit Update (2026-11-13)
- Removed the raw `payload.passcode` fallback from `isAuthorizedPost_()` in `backend/src/Code.gs`. Only `POST { action: "login", passcode }` accepts `STAFF_PASSCODE`; all other protected endpoints strictly require a valid `session_token` from `CacheService`.
- Verified `CacheService` eviction returns `SESSION_EXPIRED` and clears client session state.
- Enforced `payment_status !== 'Paid'` guards on `addItemsToOrder`, `mergeOrders`, and `splitOrder` to prevent ambiguous payment ownership.
