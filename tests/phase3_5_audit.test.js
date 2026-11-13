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

function bootBackend(skipSetup = false) {
  const ctx = createGasMockEnv();
  vm.createContext(ctx);
  for (const relPath of GAS_FILES) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    vm.runInContext(code, ctx, { filename: relPath });
  }
  if (!skipSetup) {
    ctx.setupDatabase();
  }
  const loginRes = JSON.parse(
    ctx.doPost({
      postData: { contents: JSON.stringify({ action: 'login', passcode: 'test-pass-999' }) },
    }).getContent()
  );
  ctx._sessionToken = loginRes.data.session_token;
  return ctx;
}

function post(ctx, bodyObj) {
  const payload = Object.assign({ session_token: ctx._sessionToken }, bodyObj);
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

test('Phase 3.5 Payment Audit: fault injection at every write step, timeout replay, and selective seat release', () => {
  const ctx = bootBackend();
  const ss = ctx.SpreadsheetApp.getActiveSpreadsheet();

  // Order 1 occupies T1-S1 and T2-S1; Order 2 occupies T1-S2
  const o1 = createOrder(
    ctx,
    'DINE_IN',
    [
      { item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T1-S1', topping_units: 1 }, // 60000
      { item_id: 'QUAY', quantity: 2, seat_id: 'T2-S1', topping_units: 0 }, // 10000
    ],
    'p35-ord-1'
  );
  const o2 = createOrder(
    ctx,
    'DINE_IN',
    [{ item_id: 'BUN_THANG', quantity: 1, seat_id: 'T1-S2' }],
    'p35-ord-2'
  );
  assert.equal(o1.ok, true);
  assert.equal(o2.ok, true);

  // Fault injection on Payments, IdempotencyKeys, AuditLog
  for (const sheetName of ['Payments', 'IdempotencyKeys', 'AuditLog']) {
    ss.getSheetByName(sheetName)._failOnNextWrite = true;
    const revBefore = post(ctx, { action: 'syncStatus' }).data.syncRevision;
    const failRes = post(ctx, {
      action: 'settlePayment',
      idempotency_key: 'p35-pay-fi-key',
      order_id: o1.data.order.order_id,
      expected_version: 1,
      payment_method: 'CASH',
    });
    assert.equal(failRes.ok, false);
    assert.equal(ss.getSheetByName('Payments').getLastRow(), 1);
    assert.equal(post(ctx, { action: 'syncStatus' }).data.syncRevision, revBefore);
    const det = post(ctx, { action: 'getOrderDetail', order_id: o1.data.order.order_id });
    assert.equal(det.data.order.payment_status, 'Unpaid');
    assert.equal(det.data.order.version, 1);
  }

  // Successful retry with same idempotency_key (simulates timeout recovery)
  const okPay = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p35-pay-fi-key',
    order_id: o1.data.order.order_id,
    expected_version: 1,
    payment_method: 'CASH',
  });
  assert.equal(okPay.ok, true);
  assert.equal(okPay.data.payment.amount_vnd, 70000);

  // Replay with same idempotency_key returns original result
  const replayPay = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p35-pay-fi-key',
    order_id: o1.data.order.order_id,
    expected_version: 1,
    payment_method: 'CASH',
  });
  assert.equal(replayPay.ok, true);
  assert.equal(replayPay.data.replayed, true);

  // T1-S1 and T2-S1 released, while T1-S2 remains occupied by o2
  const floor = post(ctx, { action: 'getFloorState' });
  const t1s1 = floor.data.tables[0].seats.find((s) => s.seat_id === 'T1-S1');
  const t1s2 = floor.data.tables[0].seats.find((s) => s.seat_id === 'T1-S2');
  const t2s1 = floor.data.tables[1].seats.find((s) => s.seat_id === 'T2-S1');
  assert.equal(t1s1.status, 'available');
  assert.equal(t2s1.status, 'available');
  assert.equal(t1s2.status, 'occupied');

  // Paid order rejects ALL mutations including moveOrderItem
  const movePaid = post(ctx, {
    action: 'moveOrderItem',
    idempotency_key: 'p35-move-paid',
    order_id: o1.data.order.order_id,
    order_item_id: o1.data.items[0].order_item_id,
    target_seat_id: 'T3-S1',
    expected_version: 2,
  });
  assert.equal(movePaid.ok, false);
  assert.equal(movePaid.error.code, 'INVALID_STATE');
});

