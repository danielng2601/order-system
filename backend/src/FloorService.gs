/**
 * ROMS V1.0 - Phase 2 Floor, Seat, Active Order, Merge, Split & Sync Service
 */

function isActiveOrderStatus_(status) {
  return ROMS_CONFIG.ACTIVE_ORDER_STATUSES.indexOf(status) !== -1;
}

function buildSeatAndTableSubtotals_(orderType, items) {
  const seatTotals = {};
  const tableTotals = {};
  items.forEach(function (it) {
    const lineTotal = Number(it.line_total_vnd || 0);
    if (orderType === 'DINE_IN' && it.seat_id) {
      seatTotals[it.seat_id] = (seatTotals[it.seat_id] || 0) + lineTotal;
      if (it.table_number) {
        const tKey = String(it.table_number);
        tableTotals[tKey] = (tableTotals[tKey] || 0) + lineTotal;
      }
    }
  });
  return { seatSubtotals: seatTotals, tableSubtotals: tableTotals };
}

function formatPublicOrder_(order, items) {
  const aggs = computeOrderAggregatesFromItems_(order.order_type, items || []);
  return {
    order_id: order.order_id,
    order_number: order.order_number,
    order_type: order.order_type,
    status: order.status,
    payment_status: order.payment_status,
    payment_method: order.payment_method || '',
    paid_at: order.paid_at || '',
    cancelled_at: order.cancelled_at || '',
    cancel_reason: order.cancel_reason || '',
    cancelled_by: order.cancelled_by || '',
    table_numbers: order.table_numbers && order.table_numbers.length ? order.table_numbers : aggs.table_numbers,
    subtotal_vnd: order.subtotal_vnd,
    total_vnd: order.total_vnd,
    version: order.version,
    notes: order.notes,
    created_at: order.created_at,
    updated_at: order.updated_at,
    created_by: order.created_by,
    merged_into_order_id: order.merged_into_order_id || '',
    parent_order_ids: order.parent_order_ids || [],
    item_count: (items || []).length,
  };
}

/**
 * Lightweight sync cursor endpoint for multi-device polling.
 */
function handleGetSyncStatus_(ss) {
  return {
    syncRevision: getSyncRevision_(ss),
    serverTime: formatLocalTimestamp(),
  };
}

/**
 * Returns full 9-table, 36-seat floor state with occupancy and active orders.
 */
function handleGetFloorState_(ss) {
  const catalog = loadCatalog_(ss);
  const db = loadAllOrdersAndItems_(ss);
  const syncRevision = getSyncRevision_(ss);

  const activeOrders = db.orders.filter(function (o) {
    return isActiveOrderStatus_(o.status) && o.payment_status !== 'Paid';
  });

  const seatOccupancy = {};
  activeOrders.forEach(function (order) {
    if (order.order_type !== 'DINE_IN') return;
    const items = db.itemsByOrderId[order.order_id] || [];
    items.forEach(function (it) {
      if (!it.seat_id) return;
      if (!seatOccupancy[it.seat_id]) {
        seatOccupancy[it.seat_id] = {
          order_ids: [],
          order_numbers: [],
          subtotal_vnd: 0,
          item_count: 0,
        };
      }
      const occ = seatOccupancy[it.seat_id];
      if (occ.order_ids.indexOf(order.order_id) === -1) {
        occ.order_ids.push(order.order_id);
        occ.order_numbers.push(order.order_number || order.order_id);
      }
      occ.subtotal_vnd += Number(it.line_total_vnd || 0);
      occ.item_count += Number(it.quantity || 0);
    });
  });

  const seats = catalog.tablesSeats.map(function (seat) {
    const occ = seatOccupancy[seat.seat_id] || null;
    let seatStatus = 'available';
    if (!seat.is_active) {
      seatStatus = 'unavailable';
    } else if (occ) {
      seatStatus = 'occupied';
    }
    return {
      seat_id: seat.seat_id,
      table_number: seat.table_number,
      seat_number: seat.seat_number,
      label: seat.label,
      is_active: seat.is_active,
      status: seatStatus,
      order_ids: occ ? occ.order_ids : [],
      order_numbers: occ ? occ.order_numbers : [],
      subtotal_vnd: occ ? occ.subtotal_vnd : 0,
      item_count: occ ? occ.item_count : 0,
    };
  });

  const tablesMap = {};
  for (let t = 1; t <= ROMS_CONFIG.TABLE_COUNT; t += 1) {
    tablesMap[t] = {
      table_number: t,
      label: 'Bàn ' + t,
      seats: [],
      occupied_seats: 0,
      available_seats: 0,
      unavailable_seats: 0,
      active_order_ids: [],
      active_order_numbers: [],
      active_total_vnd: 0,
    };
  }

  seats.forEach(function (s) {
    const tbl = tablesMap[s.table_number];
    if (!tbl) return;
    tbl.seats.push(s);
    if (s.status === 'occupied') tbl.occupied_seats += 1;
    else if (s.status === 'unavailable') tbl.unavailable_seats += 1;
    else tbl.available_seats += 1;
    tbl.active_total_vnd += s.subtotal_vnd;
    s.order_ids.forEach(function (oid, idx) {
      if (tbl.active_order_ids.indexOf(oid) === -1) {
        tbl.active_order_ids.push(oid);
        tbl.active_order_numbers.push(s.order_numbers[idx]);
      }
    });
  });

  const tables = Object.keys(tablesMap)
    .map(Number)
    .sort(function (a, b) {
      return a - b;
    })
    .map(function (t) {
      return tablesMap[t];
    });

  return {
    syncRevision: syncRevision,
    serverTime: formatLocalTimestamp(),
    tables: tables,
    seats: seats,
    activeOrders: activeOrders.map(function (o) {
      return formatPublicOrder_(o, db.itemsByOrderId[o.order_id] || []);
    }),
  };
}

