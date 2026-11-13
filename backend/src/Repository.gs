/**
 * ROMS V1.0 - Google Sheets Repository & Atomic Persistence Layer
 */

/**
 * Converts a sheet with header row 1 into an array of objects.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Array<Object>}
 */
function sheetToObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rows = [];
  for (let r = 1; r < values.length; r += 1) {
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]] = values[r][c];
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * Builds a row array matching a sheet's header order.
 * @param {Array<string>} headers
 * @param {Object} record
 * @return {Array<*>}
 */
function mapRecordToHeaders_(headers, record) {
  return headers.map(function (col) {
    return Object.prototype.hasOwnProperty.call(record, col) ? record[col] : '';
  });
}

/**
 * Loads settings, menu items, modifiers, and seats from Google Sheets.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {Object}
 */
function loadCatalog_(ss) {
  const settingsRows = sheetToObjects_(ss.getSheetByName(ROMS_CONFIG.SHEETS.SETTINGS));
  const settingsMap = {};
  settingsRows.forEach(function (row) {
    settingsMap[String(row.key)] = row.value;
  });

  const menuItems = sheetToObjects_(ss.getSheetByName(ROMS_CONFIG.SHEETS.MENU_ITEMS))
    .map(function (row) {
      return {
        item_id: String(row.item_id),
        name: String(row.name),
        category: String(row.category || 'Khác'),
        price_vnd: Number(row.price_vnd),
        is_active: toBoolean(row.is_active),
        sort_order: Number(row.sort_order || 999),
        updated_at: String(row.updated_at || ''),
      };
    })
    .sort(function (a, b) {
      return a.sort_order - b.sort_order;
    });

  const menuById = {};
  menuItems.forEach(function (item) {
    menuById[item.item_id] = item;
  });

  const modifiers = sheetToObjects_(ss.getSheetByName(ROMS_CONFIG.SHEETS.MODIFIERS))
    .map(function (row) {
      return {
        modifier_id: String(row.modifier_id),
        name: String(row.name),
        group_name: String(row.group_name || 'Tùy chọn'),
        price_delta_vnd: Number(row.price_delta_vnd || 0),
        is_active: toBoolean(row.is_active),
        sort_order: Number(row.sort_order || 999),
      };
    })
    .sort(function (a, b) {
      return a.sort_order - b.sort_order;
    });

  const modifiersById = {};
  modifiers.forEach(function (mod) {
    modifiersById[mod.modifier_id] = mod;
  });

  const tablesSeats = sheetToObjects_(ss.getSheetByName(ROMS_CONFIG.SHEETS.TABLES_SEATS)).map(
    function (row) {
      return {
        seat_id: String(row.seat_id),
        table_number: Number(row.table_number),
        seat_number: Number(row.seat_number),
        label: String(row.label),
        is_active: toBoolean(row.is_active),
      };
    }
  );

  const validSeatsById = {};
  tablesSeats.forEach(function (seat) {
    validSeatsById[seat.seat_id] = seat;
  });

  const toppingUnitPriceVnd = settingsMap.ToppingPriceVnd
    ? Number(settingsMap.ToppingPriceVnd)
    : ROMS_CONFIG.TOPPING_UNIT_PRICE_VND;

  return {
    settingsRows: settingsRows,
    settingsMap: settingsMap,
    menuItems: menuItems,
    menuById: menuById,
    modifiers: modifiers,
    modifiersById: modifiersById,
    tablesSeats: tablesSeats,
    validSeatsById: validSeatsById,
    toppingUnitPriceVnd: toppingUnitPriceVnd,
  };
}

/**
 * Checks IdempotencyKeys for a previously completed response.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} idempotencyKey
 * @param {string} action
 * @return {Object|null}
 */
function findIdempotentResponse_(ss, idempotencyKey, action) {
  const sheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.IDEMPOTENCY_KEYS);
  if (!sheet || sheet.getLastRow() < 2) {
    return null;
  }
  const values = sheet.getDataRange().getValues();
  for (let r = values.length - 1; r >= 1; r -= 1) {
    if (String(values[r][0]) === idempotencyKey && String(values[r][1]) === action) {
      try {
        return JSON.parse(String(values[r][3]));
      } catch (err) {
        return null;
      }
    }
  }
  return null;
}

/**
 * Checks whether an order_id already exists in Orders.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} orderId
 * @return {boolean}
 */
