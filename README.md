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
- **Phase 3.5 (Completed):** Production-readiness audit, `Paid` `moveOrderItem` guard, CSV formula injection protection, payment timeout idempotent retry, v1.2.0 → v1.3.0 migration verification (48/48 tests passing).
- **Phase 4A (Completed — Preparation Only):** Staging environment separation (`LOCAL`/`STAGING`/`PRODUCTION`), preflight validation (`npm run preflight`), GAS health environment reporting, and staging/backup/rollback runbooks (53/53 tests passing; no live deployment performed).

## Running Automated Tests & Preflight

Requires Node.js >= 20:

```bash
npm test
npm run preflight
```

## Documentation

- [STAGING_DEPLOYMENT_PLAN.md](STAGING_DEPLOYMENT_PLAN.md) — Controlled staging deployment topology & sequence.
- [ENVIRONMENT_CONFIGURATION.md](ENVIRONMENT_CONFIGURATION.md) — `LOCAL` / `STAGING` / `PRODUCTION` separation & fail-closed rules.
- [GAS_DEPLOYMENT_GUIDE.md](GAS_DEPLOYMENT_GUIDE.md) — Standalone GAS staging deployment & Script Properties.
- [STAGING_DATABASE_SETUP.md](STAGING_DATABASE_SETUP.md) — Isolated staging Google Sheet setup & verification.
- [BACKUP_AND_ROLLBACK.md](BACKUP_AND_ROLLBACK.md) — Drive backup & rollback procedures.
- [STAGING_TEST_PLAN.md](STAGING_TEST_PLAN.md) — Live staging verification gate.
- [DEPLOYMENT_PREFLIGHT_REPORT.md](DEPLOYMENT_PREFLIGHT_REPORT.md) — Phase 4A preflight verification report.
- [PHASE3_5_AUDIT.md](PHASE3_5_AUDIT.md) — Phase 3.5 production-readiness audit & fixes.
- [PAYMENT_AND_ACCOUNTING_INVARIANTS.md](PAYMENT_AND_ACCOUNTING_INVARIANTS.md) — Canonical accounting & payment invariants.
- [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) — Controlled deployment sequence & known limitations.
- [PHASE3_5_TEST_REPORT.md](PHASE3_5_TEST_REPORT.md) — Phase 3.5 automated test results (48/48 passing).
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
