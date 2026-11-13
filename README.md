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
- **Phase 1 (Completed):** Dynamic menu, search & categories, sold-out state, free modifiers, paid toppings (`15,000 VND`), full cart, `DINE_IN` / `TAKEAWAY` checkout, idempotent `createOrder`, atomic Sheets persistence, and audit logging.
- **Phase 2 (Next):** 9 tables × 4 seats (36 seats) occupancy board and multi-table/seat order management.
- **Phase 3 (Planned):** Order editing, merging, splitting, payment (`Unpaid`/`Paid`), synchronization, and live E2E testing.

## Running Automated Tests

Requires Node.js >= 20:

```bash
npm test
```

## Documentation

- [PHASE1_IMPLEMENTATION.md](PHASE1_IMPLEMENTATION.md) — Complete summary of Phase 1 backend, frontend, and security.
- [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md) — Architecture, security model, concurrency, and risk mitigations.
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) — Google Sheets tables, columns, migrations, and seed data.
- [API_REFERENCE.md](API_REFERENCE.md) — GAS Web App endpoints, request/response envelopes, and error codes.
- [DEPLOYMENT.md](DEPLOYMENT.md) — Step-by-step setup for Google Sheets, Apps Script, Drive backups, and GitHub Pages.
- [TEST_REPORT.md](TEST_REPORT.md) — Automated test coverage and mocked vs. live verification status.
- [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) — Honest security, concurrency, and operational limitations.
