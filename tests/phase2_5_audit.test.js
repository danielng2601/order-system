const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGasMockEnv } = require('./mock_sheets');

const ROOT = path.resolve(__dirname, '..');
const GAS_FILES = [
  'backend/src/Config.gs',
  'backend/src/Validation.gs',
  'backend/src/DbSetup.gs',
  'backend/src/PrinterService.gs',
  'backend/src/Repository.gs',
  'backend/src/OrderService.gs',
  'backend/src/FloorService.gs',
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

test('Phase 2.5 Auth Audit: raw passcode rejected on all protected endpoints and CacheService eviction returns SESSION_EXPIRED', () => {
  const ctx = bootBackend();

  const protectedActions = [
    'bootstrap',
    'menu',
    'modifiers',
    'syncStatus',
    'getFloorState',
    'listActiveOrders',
    'getOrderDetail',
    'createOrder',
    'addItemsToOrder',
    'moveOrderItem',
    'mergeOrders',
    'splitOrder',
  ];

  for (const action of protectedActions) {
    const res = post(ctx, { action, passcode: 'test-pass-999' }, true);
    assert.equal(res.ok, false, `${action} must reject raw passcode`);
    assert.equal(res.error.code, 'UNAUTHORIZED');
  }

  // Bootstrap returns current syncRevision
  const boot = post(ctx, { action: 'bootstrap' });
  assert.equal(boot.ok, true);
  assert.equal(boot.data.syncRevision, 1);

  // CacheService eviction -> SESSION_EXPIRED
  ctx.CacheService.getScriptCache().remove('SESSION_' + ctx._sessionToken);
  const evicted = post(ctx, { action: 'syncStatus' });
  assert.equal(evicted.ok, false);
  assert.equal(evicted.error.code, 'SESSION_EXPIRED');
});

test('Phase 2.5 State Machine & Paid Guard: prevents invalid creations and Paid/Cancelled/Merged mutations', () => {
  const ctx = bootBackend();

  // Cannot create order directly as Cancelled or Merged
  for (const badStatus of ['Cancelled', 'Merged']) {
    const res = post(ctx, {
      action: 'createOrder',
      idempotency_key: 'idemp-bad-status-' + badStatus,
      order_type: 'TAKEAWAY',
      status: badStatus,
      items: [{ item_id: 'QUAY', quantity: 1 }],
    });
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'VALIDATION_ERROR');
  }

  const o1 = createOrder(ctx, 'DINE_IN', [
    { item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T1-S1' },
    { item_id: 'QUAY', quantity: 1, seat_id: 'T1-S2' },
  ], 'idemp-paid-1');
  const o2 = createOrder(ctx, 'DINE_IN', [{ item_id: 'BUN_THANG', quantity: 1, seat_id: 'T2-S1' }], 'idemp-paid-2');
  const tw = createOrder(ctx, 'TAKEAWAY', [{ item_id: 'SUI_CAO', quantity: 1 }], 'idemp-tw-1');

  // Cannot merge DINE_IN + TAKEAWAY
  const mixMerge = post(ctx, {
    action: 'mergeOrders',
    idempotency_key: 'idemp-mix-merge',
    source_orders: [
      { order_id: o1.data.order.order_id, expected_version: 1 },
      { order_id: tw.data.order.order_id, expected_version: 1 },
    ],
  });
  assert.equal(mixMerge.ok, false);
  assert.equal(mixMerge.error.code, 'VALIDATION_ERROR');

  // Cannot merge same order twice
  const dupMerge = post(ctx, {
    action: 'mergeOrders',
    idempotency_key: 'idemp-dup-merge',
    source_orders: [
      { order_id: o1.data.order.order_id, expected_version: 1 },
      { order_id: o1.data.order.order_id, expected_version: 1 },
    ],
  });
  assert.equal(dupMerge.ok, false);
  assert.equal(dupMerge.error.code, 'BAD_REQUEST');

  // Mark o1 as Paid in Orders sheet -> reject addItemsToOrder, splitOrder, mergeOrders
  const ordersSheet = ctx._ss.getSheetByName('Orders');
  const paidCol = ordersSheet._rows[0].indexOf('payment_status');
  ordersSheet._rows[1][paidCol] = 'Paid';

  const addPaid = post(ctx, {
    action: 'addItemsToOrder',
    idempotency_key: 'idemp-add-paid',
    order_id: o1.data.order.order_id,
    expected_version: 1,
    items: [{ item_id: 'QUAY', quantity: 1, seat_id: 'T1-S1' }],
  });
  assert.equal(addPaid.ok, false);
  assert.equal(addPaid.error.code, 'INVALID_STATE');

  const splitPaid = post(ctx, {
    action: 'splitOrder',
    idempotency_key: 'idemp-split-paid',
    source_order_id: o1.data.order.order_id,
    expected_version: 1,
    split_item_ids: [o1.data.items[0].order_item_id],
  });
  assert.equal(splitPaid.ok, false);
  assert.equal(splitPaid.error.code, 'INVALID_STATE');

  const mergePaid = post(ctx, {
    action: 'mergeOrders',
    idempotency_key: 'idemp-merge-paid',
    source_orders: [
      { order_id: o1.data.order.order_id, expected_version: 1 },
      { order_id: o2.data.order.order_id, expected_version: 1 },
    ],
  });
  assert.equal(mergePaid.ok, false);
  assert.equal(mergePaid.error.code, 'INVALID_STATE');
});

test('Phase 2.5 Scenario A & B: Multi-seat initial order (T1-S1..T1-S4), move item, multi-table add-items & subtotals', () => {
  const ctx = bootBackend();

  // Scenario A: 1 order across all 4 seats of Table 1
  const ordA = createOrder(
    ctx,
    'DINE_IN',
    [
      { item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T1-S1' }, // 45,000
      { item_id: 'MY_DAC_BIET', quantity: 1, seat_id: 'T1-S2', topping_units: 1 }, // 65,000
      { item_id: 'SUI_CAO', quantity: 1, seat_id: 'T1-S3', modifier_ids: ['NO_VEG'], custom_note: 'Ít hành' }, // 50,000
      { item_id: 'QUAY', quantity: 2, seat_id: 'T1-S4' }, // 10,000
    ],
    'idemp-scen-a'
  );
  assert.equal(ordA.ok, true);
  assert.equal(ordA.data.order.total_vnd, 170000);
  assert.deepEqual(ordA.data.order.table_numbers, [1]);

  // Move Quẩy from T1-S4 -> T1-S1
  const moveRes = post(ctx, {
    action: 'moveOrderItem',
    idempotency_key: 'idemp-scen-a-move',
    order_id: ordA.data.order.order_id,
    order_item_id: ordA.data.items[3].order_item_id,
    target_seat_id: 'T1-S1',
    expected_version: 1,
  });
  assert.equal(moveRes.ok, true);

  const detailA = post(ctx, { action: 'getOrderDetail', order_id: ordA.data.order.order_id });
  assert.equal(detailA.data.seatSubtotals['T1-S1'], 55000);
  assert.equal(detailA.data.seatSubtotals['T1-S2'], 65000);
  assert.equal(detailA.data.seatSubtotals['T1-S3'], 50000);
  assert.equal(detailA.data.seatSubtotals['T1-S4'], undefined);
  assert.equal(detailA.data.tableSubtotals['1'], 170000);

  // Scenario B: Add items on Table 2 to same order
  const addB = post(ctx, {
    action: 'addItemsToOrder',
    idempotency_key: 'idemp-scen-b-add',
    order_id: ordA.data.order.order_id,
    expected_version: 2,
    items: [
      { item_id: 'BUN_THANG', quantity: 2, seat_id: 'T2-S1' }, // 80,000
      { item_id: 'MY_TRE_EM', quantity: 1, seat_id: 'T2-S2' }, // 35,000
    ],
  });
  assert.equal(addB.ok, true);
  assert.deepEqual(addB.data.order.table_numbers, [1, 2]);
  assert.equal(addB.data.order.total_vnd, 285000);

  const detailB = post(ctx, { action: 'getOrderDetail', order_id: ordA.data.order.order_id });
  assert.equal(detailB.data.tableSubtotals['1'], 170000);
  assert.equal(detailB.data.tableSubtotals['2'], 115000);
  assert.equal(ctx.verifyDatabaseIntegrity().ok, true);
});

test('Phase 2.5 Scenario C & D: Merge 3 orders (no duplicate OrderItems) then split into 3 orders preserving snapshots & totals', () => {
  const ctx = bootBackend();

  const o1 = createOrder(
    ctx,
    'DINE_IN',
    [{ item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T1-S1', topping_units: 1, custom_note: 'Nóng' }],
    'idemp-cd-1'
  ); // 60,000
  const o2 = createOrder(
    ctx,
    'DINE_IN',
    [{ item_id: 'MY_DAC_BIET', quantity: 1, seat_id: 'T2-S2', modifier_ids: ['NO_VEG'] }],
    'idemp-cd-2'
  ); // 50,000
  const o3 = createOrder(
    ctx,
    'DINE_IN',
    [{ item_id: 'QUAY', quantity: 3, seat_id: 'T3-S3' }],
    'idemp-cd-3'
  ); // 15,000

  // Scenario C: Merge 3 orders -> OrderItems sheet must still have only 3 data rows (4 total with header)
  const merged = post(ctx, {
    action: 'mergeOrders',
    idempotency_key: 'idemp-cd-merge',
    source_orders: [
      { order_id: o1.data.order.order_id, expected_version: 1 },
      { order_id: o2.data.order.order_id, expected_version: 1 },
      { order_id: o3.data.order.order_id, expected_version: 1 },
    ],
  });
  assert.equal(merged.ok, true);
  assert.equal(merged.data.order.total_vnd, 125000);
  assert.equal(ctx._ss.getSheetByName('OrderItems').getLastRow(), 4); // 1 header + 3 reassigned items (no duplication!)
  assert.equal(ctx.verifyDatabaseIntegrity().ok, true);

  // Scenario D: Split merged order into 3 orders
  const mergedId = merged.data.order.order_id;
  const itemIds = merged.data.items.map((it) => it.order_item_id);

  const split1 = post(ctx, {
    action: 'splitOrder',
    idempotency_key: 'idemp-cd-split-1',
    source_order_id: mergedId,
    expected_version: 1,
    split_item_ids: [itemIds[0]],
  });
  assert.equal(split1.ok, true);
  assert.equal(split1.data.newOrder.total_vnd, 60000);
  assert.equal(split1.data.sourceOrder.total_vnd, 65000);

  const split2 = post(ctx, {
    action: 'splitOrder',
    idempotency_key: 'idemp-cd-split-2',
    source_order_id: mergedId,
    expected_version: 2,
    split_item_ids: [itemIds[1]],
  });
  assert.equal(split2.ok, true);
  assert.equal(split2.data.newOrder.total_vnd, 50000);
  assert.equal(split2.data.sourceOrder.total_vnd, 15000);

  // Combined totals across the 3 resulting active orders equal 125,000
  const active = post(ctx, { action: 'listActiveOrders' });
  assert.equal(active.data.orders.length, 3);
  const sumTotal = active.data.orders.reduce((s, o) => s + o.total_vnd, 0);
  assert.equal(sumTotal, 125000);
  assert.equal(ctx.verifyDatabaseIntegrity().ok, true);
});

test('Phase 2.5 Scenario E & F: Multi-device VERSION_CONFLICT and Fault-Injection Rollback + Retry', () => {
  const ctx = bootBackend();

  const o1 = createOrder(ctx, 'DINE_IN', [
    { item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T1-S1' },
    { item_id: 'QUAY', quantity: 1, seat_id: 'T1-S2' },
  ], 'idemp-ef-1');
  const revAfterCreate = o1.data.syncRevision;
  assert.equal(revAfterCreate, 2);

  // Device A adds item -> version 2, SyncRevision 3
  const devA = post(ctx, {
    action: 'addItemsToOrder',
    idempotency_key: 'idemp-ef-devA',
    order_id: o1.data.order.order_id,
    expected_version: 1,
    items: [{ item_id: 'QUAY', quantity: 1, seat_id: 'T1-S3' }],
  });
  assert.equal(devA.ok, true);
  assert.equal(devA.data.syncRevision, 3);

  // Device B submits with stale version 1 -> VERSION_CONFLICT, SyncRevision stays 3
  const devB = post(ctx, {
    action: 'addItemsToOrder',
    idempotency_key: 'idemp-ef-devB',
    order_id: o1.data.order.order_id,
    expected_version: 1,
    items: [{ item_id: 'BUN_THANG', quantity: 1, seat_id: 'T1-S4' }],
  });
  assert.equal(devB.ok, false);
  assert.equal(devB.error.code, 'VERSION_CONFLICT');
  assert.equal(post(ctx, { action: 'syncStatus' }).data.syncRevision, 3);

  // Fault injection on AuditLog write during splitOrder -> full rollback including IdempotencyKeys
  ctx._ss.getSheetByName('AuditLog')._failOnNextWrite = true;
  const failSplit = post(ctx, {
    action: 'splitOrder',
    idempotency_key: 'idemp-ef-split-retry',
    source_order_id: o1.data.order.order_id,
    expected_version: 2,
    split_item_ids: [o1.data.items[0].order_item_id],
  });
  assert.equal(failSplit.ok, false);
  assert.equal(failSplit.error.code, 'INTERNAL_ERROR');
  assert.equal(ctx.verifyDatabaseIntegrity().ok, true);
  assert.equal(post(ctx, { action: 'syncStatus' }).data.syncRevision, 3);

  // Retrying with the SAME idempotency_key now succeeds cleanly (wasn't poisoned by failed attempt)
  const retrySplit = post(ctx, {
    action: 'splitOrder',
    idempotency_key: 'idemp-ef-split-retry',
    source_order_id: o1.data.order.order_id,
    expected_version: 2,
    split_item_ids: [o1.data.items[0].order_item_id],
  });
  assert.equal(retrySplit.ok, true);
  assert.equal(retrySplit.data.replayed, false);
  assert.equal(retrySplit.data.syncRevision, 4);
  assert.equal(ctx.verifyDatabaseIntegrity().ok, true);
});

test('Phase 2.5 Database Integrity: detects corrupted totals, table_numbers, merged items, and broken lineage without mutating data', () => {
  const ctx = bootBackend();
  const o1 = createOrder(ctx, 'DINE_IN', [{ item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T1-S1' }], 'idemp-int-1');

  // Corrupt total_vnd & table_numbers_json
  const ordersSheet = ctx._ss.getSheetByName('Orders');
  const totalCol = ordersSheet._rows[0].indexOf('total_vnd');
  const tablesCol = ordersSheet._rows[0].indexOf('table_numbers_json');
  const origTotal = ordersSheet._rows[1][totalCol];
  ordersSheet._rows[1][totalCol] = 999;
  ordersSheet._rows[1][tablesCol] = '[9]';

  const check = ctx.verifyDatabaseIntegrity();
  assert.equal(check.ok, false);
  assert.ok(check.errors.some((e) => e.includes('total_vnd')));
  assert.ok(check.errors.some((e) => e.includes('table_numbers_json')));
  // Verify read-only: did not silently repair
  assert.equal(ordersSheet._rows[1][totalCol], 999);
  ordersSheet._rows[1][totalCol] = origTotal;
});
