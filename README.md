# Restaurant Order Management System (ROMS) V1.0

A fast, tablet-first Restaurant Order Management System built for daily operations on iPad, iPhone, Android, and desktop browsers.

## Architecture Overview

- **Frontend:** Responsive Vietnamese POS web app (HTML, CSS, vanilla JS) hosted on GitHub Pages (`frontend/`).
- **Backend:** Google Apps Script Web App (`backend/src/`).
- **Database:** Google Sheets (9 normalized sheets, Schema v1.3.0, initialized/migrated via `setupDatabase()`).
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
│       ├── FloorService.gs
│       ├── PaymentAndLifecycleService.gs
│       ├── HistoryAndReportService.gs
│       └── Code.gs
├── frontend/
│   ├── index.html
│   ├── css/styles.css
│   └── js/
│       ├── config.example.js
│       ├── format.js
│       ├── cart.js
│       ├── api.js
│       ├── sync.js
│       └── app.js
├── tests/
│   ├── mock_sheets.js
│   ├── phase0.test.js
│   ├── validation.test.js
│   ├── phase1_backend.test.js
│   ├── phase1_frontend.test.js
│   ├── phase2.test.js
│   ├── phase2_5_audit.test.js
│   └── phase3.test.js
└── *.md (Architecture, API, Schema, Migration, Security & Test Docs)
```

## Development Phases

- **Phase 0 (Completed):** Project setup, GAS configuration, Sheets initialization script, API contract, documentation, and base tests.
- **Phase 1 & 1.5 (Completed):** Dynamic menu, modifiers, toppings, cart, `DINE_IN`/`TAKEAWAY` checkout, POST-only session auth, and rollback hardening.
- **Phase 2 & 2.5 (Completed):** 3×3 Floor Plan (9 tables × 4 seats), seat-based item assignment, add items, move item, merge/split orders, active order filters, multi-device polling sync, and integration audit.
- **Phase 3 (Completed):** Payment settlement (`CASH`/`BANK`), item editing/removal, order cancellation, paginated order history, daily/range reports, UTF-8 BOM CSV exports, and `Payments` integrity checks.

## Running Automated Tests

Requires Node.js >= 20:

```bash
npm test
```

## Documentation

- [PHASE3_IMPLEMENTATION.md](PHASE3_IMPLEMENTATION.md) — Phase 3 payment, lifecycle, history, and reporting summary.
- [PAYMENT_WORKFLOW.md](PAYMENT_WORKFLOW.md) — Single full settlement (`CASH`/`BANK`) and rollback rules.
- [ORDER_EDITING_AND_CANCELLATION.md](ORDER_EDITING_AND_CANCELLATION.md) — Item edit/remove and order cancellation rules.
- [ORDER_HISTORY_AND_REPORTS.md](ORDER_HISTORY_AND_REPORTS.md) — History filters, reporting rules, and CSV exports.
- [PHASE3_TEST_REPORT.md](PHASE3_TEST_REPORT.md) — Phase 3 automated test results (44/44 passing).
- [PHASE3_MIGRATION_GUIDE.md](PHASE3_MIGRATION_GUIDE.md) — Safe migration from Schema v1.2.0 to v1.3.0.
- [PHASE2_IMPLEMENTATION.md](PHASE2_IMPLEMENTATION.md) — Phase 2 floor, merge/split, and sync architecture.
- [TABLE_SEAT_MANAGEMENT.md](TABLE_SEAT_MANAGEMENT.md) — 36-seat floor plan & multi-table order rules.
- [ORDER_MERGE_SPLIT.md](ORDER_MERGE_SPLIT.md) — Order lifecycle, merge, and split guarantees.
- [MULTI_DEVICE_SYNC.md](MULTI_DEVICE_SYNC.md) — Polling sync & optimistic concurrency.
- [SECURITY_REVIEW.md](SECURITY_REVIEW.md) — Authentication, session tokens, and XSS protections.
- [TECHNICAL_SPEC.md](TECHNICAL_SPEC.md) — Architecture, concurrency, and risk mitigations.
- [DATABASE_SCHEMA.md](DATABASE_SCHEMA.md) — Google Sheets tables (Schema v1.3.0).
- [API_REFERENCE.md](API_REFERENCE.md) — GAS Web App endpoints and error codes.
- [DEPLOYMENT.md](DEPLOYMENT.md) — Setup for Google Sheets, Apps Script, Drive backups, and GitHub Pages.
- [LIVE_TEST_CHECKLIST.md](LIVE_TEST_CHECKLIST.md) — Manual live browser & GAS verification checklist.
- [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) — Security, sync, and scope limitations.
