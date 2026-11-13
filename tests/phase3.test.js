const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGasMockEnv } = require('./mock_sheets');
const fmt = require('../frontend/js/format');

const ROOT = path.resolve(__dirname, '..');
const GAS_FILES = [
  'backend/src/Config.gs',
  'backend/src/Validation.gs',
  'backend/src/DbSetup.gs',
  'backend/src/PrinterService.gs',
  'backend/src/Repository.gs',
  'backend/src/OrderService.gs',
  'backend/src/FloorService.gs',
  'backend/src/PaymentAndLifecycleService.gs',
  'backend/src/HistoryAndReportService.gs',
  'backend/src/Code.gs',
];

function bootBackend() {
  const ctx = createGasMockEnv();
  vm.createContext(ctx);
  for (const relPath of GAS_FILES) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    vm.runInContext(code, ctx, { filename: relPath });
  }
  ctx.setupDatabase();
  const loginRes = JSON.parse(
    ctx.doPost({
      postData: { contents: JSON.stringify({ action: 'login', passcode: 'test-pass-999' }) },
    }).getContent()
  );
  ctx._sessionToken = loginRes.data.session_token;
  return ctx;
}

function post(ctx, bodyObj, omitSession = false) {
  const payload = omitSession
    ? bodyObj
    : Object.assign({ session_token: ctx._sessionToken }, bodyObj);
  const out = ctx.doPost({
    postData: { contents: JSON.stringify(payload) },
  });
  return JSON.parse(out.getContent());
}

function createOrder(ctx, orderType, items, key) {
  return post(ctx, {
    action: 'createOrder',
    idempotency_key: key,
    order_type: orderType,
    items,
  });
}

test('Phase 3A: settlePayment CASH & BANK, server amount integrity, replay, and invalid state guards', () => {
  const ctx = bootBackend();

  const o1 = createOrder(
    ctx,
    'DINE_IN',
    [
      { item_id: 'MY_VAN_THAN', quantity: 2, seat_id: 'T1-S1', topping_units: 1 }, // (45000+15000)*2 = 120000
    ],
    'p3-create-o1'
  );
  assert.equal(o1.ok, true);
  const order1 = o1.data.order;
  assert.equal(order1.total_vnd, 120000);
  const revBeforePay = o1.data.syncRevision;

  // Attempt to pass client-supplied amount_vnd (must be ignored)
  const pay1 = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3-pay-o1',
    order_id: order1.order_id,
    expected_version: order1.version,
    payment_method: 'CASH',
    amount_vnd: 1,
    reference_note: 'Khách trả đủ',
  });
  assert.equal(pay1.ok, true);
  assert.equal(pay1.data.replayed, false);
  assert.equal(pay1.data.payment.amount_vnd, 120000);
  assert.equal(pay1.data.payment.payment_method, 'CASH');
  assert.equal(pay1.data.payment.payment_status, 'Paid');
  assert.equal(pay1.data.order.payment_status, 'Paid');
  assert.equal(pay1.data.order.payment_method, 'CASH');
  assert.ok(pay1.data.order.paid_at);
  assert.equal(pay1.data.order.version, order1.version + 1);
  assert.equal(pay1.data.syncRevision, revBeforePay + 1);

  // Idempotent replay does not create duplicate payment
  const pay1Replay = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3-pay-o1',
    order_id: order1.order_id,
    expected_version: order1.version,
    payment_method: 'CASH',
  });
  assert.equal(pay1Replay.ok, true);
  assert.equal(pay1Replay.data.replayed, true);
  assert.equal(ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Payments').getLastRow(), 2); // header + 1 row

  // Duplicate settlement with new key fails with INVALID_STATE
  const pay1Dup = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3-pay-o1-dup',
    order_id: order1.order_id,
    expected_version: pay1.data.order.version,
    payment_method: 'BANK',
  });
  assert.equal(pay1Dup.ok, false);
  assert.equal(pay1Dup.error.code, 'INVALID_STATE');

  // Seat T1-S1 should now be available on floor plan & order absent from active orders
  const floor = post(ctx, { action: 'getFloorState' });
  const t1s1 = floor.data.tables[0].seats.find((s) => s.seat_id === 'T1-S1');
  assert.equal(t1s1.status, 'available');
  const active = post(ctx, { action: 'listActiveOrders', filters: {} });
  assert.equal(active.data.orders.some((o) => o.order_id === order1.order_id), false);

  // Settle TAKEAWAY order with BANK
  const o2 = createOrder(
    ctx,
    'TAKEAWAY',
    [{ item_id: 'SUI_CAO', quantity: 1, seat_id: '' }], // 50000
    'p3-create-o2'
  );
  assert.equal(o2.ok, true);

  // Invalid payment method rejected
  const badMethod = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3-pay-bad-method',
    order_id: o2.data.order.order_id,
    expected_version: 1,
    payment_method: 'CRYPTO',
  });
  assert.equal(badMethod.ok, false);
  assert.equal(badMethod.error.code, 'VALIDATION_ERROR');

  // Stale version rejected
  const staleVer = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3-pay-stale',
    order_id: o2.data.order.order_id,
    expected_version: 99,
    payment_method: 'BANK',
  });
  assert.equal(staleVer.ok, false);
  assert.equal(staleVer.error.code, 'VERSION_CONFLICT');

  const pay2 = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3-pay-o2',
    order_id: o2.data.order.order_id,
    expected_version: 1,
    payment_method: 'BANK',
    reference_note: 'VCB 123456',
  });
  assert.equal(pay2.ok, true);
  assert.equal(pay2.data.payment.payment_method, 'BANK');
  assert.equal(pay2.data.payment.amount_vnd, 50000);
});

