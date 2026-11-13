# Restaurant Order Management System (ROMS) V1.0

A fast, tablet-first Restaurant Order Management System built for daily operations on iPad, iPhone, Android, and desktop browsers.

## Architecture Overview

- **Frontend:** Static HTML, CSS, and vanilla JavaScript hosted on GitHub Pages (`frontend/`).
- **Backend:** Google Apps Script Web App (`backend/src/`).
- **Database:** Google Sheets (8 normalized sheets, initialized via `setupDatabase()`).
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
│       └── Code.gs
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── config.example.js
│       ├── api.js
│       └── app.js
├── tests/
│   ├── phase0.test.js
│   └── validation.test.js
├── API_REFERENCE.md
├── DATABASE_SCHEMA.md
├── DEPLOYMENT.md
├── TECHNICAL_SPEC.md
└── package.json
```

## Development Phases

- **Phase 0 (Current):** Project setup, GAS configuration, Sheets initialization script, API contract, documentation, and automated unit tests.
- **Phase 1:** Menu, modifiers, paid toppings (`15,000 VND`), cart, and checkout.
- **Phase 2:** 9 tables × 4 seats (36 seats) and multi-table/seat item assignment.
- **Phase 3:** Order editing, merging, splitting, payment (`Unpaid`/`Paid`), synchronization, and end-to-end testing.

## Running Automated Tests

Requires Node.js >= 20:

```bash
npm test
```

## Documentation

- [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md) — Architecture, security model, concurrency, and risk mitigations.
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) — Google Sheets tables, columns, types, and seed data.
- [API_REFERENCE.md](API_REFERENCE.md) — GAS Web App endpoints, request/response envelopes, and error codes.
- [DEPLOYMENT.md](DEPLOYMENT.md) — Step-by-step setup for Google Sheets, Apps Script, Drive backups, and GitHub Pages.
