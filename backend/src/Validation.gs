/**
 * ROMS V1.0 - Server-Side Validation & Price Calculation
 * Pure functions so they can be executed in both GAS and Node.js unit tests.
 */

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
 * Formula: (unit_price_vnd + topping_units * topping_unit_price_vnd) * quantity
 * Modifiers do not change price by default (delta = 0).
 * @param {number} unitPriceVnd
 * @param {number} quantity
 * @param {number=} toppingUnits
 * @param {number=} toppingUnitPriceVnd
 * @return {number}
 */
function calculateLineTotalVnd(unitPriceVnd, quantity, toppingUnits, toppingUnitPriceVnd) {
  const price = Number(unitPriceVnd);
  const qty = Number(quantity);
  const toppings = Number(toppingUnits || 0);
  const toppingPrice = Number(
    toppingUnitPriceVnd !== undefined ? toppingUnitPriceVnd : ROMS_CONFIG.TOPPING_UNIT_PRICE_VND
  );

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

  return (price + toppings * toppingPrice) * qty;
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
 * @param {{ menuById: Object, modifiersById: Object, toppingUnitPriceVnd?: number }} catalog
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

  if (payload.status !== undefined && ROMS_CONFIG.ORDER_STATUSES.indexOf(payload.status) === -1) {
    errors.push('status must be Draft, Confirmed, or Cancelled');
  }

  if (
    payload.payment_status !== undefined &&
    ROMS_CONFIG.PAYMENT_STATUSES.indexOf(payload.payment_status) === -1
  ) {
    errors.push('payment_status must be Unpaid or Paid');
  }

  if (!Array.isArray(payload.items) || payload.items.length === 0) {
    errors.push('items must be a non-empty array');
  }

  const menuById = (catalog && catalog.menuById) || {};
  const modifiersById = (catalog && catalog.modifiersById) || {};
  const toppingPrice = Number(
    catalog && catalog.toppingUnitPriceVnd !== undefined
      ? catalog.toppingUnitPriceVnd
      : ROMS_CONFIG.TOPPING_UNIT_PRICE_VND
  );

  const normalizedItems = [];
  const tableNumberSet = {};

  if (Array.isArray(payload.items)) {
    payload.items.forEach(function (rawItem, idx) {
      const prefix = 'items[' + idx + ']';
      if (!rawItem || typeof rawItem !== 'object') {
        errors.push(prefix + ' must be an object');
        return;
      }

      const menuItem = menuById[rawItem.item_id];
      if (!menuItem || menuItem.is_active === false) {
        errors.push(prefix + '.item_id is unknown or inactive');
        return;
      }

      const qty = Number(rawItem.quantity);
      if (!Number.isInteger(qty) || qty <= 0 || qty > 100) {
        errors.push(prefix + '.quantity must be an integer between 1 and 100');
        return;
      }

      const toppingUnits = rawItem.topping_units === undefined ? 0 : Number(rawItem.topping_units);
      if (!Number.isInteger(toppingUnits) || toppingUnits < 0 || toppingUnits > 20) {
        errors.push(prefix + '.topping_units must be an integer between 0 and 20');
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
        const parsed = parseSeatId(seatId);
        tableNumber = parsed.table_number;
        seatNumber = parsed.seat_number;
        tableNumberSet[tableNumber] = true;
      }

      const rawModifierIds = Array.isArray(rawItem.modifier_ids) ? rawItem.modifier_ids : [];
      const modifierNames = [];
      for (let m = 0; m < rawModifierIds.length; m += 1) {
        const modId = rawModifierIds[m];
        const mod = modifiersById[modId];
        if (!mod || mod.is_active === false) {
          errors.push(prefix + '.modifier_ids contains unknown or inactive modifier: ' + modId);
          return;
        }
        modifierNames.push(mod.name);
      }

      const customNote = typeof rawItem.custom_note === 'string' ? rawItem.custom_note.trim().slice(0, 200) : '';
      const lineTotalVnd = calculateLineTotalVnd(
        Number(menuItem.price_vnd),
        qty,
        toppingUnits,
        toppingPrice
      );

      normalizedItems.push({
        seat_id: seatId,
        table_number: tableNumber,
        seat_number: seatNumber,
        item_id: menuItem.item_id,
        item_name_snapshot: menuItem.name,
        unit_price_vnd: Number(menuItem.price_vnd),
        quantity: qty,
        modifier_ids: rawModifierIds,
        modifiers: modifierNames,
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
      subtotal_vnd: totalVnd,
      total_vnd: totalVnd,
      notes: typeof payload.notes === 'string' ? payload.notes.trim().slice(0, 500) : '',
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
      .toUpperCase();

  return 'ORD-' + dateStr + '-' + timeStr + '-' + suffix;
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
