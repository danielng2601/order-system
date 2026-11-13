/**
 * ROMS V1.0 - Server-Side Validation, Sanitization & Integer VND Price Calculation
 * Pure functions so they can be executed in both GAS and Node.js unit tests.
 */

/**
 * Strips ASCII control characters, trims whitespace, and truncates to maxLen.
 * @param {*} value
 * @param {number=} maxLen
 * @return {string}
 */
function sanitizeText(value, maxLen) {
  if (value === null || value === undefined) {
    return '';
  }
  const limit = maxLen || 200;
  return String(value)
    .replace(/[\u0000-\u001F\u007F]/g, ' ')
    .trim()
    .slice(0, limit);
}

/**
 * Normalizes boolean flags from Google Sheets (true/'TRUE'/'true').
 * @param {*} val
 * @return {boolean}
 */
function toBoolean(val) {
  if (typeof val === 'boolean') return val;
  return String(val).toLowerCase() === 'true';
}

/**
 * Validates whether a seat_id matches T1-S1 through T9-S4.
 * @param {string} seatId
 * @return {boolean}
 */
function isValidSeatId(seatId) {
  if (typeof seatId !== 'string') {
    return false;
  }
  const match = /^T([1-9])-S([1-4])$/.exec(seatId.trim());
  return Boolean(match);
}

/**
 * Parses a valid seat_id into table and seat numbers.
 * @param {string} seatId
 * @return {{ table_number: number, seat_number: number } | null}
 */
function parseSeatId(seatId) {
  if (!isValidSeatId(seatId)) {
    return null;
  }
  const match = /^T([1-9])-S([1-4])$/.exec(seatId.trim());
  return {
    table_number: Number(match[1]),
    seat_number: Number(match[2]),
  };
}

/**
 * Calculates a single order line total in integer VND.
 * Formula: (unit_price_vnd + modifier_delta_sum_vnd + topping_units * topping_unit_price_vnd) * quantity
 * @param {number} unitPriceVnd
 * @param {number} quantity
 * @param {number=} toppingUnits
 * @param {number=} toppingUnitPriceVnd
 * @param {number=} modifierDeltaSumVnd
 * @return {number}
 */
function calculateLineTotalVnd(
  unitPriceVnd,
  quantity,
  toppingUnits,
  toppingUnitPriceVnd,
  modifierDeltaSumVnd
) {
  const price = Number(unitPriceVnd);
  const qty = Number(quantity);
  const toppings = Number(toppingUnits || 0);
  const toppingPrice = Number(
    toppingUnitPriceVnd !== undefined ? toppingUnitPriceVnd : ROMS_CONFIG.TOPPING_UNIT_PRICE_VND
  );
  const modDelta = Number(modifierDeltaSumVnd || 0);

  if (!Number.isInteger(price) || price < 0) {
    throw new Error('Invalid unitPriceVnd: must be a non-negative integer');
  }
  if (!Number.isInteger(qty) || qty <= 0) {
    throw new Error('Invalid quantity: must be a positive integer');
  }
  if (!Number.isInteger(toppings) || toppings < 0) {
    throw new Error('Invalid toppingUnits: must be a non-negative integer');
  }
  if (!Number.isInteger(toppingPrice) || toppingPrice < 0) {
    throw new Error('Invalid toppingUnitPriceVnd: must be a non-negative integer');
  }
  if (!Number.isInteger(modDelta)) {
    throw new Error('Invalid modifierDeltaSumVnd: must be an integer');
  }

  const unitTotal = price + modDelta + toppings * toppingPrice;
  if (unitTotal < 0) {
    throw new Error('Calculated unit total cannot be negative');
  }
  return unitTotal * qty;
}

/**
 * Sums line totals in integer VND.
 * @param {Array<{ line_total_vnd: number }>} lineItems
 * @return {number}
 */
function calculateOrderTotalVnd(lineItems) {
  if (!Array.isArray(lineItems)) {
    throw new Error('lineItems must be an array');
  }
  return lineItems.reduce(function (sum, item) {
    const lineTotal = Number(item.line_total_vnd);
    if (!Number.isInteger(lineTotal) || lineTotal < 0) {
      throw new Error('Invalid line_total_vnd in lineItems');
    }
    return sum + lineTotal;
  }, 0);
}

/**
 * Validates and normalizes an order payload against server-side menu & modifier catalogs.
 * Client-submitted prices or totals are ignored; server calculates all prices.
 * @param {Object} payload
 * @param {{ menuById: Object, modifiersById: Object, toppingUnitPriceVnd?: number, validSeatsById?: Object }} catalog
 * @return {{ valid: boolean, errors: Array<string>, normalized?: Object }}
 */