/**
 * Lists active orders with optional filters.
 */
function handleListActiveOrders_(ss, filters) {
  const f = filters || {};
  const db = loadAllOrdersAndItems_(ss);
  const syncRevision = getSyncRevision_(ss);

  let orders = db.orders.filter(function (o) {
    return isActiveOrderStatus_(o.status) && o.payment_status !== 'Paid';
  });

  if (f.order_type && ROMS_CONFIG.ORDER_TYPES.indexOf(f.order_type) !== -1) {
    orders = orders.filter(function (o) {
      return o.order_type === f.order_type;
    });
  }
  if (f.order_number) {
    const q = sanitizeText(f.order_number, 32).toLowerCase();
    orders = orders.filter(function (o) {
      return (
        o.order_number.toLowerCase().indexOf(q) !== -1 ||
        o.order_id.toLowerCase().indexOf(q) !== -1
      );
    });
  }
  if (f.table_number) {
    const tblNum = Number(f.table_number);
    orders = orders.filter(function (o) {
      return o.table_numbers.indexOf(tblNum) !== -1;
    });
  }
  if (f.seat_id) {
    const targetSeat = sanitizeText(f.seat_id, 16);
    orders = orders.filter(function (o) {
      const items = db.itemsByOrderId[o.order_id] || [];
      return items.some(function (it) {
        return it.seat_id === targetSeat;
      });
    });
  }

  return {
    syncRevision: syncRevision,
    orders: orders.map(function (o) {
      return formatPublicOrder_(o, db.itemsByOrderId[o.order_id] || []);
    }),
  };
}

/**
 * Returns complete order detail with seat/table subtotals.
 */
function handleGetOrderDetail_(ss, payload) {
  const orderId = sanitizeText(payload && payload.order_id, 64);
  if (!orderId) {
    return { error: { code: 'BAD_REQUEST', message: 'order_id is required.' } };
  }
  const db = loadAllOrdersAndItems_(ss);
  const order = db.ordersById[orderId];
  if (!order) {
    return { error: { code: 'NOT_FOUND', message: 'Order not found: ' + orderId } };
  }
  const items = db.itemsByOrderId[orderId] || [];
  const subs = buildSeatAndTableSubtotals_(order.order_type, items);

  const payData = loadAllPayments_(ss);
  const ordPayments = payData.paymentsByOrderId[orderId] || [];
  const payment = ordPayments.find(function (p) { return p.payment_status === 'Paid'; }) || ordPayments[0] || null;

  const auditSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.AUDIT_LOG);
  const auditRows = sheetToObjects_(auditSheet);
  const auditHistory = auditRows
    .filter(function (a) {
      if (String(a.entity_id) === orderId) return true;
      const details = safeParseJson_(a.details_json, {});
      return details && (details.order_id === orderId || details.source_order_id === orderId || details.destination_order_id === orderId);
    })
    .map(function (a) {
      return {
        log_id: String(a.log_id || ''),
        timestamp: String(a.timestamp || ''),
        action: String(a.action || ''),
        actor: String(a.actor || ''),
        details: safeParseJson_(a.details_json, {}),
      };
    });

  return {
    data: {
      syncRevision: getSyncRevision_(ss),
      order: formatPublicOrder_(order, items),
      items: items.map(function (it) {
        return {
          order_item_id: it.order_item_id,
          order_id: it.order_id,
          seat_id: it.seat_id,
          table_number: it.table_number,
          seat_number: it.seat_number,
          item_id: it.item_id,
          item_name_snapshot: it.item_name_snapshot,
          unit_price_vnd: it.unit_price_vnd,
          quantity: it.quantity,
          modifiers: it.modifiers,
          topping_units: it.topping_units,
          topping_unit_price_vnd: it.topping_unit_price_vnd,
          line_total_vnd: it.line_total_vnd,
          custom_note: it.custom_note,
          created_at: it.created_at,
          updated_at: it.updated_at,
        };
      }),
      seatSubtotals: subs.seatSubtotals,
      tableSubtotals: subs.tableSubtotals,
      payment: payment
        ? {
            payment_id: payment.payment_id,
            amount_vnd: payment.amount_vnd,
            payment_method: payment.payment_method,
            payment_status: payment.payment_status,
            reference_note: payment.reference_note,
            created_at: payment.created_at,
            created_by: payment.created_by,
          }
        : null,
      auditHistory: auditHistory,
    },
  };
}

