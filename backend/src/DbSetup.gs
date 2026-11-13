/**
 * ROMS V1.0 - Google Sheets Database Initialization, Safe Migrations & Drive Backup
 * Run setupDatabase() once from the Apps Script editor after configuring SPREADSHEET_ID.
 */

const SCHEMA_HEADERS = {
  Settings: ['key', 'value', 'description'],
  MenuItems: ['item_id', 'name', 'category', 'price_vnd', 'is_active', 'sort_order', 'updated_at'],
  Modifiers: ['modifier_id', 'name', 'group_name', 'price_delta_vnd', 'is_active', 'sort_order'],
  TablesSeats: ['seat_id', 'table_number', 'seat_number', 'label', 'is_active'],
  Orders: [
    'order_id',
    'order_number',
    'order_type',
    'status',
    'payment_status',
    'table_numbers_json',
    'subtotal_vnd',
    'total_vnd',
    'version',
    'idempotency_key',
    'notes',
    'created_at',
    'updated_at',
    'paid_at',
    'created_by',
  ],
  OrderItems: [
    'order_item_id',
    'order_id',
    'seat_id',
    'table_number',
    'seat_number',
    'item_id',
    'item_name_snapshot',
    'unit_price_vnd',
    'quantity',
    'modifiers_json',
    'topping_units',
    'topping_unit_price_vnd',
    'line_total_vnd',
    'custom_note',
    'created_at',
    'updated_at',
  ],
  AuditLog: [
    'log_id',
    'timestamp',
    'action',
    'entity_type',
    'entity_id',
    'actor',
    'request_id',
    'details_json',
  ],
  IdempotencyKeys: ['idempotency_key', 'action', 'order_id', 'response_json', 'created_at'],
};

/**
 * Returns the target Spreadsheet using ScriptProperties.SPREADSHEET_ID or active bound sheet.
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getDatabaseSpreadsheet() {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty('SPREADSHEET_ID');
  if (spreadsheetId) {
    return SpreadsheetApp.openById(spreadsheetId);
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) {
    return active;
  }
  throw new Error(
    'SPREADSHEET_ID is not set in Script Properties and no active spreadsheet is bound.'
  );
}

/**
 * Formats a Date in Asia/Ho_Chi_Minh ISO-8601 string.
 * @param {Date=} date
 * @return {string}
 */
function formatLocalTimestamp(date) {
  return Utilities.formatDate(
    date || new Date(),
    ROMS_CONFIG.TIMEZONE,
    "yyyy-MM-dd'T'HH:mm:ssXXX"
  );
}

/**
 * Idempotently creates sheets, headers, migrations, and initial seed data.
 * Safe to re-run without overwriting existing data.
 */
function setupDatabase() {
  const ss = getDatabaseSpreadsheet();
  const nowStr = formatLocalTimestamp();

  Object.keys(SCHEMA_HEADERS).forEach(function (sheetName) {
    let sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
    }
    const headers = SCHEMA_HEADERS[sheetName];
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
    } else {
      ensureSheetColumns_(sheet, headers);
    }
  });

  seedSettingsIfEmpty_(ss);
  updateSettingValue_(ss, 'SchemaVersion', ROMS_CONFIG.SCHEMA_VERSION);
  seedMenuItemsIfEmpty_(ss, nowStr);
  seedModifiersIfEmpty_(ss);
  seedTablesSeatsIfEmpty_(ss);

  SpreadsheetApp.flush();
  return {
    ok: true,
    message: 'Database setup & migration completed',
    schemaVersion: ROMS_CONFIG.SCHEMA_VERSION,
    timestamp: nowStr,
  };
}

/**
 * Safely appends any missing schema columns to an existing sheet without moving existing data.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {Array<string>} expectedHeaders
 */
