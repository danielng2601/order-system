/**
 * ROMS V1.0 - Order & Catalog Service Layer (Phase 1)
 */

/**
 * Returns full bootstrap payload for the POS frontend.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {Object}
 */
function handleGetBootstrap_(ss) {
  const catalog = loadCatalog_(ss);
  return {
    settings: {
      schemaVersion: String(catalog.settingsMap.SchemaVersion || ROMS_CONFIG.SCHEMA_VERSION),
      timezone: String(catalog.settingsMap.Timezone || ROMS_CONFIG.TIMEZONE),
      currency: String(catalog.settingsMap.Currency || ROMS_CONFIG.CURRENCY),
      tableCount: Number(catalog.settingsMap.TableCount || ROMS_CONFIG.TABLE_COUNT),
      seatsPerTable: Number(catalog.settingsMap.SeatsPerTable || ROMS_CONFIG.SEATS_PER_TABLE),
    },
    menuItems: catalog.menuItems,
    modifiers: catalog.modifiers.filter(function (mod) {
      return mod.is_active;
    }),
    tablesSeats: catalog.tablesSeats.filter(function (seat) {
      return seat.is_active;
    }),
    toppingUnitPriceVnd: catalog.toppingUnitPriceVnd,
    printerEnabled: PrinterService.isEnabled(catalog.settingsMap),
  };
}

/**
 * Returns menu items (including sold-out items so UI can render disabled state).
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {Object}
 */
function handleGetMenu_(ss) {
  const catalog = loadCatalog_(ss);
  return {
    menuItems: catalog.menuItems,
    toppingUnitPriceVnd: catalog.toppingUnitPriceVnd,
  };
}

/**
 * Returns active modifiers.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @return {Object}
 */
function handleGetModifiers_(ss) {
  const catalog = loadCatalog_(ss);
  return {
    modifiers: catalog.modifiers.filter(function (mod) {
      return mod.is_active;
    }),
  };
}

/**
 * Creates and persists a new order with idempotency, server-side pricing, and audit logging.
 * Must be called inside LockService.getScriptLock().
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {Object} payload
 * @return {{ statusCode: string, data?: Object, error?: Object }}
 */
function handleCreateOrder_(ss, payload) {
  const idempotencyKey = sanitizeText(payload && payload.idempotency_key, 100);
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return {
      statusCode: 'BAD_REQUEST',
      error: {
        code: 'BAD_REQUEST',
        message: 'idempotency_key (min 8 chars) is required for createOrder.',
      },
    };
  }

  const cached = findIdempotentResponse_(ss, idempotencyKey, 'createOrder');
  if (cached) {
    return {
      statusCode: 'OK',
      data: Object.assign({}, cached, { replayed: true }),
    };
  }

  const catalog = loadCatalog_(ss);
  const validation = validateAndPriceOrderPayload(payload, catalog);
  if (!validation.valid) {
    return {
      statusCode: 'VALIDATION_ERROR',
      error: {
        code: 'VALIDATION_ERROR',
        message: validation.errors.join('; '),
        details: validation.errors,
      },
    };
  }

  const now = new Date();
  const nowStr = formatLocalTimestamp(now);
  let orderId = '';
  for (let attempt = 0; attempt < ROMS_CONFIG.MAX_ORDER_ID_RETRIES; attempt += 1) {
    const candidate = generateOrderId(now);
    if (!orderIdExists_(ss, candidate)) {
      orderId = candidate;
      break;
    }
  }
  if (!orderId) {
    throw new Error('Could not generate a unique order_id after retries.');
  }
  const dailySeq = nextDailyOrderSequence_(ss, now);
  const orderNumber = formatOrderNumber(now, dailySeq);
  const norm = validation.normalized;
  const actor = sanitizeText(payload.actor, 60) || 'staff';

  const orderRecord = {
    order_id: orderId,
    order_number: orderNumber,
    order_type: norm.order_type,
    status: norm.status,
    payment_status: norm.payment_status,
    table_numbers_json: JSON.stringify(norm.table_numbers),
    subtotal_vnd: norm.subtotal_vnd,
    total_vnd: norm.total_vnd,
    version: 1,
    idempotency_key: idempotencyKey,
    notes: norm.notes,
    created_at: nowStr,
    updated_at: nowStr,
    paid_at: '',
    created_by: actor,
    merged_into_order_id: '',
    parent_order_ids_json: '[]',
  };

  const itemRecords = norm.items.map(function (item, idx) {
    const lineNum = String(idx + 1).padStart(2, '0');
    return {
      order_item_id: orderId + '-L' + lineNum,
      order_id: orderId,
      seat_id: item.seat_id,
      table_number: item.table_number === null ? '' : item.table_number,
      seat_number: item.seat_number === null ? '' : item.seat_number,
      item_id: item.item_id,
      item_name_snapshot: item.item_name_snapshot,
      unit_price_vnd: item.unit_price_vnd,
      quantity: item.quantity,
      modifiers_json: JSON.stringify(item.modifier_snapshots),
      topping_units: item.topping_units,
      topping_unit_price_vnd: item.topping_unit_price_vnd,
      line_total_vnd: item.line_total_vnd,
      custom_note: item.custom_note,
      created_at: nowStr,
      updated_at: nowStr,
    };
  });

  const responseData = {
    order: {
      order_id: orderRecord.order_id,
      order_number: orderRecord.order_number,
      order_type: orderRecord.order_type,
      status: orderRecord.status,
      payment_status: orderRecord.payment_status,
      table_numbers: norm.table_numbers,
      base_subtotal_vnd: norm.base_subtotal_vnd,
      topping_subtotal_vnd: norm.topping_subtotal_vnd,
      subtotal_vnd: orderRecord.subtotal_vnd,
      total_vnd: orderRecord.total_vnd,
      version: orderRecord.version,
      notes: orderRecord.notes,
      created_at: orderRecord.created_at,
    },
    items: norm.items.map(function (item, idx) {
      return Object.assign({}, item, {
        order_item_id: itemRecords[idx].order_item_id,
      });
    }),
    printStatus: PrinterService.printOrderIfEnabled(orderRecord, norm.items, catalog.settingsMap),
    replayed: false,
  };

  const idempotencyRecord = {
    idempotency_key: idempotencyKey,
    action: 'createOrder',
    order_id: orderId,
    response_json: JSON.stringify(responseData),
    created_at: nowStr,
  };

  const auditRecord = {
    log_id: 'LOG-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
    timestamp: nowStr,
    action: 'CREATE_ORDER',
    entity_type: 'ORDER',
    entity_id: orderId,
    actor: actor,
    request_id: idempotencyKey,
    details_json: JSON.stringify({
      order_number: orderNumber,
      order_type: norm.order_type,
      item_count: itemRecords.length,
      total_vnd: norm.total_vnd,
    }),
  };

  persistOrderAtomically_(ss, orderRecord, itemRecords, idempotencyRecord, auditRecord);

  return {
    statusCode: 'OK',
    data: Object.assign({}, responseData, { syncRevision: getSyncRevision_(ss) }),
  };
}