function orderIdExists_(ss, orderId) {
  const sheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDERS);
  if (!sheet || sheet.getLastRow() < 2) {
    return false;
  }
  const ids = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < ids.length; i += 1) {
    if (String(ids[i][0]) === orderId) {
      return true;
    }
  }
  return false;
}

/**
 * Computes the next daily sequential order number for today's date prefix (#YYMMDD-).
 * Must be called inside LockService.getScriptLock().
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {Date} now
 * @return {number}
 */
function nextDailyOrderSequence_(ss, now) {
  const sheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDERS);
  if (!sheet || sheet.getLastRow() < 2) {
    return 1;
  }
  const todayPrefix = formatOrderNumber(now, 0).slice(0, 8); // "#YYMMDD-"
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const orderNumCol = headers.indexOf('order_number');
  if (orderNumCol === -1) {
    return sheet.getLastRow();
  }
  const colValues = sheet
    .getRange(2, orderNumCol + 1, sheet.getLastRow() - 1, 1)
    .getValues();
  let maxSeq = 0;
  for (let i = 0; i < colValues.length; i += 1) {
    const val = String(colValues[i][0] || '');
    if (val.indexOf(todayPrefix) === 0) {
      const seqPart = Number(val.slice(todayPrefix.length));
      if (Number.isInteger(seqPart) && seqPart > maxSeq) {
        maxSeq = seqPart;
      }
    }
  }
  return maxSeq + 1;
}

/**
 * Persists Orders, OrderItems, IdempotencyKeys, and AuditLog with rollback & write verification.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {Object} orderRecord
 * @param {Array<Object>} itemRecords
 * @param {Object} idempotencyRecord
 * @param {Object} auditRecord
 */
function persistOrderAtomically_(ss, orderRecord, itemRecords, idempotencyRecord, auditRecord) {
  const ordersSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDERS);
  const itemsSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDER_ITEMS);
  const idempSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.IDEMPOTENCY_KEYS);
  const auditSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.AUDIT_LOG);

  if (!ordersSheet || !itemsSheet || !idempSheet || !auditSheet) {
    throw new Error('Database sheets are not initialized. Run setupDatabase() first.');
  }

  if (orderIdExists_(ss, orderRecord.order_id)) {
    throw new Error('Duplicate order_id generated: ' + orderRecord.order_id);
  }

  const orderHeaders = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0];
  const itemHeaders = itemsSheet.getRange(1, 1, 1, itemsSheet.getLastColumn()).getValues()[0];
  const idempHeaders = idempSheet.getRange(1, 1, 1, idempSheet.getLastColumn()).getValues()[0];
  const auditHeaders = auditSheet.getRange(1, 1, 1, auditSheet.getLastColumn()).getValues()[0];

  const orderRowValues = mapRecordToHeaders_(orderHeaders, orderRecord);
  const itemRowsValues = itemRecords.map(function (item) {
    return mapRecordToHeaders_(itemHeaders, item);
  });

  const orderStartRow = ordersSheet.getLastRow() + 1;
  const itemStartRow = itemsSheet.getLastRow() + 1;
  const idempStartRow = idempSheet.getLastRow() + 1;
  let orderWritten = false;
  let itemsWritten = false;
  let idempWritten = false;

  try {
    ordersSheet.getRange(orderStartRow, 1, 1, orderRowValues.length).setValues([orderRowValues]);
    orderWritten = true;

    itemsSheet
      .getRange(itemStartRow, 1, itemRowsValues.length, itemHeaders.length)
      .setValues(itemRowsValues);
    itemsWritten = true;

    const idempRowValues = mapRecordToHeaders_(idempHeaders, idempotencyRecord);
    idempSheet.getRange(idempStartRow, 1, 1, idempRowValues.length).setValues([idempRowValues]);
    idempWritten = true;

    const auditStartRow = auditSheet.getLastRow() + 1;
    const auditRowValues = mapRecordToHeaders_(auditHeaders, auditRecord);
    auditSheet.getRange(auditStartRow, 1, 1, auditRowValues.length).setValues([auditRowValues]);

    SpreadsheetApp.flush();

    // Post-flush database write verification
    const writtenOrderId = String(ordersSheet.getRange(orderStartRow, 1).getValue());
    if (writtenOrderId !== orderRecord.order_id) {
      throw new Error('Order write verification failed for ' + orderRecord.order_id);
    }
    const writtenItemOrderIds = itemsSheet
      .getRange(itemStartRow, 2, itemRowsValues.length, 1)
      .getValues();
    for (let i = 0; i < writtenItemOrderIds.length; i += 1) {
      if (String(writtenItemOrderIds[i][0]) !== orderRecord.order_id) {
        throw new Error('OrderItem write verification failed for ' + orderRecord.order_id);
      }
    }
    const writtenIdempKey = String(idempSheet.getRange(idempStartRow, 1).getValue());
    if (writtenIdempKey !== idempotencyRecord.idempotency_key) {
      throw new Error('IdempotencyKey write verification failed for ' + orderRecord.order_id);
    }

    incrementSyncRevision_(ss);
  } catch (err) {
    // Roll back in reverse order so no orphan rows remain
    try {
      if (idempWritten && idempSheet.getLastRow() >= idempStartRow) {
        if (String(idempSheet.getRange(idempStartRow, 1).getValue()) === idempotencyRecord.idempotency_key) {
          idempSheet.deleteRow(idempStartRow);
        }
      }
      if (itemsWritten && itemsSheet.getLastRow() >= itemStartRow) {
        for (let idx = itemRowsValues.length - 1; idx >= 0; idx -= 1) {
          const rowPos = itemStartRow + idx;
          if (itemsSheet.getLastRow() >= rowPos && String(itemsSheet.getRange(rowPos, 2).getValue()) === orderRecord.order_id) {
            itemsSheet.deleteRow(rowPos);
          }
        }
      }
      if (orderWritten && ordersSheet.getLastRow() >= orderStartRow) {
        if (String(ordersSheet.getRange(orderStartRow, 1).getValue()) === orderRecord.order_id) {
          ordersSheet.deleteRow(orderStartRow);
        }
      }
      SpreadsheetApp.flush();
    } catch (rollbackErr) {
      // Best-effort rollback
    }
    throw err;
  }
}