function validateAndPriceOrderPayload(payload, catalog) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be a JSON object'] };
  }

  const orderType = payload.order_type;
  if (ROMS_CONFIG.ORDER_TYPES.indexOf(orderType) === -1) {
    errors.push('order_type must be DINE_IN or TAKEAWAY');
  }

  if (payload.status !== undefined && ROMS_CONFIG.ACTIVE_ORDER_STATUSES.indexOf(payload.status) === -1) {
    errors.push('status must be Draft or Confirmed');
  }

  if (
    payload.payment_status !== undefined &&
    ROMS_CONFIG.PAYMENT_STATUSES.indexOf(payload.payment_status) === -1
  ) {
    errors.push('payment_status must be Unpaid or Paid');
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    errors.push('items must be a non-empty array');
  } else if (payload.items.length > ROMS_CONFIG.MAX_ITEMS_PER_ORDER) {
    errors.push('items cannot exceed ' + ROMS_CONFIG.MAX_ITEMS_PER_ORDER + ' lines per order');
  }

  const menuById = (catalog && catalog.menuById) || {};
  const modifiersById = (catalog && catalog.modifiersById) || {};
  const validSeatsById = (catalog && catalog.validSeatsById) || null;
  const toppingPrice = Number(
    catalog && catalog.toppingUnitPriceVnd !== undefined
      ? catalog.toppingUnitPriceVnd
      : ROMS_CONFIG.TOPPING_UNIT_PRICE_VND
  );

  const normalizedItems = [];
  const tableNumberSet = {};
  let baseSubtotalVnd = 0;
  let toppingSubtotalVnd = 0;

  if (Array.isArray(payload.items) && payload.items.length <= ROMS_CONFIG.MAX_ITEMS_PER_ORDER) {
    payload.items.forEach(function (rawItem, idx) {
      const prefix = 'items[' + idx + ']';
      if (!rawItem || typeof rawItem !== 'object') {
        errors.push(prefix + ' must be an object');
        return;
      }

      const itemId = sanitizeText(rawItem.item_id, 64);
      const menuItem = menuById[itemId];
      if (!menuItem) {
        errors.push(prefix + '.item_id is unknown: ' + itemId);
        return;
      }
      if (!toBoolean(menuItem.is_active)) {
        errors.push(prefix + '.item_id is currently sold out: ' + menuItem.name);
        return;
      }

      const qty = Number(rawItem.quantity);
      if (
        !Number.isInteger(qty) ||
        qty <= 0 ||
        qty > ROMS_CONFIG.MAX_QUANTITY_PER_LINE
      ) {
        errors.push(
          prefix + '.quantity must be an integer between 1 and ' + ROMS_CONFIG.MAX_QUANTITY_PER_LINE
        );
        return;
      }

      const toppingUnits = rawItem.topping_units === undefined ? 0 : Number(rawItem.topping_units);
      if (
        !Number.isInteger(toppingUnits) ||
        toppingUnits < 0 ||
        toppingUnits > ROMS_CONFIG.MAX_TOPPING_UNITS_PER_LINE
      ) {
        errors.push(
          prefix +
            '.topping_units must be an integer between 0 and ' +
            ROMS_CONFIG.MAX_TOPPING_UNITS_PER_LINE
        );
        return;
      }

      let seatId = '';
      let tableNumber = null;
      let seatNumber = null;
      if (orderType === 'DINE_IN') {
        if (!isValidSeatId(rawItem.seat_id)) {
          errors.push(prefix + '.seat_id is required for DINE_IN orders (T1-S1..T9-S4)');
          return;
        }
        seatId = rawItem.seat_id.trim();
        if (validSeatsById && (!validSeatsById[seatId] || !toBoolean(validSeatsById[seatId].is_active))) {
          errors.push(prefix + '.seat_id is inactive or unavailable: ' + seatId);
          return;
        }
        const parsed = parseSeatId(seatId);
        tableNumber = parsed.table_number;
        seatNumber = parsed.seat_number;
        tableNumberSet[tableNumber] = true;
      }

      if (rawItem.modifier_ids !== undefined && !Array.isArray(rawItem.modifier_ids)) {
        errors.push(prefix + '.modifier_ids must be an array');
        return;
      }

      const rawModifierIds = Array.isArray(rawItem.modifier_ids) ? rawItem.modifier_ids : [];
      const seenModIds = {};
      const dedupedModIds = [];
      const modifierSnapshots = [];
      let modifierDeltaSum = 0;

      for (let m = 0; m < rawModifierIds.length; m += 1) {
        const modId = sanitizeText(rawModifierIds[m], 64);
        if (seenModIds[modId]) {
          continue;
        }
        const mod = modifiersById[modId];
        if (!mod || !toBoolean(mod.is_active)) {
          errors.push(prefix + '.modifier_ids contains unknown or inactive modifier: ' + modId);
          return;
        }
        seenModIds[modId] = true;
        dedupedModIds.push(modId);
        const modDelta = Number(mod.price_delta_vnd || 0);
        modifierDeltaSum += modDelta;
        modifierSnapshots.push({
          modifier_id: mod.modifier_id,
          name: mod.name,
          price_delta_vnd: modDelta,
        });
      }

      const unitPriceVnd = Number(menuItem.price_vnd);
      const customNote = sanitizeText(rawItem.custom_note, 200);
      const lineTotalVnd = calculateLineTotalVnd(
        unitPriceVnd,
        qty,
        toppingUnits,
        toppingPrice,
        modifierDeltaSum
      );

      baseSubtotalVnd += (unitPriceVnd + modifierDeltaSum) * qty;
      toppingSubtotalVnd += toppingUnits * toppingPrice * qty;

      normalizedItems.push({
        seat_id: seatId,
        table_number: tableNumber,
        seat_number: seatNumber,
        item_id: menuItem.item_id,
        item_name_snapshot: menuItem.name,
        unit_price_vnd: unitPriceVnd,
        quantity: qty,
        modifier_ids: dedupedModIds,
        modifiers: modifierSnapshots.map(function (ms) {
          return ms.name;
        }),
        modifier_snapshots: modifierSnapshots,
        topping_units: toppingUnits,
        topping_unit_price_vnd: toppingPrice,
        line_total_vnd: lineTotalVnd,
        custom_note: customNote,
      });
    });
  }

  if (errors.length > 0) {
    return { valid: false, errors: errors };
  }

  const totalVnd = calculateOrderTotalVnd(normalizedItems);
  const tableNumbers = Object.keys(tableNumberSet)
    .map(Number)
    .sort(function (a, b) {
      return a - b;
    });

  return {
    valid: true,
    errors: [],
    normalized: {
      order_type: orderType,
      status: payload.status || 'Confirmed',
      payment_status: payload.payment_status || 'Unpaid',
      table_numbers: tableNumbers,
      base_subtotal_vnd: baseSubtotalVnd,
      topping_subtotal_vnd: toppingSubtotalVnd,
      subtotal_vnd: totalVnd,
      total_vnd: totalVnd,
      notes: sanitizeText(payload.notes, 500),
      items: normalizedItems,
    },
  };
}

