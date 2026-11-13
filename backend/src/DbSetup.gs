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
    'merged_into_order_id',
    'parent_order_ids_json',
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
  ensureSettingExists_(ss, 'SyncRevision', '1', 'Monotonic sync cursor incremented on order writes');
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
 * Detects duplicate headers and rejects corrupted schemas.
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
  const rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const currentHeaders = [];
  const seen = {};
  for (let i = 0; i < rawHeaders.length; i += 1) {
    const h = String(rawHeaders[i] || '').trim();
    if (!h) continue;
    if (seen[h]) {
      throw new Error('Duplicate header "' + h + '" in sheet "' + sheet.getName() + '"');
    }
    seen[h] = true;
    currentHeaders.push(h);
  }
  const missing = expectedHeaders.filter(function (col) {
    return currentHeaders.indexOf(col) === -1;
  });
  if (missing.length > 0) {
    sheet.getRange(1, lastCol + 1, 1, missing.length).setValues([missing]);
  }
}

/**
 * Verifies schema headers, primary key uniqueness, VND integer types, and OrderItems -> Orders FK integrity.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet=} ssOpt
 * @return {{ ok: boolean, errors: Array<string> }}
 */
function verifyDatabaseIntegrity(ssOpt) {
  const ss = ssOpt || getDatabaseSpreadsheet();
  const errors = [];

  Object.keys(SCHEMA_HEADERS).forEach(function (sheetName) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) {
      errors.push('Missing required sheet: ' + sheetName);
      return;
    }
    if (sheet.getLastRow() === 0 || sheet.getLastColumn() === 0) {
      errors.push('Empty header row in sheet: ' + sheetName);
      return;
    }
    const headers = sheet
      .getRange(1, 1, 1, sheet.getLastColumn())
      .getValues()[0]
      .map(function (h) {
        return String(h || '').trim();
      });
    const seen = {};
    headers.forEach(function (h) {
      if (!h) return;
      if (seen[h]) errors.push('Duplicate header "' + h + '" in ' + sheetName);
      seen[h] = true;
    });
    SCHEMA_HEADERS[sheetName].forEach(function (reqCol) {
      if (headers.indexOf(reqCol) === -1) {
        errors.push('Missing column "' + reqCol + '" in ' + sheetName);
      }
    });
  });

  if (errors.length > 0) {
    return { ok: false, errors: errors };
  }

  // Check primary key uniqueness & types
  function checkUniquePk(sheetName, pkField) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet || sheet.getLastRow() < 2) return {};
    const rows = sheet.getDataRange().getValues();
    const pkCol = rows[0].indexOf(pkField);
    const seen = {};
    for (let r = 1; r < rows.length; r += 1) {
      const val = String(rows[r][pkCol] || '').trim();
      if (!val) continue; // ignore completely blank trailing rows
      if (seen[val]) {
        errors.push('Duplicate ' + pkField + ' "' + val + '" in ' + sheetName);
      }
      seen[val] = true;
    }
    return seen;
  }

  checkUniquePk(ROMS_CONFIG.SHEETS.MENU_ITEMS, 'item_id');
  checkUniquePk(ROMS_CONFIG.SHEETS.MODIFIERS, 'modifier_id');
  const seatIds = checkUniquePk(ROMS_CONFIG.SHEETS.TABLES_SEATS, 'seat_id');
  const orderIds = checkUniquePk(ROMS_CONFIG.SHEETS.ORDERS, 'order_id');
  checkUniquePk(ROMS_CONFIG.SHEETS.ORDER_ITEMS, 'order_item_id');

  // Check MenuItems integer VND prices
  const menuSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.MENU_ITEMS);
  if (menuSheet && menuSheet.getLastRow() >= 2) {
    const mRows = menuSheet.getDataRange().getValues();
    const priceCol = mRows[0].indexOf('price_vnd');
    for (let r = 1; r < mRows.length; r += 1) {
      if (!String(mRows[r][0] || '').trim()) continue;
      const p = Number(mRows[r][priceCol]);
      if (!Number.isInteger(p) || p < 0) {
        errors.push('Invalid price_vnd in MenuItems row ' + (r + 1));
      }
    }
  }

  // Load Orders & OrderItems for Phase 2 referential, total, table, and lineage checks
  const db = loadAllOrdersAndItems_(ss);

  db.orders.forEach(function (ord) {
    if (ROMS_CONFIG.ORDER_STATUSES.indexOf(ord.status) === -1) {
      errors.push('Invalid status "' + ord.status + '" on order ' + ord.order_id);
    }
    if (ROMS_CONFIG.PAYMENT_STATUSES.indexOf(ord.payment_status) === -1) {
      errors.push('Invalid payment_status "' + ord.payment_status + '" on order ' + ord.order_id);
    }
    if (ord.status === 'Merged') {
      if (!ord.merged_into_order_id || !db.ordersById[ord.merged_into_order_id]) {
        errors.push('Merged order ' + ord.order_id + ' has missing or invalid merged_into_order_id: ' + ord.merged_into_order_id);
      }
      const itemsOnMerged = db.itemsByOrderId[ord.order_id] || [];
      if (itemsOnMerged.length > 0) {
        errors.push('Merged source order ' + ord.order_id + ' still has ' + itemsOnMerged.length + ' assigned OrderItems');
      }
    } else {
      const items = db.itemsByOrderId[ord.order_id] || [];
      const aggs = computeOrderAggregatesFromItems_(ord.order_type, items);
      if (ord.total_vnd !== aggs.total_vnd) {
        errors.push('Order ' + ord.order_id + ' total_vnd (' + ord.total_vnd + ') != sum of items (' + aggs.total_vnd + ')');
      }
      const expectedTablesJson = JSON.stringify(aggs.table_numbers);
      const actualTablesJson = JSON.stringify(Array.isArray(ord.table_numbers) ? ord.table_numbers : []);
      if (actualTablesJson !== expectedTablesJson) {
        errors.push('Order ' + ord.order_id + ' table_numbers_json (' + actualTablesJson + ') != derived (' + expectedTablesJson + ')');
      }
    }
    if (Array.isArray(ord.parent_order_ids)) {
      ord.parent_order_ids.forEach(function (pid) {
        if (!db.ordersById[pid]) {
          errors.push('Order ' + ord.order_id + ' references missing parent_order_id: ' + pid);
        }
      });
    }
  });

  // Check OrderItems -> Orders FK & seat_id validity
  Object.keys(db.itemsByOrderId).forEach(function (oid) {
    const parentOrder = db.ordersById[oid];
    const items = db.itemsByOrderId[oid];
    items.forEach(function (it) {
      if (!parentOrder) {
        errors.push('Orphan OrderItem ' + it.order_item_id + ' referencing missing order_id: ' + oid);
        return;
      }
      if (parentOrder.order_type === 'DINE_IN') {
        if (!it.seat_id || !seatIds[it.seat_id]) {
          errors.push('OrderItem ' + it.order_item_id + ' has invalid seat_id: ' + it.seat_id);
        }
      } else if (parentOrder.order_type === 'TAKEAWAY' && it.seat_id) {
        errors.push('TAKEAWAY OrderItem ' + it.order_item_id + ' should not have seat_id: ' + it.seat_id);
      }
    });
  });

  // Check IdempotencyKeys -> Orders consistency
  const idempSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.IDEMPOTENCY_KEYS);
  if (idempSheet && idempSheet.getLastRow() >= 2) {
    const idempRows = sheetToObjects_(idempSheet);
    idempRows.forEach(function (row, idx) {
      const oid = String(row.order_id || '').trim();
      if (oid && !orderIds[oid]) {
        errors.push('IdempotencyKeys row ' + (idx + 2) + ' references missing order_id: ' + oid);
      }
    });
  }

  return { ok: errors.length === 0, errors: errors };
}

function ensureSettingExists_(ss, key, defaultValue, description) {
  const sheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.SETTINGS);
  if (!sheet) return;
  if (sheet.getLastRow() >= 2) {
    const values = sheet.getDataRange().getValues();
    for (let r = 1; r < values.length; r += 1) {
      if (String(values[r][0]) === key) return;
    }
  }
  sheet.appendRow([key, String(defaultValue), description || '']);
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
    ['SyncRevision', '1', 'Monotonic sync cursor incremented on order writes'],
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