/**
 * Safely parses a JSON array string, returning fallback on error.
 * @param {*} raw
 * @param {*=} fallback
 * @return {*}
 */
function safeParseJson_(raw, fallback) {
  if (typeof raw !== 'string' || !raw.trim()) {
    return fallback !== undefined ? fallback : [];
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    return fallback !== undefined ? fallback : [];
  }
}

/**
 * Reads the current SyncRevision integer from Settings.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {number}
 */
function getSyncRevision_(ss) {
  const sheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.SETTINGS);
  if (!sheet || sheet.getLastRow() < 2) return 1;
  const values = sheet.getDataRange().getValues();
  for (let r = 1; r < values.length; r += 1) {
    if (String(values[r][0]) === 'SyncRevision') {
      const rev = Number(values[r][1]);
      return Number.isInteger(rev) && rev >= 1 ? rev : 1;
    }
  }
  return 1;
}

/**
 * Atomically increments Settings.SyncRevision inside ScriptLock.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {number}
 */
function incrementSyncRevision_(ss) {
  const sheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.SETTINGS);
  if (!sheet) return 1;
  if (sheet.getLastRow() >= 2) {
    const values = sheet.getDataRange().getValues();
    for (let r = 1; r < values.length; r += 1) {
      if (String(values[r][0]) === 'SyncRevision') {
        const nextRev = (Number(values[r][1]) || 1) + 1;
        sheet.getRange(r + 1, 2).setValue(String(nextRev));
        SpreadsheetApp.flush();
        return nextRev;
      }
    }
  }
  sheet.appendRow(['SyncRevision', '2', 'Monotonic sync cursor incremented on order writes']);
  SpreadsheetApp.flush();
  return 2;
}

/**
 * Loads all Orders and OrderItems in two batch sheet reads and normalizes them.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {{ orders: Array<Object>, ordersById: Object, itemsByOrderId: Object }}
 */