test('Phase 3.5 Concurrent Settlement & Lifecycle Rollbacks: two devices racing, edit/remove/cancel failure recovery', () => {
  const ctx = bootBackend();
  const ss = ctx.SpreadsheetApp.getActiveSpreadsheet();

  const o1 = createOrder(
    ctx,
    'DINE_IN',
    [
      { item_id: 'MY_DAC_BIET', quantity: 1, seat_id: 'T4-S1' },
      { item_id: 'QUAY', quantity: 1, seat_id: 'T4-S2' },
    ],
    'p35-conc-o1'
  );
  const oid = o1.data.order.order_id;
  const item1Id = o1.data.items[0].order_item_id;

  // Device A settles with expected_version=1 -> succeeds
  const devA = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p35-devA-pay',
    order_id: oid,
    expected_version: 1,
    payment_method: 'BANK',
  });
  assert.equal(devA.ok, true);

  // Device B tries to settle with stale expected_version=1 and different key -> rejected
  const devB = post(ctx, {
    action: 'settlePayment',
    idempotency_key: 'p35-devB-pay',
    order_id: oid,
    expected_version: 1,
    payment_method: 'CASH',
  });
  assert.equal(devB.ok, false);
  assert.equal(devB.error.code, 'INVALID_STATE');
  assert.equal(ss.getSheetByName('Payments').getLastRow(), 2);

  // Order 2: test fault injection on updateOrderItem and cancelOrder
  const o2 = createOrder(
    ctx,
    'DINE_IN',
    [{ item_id: 'SUI_CAO', quantity: 1, seat_id: 'T5-S1' }],
    'p35-conc-o2'
  );
  const oid2 = o2.data.order.order_id;
  const o2ItemId = o2.data.items[0].order_item_id;

  ss.getSheetByName('AuditLog')._failOnNextWrite = true;
  const failUpd = post(ctx, {
    action: 'updateOrderItem',
    idempotency_key: 'p35-upd-fi',
    order_id: oid2,
    order_item_id: o2ItemId,
    expected_version: 1,
    quantity: 3,
  });
  assert.equal(failUpd.ok, false);
  const det2 = post(ctx, { action: 'getOrderDetail', order_id: oid2 });
  assert.equal(det2.data.order.total_vnd, 50000);
  assert.equal(det2.data.items[0].quantity, 1);

  ss.getSheetByName('AuditLog')._failOnNextWrite = true;
  const failCancel = post(ctx, {
    action: 'cancelOrder',
    idempotency_key: 'p35-can-fi',
    order_id: oid2,
    expected_version: 1,
    cancel_reason: 'Khách hủy',
  });
  assert.equal(failCancel.ok, false);
  const det2After = post(ctx, { action: 'getOrderDetail', order_id: oid2 });
  assert.equal(det2After.data.order.status, 'Confirmed');
});

test('Phase 3.5 Reporting Date Boundaries, Reversed Custom Range, and CSV Formula Injection', () => {
  const ctx = bootBackend();

  // Midnight boundary in Asia/Ho_Chi_Minh (+07:00)
  // 2026-05-10T16:59:59Z == 2026-05-10 23:59:59+07:00
  // 2026-05-10T17:00:00Z == 2026-05-11 00:00:00+07:00
  assert.equal(ctx.toLocalDateStr_('2026-05-10T16:59:59Z'), '2026-05-10');
  assert.equal(ctx.toLocalDateStr_('2026-05-10T17:00:00Z'), '2026-05-11');

  // Reversed custom range swaps cleanly
  const swapped = ctx.resolveDateRange_({
    date_preset: 'custom',
    date_from: '2026-05-15',
    date_to: '2026-05-10',
  });
  assert.equal(swapped.dateFrom, '2026-05-10');
  assert.equal(swapped.dateTo, '2026-05-15');

  // CSV formula injection neutralization
  const evilCsv = fmt.buildCsv(
    ['Mã đơn', 'Ghi chú'],
    [
      ['#001', '=CMD("calc")'],
      ['#002', '+1+1'],
      ['#003', '-2+3'],
      ['#004', '@SUM(A1:A2)'],
      ['#005', '\t=HYPERLINK("http://evil")'],
    ]
  );
  assert.ok(evilCsv.startsWith('\uFEFF'));
  assert.ok(evilCsv.includes("'=CMD(\"\"calc\"\")"));
  assert.ok(evilCsv.includes("'+1+1"));
  assert.ok(evilCsv.includes("'-2+3"));
  assert.ok(evilCsv.includes("'@SUM(A1:A2)"));
  assert.ok(evilCsv.includes("'\t=HYPERLINK"));
});