test('Phase 3A Fault Injection: settlePayment rolls back Payments row on Orders/Audit failure and allows retry', () => {
  const ctx = bootBackend();
  const o1 = createOrder(
    ctx,
    'DINE_IN',
    [{ item_id: 'BUN_THANG', quantity: 1, seat_id: 'T2-S1' }],
    'p3-fi-o1'
  );
  assert.equal(o1.ok, true);

  // Inject failure on AuditLog write during settlePayment
  ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('AuditLog')._failOnNextWrite = true;
  const failedPay = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3-fi-pay-1',
    order_id: o1.data.order.order_id,
    expected_version: 1,
    payment_method: 'CASH',
  });
  assert.equal(failedPay.ok, false);

  // Verify Payments sheet rolled back cleanly and Order remains Unpaid v1
  assert.equal(ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Payments').getLastRow(), 1);
  const detailAfterFail = post(ctx, { action: 'getOrderDetail', order_id: o1.data.order.order_id });
  assert.equal(detailAfterFail.data.order.payment_status, 'Unpaid');
  assert.equal(detailAfterFail.data.order.version, 1);

  // Retry with same idempotency_key succeeds
  const retryPay = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3-fi-pay-1',
    order_id: o1.data.order.order_id,
    expected_version: 1,
    payment_method: 'CASH',
  });
  assert.equal(retryPay.ok, true);
  assert.equal(ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Payments').getLastRow(), 2);
});