function loadAllOrdersAndItems_(ss) {
  const ordersSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDERS);
  const itemsSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDER_ITEMS);

  const rawOrders = sheetToObjects_(ordersSheet);
  const rawItems = sheetToObjects_(itemsSheet);

  const itemsByOrderId = {};
  rawItems.forEach(function (row, idx) {
    if (!String(row.order_item_id || '').trim()) return;
    const item = {
      _rowIndex: idx + 2,
      order_item_id: String(row.order_item_id),
      order_id: String(row.order_id),
      seat_id: String(row.seat_id || ''),
      table_number: row.table_number === '' || row.table_number === null ? null : Number(row.table_number),
      seat_number: row.seat_number === '' || row.seat_number === null ? null : Number(row.seat_number),
      item_id: String(row.item_id),
      item_name_snapshot: String(row.item_name_snapshot),
      unit_price_vnd: Number(row.unit_price_vnd),
      quantity: Number(row.quantity),
      modifiers: safeParseJson_(row.modifiers_json, []),
      modifiers_json: String(row.modifiers_json || '[]'),
      topping_units: Number(row.topping_units || 0),
      topping_unit_price_vnd: Number(row.topping_unit_price_vnd || ROMS_CONFIG.TOPPING_UNIT_PRICE_VND),
      line_total_vnd: Number(row.line_total_vnd),
      custom_note: String(row.custom_note || ''),
      created_at: String(row.created_at || ''),
      updated_at: String(row.updated_at || ''),
    };
    if (!itemsByOrderId[item.order_id]) {
      itemsByOrderId[item.order_id] = [];
    }
    itemsByOrderId[item.order_id].push(item);
  });

  const orders = [];
  const ordersById = {};
  rawOrders.forEach(function (row, idx) {
    if (!String(row.order_id || '').trim()) return;
    const order = {
      _rowIndex: idx + 2,
      order_id: String(row.order_id),
      order_number: String(row.order_number || ''),
      order_type: String(row.order_type),
      status: String(row.status),
      payment_status: String(row.payment_status),
      table_numbers: safeParseJson_(row.table_numbers_json, []),
      table_numbers_json: String(row.table_numbers_json || '[]'),
      subtotal_vnd: Number(row.subtotal_vnd || 0),
      total_vnd: Number(row.total_vnd || 0),
      version: Number(row.version || 1),
      idempotency_key: String(row.idempotency_key || ''),
      notes: String(row.notes || ''),
      created_at: String(row.created_at || ''),
      updated_at: String(row.updated_at || ''),
      paid_at: String(row.paid_at || ''),
      created_by: String(row.created_by || ''),
      merged_into_order_id: String(row.merged_into_order_id || ''),
      parent_order_ids: safeParseJson_(row.parent_order_ids_json, []),
      parent_order_ids_json: String(row.parent_order_ids_json || '[]'),
    };
    orders.push(order);
    ordersById[order.order_id] = order;
  });

  return {
    orders: orders,
    ordersById: ordersById,
    itemsByOrderId: itemsByOrderId,
  };
}

/**
 * Computes derived table_numbers and total_vnd from an array of item snapshots.
 * @param {string} orderType
 * @param {Array<Object>} items
 * @return {{ table_numbers: Array<number>, total_vnd: number }}
 */
function computeOrderAggregatesFromItems_(orderType, items) {
  const tableSet = {};
  let totalVnd = 0;
  items.forEach(function (it) {
    totalVnd += Number(it.line_total_vnd);
    if (orderType === 'DINE_IN' && it.seat_id) {
      const parsed = parseSeatId(it.seat_id);
      if (parsed) {
        tableSet[parsed.table_number] = true;
      }
    }
  });
  const tableNumbers = Object.keys(tableSet)
    .map(Number)
    .sort(function (a, b) {
      return a - b;
    });
  return {
    table_numbers: tableNumbers,
    total_vnd: totalVnd,
  };
}

/**
 * Updates an existing Orders row by 1-based rowIndex.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} ordersSheet
 * @param {number} rowIndex
 * @param {Array<string>} headers
 * @param {Object} orderRecord
 */
function writeOrderRowAt_(ordersSheet, rowIndex, headers, orderRecord) {
  const values = mapRecordToHeaders_(headers, orderRecord);
  ordersSheet.getRange(rowIndex, 1, 1, headers.length).setValues([values]);
}

/**
 * Updates an existing OrderItems row by 1-based rowIndex.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} itemsSheet
 * @param {number} rowIndex
 * @param {Array<string>} headers
 * @param {Object} itemRecord
 */
function writeOrderItemRowAt_(itemsSheet, rowIndex, headers, itemRecord) {
  const values = mapRecordToHeaders_(headers, itemRecord);
  itemsSheet.getRange(rowIndex, 1, 1, headers.length).setValues([values]);
}