function ensureSheetColumns_(sheet, expectedHeaders) {
  const lastCol = sheet.getLastColumn();
  if (lastCol === 0) {
    sheet.getRange(1, 1, 1, expectedHeaders.length).setValues([expectedHeaders]);
    sheet.setFrozenRows(1);
    return;
  }
  const currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const missing = expectedHeaders.filter(function (col) {
    return currentHeaders.indexOf(col) === -1;
  });
  if (missing.length > 0) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
}

function updateSettingValue_(ss, key, value) {
  const sheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.SETTINGS);
  if (!sheet || sheet.getLastRow() < 2) return;
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) === key) {
      sheet.getRange(r + 1, 2).setValue(String(value));
      return;
    }
  }
  sheet.appendRow([key, String(value), '']);
}

function seedSettingsIfEmpty_(ss) {
  const sheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.SETTINGS);
  if (sheet.getLastRow() > 1) return;

  const rows = [
    ['SchemaVersion', ROMS_CONFIG.SCHEMA_VERSION, 'Current database schema version'],
    ['Timezone', ROMS_CONFIG.TIMEZONE, 'Restaurant local timezone'],
    ['Currency', ROMS_CONFIG.CURRENCY, 'Integer VND currency'],
    ['PrinterEnabled', String(ROMS_CONFIG.PRINTER_ENABLED), 'Enable/disable thermal printer'],
    ['ToppingPriceVnd', String(ROMS_CONFIG.TOPPING_UNIT_PRICE_VND), 'Price per extra topping unit'],
    ['TableCount', String(ROMS_CONFIG.TABLE_COUNT), 'Total physical tables'],
    ['SeatsPerTable', String(ROMS_CONFIG.SEATS_PER_TABLE), 'Seats per table'],
  ];
  sheet.getRange(2, 1, rows.length, 3).setValues(rows);
}

function seedMenuItemsIfEmpty_(ss, nowStr) {
  const sheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.MENU_ITEMS);
  if (sheet.getLastRow() > 1) return;

  const rows = SEED_MENU_ITEMS.map(function (item) {
    return [
      item.item_id,
      item.name,
      item.category,
      item.price_vnd,
      item.is_active,
      item.sort_order,
      nowStr,
    ];
  });
  sheet.getRange(2, 1, rows.length, 7).setValues(rows);
}

function seedModifiersIfEmpty_(ss) {
  const sheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.MODIFIERS);
  if (sheet.getLastRow() > 1) return;

  const rows = SEED_MODIFIERS.map(function (mod) {
    return [
      mod.modifier_id,
      mod.name,
      mod.group_name || 'Tùy chọn',
      mod.price_delta_vnd,
      mod.is_active,
      mod.sort_order,
    ];
  });
  sheet.getRange(2, 1, rows.length, 6).setValues(rows);
}

function seedTablesSeatsIfEmpty_(ss) {
  const sheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.TABLES_SEATS);
  if (sheet.getLastRow() > 1) return;

  const seats = buildSeedTablesSeats();
  const rows = seats.map(function (s) {
    return [s.seat_id, s.table_number, s.seat_number, s.label, s.is_active];
  });
  sheet.getRange(2, 1, rows.length, 5).setValues(rows);
}

/**
 * Creates a timestamped backup copy of the database spreadsheet in Google Drive.
 * @return {{ ok: boolean, fileId: string, fileName: string }}
 */
function backupDatabaseToDrive() {
  const ss = getDatabaseSpreadsheet();
  const folderName = 'ROMS_Backups';
  const folders = DriveApp.getFoldersByName(folderName);
  const backupFolder = folders.hasNext() ? folders.next() : DriveApp.createFolder(folderName);

  const stamp = Utilities.formatDate(new Date(), ROMS_CONFIG.TIMEZONE, 'yyyyMMdd-HHmmss');
  const backupName = ss.getName() + '_backup_' + stamp;
  const file = DriveApp.getFileById(ss.getId()).makeCopy(backupName, backupFolder);

  return {
    ok: true,
    fileId: file.getId(),
    fileName: file.getName(),
  };
}