/**
 * Generates a unique order ID using Asia/Ho_Chi_Minh timestamp + random suffix.
 * Format: ORD-YYYYMMDD-HHMMSS-XXXX
 * @param {Date=} now
 * @param {string=} randomSuffix
 * @return {string}
 */
function generateOrderId(now, randomSuffix) {
  const d = now || new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROMS_CONFIG.TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const map = {};
  parts.forEach(function (p) {
    map[p.type] = p.value;
  });

  const dateStr = map.year + map.month + map.day;
  const timeStr = map.hour + map.minute + map.second;
  const suffix =
    randomSuffix ||
    Math.random()
      .toString(36)
      .substring(2, 6)
      .toUpperCase()
      .padEnd(4, '0');

  return 'ORD-' + dateStr + '-' + timeStr + '-' + suffix;
}

/**
 * Formats a human-readable daily order number: #YYMMDD-NNN
 * @param {Date} now
 * @param {number} sequenceNumber
 * @return {string}
 */
function formatOrderNumber(now, sequenceNumber) {
  const d = now || new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: ROMS_CONFIG.TIMEZONE,
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);

  const map = {};
  parts.forEach(function (p) {
    map[p.type] = p.value;
  });

  const seq = String(sequenceNumber).padStart(3, '0');
  return '#' + map.year + map.month + map.day + '-' + seq;
}

/**
 * Constant-time string comparison to reduce timing leaks on passcode checks.
 * @param {string} a
 * @param {string} b
 * @return {boolean}
 */
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i += 1) {
    const codeA = i < a.length ? a.charCodeAt(i) : 0;
    const codeB = i < b.length ? b.charCodeAt(i) : 0;
    diff |= codeA ^ codeB;
  }
  return diff === 0;
}