test('Phase 3B: updateOrderItem, removeOrderItem, cancelOrder, price snapshot preservation, and Paid/Cancelled/Merged guards', () => {
  const ctx = bootBackend();

  const o1 = createOrder(
    ctx,
    'DINE_IN',
    [
      { item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T3-S1', topping_units: 0 }, // 45000
      { item_id: 'QUAY', quantity: 2, seat_id: 'T3-S2', topping_units: 0 }, // 10000
    ],
    'p3b-create-o1'
  );
  assert.equal(o1.ok, true);
  const orderId = o1.data.order.order_id;
  const item1Id = o1.data.items[0].order_item_id;
  const item2Id = o1.data.items[1].order_item_id;

  // Mutate MenuItems price in sheet to verify updateOrderItem preserves historical unit_price_vnd snapshot (45000)
  const menuSheet = ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('MenuItems');
  const menuHeaders = menuSheet.getRange(1, 1, 1, menuSheet.getLastColumn()).getValues()[0];
  const priceCol = menuHeaders.indexOf('price_vnd') + 1;
  menuSheet.getRange(2, priceCol).setValue(99000);

  // Update item 1: qty=2, topping_units=1, modifiers=['NO_VEG'], seat='T4-S1'
  const upd = post(ctx, {
    action: 'updateOrderItem',
    idempotency_key: 'p3b-upd-1',
    order_id: orderId,
    order_item_id: item1Id,
    expected_version: 1,
    quantity: 2,
    topping_units: 1,
    modifier_ids: ['NO_VEG'],
    custom_note: 'Nước nóng',
    seat_id: 'T4-S1',
  });
  assert.equal(upd.ok, true);
  // (45000 + 15000) * 2 = 120000, plus QUAY 10000 = 130000
  assert.equal(upd.data.updatedItem.unit_price_vnd, 45000);
  assert.equal(upd.data.updatedItem.line_total_vnd, 120000);
  assert.equal(upd.data.order.total_vnd, 130000);
  assert.deepEqual(upd.data.order.table_numbers, [3, 4]);
  assert.equal(upd.data.order.version, 2);

  // Stale version rejected
  const staleUpd = post(ctx, {
    action: 'updateOrderItem',
    idempotency_key: 'p3b-upd-stale',
    order_id: orderId,
    order_item_id: item1Id,
    expected_version: 1,
    quantity: 3,
  });
  assert.equal(staleUpd.ok, false);
  assert.equal(staleUpd.error.code, 'VERSION_CONFLICT');

  // Remove item 2 (leaves item 1)
  const rem = post(ctx, {
    action: 'removeOrderItem',
    idempotency_key: 'p3b-rem-1',
    order_id: orderId,
    order_item_id: item2Id,
    expected_version: 2,
  });
  assert.equal(rem.ok, true);
  assert.equal(rem.data.order.total_vnd, 120000);
  assert.deepEqual(rem.data.order.table_numbers, [4]);
  assert.equal(rem.data.order.version, 3);

  // Cannot remove last remaining item
  const remLast = post(ctx, {
    action: 'removeOrderItem',
    idempotency_key: 'p3b-rem-last',
    order_id: orderId,
    order_item_id: item1Id,
    expected_version: 3,
  });
  assert.equal(remLast.ok, false);
  assert.equal(remLast.error.code, 'VALIDATION_ERROR');

  // Settle o1, then verify Paid order rejects updateOrderItem, removeOrderItem, cancelOrder
  const payO1 = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3b-pay-o1',
    order_id: orderId,
    expected_version: 3,
    payment_method: 'CASH',
  });
  assert.equal(payO1.ok, true);

  for (const act of [
    { action: 'updateOrderItem', order_item_id: item1Id, quantity: 5 },
    { action: 'removeOrderItem', order_item_id: item1Id },
    { action: 'cancelOrder', cancel_reason: 'Test' },
  ]) {
    const r = post(
      ctx,
      Object.assign(
        {
          idempotency_key: 'p3b-guard-' + act.action,
          order_id: orderId,
          expected_version: 4,
        },
        act
      )
    );
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'INVALID_STATE');
  }

  // Create o2 and test cancelOrder
  const o2 = createOrder(
    ctx,
    'DINE_IN',
    [{ item_id: 'MY_DAC_BIET', quantity: 1, seat_id: 'T5-S2' }],
    'p3b-create-o2'
  );
  assert.equal(o2.ok, true);

  // Empty cancel_reason rejected
  const badCancel = post(ctx, {
    action: 'cancelOrder',
    idempotency_key: 'p3b-cancel-bad',
    order_id: o2.data.order.order_id,
    expected_version: 1,
    cancel_reason: ' ',
  });
  assert.equal(badCancel.ok, false);
  assert.equal(badCancel.error.code, 'VALIDATION_ERROR');

  // Valid cancel
  const okCancel = post(ctx, {
    action: 'cancelOrder',
    idempotency_key: 'p3b-cancel-ok',
    order_id: o2.data.order.order_id,
    expected_version: 1,
    cancel_reason: 'Khách đổi ý không ăn nữa',
  });
  assert.equal(okCancel.ok, true);
  assert.equal(okCancel.data.order.status, 'Cancelled');
  assert.equal(okCancel.data.order.cancel_reason, 'Khách đổi ý không ăn nữa');
  assert.ok(okCancel.data.order.cancelled_at);

  // Seat T5-S2 released
  const floor = post(ctx, { action: 'getFloorState' });
  const t5s2 = floor.data.tables[4].seats.find((s) => s.seat_id === 'T5-S2');
  assert.equal(t5s2.status, 'available');

  // Repeated cancel & settle on Cancelled order rejected
  const repCancel = post(ctx, {
    action: 'cancelOrder',
    idempotency_key: 'p3b-cancel-rep',
    order_id: o2.data.order.order_id,
    expected_version: 2,
    cancel_reason: 'Again',
  });
  assert.equal(repCancel.ok, false);
  assert.equal(repCancel.error.code, 'INVALID_STATE');

  const payCancelled = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3b-pay-cancelled',
    order_id: o2.data.order.order_id,
    expected_version: 2,
    payment_method: 'CASH',
  });
  assert.equal(payCancelled.ok, false);
  assert.equal(payCancelled.error.code, 'INVALID_STATE');
});

