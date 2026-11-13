/**
 * ROMS V1.0 - Phase 3C & 3D: Order History & Daily/Period Reporting Service
 * All date calculations use Asia/Ho_Chi_Minh timezone.
 */

/**
 * Formats a Date into yyyy-MM-dd in Asia/Ho_Chi_Minh.
 * @param {Date} date
 * @return {string}
 */
function formatLocalDateOnly_(date) {
  return Utilities.formatDate(date || new Date(), ROMS_CONFIG.TIMEZONE, 'yyyy-MM-dd');
}

/**
 * Extracts yyyy-MM-dd in Asia/Ho_Chi_Minh from an ISO timestamp string.
 * @param {string} ts
 * @return {string}
 */
function toLocalDateStr_(ts) {
  if (!ts) return '';
  const s = String(ts).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) {
    return s.slice(0, 10);
  }
  return formatLocalDateOnly_(d);
}

/**
 * Resolves date_preset ('today', 'yesterday', 'custom', 'all') into { dateFrom, dateTo }.
 * @param {Object} filters
 * @param {Date=} nowOpt
 * @return {{ dateFrom: string, dateTo: string }}
 */
function resolveDateRange_(filters, nowOpt) {
  const f = filters || {};
  const now = nowOpt || new Date();
  const todayStr = formatLocalDateOnly_(now);
  const preset = sanitizeText(f.date_preset, 20) || 'today';

  if (preset === 'all') {
    return { dateFrom: '', dateTo: '' };
  }
  if (preset === 'yesterday') {
    const yest = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const yStr = formatLocalDateOnly_(yest);
    return { dateFrom: yStr, dateTo: yStr };
  }
  if (preset === 'custom') {
    const df = sanitizeText(f.date_from, 10);
    const dt = sanitizeText(f.date_to, 10);
    return {
      dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(df) ? df : todayStr,
      dateTo: /^\d{4}-\d{2}-\d{2}$/.test(dt) ? dt : todayStr,
    };
  }
  return { dateFrom: todayStr, dateTo: todayStr };
}

/**
 * Lists order history with date-range, status, payment, type, table, search, and pagination.
 */
function handleListOrderHistory_(ss, payload) {
  const f = (payload && payload.filters) || {};
  const range = resolveDateRange_(f);
  const db = loadAllOrdersAndItems_(ss);
  const syncRevision = getSyncRevision_(ss);

  let orders = db.orders.slice();

  if (range.dateFrom) {
    orders = orders.filter(function (o) {
      const d = toLocalDateStr_(o.created_at);
      return d && d >= range.dateFrom;
    });
  }
  if (range.dateTo) {
    orders = orders.filter(function (o) {
      const d = toLocalDateStr_(o.created_at);
      return d && d <= range.dateTo;
    });
  }
  if (f.status && ROMS_CONFIG.ORDER_STATUSES.indexOf(f.status) !== -1) {
    orders = orders.filter(function (o) {
      return o.status === f.status;
    });
  }
  if (f.payment_status && ROMS_CONFIG.PAYMENT_STATUSES.indexOf(f.payment_status) !== -1) {
    orders = orders.filter(function (o) {
      return o.payment_status === f.payment_status;
    });
  }
  if (f.order_type && ROMS_CONFIG.ORDER_TYPES.indexOf(f.order_type) !== -1) {
    orders = orders.filter(function (o) {
      return o.order_type === f.order_type;
    });
  }
  if (f.table_number) {
    const tblNum = Number(f.table_number);
    orders = orders.filter(function (o) {
      return o.table_numbers.indexOf(tblNum) !== -1;
    });
  }
  if (f.search) {
    const q = sanitizeText(f.search, 64).toLowerCase();
    orders = orders.filter(function (o) {
      return (
        o.order_number.toLowerCase().indexOf(q) !== -1 ||
        o.order_id.toLowerCase().indexOf(q) !== -1 ||
        o.notes.toLowerCase().indexOf(q) !== -1
      );
    });
  }

  // Sort newest first
  orders.sort(function (a, b) {
    return b.created_at.localeCompare(a.created_at);
  });

  const page = Math.max(1, Math.floor(Number((payload && payload.page) || 1)));
  const pageSize = Math.max(1, Math.min(100, Math.floor(Number((payload && payload.page_size) || 25))));
  const total = orders.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const paged = orders.slice(startIdx, startIdx + pageSize);

  return {
    syncRevision: syncRevision,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    total: total,
    page: safePage,
    pageSize: pageSize,
    totalPages: totalPages,
    orders: paged.map(function (o) {
      return formatPublicOrder_(o, db.itemsByOrderId[o.order_id] || []);
    }),
  };
}

/**
 * Generates daily or date-range operational & financial reports.
 * Rules:
 * - Excludes Cancelled orders from sales/order value.
 * - Excludes Merged source orders to avoid double-counting.
 * - Uses actual Payments records for collected CASH / BANK amounts.
 */
