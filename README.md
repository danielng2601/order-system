# Restaurant Order Management System (ROMS) V1.0

A fast, tablet-first Restaurant Order Management System built for daily operations on iPad, iPhone, Android, and desktop browsers.

## Architecture Overview

- **Frontend:** Responsive Vietnamese POS web app (HTML, CSS, vanilla JS) hosted on GitHub Pages (`frontend/`).
- **Backend:** Google Apps Script Web App (`backend/src/`).
- **Database:** Google Sheets (8 normalized sheets, Schema v1.1.0, initialized/migrated via `setupDatabase()`).
- **Backup:** Google Drive (`ROMS_Backups` folder via `backupDatabaseToDrive()`).
- **Timezone & Currency:** `Asia/Ho_Chi_Minh`, integer `VND`.

## Project Structure

```text
order-system/
├── .github/workflows/deploy-pages.yml
├── backend/
│   ├── .clasp.json.example
│   └── src/
│       ├── appsscript.json
│       ├── Config.gs
│       ├── DbSetup.gs
│       ├── PrinterService.gs
│       ├── Validation.gs
│       ├── Repository.gs
│       ├── OrderService.gs
│       └── Code.gs
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── config.example.js
│       ├── format.js
│       ├── cart.js
│       ├── api.js
│       └── app.js
├── tests/
│   ├── mock_sheets.js
│   ├── phase0.test.js
│   ├── validation.test.js
│   ├── phase1_backend.test.js
│   └── phase1_frontend.test.js
├── API_REFERENCE.md
├── DATABASE_SCHEMA.md
├── DEPLOYMENT.md
├── KNOWN_LIMITATIONS.md
├── PHASE1_IMPLEMENTATION.md
├── TECHNICAL_SPEC.md
├── TEST_REPORT.md
└── package.json
```

## Development Phases

- **Phase 0 (Completed):** Project setup, GAS configuration, Sheets initialization script, API contract, documentation, and base tests.
- **Phase 1 & 1.5 (Completed):** Dynamic menu, modifiers, toppings, cart, `DINE_IN`/`TAKEAWAY` checkout, POST-only session auth, and rollback hardening.
- **Phase 2 (Completed):** 3×3 Floor Plan (9 tables × 4 seats), seat-based item assignment, add items to existing orders, move item between seats, merge orders, split orders, active order filters, and multi-device polling sync.
- **Phase 3 (Next):** Payment settlement (`Unpaid`/`Paid`), order cancellation, order history, and live E2E testing.

## Running Automated Tests

Requires Node.js >= 20:

```bash
npm test
```

## Documentation

- [PHASE2_IMPLEMENTATION.md](PHASE2_IMPLEMENTATION.md) — Phase 2 floor, merge/split, and sync architecture.
- [TABLE_SEAT_MANAGEMENT.md](TABLE_SEAT_MANAGEMENT.md) — 36-seat floor plan & multi-table order rules.
- [ORDER_MERGE_SPLIT.md](ORDER_MERGE_SPLIT.md) — Order lifecycle, merge, and split guarantees.
- [MULTI_DEVICE_SYNC.md](MULTI_DEVICE_SYNC.md) — Polling sync & optimistic concurrency.
- [PHASE2_TEST_REPORT.md](PHASE2_TEST_REPORT.md) — Phase 2 automated test results (33/33 passing).
- [SECURITY_REVIEW.md](SECURITY_REVIEW.md) — Authentication, session tokens, and XSS protections.
- [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md) — Architecture, concurrency, and risk mitigations.
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) — Google Sheets tables (Schema v1.2.0).
- [API_REFERENCE.md](API_REFERENCE.md) — GAS Web App endpoints and error codes.
- [DEPLOYMENT.md](DEPLOYMENT.md) — Setup for Google Sheets, Apps Script, Drive backups, and GitHub Pages.
- [LIVE_TEST_CHECKLIST.md](LIVE_TEST_CHECKLIST.md) — Manual live browser & GAS verification checklist.
- [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) — Security, sync, and scope limitations.