test('Phase 3C & 3D: Order History filters/pagination, Reports excluding Cancelled & Merged, Asia/Ho_Chi_Minh dates, and CSV BOM', () => {
  const ctx = bootBackend();

  // 1. Paid DINE_IN CASH (100,000)
  const o1 = createOrder(
    ctx,
    'DINE_IN',
    [{ item_id: 'MY_DAC_BIET', quantity: 2, seat_id: 'T1-S1' }],
    'p3cd-order-o1'
  );
  post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3cd-pay1',
    order_id: o1.data.order.order_id,
    expected_version: 1,
    payment_method: 'CASH',
  });

  // 2. Two orders merged -> 1 Paid BANK order (85,000); 2 source orders become Merged
  const m1 = createOrder(ctx, 'DINE_IN', [{ item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T2-S1' }], 'p3cd-order-m1');
  const m2 = createOrder(ctx, 'DINE_IN', [{ item_id: 'BUN_THANG', quantity: 1, seat_id: 'T2-S2' }], 'p3cd-order-m2');
  const merged = post(ctx, {
    action: 'mergeOrders',
    idempotency_key: 'p3cd-merge',
    source_orders: [
      { order_id: m1.data.order.order_id, expected_version: 1 },
      { order_id: m2.data.order.order_id, expected_version: 1 },
    ],
  });
  assert.equal(merged.ok, true);
  post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3cd-pay-merged',
    order_id: merged.data.order.order_id,
    expected_version: 1,
    payment_method: 'BANK',
  });

  // 3. Unpaid TAKEAWAY (50,000)
  createOrder(ctx, 'TAKEAWAY', [{ item_id: 'SUI_CAO', quantity: 1, seat_id: '' }], 'p3cd-order-tw');

  // 4. Cancelled DINE_IN (50,000 - must be excluded from sales)
  const c1 = createOrder(ctx, 'DINE_IN', [{ item_id: 'MY_TRON', quantity: 1, seat_id: 'T6-S1' }], 'p3cd-order-c1');
  post(ctx, {
    action: 'cancelOrder',
    idempotency_key: 'p3cd-cancel-c1',
    order_id: c1.data.order.order_id,
    expected_version: 1,
    cancel_reason: 'Hết bàn',
  });

  // Check reports
  const rep = post(ctx, { action: 'getReports', filters: { date_preset: 'today' } });
  assert.equal(rep.ok, true);
  const s = rep.data.summary;
  // Eligible orders: o1 (100k), merged (85k), tw (50k) = 3 orders, 235k total
  assert.equal(s.total_orders, 3);
  assert.equal(s.dine_in_orders, 2);
  assert.equal(s.takeaway_orders, 1);
  assert.equal(s.paid_orders, 2);
  assert.equal(s.unpaid_orders, 1);
  assert.equal(s.cancelled_orders, 1);
  assert.equal(s.merged_source_orders, 2);
  assert.equal(s.total_order_value_vnd, 235000);
  assert.equal(s.cash_collected_vnd, 100000);
  assert.equal(s.bank_collected_vnd, 85000);
  assert.equal(s.total_collected_vnd, 185000);
  assert.equal(s.average_order_value_vnd, Math.round(235000 / 3));

  // History filtering & pagination
  const histPaid = post(ctx, {
    action: 'listOrderHistory',
    filters: { date_preset: 'today', payment_status: 'Paid' },
    page: 1,
    page_size: 1,
  });
  assert.equal(histPaid.ok, true);
  assert.equal(histPaid.data.total, 2);
  assert.equal(histPaid.data.totalPages, 2);
  assert.equal(histPaid.data.orders.length, 1);

  const histCancelled = post(ctx, {
    action: 'listOrderHistory',
    filters: { date_preset: 'today', status: 'Cancelled' },
  });
  assert.equal(histCancelled.data.total, 1);
  assert.equal(histCancelled.data.orders[0].cancel_reason, 'Hết bàn');

  // Detail includes payment & auditHistory
  const detailPaid = post(ctx, { action: 'getOrderDetail', order_id: merged.data.order.order_id });
  assert.equal(detailPaid.ok, true);
  assert.equal(detailPaid.data.payment.payment_method, 'BANK');
  assert.equal(detailPaid.data.payment.amount_vnd, 85000);
  assert.ok(detailPaid.data.auditHistory.length >= 2);

  // Asia/Ho_Chi_Minh timezone boundary: 2026-05-10T17:30:00Z is 2026-05-11 00:30+07:00
  const localDay = ctx.toLocalDateStr_('2026-05-10T17:30:00Z');
  assert.equal(localDay, '2026-05-11');

  // CSV Export UTF-8 BOM & RFC-4180 escaping
  const csv = fmt.buildCsv(['Mã đơn', 'Ghi chú'], [['#001', 'Ít rau, "nóng"\nnhanh']]);
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('"Ít rau, ""nóng""\nnhanh"'));
});

