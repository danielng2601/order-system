# Staging Database Setup — ROMS V1.0

> **Note:** Creating or modifying a real Google Sheet `[REQUIRES OWNER]` authorization.

## 1. Create Isolated Staging Spreadsheet `[REQUIRES OWNER]`
1. In the owner's Google Drive, create a new spreadsheet named `ROMS_Database_Staging`.
2. Keep sharing restricted/private (do not share publicly).
3. Copy the Spreadsheet ID from its URL:
   `https://docs.google.com/spreadsheets/d/<STAGING_SPREADSHEET_ID>/edit`
4. Set `SPREADSHEET_ID = <STAGING_SPREADSHEET_ID>` in the **Staging** GAS project's Script Properties (never point Staging GAS at the Production Spreadsheet ID).

## 2. Schema Initialization (`setupDatabase()`)
Running `setupDatabase()` in Staging GAS creates/verifies all 9 sheets (Schema `1.3.0`):
1. `Settings` (`SchemaVersion=1.3.0`, `Timezone=Asia/Ho_Chi_Minh`, `Currency=VND`, `TableCount=9`, `SeatsPerTable=4`, `ToppingUnitPriceVnd=15000`, `PrinterEnabled=false`, `SyncRevision=1`)
2. `MenuItems` (7 seeded VND items)
3. `Modifiers` (6 seeded free modifiers)
4. `TablesSeats` (36 seats: `T1-S1` .. `T9-S4`)
5. `Orders`
6. `OrderItems`
7. `Payments`
8. `AuditLog`
9. `IdempotencyKeys`

## 3. Integrity Verification (`verifyDatabaseIntegrity()`)
Run `verifyDatabaseIntegrity()` immediately after `setupDatabase()`:
- Expect `{ ok: true, schemaVersion: "1.3.0", errors: [] }`.
- Confirm 36 seats, 7 menu items, and 6 modifiers exist.