test('Phase 3.5 Migration & Integrity: migrates pre-Phase-3 v1.2.0 DB safely without data loss and catches corruptions', () => {
  const ctx = bootBackend(true); // skip initial setupDatabase
  const ss = ctx.SpreadsheetApp.getActiveSpreadsheet();

  // Simulate pre-Phase-3 (v1.2.0) database without Payments sheet and without Phase 3 Orders columns
  const preOrderHeaders = [
    'order_id', 'order_number', 'order_type', 'status', 'payment_status',
    'table_numbers_json', 'subtotal_vnd', 'total_vnd', 'version',
    'idempotency_key', 'notes', 'created_at', 'updated_at', 'paid_at',
    'created_by', 'merged_into_order_id', 'parent_order_ids_json',
  ];
  const v12Sheets = {
    Settings: [['key', 'value', 'description'], ['SchemaVersion', '1.2.0', 'Old']],
    MenuItems: [['item_id', 'name', 'category', 'price_vnd', 'is_active', 'sort_order', 'updated_at']],
    Modifiers: [['modifier_id', 'name', 'group_name', 'price_delta_vnd', 'is_active', 'sort_order']],
    TablesSeats: [['seat_id', 'table_number', 'seat_number', 'label', 'is_active']],
    Orders: [
      preOrderHeaders,
      ['ORD-OLD-1', '#001', 'TAKEAWAY', 'Confirmed', 'Unpaid', '[]', 45000, 45000, 1, 'old-key-1', 'Old note', '2026-05-01T10:00:00+07:00', '2026-05-01T10:00:00+07:00', '', 'staff', '', '[]'],
    ],
    OrderItems: [
      ['order_item_id', 'order_id', 'seat_id', 'table_number', 'seat_number', 'item_id', 'item_name_snapshot', 'unit_price_vnd', 'quantity', 'modifiers_json', 'topping_units', 'topping_unit_price_vnd', 'line_total_vnd', 'custom_note', 'created_at', 'updated_at'],
      ['ORD-OLD-1-L01', 'ORD-OLD-1', '', '', '', 'MY_VAN_THAN', 'Mỳ Vằn Thắn', 45000, 1, '[]', 0, 15000, 45000, '', '2026-05-01T10:00:00+07:00', '2026-05-01T10:00:00+07:00'],
    ],
    AuditLog: [['log_id', 'timestamp', 'action', 'entity_type', 'entity_id', 'actor', 'request_id', 'details_json']],
    IdempotencyKeys: [['idempotency_key', 'action', 'order_id', 'response_json', 'created_at']],
  };

  Object.keys(v12Sheets).forEach((name) => {
    const sh = ss.insertSheet(name);
    const rows = v12Sheets[name];
    sh.getRange(1, 1, rows.length, rows[0].length).setValues(rows);
  });

  // Run setupDatabase() migration
  ctx.setupDatabase();

  // Verify existing order preserved, Payments sheet created, new columns added, integrity clean
  const ordersSheet = ss.getSheetByName('Orders');
  assert.equal(ordersSheet.getLastRow(), 2);
  const newHeaders = ordersSheet.getRange(1, 1, 1, ordersSheet.getLastColumn()).getValues()[0];
  assert.ok(newHeaders.indexOf('payment_method') !== -1);
  assert.ok(newHeaders.indexOf('cancelled_at') !== -1);
  assert.ok(newHeaders.indexOf('cancel_reason') !== -1);
  assert.ok(ss.getSheetByName('Payments'));

  const integrity = ctx.verifyDatabaseIntegrity();
  assert.equal(integrity.ok, true);
  assert.equal(integrity.errors.length, 0);

  // Inject negative OrderItems line_total_vnd -> verifyDatabaseIntegrity catches it without mutating
  const itemsSheet = ss.getSheetByName('OrderItems');
  const itemHeaders = itemsSheet.getRange(1, 1, 1, itemsSheet.getLastColumn()).getValues()[0];
  itemsSheet.getRange(2, itemHeaders.indexOf('line_total_vnd') + 1).setValue(-500);
  const dirty = ctx.verifyDatabaseIntegrity();
  assert.equal(dirty.ok, false);
  assert.ok(dirty.errors.some((e) => e.includes('invalid integer VND')));
});