/**
 * Adds new items to an existing active order while preserving original item snapshots.
 */
function handleAddItemsToOrder_(ss, payload) {
  const idempotencyKey = sanitizeText(payload && payload.idempotency_key, 100);
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return { error: { code: 'BAD_REQUEST', message: 'idempotency_key (min 8 chars) is required.' } };
  }

  const cached = findIdempotentResponse_(ss, idempotencyKey, 'addItemsToOrder');
  if (cached) {
    return { data: Object.assign({}, cached, { replayed: true }) };
  }

  const orderId = sanitizeText(payload && payload.order_id, 64);
  const expectedVersion = Number(payload && payload.expected_version);
  if (!orderId || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { error: { code: 'BAD_REQUEST', message: 'order_id and integer expected_version are required.' } };
  }

  const db = loadAllOrdersAndItems_(ss);
  const order = db.ordersById[orderId];
  if (!order) {
    return { error: { code: 'NOT_FOUND', message: 'Order not found: ' + orderId } };
  }
  if (!isActiveOrderStatus_(order.status)) {
    return {
      error: {
        code: 'INVALID_STATE',
        message: 'Cannot add items to order with status: ' + order.status,
      },
    };
  }
  if (order.payment_status === 'Paid') {
    return {
      error: {
        code: 'INVALID_STATE',
        message: 'Cannot add items to an already Paid order.',
      },
    };
  }
  if (order.version !== expectedVersion) {
    return {
      error: {
        code: 'VERSION_CONFLICT',
        message: 'Đơn hàng đã được cập nhật từ thiết bị khác. Vui lòng tải lại.',
        latestOrder: formatPublicOrder_(order, db.itemsByOrderId[orderId] || []),
      },
    };
  }

  const catalog = loadCatalog_(ss);
  const validation = validateAndPriceOrderPayload(
    { order_type: order.order_type, items: payload.items },
    catalog
  );
  if (!validation.valid) {
    return {
      error: {
        code: 'VALIDATION_ERROR',
        message: validation.errors.join('; '),
        details: validation.errors,
      },
    };
  }

  const existingItems = db.itemsByOrderId[orderId] || [];
  const nowStr = formatLocalTimestamp();
  const baseIndex = existingItems.length;
  const newItemRecords = validation.normalized.items.map(function (item, idx) {
    const lineNum = String(baseIndex + idx + 1).padStart(2, '0');
    return {
      order_item_id: orderId + '-L' + lineNum + '-' + Utilities.getUuid().slice(0, 4).toUpperCase(),
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

  const allItems = existingItems.concat(newItemRecords);
  const aggs = computeOrderAggregatesFromItems_(order.order_type, allItems);
  const updatedOrderRecord = Object.assign({}, order, {
    table_numbers: aggs.table_numbers,
    table_numbers_json: JSON.stringify(aggs.table_numbers),
    subtotal_vnd: aggs.total_vnd,
    total_vnd: aggs.total_vnd,
    version: order.version + 1,
    updated_at: nowStr,
  });

  const ordersSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDERS);
  const itemsSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDER_ITEMS);
  const idempSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.IDEMPOTENCY_KEYS);
  const auditSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.AUDIT_LOG);

  const orderHeaders = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0];
  const itemHeaders = itemsSheet.getRange(1, 1, 1, itemsSheet.getLastColumn()).getValues()[0];
  const idempHeaders = idempSheet.getRange(1, 1, 1, idempSheet.getLastColumn()).getValues()[0];
  const auditHeaders = auditSheet.getRange(1, 1, 1, auditSheet.getLastColumn()).getValues()[0];

  const newRowsValues = newItemRecords.map(function (it) {
    return mapRecordToHeaders_(itemHeaders, it);
  });
  const itemStartRow = itemsSheet.getLastRow() + 1;
  const idempRowIdx = idempSheet.getLastRow() + 1;
  let itemsWritten = false;
  let orderUpdated = false;
  let idempWritten = false;

  const responseData = {
    order: formatPublicOrder_(updatedOrderRecord, allItems),
    addedItems: newItemRecords,
    replayed: false,
  };

  try {
    itemsSheet.getRange(itemStartRow, 1, newRowsValues.length, itemHeaders.length).setValues(newRowsValues);
    itemsWritten = true;

    writeOrderRowAt_(ordersSheet, order._rowIndex, orderHeaders, updatedOrderRecord);
    orderUpdated = true;

    const idempValues = mapRecordToHeaders_(idempHeaders, {
      idempotency_key: idempotencyKey,
      action: 'addItemsToOrder',
      order_id: orderId,
      response_json: JSON.stringify(responseData),
      created_at: nowStr,
    });
    idempSheet.getRange(idempRowIdx, 1, 1, idempHeaders.length).setValues([idempValues]);
    idempWritten = true;

    auditSheet.appendRow(
      mapRecordToHeaders_(auditHeaders, {
        log_id: 'LOG-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
        timestamp: nowStr,
        action: 'ADD_ITEMS',
        entity_type: 'ORDER',
        entity_id: orderId,
        actor: sanitizeText(payload.actor, 60) || 'staff',
        request_id: idempotencyKey,
        details_json: JSON.stringify({
          added_count: newItemRecords.length,
          new_total_vnd: aggs.total_vnd,
          new_version: updatedOrderRecord.version,
        }),
      })
    );
    SpreadsheetApp.flush();
    const syncRevision = incrementSyncRevision_(ss);
    return { data: Object.assign({}, responseData, { syncRevision: syncRevision }) };
  } catch (err) {
    try {
      if (idempWritten && idempSheet.getLastRow() >= idempRowIdx && String(idempSheet.getRange(idempRowIdx, 1).getValue()) === idempotencyKey) {
        idempSheet.deleteRow(idempRowIdx);
      }
      if (orderUpdated) writeOrderRowAt_(ordersSheet, order._rowIndex, orderHeaders, order);
      if (itemsWritten) {
        for (let i = newRowsValues.length - 1; i >= 0; i -= 1) {
          if (itemsSheet.getLastRow() >= itemStartRow + i) {
            itemsSheet.deleteRow(itemStartRow + i);
          }
        }
      }
      SpreadsheetApp.flush();
    } catch (rbErr) {}
    throw err;
  }
}