function handleGetReports_(ss, payload) {
  const f = (payload && payload.filters) || {};
  const range = resolveDateRange_(f);
  const db = loadAllOrdersAndItems_(ss);
  const payData = loadAllPayments_(ss);
  const syncRevision = getSyncRevision_(ss);

  const ordersInRange = db.orders.filter(function (o) {
    const d = toLocalDateStr_(o.created_at);
    if (!d) return false;
    if (range.dateFrom && d < range.dateFrom) return false;
    if (range.dateTo && d > range.dateTo) return false;
    return true;
  });

  const eligibleOrders = ordersInRange.filter(function (o) {
    return o.status !== 'Cancelled' && o.status !== 'Merged';
  });
  const cancelledOrders = ordersInRange.filter(function (o) {
    return o.status === 'Cancelled';
  });
  const mergedOrders = ordersInRange.filter(function (o) {
    return o.status === 'Merged';
  });

  let dineInOrders = 0;
  let takeawayOrders = 0;
  let paidOrders = 0;
  let unpaidOrders = 0;
  let totalOrderValueVnd = 0;

  const dailyMap = {};
  function ensureDay(dayStr) {
    if (!dailyMap[dayStr]) {
      dailyMap[dayStr] = {
        date: dayStr,
        order_count: 0,
        order_value_vnd: 0,
        collected_vnd: 0,
        cash_collected_vnd: 0,
        bank_collected_vnd: 0,
        cancelled_count: 0,
      };
    }
    return dailyMap[dayStr];
  }

  eligibleOrders.forEach(function (o) {
    if (o.order_type === 'DINE_IN') dineInOrders += 1;
    else takeawayOrders += 1;
    if (o.payment_status === 'Paid') paidOrders += 1;
    else unpaidOrders += 1;
    totalOrderValueVnd += Number(o.total_vnd || 0);

    const day = ensureDay(toLocalDateStr_(o.created_at));
    day.order_count += 1;
    day.order_value_vnd += Number(o.total_vnd || 0);
  });

  cancelledOrders.forEach(function (o) {
    const day = ensureDay(toLocalDateStr_(o.created_at));
    day.cancelled_count += 1;
  });

  const paymentsInRange = payData.payments.filter(function (p) {
    if (p.payment_status !== 'Paid') return false;
    const ord = db.ordersById[p.order_id];
    if (!ord || ord.status === 'Cancelled' || ord.status === 'Merged') return false;
    const d = toLocalDateStr_(p.created_at);
    if (!d) return false;
    if (range.dateFrom && d < range.dateFrom) return false;
    if (range.dateTo && d > range.dateTo) return false;
    return true;
  });

  let totalCollectedVnd = 0;
  let cashCollectedVnd = 0;
  let bankCollectedVnd = 0;

  paymentsInRange.forEach(function (p) {
    const amt = Number(p.amount_vnd || 0);
    totalCollectedVnd += amt;
    if (p.payment_method === 'CASH') cashCollectedVnd += amt;
    else if (p.payment_method === 'BANK') bankCollectedVnd += amt;

    const day = ensureDay(toLocalDateStr_(p.created_at));
    day.collected_vnd += amt;
    if (p.payment_method === 'CASH') day.cash_collected_vnd += amt;
    else if (p.payment_method === 'BANK') day.bank_collected_vnd += amt;
  });

  const dailyBreakdown = Object.keys(dailyMap)
    .sort()
    .map(function (k) {
      return dailyMap[k];
    });

  return {
    syncRevision: syncRevision,
    dateFrom: range.dateFrom,
    dateTo: range.dateTo,
    summary: {
      total_orders: eligibleOrders.length,
      dine_in_orders: dineInOrders,
      takeaway_orders: takeawayOrders,
      paid_orders: paidOrders,
      unpaid_orders: unpaidOrders,
      cancelled_orders: cancelledOrders.length,
      merged_source_orders: mergedOrders.length,
      total_order_value_vnd: totalOrderValueVnd,
      total_collected_vnd: totalCollectedVnd,
      cash_collected_vnd: cashCollectedVnd,
      bank_collected_vnd: bankCollectedVnd,
      payment_count: paymentsInRange.length,
      average_order_value_vnd: eligibleOrders.length > 0 ? Math.round(totalOrderValueVnd / eligibleOrders.length) : 0,
    },
    dailyBreakdown: dailyBreakdown,
    payments: paymentsInRange.map(function (p) {
      const ord = db.ordersById[p.order_id];
      return {
        payment_id: p.payment_id,
        order_id: p.order_id,
        order_number: ord ? ord.order_number : '',
        amount_vnd: p.amount_vnd,
        payment_method: p.payment_method,
        payment_status: p.payment_status,
        reference_note: p.reference_note,
        created_at: p.created_at,
        created_by: p.created_by,
      };
    }),
  };
}
