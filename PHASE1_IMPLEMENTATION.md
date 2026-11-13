# Phase 1 Implementation Summary — ROMS V1.0

## 1. Backend Service Layer (`backend/src/`)
- **`Config.gs`**: Schema v1.1.0 constants, 7 seeded menu items, 6 modifiers with `group_name`, 9×4 seat generator, `TOPPING_UNIT_PRICE_VND = 15000`, `PRINTER_ENABLED = false`, and request bounds (`MAX_ITEMS_PER_ORDER = 50`, `MAX_QUANTITY_PER_LINE = 100`, `MAX_TOPPING_UNITS_PER_LINE = 20`).
- **`DbSetup.gs`**: Idempotent `setupDatabase()` with `ensureSheetColumns_()` safe schema migration (appends `order_number` to `Orders` and `group_name` to `Modifiers` without disturbing existing rows).
- **`Validation.gs`**: Control-character sanitization (`sanitizeText`), `DINE_IN` seat validation (`T1-S1`..`T9-S4`), sold-out rejection (`!is_active`), integer VND line/order calculation ignoring all client-supplied prices, and human-readable daily order number formatting (`#YYMMDD-NNN`).
- **`Repository.gs`**: Catalog loader (`loadCatalog_`), idempotency key lookup (`findIdempotentResponse_`), daily sequential order numbering (`nextDailyOrderSequence_`), and `persistOrderAtomically_()` with rollback on partial failure and post-flush write verification.
- **`OrderService.gs`**: `handleGetBootstrap_()`, `handleGetMenu_()`, `handleGetModifiers_()`, and `handleCreateOrder_()` (with `AuditLog` recording and non-blocking `PrinterService.printOrderIfEnabled()`).
- **`Code.gs`**: Authenticated `doGet` (`health`, `bootstrap`, `menu`, `modifiers`) and locked `doPost` (`ping`, `createOrder`).

## 2. Frontend Vietnamese POS (`frontend/`)
- **`js/format.js`**: `formatVnd()`, `escapeHtml()` (XSS protection), and `generateUuid()`.
- **`js/cart.js`**: Pure cart state manager supporting add, edit, duplicate line, quantity steppers, free modifiers, paid toppings, custom notes, clear-with-confirmation, preserve-on-failure, and clear-on-success.
- **`js/api.js`**: CORS-safe GAS client (`text/plain;charset=utf-8` on `POST`), `sessionStorage` passcode handling, and HTTP error checking.
- **`js/app.js` & `index.html` & `css/styles.css`**: Tablet-first Vietnamese POS UI with dynamic menu loading, search & category filters, sold-out badges, `DINE_IN` / `TAKEAWAY` toggle, seat selector, item customization/edit modal, checkout review modal, and order confirmation receipt.