/**
 * Moves an individual DINE_IN order item to another valid active seat.
 */
function handleMoveOrderItem_(ss, payload) {
  const idempotencyKey = sanitizeText(payload && payload.idempotency_key, 100);
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return { error: { code: 'BAD_REQUEST', message: 'idempotency_key (min 8 chars) is required.' } };
  }

  const cached = findIdempotentResponse_(ss, idempotencyKey, 'moveOrderItem');
  if (cached) {
    return { data: Object.assign({}, cached, { replayed: true }) };
  }

  const orderId = sanitizeText(payload && payload.order_id, 64);
  const orderItemId = sanitizeText(payload && payload.order_item_id, 80);
  const targetSeatId = sanitizeText(payload && payload.target_seat_id, 16);
  const expectedVersion = Number(payload && payload.expected_version);

  if (!orderId || !orderItemId || !isValidSeatId(targetSeatId) || !Number.isInteger(expectedVersion)) {
    return { error: { code: 'BAD_REQUEST', message: 'order_id, order_item_id, valid target_seat_id, and expected_version are required.' } };
  }

  const catalog = loadCatalog_(ss);
  const seatObj = catalog.validSeatsById[targetSeatId];
  if (!seatObj || !seatObj.is_active) {
    return { error: { code: 'VALIDATION_ERROR', message: 'Target seat is unavailable: ' + targetSeatId } };
  }

  const db = loadAllOrdersAndItems_(ss);
  const order = db.ordersById[orderId];
  if (!order) {
    return { error: { code: 'NOT_FOUND', message: 'Order not found: ' + orderId } };
  }
  if (order.order_type !== 'DINE_IN') {
    return { error: { code: 'INVALID_STATE', message: 'TAKEAWAY orders cannot assign seats.' } };
  }
  if (!isActiveOrderStatus_(order.status)) {
    return { error: { code: 'INVALID_STATE', message: 'Cannot move items on order status: ' + order.status } };
  }
  if (order.version !== expectedVersion) {
    return {
      error: {
        code: 'VERSION_CONFLICT',
        message: 'Đơn hàng đã được cập nhật từ thiết bị khác. Vui lòng tải lại.',
        latestOrder: formatPublicOrder_(order, db.itemsByOrderId[orderId] || []),
      },
    };
  }

  const items = db.itemsByOrderId[orderId] || [];
  const targetItem = items.find(function (it) {
    return it.order_item_id === orderItemId;
  });
  if (!targetItem) {
    return { error: { code: 'NOT_FOUND', message: 'Order item not found in order: ' + orderItemId } };
  }

  const nowStr = formatLocalTimestamp();
  const parsedSeat = parseSeatId(targetSeatId);
  const prevSeatId = targetItem.seat_id;

  const updatedItem = Object.assign({}, targetItem, {
    seat_id: targetSeatId,
    table_number: parsedSeat.table_number,
    seat_number: parsedSeat.seat_number,
    updated_at: nowStr,
  });

  const updatedItemsList = items.map(function (it) {
    return it.order_item_id === orderItemId ? updatedItem : it;
  });
  const aggs = computeOrderAggregatesFromItems_(order.order_type, updatedItemsList);
  const updatedOrder = Object.assign({}, order, {
    table_numbers: aggs.table_numbers,
    table_numbers_json: JSON.stringify(aggs.table_numbers),
    version: order.version + 1,
    updated_at: nowStr,
  });

  const ordersSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDERS);
  const itemsSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDER_ITEMS);
  const idempSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.IDEMPOTENCY_KEYS);
  const auditSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.AUDIT_LOG);

  const orderHeaders = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0];
  const itemHeaders = itemsSheet.getRange(1, 1, 1, itemsSheet.getLastColumn()).getValues()[0];
  const idempHeaders = idempSheet.getRange(1, 1, 1, idempSheet.getLastColumn()).getValues()[0];
  const auditHeaders = auditSheet.getRange(1, 1, 1, auditSheet.getLastColumn()).getValues()[0];

  const responseData = {
    order: formatPublicOrder_(updatedOrder, updatedItemsList),
    movedItem: updatedItem,
    replayed: false,
  };

  const idempRowIdx = idempSheet.getLastRow() + 1;
  let itemWritten = false;
  let orderWritten = false;
  let idempWritten = false;
  try {
    writeOrderItemRowAt_(itemsSheet, targetItem._rowIndex, itemHeaders, updatedItem);
    itemWritten = true;
    writeOrderRowAt_(ordersSheet, order._rowIndex, orderHeaders, updatedOrder);
    orderWritten = true;

    const idempValues = mapRecordToHeaders_(idempHeaders, {
      idempotency_key: idempotencyKey,
      action: 'moveOrderItem',
      order_id: orderId,
      response_json: JSON.stringify(responseData),
      created_at: nowStr,
    });
    idempSheet.getRange(idempRowIdx, 1, 1, idempHeaders.length).setValues([idempValues]);
    idempWritten = true;

    auditSheet.appendRow(
      mapRecordToHeaders_(auditHeaders, {
        log_id: 'LOG-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
        timestamp: nowStr,
        action: 'MOVE_ITEM',
        entity_type: 'ORDER_ITEM',
        entity_id: orderItemId,
        actor: sanitizeText(payload.actor, 60) || 'staff',
        request_id: idempotencyKey,
        details_json: JSON.stringify({
          order_id: orderId,
          from_seat: prevSeatId,
          to_seat: targetSeatId,
          new_version: updatedOrder.version,
        }),
      })
    );
    SpreadsheetApp.flush();
    const syncRevision = incrementSyncRevision_(ss);
    return { data: Object.assign({}, responseData, { syncRevision: syncRevision }) };
  } catch (err) {
    try {
      if (idempWritten && idempSheet.getLastRow() >= idempRowIdx && String(idempSheet.getRange(idempRowIdx, 1).getValue()) === idempotencyKey) {
        idempSheet.deleteRow(idempRowIdx);
      }
      if (orderWritten) writeOrderRowAt_(ordersSheet, order._rowIndex, orderHeaders, order);
      if (itemWritten) writeOrderItemRowAt_(itemsSheet, targetItem._rowIndex, itemHeaders, targetItem);
      SpreadsheetApp.flush();
    } catch (rbErr) {}
    throw err;
  }
}

