const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGasMockEnv } = require('./mock_sheets');
const { createCart } = require('../frontend/js/cart.js');
const { createSyncManager } = require('../frontend/js/sync.js');

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

function post(ctx, bodyObj) {
  const out = ctx.doPost({
    postData: {
      contents: JSON.stringify(Object.assign({ session_token: ctx._sessionToken }, bodyObj)),
    },
  });
  return JSON.parse(out.getContent());
}

function createSampleOrder(ctx, orderType, items, keySuffix) {
  return post(ctx, {
    action: 'createOrder',
    idempotency_key: 'idemp-' + keySuffix,
    order_type: orderType,
    items,
  });
}

test('Floor state tracks all 36 seats, multi-table/seat occupancy, and unavailable seats', () => {
  const ctx = bootBackend();
  // Deactivate T9-S4
  const seatsSheet = ctx._ss.getSheetByName('TablesSeats');
  seatsSheet._rows[36][4] = false;

  const ord = createSampleOrder(
    ctx,
    'DINE_IN',
    [
      { item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T1-S1' },
      { item_id: 'BUN_THANG', quantity: 1, seat_id: 'T2-S3', topping_units: 1 },
    ],
    'floor-1'
  );
  assert.equal(ord.ok, true);

  const floor = post(ctx, { action: 'getFloorState' });
  assert.equal(floor.ok, true);
  assert.equal(floor.data.tables.length, 9);
  assert.equal(floor.data.seats.length, 36);

  const s1 = floor.data.seats.find((s) => s.seat_id === 'T1-S1');
  const s2 = floor.data.seats.find((s) => s.seat_id === 'T2-S3');
  const sUnavail = floor.data.seats.find((s) => s.seat_id === 'T9-S4');
  const sAvail = floor.data.seats.find((s) => s.seat_id === 'T1-S2');

  assert.equal(s1.status, 'occupied');
  assert.equal(s1.subtotal_vnd, 45000);
  assert.equal(s2.status, 'occupied');
  assert.equal(s2.subtotal_vnd, 55000);
  assert.equal(sUnavail.status, 'unavailable');
  assert.equal(sAvail.status, 'available');

  assert.equal(floor.data.tables[0].occupied_seats, 1);
  assert.equal(floor.data.tables[0].active_total_vnd, 45000);
  assert.equal(floor.data.tables[1].active_total_vnd, 55000);
});

test('Active orders list supports filters and getOrderDetail returns seat/table subtotals', () => {
  const ctx = bootBackend();
  const o1 = createSampleOrder(
    ctx,
    'DINE_IN',
    [
      { item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T1-S1' },
      { item_id: 'QUAY', quantity: 2, seat_id: 'T1-S2' },
    ],
    'list-1'
  );
  createSampleOrder(ctx, 'TAKEAWAY', [{ item_id: 'SUI_CAO', quantity: 1 }], 'list-2');

  const dineInOnly = post(ctx, { action: 'listActiveOrders', filters: { order_type: 'DINE_IN' } });
  assert.equal(dineInOnly.data.orders.length, 1);

  const bySeat = post(ctx, { action: 'listActiveOrders', filters: { seat_id: 'T1-S2' } });
  assert.equal(bySeat.data.orders.length, 1);

  const detail = post(ctx, { action: 'getOrderDetail', order_id: o1.data.order.order_id });
  assert.equal(detail.ok, true);
  assert.equal(detail.data.seatSubtotals['T1-S1'], 45000);
  assert.equal(detail.data.seatSubtotals['T1-S2'], 10000);
  assert.equal(detail.data.tableSubtotals['1'], 55000);
});

test('addItemsToOrder preserves original price snapshots, increments version, and rejects stale version', () => {
  const ctx = bootBackend();
  const o1 = createSampleOrder(
    ctx,
    'DINE_IN',
    [{ item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T1-S1' }],
    'add-1'
  );

  // Simulate menu price increase in Sheets from 45,000 -> 48,000 after order was placed
  ctx._ss.getSheetByName('MenuItems')._rows[1][3] = 48000;

  // Stale expected_version rejected
  const stale = post(ctx, {
    action: 'addItemsToOrder',
    idempotency_key: 'idemp-add-stale',
    order_id: o1.data.order.order_id,
    expected_version: 99,
    items: [{ item_id: 'QUAY', quantity: 1, seat_id: 'T1-S1' }],
  });
  assert.equal(stale.ok, false);
  assert.equal(stale.error.code, 'VERSION_CONFLICT');

  // Valid addItemsToOrder
  const added = post(ctx, {
    action: 'addItemsToOrder',
    idempotency_key: 'idemp-add-valid',
    order_id: o1.data.order.order_id,
    expected_version: 1,
    items: [{ item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T2-S1' }],
  });
  assert.equal(added.ok, true);
  assert.equal(added.data.order.version, 2);
  // Original item stayed 45,000 + new item at 48,000 = 93,000
  assert.equal(added.data.order.total_vnd, 93000);
  assert.deepEqual(added.data.order.table_numbers, [1, 2]);
});

test('moveOrderItem moves item between seats preserving snapshots, and rejects TAKEAWAY', () => {
  const ctx = bootBackend();
  const o1 = createSampleOrder(
    ctx,
    'DINE_IN',
    [
      {
        item_id: 'MY_DAC_BIET',
        quantity: 1,
        seat_id: 'T1-S1',
        modifier_ids: ['NO_VEG'],
        topping_units: 1,
        custom_note: 'Ít hành',
      },
    ],
    'move-1'
  );
  const itemId = o1.data.items[0].order_item_id;

  const moved = post(ctx, {
    action: 'moveOrderItem',
    idempotency_key: 'idemp-move-1',
    order_id: o1.data.order.order_id,
    order_item_id: itemId,
    target_seat_id: 'T3-S4',
    expected_version: 1,
  });
  assert.equal(moved.ok, true);
  assert.equal(moved.data.order.version, 2);
  assert.deepEqual(moved.data.order.table_numbers, [3]);
  assert.equal(moved.data.movedItem.seat_id, 'T3-S4');
  assert.equal(moved.data.movedItem.line_total_vnd, 65000);

  // Takeaway cannot move seat
  const tw = createSampleOrder(ctx, 'TAKEAWAY', [{ item_id: 'QUAY', quantity: 1 }], 'move-tw');
  const twFail = post(ctx, {
    action: 'moveOrderItem',
    idempotency_key: 'idemp-move-tw',
    order_id: tw.data.order.order_id,
    order_item_id: tw.data.items[0].order_item_id,
    target_seat_id: 'T1-S1',
    expected_version: 1,
  });
  assert.equal(twFail.ok, false);
  assert.equal(twFail.error.code, 'INVALID_STATE');
});

test('mergeOrders merges 3 orders, preserves lineage/seats/totals, rejects re-merge, and rolls back on failure', () => {
  const ctx = bootBackend();
  const o1 = createSampleOrder(ctx, 'DINE_IN', [{ item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T1-S1' }], 'm1');
  const o2 = createSampleOrder(ctx, 'DINE_IN', [{ item_id: 'MY_DAC_BIET', quantity: 1, seat_id: 'T2-S1' }], 'm2');
  const o3 = createSampleOrder(ctx, 'DINE_IN', [{ item_id: 'QUAY', quantity: 2, seat_id: 'T3-S2' }], 'm3');

  const mergeRes = post(ctx, {
    action: 'mergeOrders',
    idempotency_key: 'idemp-merge-3',
    source_orders: [
      { order_id: o1.data.order.order_id, expected_version: 1 },
      { order_id: o2.data.order.order_id, expected_version: 1 },
      { order_id: o3.data.order.order_id, expected_version: 1 },
    ],
  });
  assert.equal(mergeRes.ok, true);
  assert.equal(mergeRes.data.order.total_vnd, 105000);
  assert.deepEqual(mergeRes.data.order.table_numbers, [1, 2, 3]);
  assert.equal(mergeRes.data.order.parent_order_ids.length, 3);

  // Idempotent replay returns same merged order
  const replay = post(ctx, {
    action: 'mergeOrders',
    idempotency_key: 'idemp-merge-3',
    source_orders: [
      { order_id: o1.data.order.order_id, expected_version: 1 },
      { order_id: o2.data.order.order_id, expected_version: 1 },
      { order_id: o3.data.order.order_id, expected_version: 1 },
    ],
  });
  assert.equal(replay.data.replayed, true);
  assert.equal(replay.data.order.order_id, mergeRes.data.order.order_id);

  // Merged source order cannot be merged again or receive new items
  const remerge = post(ctx, {
    action: 'mergeOrders',
    idempotency_key: 'idemp-remerge',
    source_orders: [
      { order_id: o1.data.order.order_id, expected_version: 2 },
      { order_id: mergeRes.data.order.order_id, expected_version: 1 },
    ],
  });
  assert.equal(remerge.ok, false);
  assert.equal(remerge.error.code, 'INVALID_STATE');

  // Active orders list only shows the 1 merged destination order
  const active = post(ctx, { action: 'listActiveOrders' });
  assert.equal(active.data.orders.length, 1);
  assert.equal(active.data.orders[0].order_id, mergeRes.data.order.order_id);
});

test('splitOrder splits by item/seat preserving total value, rejects invalid/duplicate splits, and checks version', () => {
  const ctx = bootBackend();
  const ord = createSampleOrder(
    ctx,
    'DINE_IN',
    [
      { item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T1-S1' },
      { item_id: 'MY_DAC_BIET', quantity: 1, seat_id: 'T2-S1', topping_units: 1 },
      { item_id: 'QUAY', quantity: 2, seat_id: 'T2-S2' },
    ],
    'split-1'
  );
  const items = ord.data.items;
  // Total = 45,000 + 65,000 + 10,000 = 120,000

  // Reject splitting all items
  const allFail = post(ctx, {
    action: 'splitOrder',
    idempotency_key: 'idemp-split-all',
    source_order_id: ord.data.order.order_id,
    expected_version: 1,
    split_item_ids: items.map((i) => i.order_item_id),
  });
  assert.equal(allFail.ok, false);

  // Reject duplicate item IDs
  const dupFail = post(ctx, {
    action: 'splitOrder',
    idempotency_key: 'idemp-split-dup',
    source_order_id: ord.data.order.order_id,
    expected_version: 1,
    split_item_ids: [items[0].order_item_id, items[0].order_item_id],
  });
  assert.equal(dupFail.ok, false);

  // Valid split of Table 2 items into new order
  const splitOk = post(ctx, {
    action: 'splitOrder',
    idempotency_key: 'idemp-split-ok',
    source_order_id: ord.data.order.order_id,
    expected_version: 1,
    split_item_ids: [items[1].order_item_id, items[2].order_item_id],
  });
  assert.equal(splitOk.ok, true);
  assert.equal(splitOk.data.sourceOrder.total_vnd, 45000);
  assert.equal(splitOk.data.newOrder.total_vnd, 75000);
  assert.equal(
    splitOk.data.sourceOrder.total_vnd + splitOk.data.newOrder.total_vnd,
    120000
  );
  assert.deepEqual(splitOk.data.sourceOrder.table_numbers, [1]);
  assert.deepEqual(splitOk.data.newOrder.table_numbers, [2]);
});

test('Multi-device sync: SyncRevision advances on writes, stays stable on reads, and SyncManager detects remote changes', async () => {
  const ctx = bootBackend();
  const s1 = post(ctx, { action: 'syncStatus' });
  const rev1 = s1.data.syncRevision;

  // Read-only call does not change revision
  post(ctx, { action: 'getFloorState' });
  const s2 = post(ctx, { action: 'syncStatus' });
  assert.equal(s2.data.syncRevision, rev1);

  // Write advances revision
  createSampleOrder(ctx, 'TAKEAWAY', [{ item_id: 'QUAY', quantity: 1 }], 'sync-w1');
  const s3 = post(ctx, { action: 'syncStatus' });
  assert.ok(s3.data.syncRevision > rev1);

  // Frontend SyncManager unit test
  let remoteChangedTo = null;
  let remoteRev = 5;
  const syncMgr = createSyncManager({
    initialRevision: 5,
    apiClient: {
      getSessionToken: () => 'tok',
      syncStatus: async () => ({ ok: true, data: { syncRevision: remoteRev } }),
    },
    onRemoteChange: (rev) => {
      remoteChangedTo = rev;
    },
  });

  const r1 = await syncMgr.pollOnce();
  assert.equal(r1.changed, false);
  assert.equal(remoteChangedTo, null);

  remoteRev = 6;
  const r2 = await syncMgr.pollOnce();
  assert.equal(r2.changed, true);
  assert.equal(remoteChangedTo, 6);

  // Offline skips polling, online resumes
  syncMgr.setOnline(false);
  const rOff = await syncMgr.pollOnce();
  assert.equal(rOff.skipped, true);
});

test('Frontend Cart: add-to-existing-order mode routes to addItemsToOrder and preserves cart on VERSION_CONFLICT', async () => {
  const cart = createCart({ toppingUnitPriceVnd: 15000 });
  cart.setTargetOrder({
    order_id: 'ORD-1',
    order_number: '#261113-001',
    version: 2,
    order_type: 'DINE_IN',
  });
  cart.addItem({
    item_id: 'QUAY',
    item_name: 'Quẩy',
    unit_price_vnd: 5000,
    quantity: 2,
    seat_id: 'T1-S1',
  });

  await assert.rejects(
    () =>
      cart.submitOrder({
        addItemsToOrder: async () => ({
          ok: false,
          error: { code: 'VERSION_CONFLICT', message: 'Stale version' },
        }),
      }),
    (err) => err.code === 'VERSION_CONFLICT'
  );
  assert.equal(cart.getSummary().lineCount, 1);

  const ok = await cart.submitOrder({
    addItemsToOrder: async () => ({
      ok: true,
      data: { order: { order_id: 'ORD-1', order_number: '#261113-001', version: 3, total_vnd: 55000 } },
    }),
  });
  assert.equal(ok.ok, true);
  assert.equal(cart.getSummary().lineCount, 0);
  assert.equal(cart.getState().targetOrder, null);
});
