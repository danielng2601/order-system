/**
 * ROMS V1.0 - Phase 3A & 3B: Payment Settlement, Order Item Editing & Cancellation
 *
 * Payment Model:
 * - Single full settlement per order (CASH or BANK).
 * - Server-calculated amount_vnd from stored Orders.total_vnd (never trusts client amounts).
 * - Paid, Cancelled, and Merged orders cannot be settled, edited, or cancelled.
 */

function generatePaymentId_(now) {
  const d = now || new Date();
  const stamp = Utilities.formatDate(d, ROMS_CONFIG.TIMEZONE, 'yyyyMMdd-HHmmss');
  const suffix = Utilities.getUuid().slice(0, 4).toUpperCase();
  return 'PAY-' + stamp + '-' + suffix;
}

/**
 * Settles an eligible Unpaid order in full using CASH or BANK.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {Object} payload
 */
function handleSettlePayment_(ss, payload) {
  const idempotencyKey = sanitizeText(payload && payload.idempotency_key, 100);
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return { error: { code: 'BAD_REQUEST', message: 'idempotency_key (min 8 chars) is required.' } };
  }

  const cached = findIdempotentResponse_(ss, idempotencyKey, 'settlePayment');
  if (cached) {
    return { data: Object.assign({}, cached, { replayed: true }) };
  }

  const orderId = sanitizeText(payload && payload.order_id, 64);
  const expectedVersion = Number(payload && payload.expected_version);
  const paymentMethod = sanitizeText(payload && payload.payment_method, 20).toUpperCase();
  const referenceNote = sanitizeText(payload && payload.reference_note, 200);
  const actor = sanitizeText(payload && payload.actor, 60) || 'staff';

  if (!orderId || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { error: { code: 'BAD_REQUEST', message: 'order_id and integer expected_version are required.' } };
  }
  if (ROMS_CONFIG.PAYMENT_METHODS.indexOf(paymentMethod) === -1) {
    return { error: { code: 'VALIDATION_ERROR', message: 'payment_method must be CASH or BANK.' } };
  }

  const db = loadAllOrdersAndItems_(ss);
  const order = db.ordersById[orderId];
  if (!order) {
    return { error: { code: 'NOT_FOUND', message: 'Order not found: ' + orderId } };
  }
  if (!isActiveOrderStatus_(order.status)) {
    return { error: { code: 'INVALID_STATE', message: 'Cannot settle payment for order with status: ' + order.status } };
  }
  if (order.payment_status === 'Paid') {
    return { error: { code: 'INVALID_STATE', message: 'Đơn hàng này đã được thanh toán trước đó.' } };
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
  if (items.length === 0 || !Number.isInteger(order.total_vnd) || order.total_vnd <= 0) {
    return { error: { code: 'VALIDATION_ERROR', message: 'Order has no valid items or invalid total_vnd.' } };
  }

  const payData = loadAllPayments_(ss);
  const existingPaid = (payData.paymentsByOrderId[orderId] || []).some(function (p) {
    return p.payment_status === 'Paid';
  });
  if (existingPaid) {
    return { error: { code: 'INVALID_STATE', message: 'A Paid payment record already exists for this order.' } };
  }

  // Never trust client-supplied amount; compute strictly from stored order data
  const aggs = computeOrderAggregatesFromItems_(order.order_type, items);
  if (aggs.total_vnd !== order.total_vnd || aggs.total_vnd <= 0) {
    return { error: { code: 'VALIDATION_ERROR', message: 'Order total integrity mismatch; cannot settle.' } };
  }

  const now = new Date();
  const nowStr = formatLocalTimestamp(now);
  const paymentId = generatePaymentId_(now);

  const paymentRecord = {
    payment_id: paymentId,
    order_id: orderId,
    amount_vnd: order.total_vnd,
    payment_method: paymentMethod,
    payment_status: 'Paid',
    reference_note: referenceNote,
    created_at: nowStr,
    created_by: actor,
    idempotency_key: idempotencyKey,
  };

  const updatedOrder = Object.assign({}, order, {
    payment_status: 'Paid',
    payment_method: paymentMethod,
    paid_at: nowStr,
    version: order.version + 1,
    updated_at: nowStr,
  });

  const ordersSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDERS);
  const paySheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.PAYMENTS);
  const idempSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.IDEMPOTENCY_KEYS);
  const auditSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.AUDIT_LOG);

  const orderHeaders = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0];
  const payHeaders = paySheet.getRange(1, 1, 1, paySheet.getLastColumn()).getValues()[0];
  const idempHeaders = idempSheet.getRange(1, 1, 1, idempSheet.getLastColumn()).getValues()[0];
  const auditHeaders = auditSheet.getRange(1, 1, 1, auditSheet.getLastColumn()).getValues()[0];

  const payRowIdx = paySheet.getLastRow() + 1;
  const idempRowIdx = idempSheet.getLastRow() + 1;
  let payWritten = false;
  let orderWritten = false;
  let idempWritten = false;

  const responseData = {
    order: formatPublicOrder_(updatedOrder, items),
    payment: {
      payment_id: paymentRecord.payment_id,
      order_id: paymentRecord.order_id,
      amount_vnd: paymentRecord.amount_vnd,
      payment_method: paymentRecord.payment_method,
      payment_status: paymentRecord.payment_status,
      reference_note: paymentRecord.reference_note,
      created_at: paymentRecord.created_at,
      created_by: paymentRecord.created_by,
    },
    replayed: false,
  };

  try {
    const payValues = mapRecordToHeaders_(payHeaders, paymentRecord);
    paySheet.getRange(payRowIdx, 1, 1, payHeaders.length).setValues([payValues]);
    payWritten = true;

    writeOrderRowAt_(ordersSheet, order._rowIndex, orderHeaders, updatedOrder);
    orderWritten = true;

    const idempValues = mapRecordToHeaders_(idempHeaders, {
      idempotency_key: idempotencyKey,
      action: 'settlePayment',
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
        action: 'SETTLE_PAYMENT',
        entity_type: 'PAYMENT',
        entity_id: paymentId,
        actor: actor,
        request_id: idempotencyKey,
        details_json: JSON.stringify({
          order_id: orderId,
          order_number: order.order_number,
          amount_vnd: paymentRecord.amount_vnd,
          payment_method: paymentMethod,
          previous_payment_status: order.payment_status,
          new_payment_status: 'Paid',
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
      if (orderWritten) {
        writeOrderRowAt_(ordersSheet, order._rowIndex, orderHeaders, order);
      }
      if (payWritten && paySheet.getLastRow() >= payRowIdx && String(paySheet.getRange(payRowIdx, 1).getValue()) === paymentId) {
        paySheet.deleteRow(payRowIdx);
      }
      SpreadsheetApp.flush();
    } catch (rbErr) {}
    throw err;
  }
}

/**
 * Edits quantity, toppings, modifiers, note, or seat on an existing OrderItem of an eligible Unpaid order.
 * Preserves unit_price_vnd and topping_unit_price_vnd snapshots.
 */
function handleUpdateOrderItem_(ss, payload) {
  const idempotencyKey = sanitizeText(payload && payload.idempotency_key, 100);
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return { error: { code: 'BAD_REQUEST', message: 'idempotency_key (min 8 chars) is required.' } };
  }

  const cached = findIdempotentResponse_(ss, idempotencyKey, 'updateOrderItem');
  if (cached) {
    return { data: Object.assign({}, cached, { replayed: true }) };
  }

  const orderId = sanitizeText(payload && payload.order_id, 64);
  const orderItemId = sanitizeText(payload && payload.order_item_id, 80);
  const expectedVersion = Number(payload && payload.expected_version);
  const actor = sanitizeText(payload && payload.actor, 60) || 'staff';

  if (!orderId || !orderItemId || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { error: { code: 'BAD_REQUEST', message: 'order_id, order_item_id, and integer expected_version are required.' } };
  }

  const db = loadAllOrdersAndItems_(ss);
  const order = db.ordersById[orderId];
  if (!order) {
    return { error: { code: 'NOT_FOUND', message: 'Order not found: ' + orderId } };
  }
  if (!isActiveOrderStatus_(order.status)) {
    return { error: { code: 'INVALID_STATE', message: 'Cannot edit items on order with status: ' + order.status } };
  }
  if (order.payment_status === 'Paid') {
    return { error: { code: 'INVALID_STATE', message: 'Không thể chỉnh sửa đơn hàng đã thanh toán.' } };
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
    return { error: { code: 'NOT_FOUND', message: 'Order item not found: ' + orderItemId } };
  }

  const catalog = loadCatalog_(ss);
  const newQty = payload.quantity !== undefined ? Number(payload.quantity) : targetItem.quantity;
  if (!Number.isInteger(newQty) || newQty <= 0 || newQty > ROMS_CONFIG.MAX_QUANTITY_PER_LINE) {
    return { error: { code: 'VALIDATION_ERROR', message: 'quantity must be an integer between 1 and ' + ROMS_CONFIG.MAX_QUANTITY_PER_LINE } };
  }

  const newToppings = payload.topping_units !== undefined ? Number(payload.topping_units) : targetItem.topping_units;
  if (!Number.isInteger(newToppings) || newToppings < 0 || newToppings > ROMS_CONFIG.MAX_TOPPING_UNITS_PER_LINE) {
    return { error: { code: 'VALIDATION_ERROR', message: 'topping_units must be an integer between 0 and ' + ROMS_CONFIG.MAX_TOPPING_UNITS_PER_LINE } };
  }

  let newSeatId = targetItem.seat_id;
  let newTableNum = targetItem.table_number === null ? '' : targetItem.table_number;
  let newSeatNum = targetItem.seat_number === null ? '' : targetItem.seat_number;
  if (payload.seat_id !== undefined) {
    if (order.order_type !== 'DINE_IN') {
      if (sanitizeText(payload.seat_id, 16) !== '') {
        return { error: { code: 'INVALID_STATE', message: 'TAKEAWAY orders cannot assign seats.' } };
      }
    } else {
      const candidateSeat = sanitizeText(payload.seat_id, 16);
      if (!isValidSeatId(candidateSeat)) {
        return { error: { code: 'VALIDATION_ERROR', message: 'Invalid seat_id: ' + candidateSeat } };
      }
      const seatObj = catalog.validSeatsById[candidateSeat];
      if (!seatObj || !seatObj.is_active) {
        return { error: { code: 'VALIDATION_ERROR', message: 'Seat is unavailable: ' + candidateSeat } };
      }
      const parsedSeat = parseSeatId(candidateSeat);
      newSeatId = candidateSeat;
      newTableNum = parsedSeat.table_number;
      newSeatNum = parsedSeat.seat_number;
    }
  }

  let modifierSnapshots = targetItem.modifiers || [];
  let modDeltaSum = 0;
  if (payload.modifier_ids !== undefined) {
    if (!Array.isArray(payload.modifier_ids)) {
      return { error: { code: 'VALIDATION_ERROR', message: 'modifier_ids must be an array.' } };
    }
    const seen = {};
    modifierSnapshots = [];
    for (let i = 0; i < payload.modifier_ids.length; i += 1) {
      const modId = sanitizeText(payload.modifier_ids[i], 64);
      if (seen[modId]) continue;
      const mod = catalog.modifiersById[modId];
      if (!mod || !toBoolean(mod.is_active)) {
        return { error: { code: 'VALIDATION_ERROR', message: 'Unknown or inactive modifier: ' + modId } };
      }
      seen[modId] = true;
      const delta = Number(mod.price_delta_vnd || 0);
      modDeltaSum += delta;
      modifierSnapshots.push({ modifier_id: mod.modifier_id, name: mod.name, price_delta_vnd: delta });
    }
  } else {
    modifierSnapshots.forEach(function (ms) {
      modDeltaSum += Number((ms && ms.price_delta_vnd) || 0);
    });
  }

  const newCustomNote = payload.custom_note !== undefined ? sanitizeText(payload.custom_note, 200) : targetItem.custom_note;
  // Preserve original unit_price_vnd & topping_unit_price_vnd snapshots
  const lineTotalVnd = calculateLineTotalVnd(
    targetItem.unit_price_vnd,
    newQty,
    newToppings,
    targetItem.topping_unit_price_vnd,
    modDeltaSum
  );

  const nowStr = formatLocalTimestamp();
  const updatedItem = Object.assign({}, targetItem, {
    seat_id: newSeatId,
    table_number: newTableNum,
    seat_number: newSeatNum,
    quantity: newQty,
    modifiers: modifierSnapshots,
    modifiers_json: JSON.stringify(modifierSnapshots),
    topping_units: newToppings,
    line_total_vnd: lineTotalVnd,
    custom_note: newCustomNote,
    updated_at: nowStr,
  });

  const updatedItemsList = items.map(function (it) {
    return it.order_item_id === orderItemId ? updatedItem : it;
  });
  const aggs = computeOrderAggregatesFromItems_(order.order_type, updatedItemsList);
  const updatedOrder = Object.assign({}, order, {
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

  const idempRowIdx = idempSheet.getLastRow() + 1;
  let itemWritten = false;
  let orderWritten = false;
  let idempWritten = false;

  const responseData = {
    order: formatPublicOrder_(updatedOrder, updatedItemsList),
    updatedItem: updatedItem,
    replayed: false,
  };

  try {
    writeOrderItemRowAt_(itemsSheet, targetItem._rowIndex, itemHeaders, updatedItem);
    itemWritten = true;
    writeOrderRowAt_(ordersSheet, order._rowIndex, orderHeaders, updatedOrder);
    orderWritten = true;

    const idempValues = mapRecordToHeaders_(idempHeaders, {
      idempotency_key: idempotencyKey,
      action: 'updateOrderItem',
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
        action: 'UPDATE_ORDER_ITEM',
        entity_type: 'ORDER_ITEM',
        entity_id: orderItemId,
        actor: actor,
        request_id: idempotencyKey,
        details_json: JSON.stringify({
          order_id: orderId,
          previous: {
            quantity: targetItem.quantity,
            topping_units: targetItem.topping_units,
            seat_id: targetItem.seat_id,
            line_total_vnd: targetItem.line_total_vnd,
          },
          next: {
            quantity: updatedItem.quantity,
            topping_units: updatedItem.topping_units,
            seat_id: updatedItem.seat_id,
            line_total_vnd: updatedItem.line_total_vnd,
          },
          new_order_total_vnd: aggs.total_vnd,
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
 * Removes an OrderItem from an eligible Unpaid order (must leave at least 1 item).
 */
function handleRemoveOrderItem_(ss, payload) {
  const idempotencyKey = sanitizeText(payload && payload.idempotency_key, 100);
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return { error: { code: 'BAD_REQUEST', message: 'idempotency_key (min 8 chars) is required.' } };
  }

  const cached = findIdempotentResponse_(ss, idempotencyKey, 'removeOrderItem');
  if (cached) {
    return { data: Object.assign({}, cached, { replayed: true }) };
  }

  const orderId = sanitizeText(payload && payload.order_id, 64);
  const orderItemId = sanitizeText(payload && payload.order_item_id, 80);
  const expectedVersion = Number(payload && payload.expected_version);
  const actor = sanitizeText(payload && payload.actor, 60) || 'staff';

  if (!orderId || !orderItemId || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { error: { code: 'BAD_REQUEST', message: 'order_id, order_item_id, and integer expected_version are required.' } };
  }

  const db = loadAllOrdersAndItems_(ss);
  const order = db.ordersById[orderId];
  if (!order) {
    return { error: { code: 'NOT_FOUND', message: 'Order not found: ' + orderId } };
  }
  if (!isActiveOrderStatus_(order.status)) {
    return { error: { code: 'INVALID_STATE', message: 'Cannot remove items on order with status: ' + order.status } };
  }
  if (order.payment_status === 'Paid') {
    return { error: { code: 'INVALID_STATE', message: 'Không thể xóa món trên đơn hàng đã thanh toán.' } };
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
    return { error: { code: 'NOT_FOUND', message: 'Order item not found: ' + orderItemId } };
  }
  if (items.length <= 1) {
    return {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Đơn hàng phải còn ít nhất 1 món. Nếu muốn hủy toàn bộ đơn, hãy dùng chức năng Hủy đơn.',
      },
    };
  }

  const remainingItems = items.filter(function (it) {
    return it.order_item_id !== orderItemId;
  });
  const nowStr = formatLocalTimestamp();
  const aggs = computeOrderAggregatesFromItems_(order.order_type, remainingItems);
  const updatedOrder = Object.assign({}, order, {
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

  const idempRowIdx = idempSheet.getLastRow() + 1;
  let orderWritten = false;
  let itemDeleted = false;
  let idempWritten = false;

  const responseData = {
    order: formatPublicOrder_(updatedOrder, remainingItems),
    removedItemId: orderItemId,
    replayed: false,
  };

  try {
    writeOrderRowAt_(ordersSheet, order._rowIndex, orderHeaders, updatedOrder);
    orderWritten = true;

    itemsSheet.deleteRow(targetItem._rowIndex);
    itemDeleted = true;

    const idempValues = mapRecordToHeaders_(idempHeaders, {
      idempotency_key: idempotencyKey,
      action: 'removeOrderItem',
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
        action: 'REMOVE_ORDER_ITEM',
        entity_type: 'ORDER_ITEM',
        entity_id: orderItemId,
        actor: actor,
        request_id: idempotencyKey,
        details_json: JSON.stringify({
          order_id: orderId,
          removed_item: {
            item_id: targetItem.item_id,
            item_name_snapshot: targetItem.item_name_snapshot,
            quantity: targetItem.quantity,
            seat_id: targetItem.seat_id,
            line_total_vnd: targetItem.line_total_vnd,
          },
          new_order_total_vnd: aggs.total_vnd,
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
      if (itemDeleted) {
        itemsSheet.appendRow(mapRecordToHeaders_(itemHeaders, targetItem));
      }
      if (orderWritten) {
        writeOrderRowAt_(ordersSheet, order._rowIndex, orderHeaders, order);
      }
      SpreadsheetApp.flush();
    } catch (rbErr) {}
    throw err;
  }
}

/**
 * Cancels an eligible Unpaid order (Draft or Confirmed), preserving all order & item history.
 */
function handleCancelOrder_(ss, payload) {
  const idempotencyKey = sanitizeText(payload && payload.idempotency_key, 100);
  if (!idempotencyKey || idempotencyKey.length < 8) {
    return { error: { code: 'BAD_REQUEST', message: 'idempotency_key (min 8 chars) is required.' } };
  }

  const cached = findIdempotentResponse_(ss, idempotencyKey, 'cancelOrder');
  if (cached) {
    return { data: Object.assign({}, cached, { replayed: true }) };
  }

  const orderId = sanitizeText(payload && payload.order_id, 64);
  const expectedVersion = Number(payload && payload.expected_version);
  const cancelReason = sanitizeText(payload && payload.cancel_reason, 300);
  const actor = sanitizeText(payload && payload.actor, 60) || 'staff';

  if (!orderId || !Number.isInteger(expectedVersion) || expectedVersion < 1) {
    return { error: { code: 'BAD_REQUEST', message: 'order_id and integer expected_version are required.' } };
  }
  if (!cancelReason || cancelReason.length < 2) {
    return { error: { code: 'VALIDATION_ERROR', message: 'Vui lòng nhập lý do hủy đơn (tối thiểu 2 ký tự).' } };
  }

  const db = loadAllOrdersAndItems_(ss);
  const order = db.ordersById[orderId];
  if (!order) {
    return { error: { code: 'NOT_FOUND', message: 'Order not found: ' + orderId } };
  }
  if (!isActiveOrderStatus_(order.status)) {
    return { error: { code: 'INVALID_STATE', message: 'Cannot cancel order with status: ' + order.status } };
  }
  if (order.payment_status === 'Paid') {
    return { error: { code: 'INVALID_STATE', message: 'Không thể hủy đơn hàng đã thanh toán.' } };
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

  const nowStr = formatLocalTimestamp();
  const items = db.itemsByOrderId[orderId] || [];
  const updatedOrder = Object.assign({}, order, {
    status: 'Cancelled',
    cancelled_at: nowStr,
    cancel_reason: cancelReason,
    cancelled_by: actor,
    version: order.version + 1,
    updated_at: nowStr,
  });

  const ordersSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.ORDERS);
  const idempSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.IDEMPOTENCY_KEYS);
  const auditSheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.AUDIT_LOG);

  const orderHeaders = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0];
  const idempHeaders = idempSheet.getRange(1, 1, 1, idempSheet.getLastColumn()).getValues()[0];
  const auditHeaders = auditSheet.getRange(1, 1, 1, auditSheet.getLastColumn()).getValues()[0];

  const idempRowIdx = idempSheet.getLastRow() + 1;
  let orderWritten = false;
  let idempWritten = false;

  const responseData = {
    order: formatPublicOrder_(updatedOrder, items),
    replayed: false,
  };

  try {
    writeOrderRowAt_(ordersSheet, order._rowIndex, orderHeaders, updatedOrder);
    orderWritten = true;

    const idempValues = mapRecordToHeaders_(idempHeaders, {
      idempotency_key: idempotencyKey,
      action: 'cancelOrder',
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
        action: 'CANCEL_ORDER',
        entity_type: 'ORDER',
        entity_id: orderId,
        actor: actor,
        request_id: idempotencyKey,
        details_json: JSON.stringify({
          order_number: order.order_number,
          previous_status: order.status,
          new_status: 'Cancelled',
          cancel_reason: cancelReason,
          parent_order_ids: order.parent_order_ids || [],
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
      if (orderWritten) {
        writeOrderRowAt_(ordersSheet, order._rowIndex, orderHeaders, order);
      }
      SpreadsheetApp.flush();
    } catch (rbErr) {}
    throw err;
  }
}