/**
 * Merges 2 or more active orders into a new consolidated order, marking sources as Merged.
 */
function handleMergeOrders_(ss, payload) {
  const idempotencyKey = sanitizeText(payload && payload.idempotency_key, 100);
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return { error: { code: 'BAD_REQUEST', message: 'idempotency_key (min 8 chars) is required.' } };
  }

  const cached = findIdempotentResponse_(ss, idempotencyKey, 'mergeOrders');
  if (cached) {
    return { data: Object.assign({}, cached, { replayed: true }) };
  }

  const sourceSpecs = payload && payload.source_orders;
  if (!Array.isArray(sourceSpecs) || sourceSpecs.length < 2) {
    return { error: { code: 'BAD_REQUEST', message: 'At least 2 source_orders are required to merge.' } };
  }

  const db = loadAllOrdersAndItems_(ss);
  const seenIds = {};
  const sourceOrders = [];
  let expectedOrderType = null;

  for (let i = 0; i < sourceSpecs.length; i += 1) {
    const spec = sourceSpecs[i];
    const oid = sanitizeText(spec && spec.order_id, 64);
    const expVer = Number(spec && spec.expected_version);
    if (!oid || !Number.isInteger(expVer) || expVer < 1) {
      return { error: { code: 'BAD_REQUEST', message: 'Each source order requires order_id and expected_version.' } };
    }
    if (seenIds[oid]) {
      return { error: { code: 'BAD_REQUEST', message: 'Duplicate source order_id: ' + oid } };
    }
    seenIds[oid] = true;

    const order = db.ordersById[oid];
    if (!order) {
      return { error: { code: 'NOT_FOUND', message: 'Order not found: ' + oid } };
    }
    if (!isActiveOrderStatus_(order.status)) {
      return { error: { code: 'INVALID_STATE', message: 'Order ' + oid + ' cannot be merged (status: ' + order.status + ').' } };
    }
    if (order.payment_status === 'Paid') {
      return { error: { code: 'INVALID_STATE', message: 'Paid order ' + oid + ' cannot be merged.' } };
    }
    if (order.version !== expVer) {
      return {
        error: {
          code: 'VERSION_CONFLICT',
          message: 'Đơn ' + (order.order_number || oid) + ' đã thay đổi từ thiết bị khác.',
          latestOrder: formatPublicOrder_(order, db.itemsByOrderId[oid] || []),
        },
      };
    }
    if (!expectedOrderType) {
      expectedOrderType = order.order_type;
    } else if (order.order_type !== expectedOrderType) {
      return { error: { code: 'VALIDATION_ERROR', message: 'Cannot merge DINE_IN and TAKEAWAY orders together.' } };
    }
    sourceOrders.push(order);
  }

  const now = new Date();
  const nowStr = formatLocalTimestamp(now);
  let destOrderId = '';
  for (let attempt = 0; attempt < ROMS_CONFIG.MAX_ORDER_ID_RETRIES; attempt += 1) {
    const candidate = generateOrderId(now);
    if (!orderIdExists_(ss, candidate)) {
      destOrderId = candidate;
      break;
    }
  }
  if (!destOrderId) {
    throw new Error('Could not generate unique destination order_id for merge.');
  }

  const destOrderNumber = formatOrderNumber(now, nextDailyOrderSequence_(ss, now));
  const actor = sanitizeText(payload.actor, 60) || 'staff';
  const sourceIds = sourceOrders.map(function (o) {
    return o.order_id;
  });

  const originalItems = [];
  const reassignedItems = [];
  sourceOrders.forEach(function (src) {
    const srcItems = db.itemsByOrderId[src.order_id] || [];
    srcItems.forEach(function (it) {
      originalItems.push(it);
      reassignedItems.push(
        Object.assign({}, it, {
          order_id: destOrderId,
          updated_at: nowStr,
        })
      );
    });
  });

  if (reassignedItems.length === 0) {
    return { error: { code: 'INVALID_STATE', message: 'Cannot merge orders with zero items.' } };
  }

  const aggs = computeOrderAggregatesFromItems_(expectedOrderType, reassignedItems);
  const destOrderRecord = {
    order_id: destOrderId,
    order_number: destOrderNumber,
    order_type: expectedOrderType,
    status: 'Confirmed',
    payment_status: 'Unpaid',
    table_numbers: aggs.table_numbers,
    table_numbers_json: JSON.stringify(aggs.table_numbers),
    subtotal_vnd: aggs.total_vnd,
    total_vnd: aggs.total_vnd,
    version: 1,
    idempotency_key: idempotencyKey,
    notes: sanitizeText(payload.notes, 500) || ('Gộp từ: ' + sourceOrders.map(function (o) { return o.order_number || o.order_id; }).join(', ')),
    created_at: nowStr,
    updated_at: nowStr,
    paid_at: '',
    created_by: actor,
    merged_into_order_id: '',
    parent_order_ids: sourceIds,
    parent_order_ids_json: JSON.stringify(sourceIds),
  };

  const ordersSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDERS);
  const itemsSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDER_ITEMS);
  const idempSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.IDEMPOTENCY_KEYS);
  const auditSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.AUDIT_LOG);

  const orderHeaders = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0];
  const itemHeaders = itemsSheet.getRange(1, 1, 1, itemsSheet.getLastColumn()).getValues()[0];
  const idempHeaders = idempSheet.getRange(1, 1, 1, idempSheet.getLastColumn()).getValues()[0];
  const auditHeaders = auditSheet.getRange(1, 1, 1, auditSheet.getLastColumn()).getValues()[0];

  const destOrderRow = ordersSheet.getLastRow() + 1;
  const idempRowIdx = idempSheet.getLastRow() + 1;

  const responseData = {
    order: formatPublicOrder_(destOrderRecord, reassignedItems),
    items: reassignedItems,
    mergedSourceOrderIds: sourceIds,
    replayed: false,
  };

  let destOrderWritten = false;
  const movedItemsOrig = [];
  const updatedSourcesOrig = [];
  let idempWritten = false;

  try {
    writeOrderRowAt_(ordersSheet, destOrderRow, orderHeaders, destOrderRecord);
    destOrderWritten = true;

    for (let idx = 0; idx < reassignedItems.length; idx += 1) {
      writeOrderItemRowAt_(itemsSheet, originalItems[idx]._rowIndex, itemHeaders, reassignedItems[idx]);
      movedItemsOrig.push(originalItems[idx]);
    }

    sourceOrders.forEach(function (src) {
      const mergedSrc = Object.assign({}, src, {
        status: 'Merged',
        merged_into_order_id: destOrderId,
        version: src.version + 1,
        updated_at: nowStr,
      });
      writeOrderRowAt_(ordersSheet, src._rowIndex, orderHeaders, mergedSrc);
      updatedSourcesOrig.push(src);
    });

    const idempValues = mapRecordToHeaders_(idempHeaders, {
      idempotency_key: idempotencyKey,
      action: 'mergeOrders',
      order_id: destOrderId,
      response_json: JSON.stringify(responseData),
      created_at: nowStr,
    });
    idempSheet.getRange(idempRowIdx, 1, 1, idempHeaders.length).setValues([idempValues]);
    idempWritten = true;

    auditSheet.appendRow(
      mapRecordToHeaders_(auditHeaders, {
        log_id: 'LOG-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
        timestamp: nowStr,
        action: 'MERGE_ORDERS',
        entity_type: 'ORDER',
        entity_id: destOrderId,
        actor: actor,
        request_id: idempotencyKey,
        details_json: JSON.stringify({
          source_order_ids: sourceIds,
          destination_order_id: destOrderId,
          destination_order_number: destOrderNumber,
          reassigned_item_ids: reassignedItems.map(function (it) { return it.order_item_id; }),
          total_vnd: aggs.total_vnd,
        }),
      })
    );

    SpreadsheetApp.flush();
    const syncRevision = incrementSyncRevision_(ss);
    return { data: Object.assign({}, responseData, { syncRevision: syncRevision }) };
  } catch (err) {
    try {
      if (idempWritten && idempSheet.getLastRow() >= idempRowIdx && String(idempSheet.getRange(idempRowIdx, 1).getValue()) === idempotencyKey) {
        idempSheet.deleteRow(idempRowIdx);
      }
      updatedSourcesOrig.forEach(function (origSrc) {
        writeOrderRowAt_(ordersSheet, origSrc._rowIndex, orderHeaders, origSrc);
      });
      movedItemsOrig.forEach(function (origIt) {
        writeOrderItemRowAt_(itemsSheet, origIt._rowIndex, itemHeaders, origIt);
      });
      if (destOrderWritten && ordersSheet.getLastRow() >= destOrderRow) {
        ordersSheet.deleteRow(destOrderRow);
      }
      SpreadsheetApp.flush();
    } catch (rbErr) {}
    throw err;
  }
}