test('Phase 3E & 3G: verifyDatabaseIntegrity for Payments, Auth enforcement, and SyncRevision behavior', () => {
  const ctx = bootBackend();

  // Protected Phase 3 endpoints reject raw passcode / missing token
  for (const act of ['settlePayment', 'updateOrderItem', 'removeOrderItem', 'cancelOrder', 'listOrderHistory', 'getReports']) {
    const noTok = post(ctx, { action: act }, true);
    assert.equal(noTok.ok, false);
    assert.equal(noTok.error.code, 'UNAUTHORIZED');

    const rawPass = post(ctx, { action: act, passcode: 'test-pass-999' }, true);
    assert.equal(rawPass.ok, false);
    assert.equal(rawPass.error.code, 'UNAUTHORIZED');
  }

  const o1 = createOrder(ctx, 'TAKEAWAY', [{ item_id: 'MY_VAN_THAN', quantity: 1, seat_id: '' }], 'p3eg-order-o1');
  const pay1 = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p3eg-pay1',
    order_id: o1.data.order.order_id,
    expected_version: 1,
    payment_method: 'CASH',
  });
  assert.equal(pay1.ok, true);

  // SyncRevision stays stable on reads
  const revBefore = pay1.data.syncRevision;
  const h = post(ctx, { action: 'listOrderHistory', filters: { date_preset: 'today' } });
  const r = post(ctx, { action: 'getReports', filters: { date_preset: 'today' } });
  assert.equal(h.data.syncRevision, revBefore);
  assert.equal(r.data.syncRevision, revBefore);

  // Clean DB passes integrity check
  const cleanReport = ctx.verifyDatabaseIntegrity();
  assert.equal(cleanReport.ok, true);
  assert.equal(cleanReport.errors.length, 0);

  // Inject Payment amount mismatch -> verifyDatabaseIntegrity catches it without mutating
  const paySheet = ctx.SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Payments');
  const payHeaders = paySheet.getRange(1, 1, 1, paySheet.getLastColumn()).getValues()[0];
  const amtCol = payHeaders.indexOf('amount_vnd') + 1;
  paySheet.getRange(2, amtCol).setValue(1000);

  const dirtyReport = ctx.verifyDatabaseIntegrity();
  assert.equal(dirtyReport.ok, false);
  assert.ok(dirtyReport.errors.some((iss) => iss.includes('amount_vnd')));
});