/**
 * Splits selected items from an active order into a new order while preserving snapshots and totals.
 */
function handleSplitOrder_(ss, payload) {
  const idempotencyKey = sanitizeText(payload && payload.idempotency_key, 100);
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return { error: { code: 'BAD_REQUEST', message: 'idempotency_key (min 8 chars) is required.' } };
  }

  const cached = findIdempotentResponse_(ss, idempotencyKey, 'splitOrder');
  if (cached) {
    return { data: Object.assign({}, cached, { replayed: true }) };
  }

  const sourceOrderId = sanitizeText(payload && payload.source_order_id, 64);
  const expectedVersion = Number(payload && payload.expected_version);
  const rawSplitIds = payload && payload.split_item_ids;

  if (!sourceOrderId || !Number.isInteger(expectedVersion) || !Array.isArray(rawSplitIds) || rawSplitIds.length === 0) {
    return { error: { code: 'BAD_REQUEST', message: 'source_order_id, expected_version, and non-empty split_item_ids are required.' } };
  }

  const db = loadAllOrdersAndItems_(ss);
  const sourceOrder = db.ordersById[sourceOrderId];
  if (!sourceOrder) {
    return { error: { code: 'NOT_FOUND', message: 'Order not found: ' + sourceOrderId } };
  }
  if (!isActiveOrderStatus_(sourceOrder.status)) {
    return { error: { code: 'INVALID_STATE', message: 'Cannot split order with status: ' + sourceOrder.status } };
  }
  if (sourceOrder.payment_status === 'Paid') {
    return { error: { code: 'INVALID_STATE', message: 'Cannot split an already Paid order.' } };
  }
  if (sourceOrder.version !== expectedVersion) {
    return {
      error: {
        code: 'VERSION_CONFLICT',
        message: 'Đơn hàng đã được cập nhật từ thiết bị khác. Vui lòng tải lại.',
        latestOrder: formatPublicOrder_(sourceOrder, db.itemsByOrderId[sourceOrderId] || []),
      },
    };
  }

  const allItems = db.itemsByOrderId[sourceOrderId] || [];
  const itemsById = {};
  allItems.forEach(function (it) {
    itemsById[it.order_item_id] = it;
  });

  const seenSplit = {};
  const splitItems = [];
  for (let i = 0; i < rawSplitIds.length; i += 1) {
    const itemId = sanitizeText(rawSplitIds[i], 80);
    if (seenSplit[itemId]) {
      return { error: { code: 'BAD_REQUEST', message: 'Duplicate item_id in split_item_ids: ' + itemId } };
    }
    if (!itemsById[itemId]) {
      return { error: { code: 'VALIDATION_ERROR', message: 'Item does not belong to source order: ' + itemId } };
    }
    seenSplit[itemId] = true;
    splitItems.push(itemsById[itemId]);
  }

  const remainingItems = allItems.filter(function (it) {
    return !seenSplit[it.order_item_id];
  });
  if (remainingItems.length === 0) {
    return { error: { code: 'VALIDATION_ERROR', message: 'Split must leave at least 1 item in the original order.' } };
  }

  const now = new Date();
  const nowStr = formatLocalTimestamp(now);
  let newOrderId = '';
  for (let attempt = 0; attempt < ROMS_CONFIG.MAX_ORDER_ID_RETRIES; attempt += 1) {
    const candidate = generateOrderId(now);
    if (!orderIdExists_(ss, candidate)) {
      newOrderId = candidate;
      break;
    }
  }
  if (!newOrderId) {
    throw new Error('Could not generate unique newOrderId for split.');
  }
  const newOrderNumber = formatOrderNumber(now, nextDailyOrderSequence_(ss, now));
  const actor = sanitizeText(payload.actor, 60) || 'staff';

  const remAggs = computeOrderAggregatesFromItems_(sourceOrder.order_type, remainingItems);
  const splitAggs = computeOrderAggregatesFromItems_(sourceOrder.order_type, splitItems);

  const updatedSourceOrder = Object.assign({}, sourceOrder, {
    table_numbers: remAggs.table_numbers,
    table_numbers_json: JSON.stringify(remAggs.table_numbers),
    subtotal_vnd: remAggs.total_vnd,
    total_vnd: remAggs.total_vnd,
    version: sourceOrder.version + 1,
    updated_at: nowStr,
  });

  const newOrderRecord = {
    order_id: newOrderId,
    order_number: newOrderNumber,
    order_type: sourceOrder.order_type,
    status: sourceOrder.status,
    payment_status: 'Unpaid',
    table_numbers: splitAggs.table_numbers,
    table_numbers_json: JSON.stringify(splitAggs.table_numbers),
    subtotal_vnd: splitAggs.total_vnd,
    total_vnd: splitAggs.total_vnd,
    version: 1,
    idempotency_key: idempotencyKey,
    notes: 'Tách từ ' + (sourceOrder.order_number || sourceOrderId),
    created_at: nowStr,
    updated_at: nowStr,
    paid_at: '',
    created_by: actor,
    merged_into_order_id: '',
    parent_order_ids: [sourceOrderId],
    parent_order_ids_json: JSON.stringify([sourceOrderId]),
  };

  const ordersSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDERS);
  const itemsSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDER_ITEMS);
  const idempSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.IDEMPOTENCY_KEYS);
  const auditSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.AUDIT_LOG);

  const orderHeaders = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0];
  const itemHeaders = itemsSheet.getRange(1, 1, 1, itemsSheet.getLastColumn()).getValues()[0];
  const idempHeaders = idempSheet.getRange(1, 1, 1, idempSheet.getLastColumn()).getValues()[0];
  const auditHeaders = auditSheet.getRange(1, 1, 1, auditSheet.getLastColumn()).getValues()[0];

  const newOrderRow = ordersSheet.getLastRow() + 1;
  const idempRowIdx = idempSheet.getLastRow() + 1;
  let newOrderWritten = false;
  let sourceUpdated = false;
  let idempWritten = false;
  const movedItems = [];

  const responseData = {
    sourceOrder: formatPublicOrder_(updatedSourceOrder, remainingItems),
    newOrder: formatPublicOrder_(newOrderRecord, splitItems),
    splitItemIds: splitItems.map(function (it) { return it.order_item_id; }),
    replayed: false,
  };

  try {
    writeOrderRowAt_(ordersSheet, newOrderRow, orderHeaders, newOrderRecord);
    newOrderWritten = true;

    splitItems.forEach(function (it) {
      const updatedIt = Object.assign({}, it, {
        order_id: newOrderId,
        updated_at: nowStr,
      });
      writeOrderItemRowAt_(itemsSheet, it._rowIndex, itemHeaders, updatedIt);
      movedItems.push(it);
    });

    writeOrderRowAt_(ordersSheet, sourceOrder._rowIndex, orderHeaders, updatedSourceOrder);
    sourceUpdated = true;

    const idempValues = mapRecordToHeaders_(idempHeaders, {
      idempotency_key: idempotencyKey,
      action: 'splitOrder',
      order_id: newOrderId,
      response_json: JSON.stringify(responseData),
      created_at: nowStr,
    });
    idempSheet.getRange(idempRowIdx, 1, 1, idempHeaders.length).setValues([idempValues]);
    idempWritten = true;

    auditSheet.appendRow(
      mapRecordToHeaders_(auditHeaders, {
        log_id: 'LOG-' + Utilities.getUuid().slice(0, 8).toUpperCase(),
        timestamp: nowStr,
        action: 'SPLIT_ORDER',
        entity_type: 'ORDER',
        entity_id: sourceOrderId,
        actor: actor,
        request_id: idempotencyKey,
        details_json: JSON.stringify({
          source_order_id: sourceOrderId,
          new_order_id: newOrderId,
          new_order_number: newOrderNumber,
          split_item_ids: responseData.splitItemIds,
          source_total_vnd: remAggs.total_vnd,
          new_total_vnd: splitAggs.total_vnd,
        }),
      })
    );

    SpreadsheetApp.flush();
    const syncRevision = incrementSyncRevision_(ss);
    return { data: Object.assign({}, responseData, { syncRevision: syncRevision }) };
  } catch (err) {
    try {
      if (idempWritten && idempSheet.getLastRow() >= idempRowIdx && String(idempSheet.getRange(idempRowIdx, 1).getValue()) === idempotencyKey) {
        idempSheet.deleteRow(idempRowIdx);
      }
      if (sourceUpdated) writeOrderRowAt_(ordersSheet, sourceOrder._rowIndex, orderHeaders, sourceOrder);
      movedItems.forEach(function (origIt) {
        writeOrderItemRowAt_(itemsSheet, origIt._rowIndex, itemHeaders, origIt);
      });
      if (newOrderWritten && ordersSheet.getLastRow() >= newOrderRow) {
        ordersSheet.deleteRow(newOrderRow);
      }
      SpreadsheetApp.flush();
    } catch (rbErr) {}
    throw err;
  }
}
