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
  return ctx;
}

function post(ctx, bodyObj) {
  const out = ctx.doPost({
    postData: {
      contents: JSON.stringify(bodyObj),
    },
  });
  return JSON.parse(out.getContent());
}

function get(ctx, params) {
  const out = ctx.doGet({ parameter: params });
  return JSON.parse(out.getContent());
}

function loginAndGetToken(ctx) {
  const res = post(ctx, { action: 'login', passcode: 'test-pass-999' });
  assert.equal(res.ok, true);
  return res.data.session_token;
}

test('Database setup seeds all 8 sheets, 7 menu items, 6 modifiers, 36 seats, and supports safe migration', () => {
  const ctx = bootBackend();
  const ss = ctx._ss;

  assert.equal(ss.getSheetByName('MenuItems').getLastRow(), 8); // 1 header + 7 items
  assert.equal(ss.getSheetByName('Modifiers').getLastRow(), 7); // 1 header + 6 modifiers
  assert.equal(ss.getSheetByName('TablesSeats').getLastRow(), 37); // 1 header + 36 seats

  // Simulate older Orders sheet missing order_number column, then re-run setupDatabase()
  const ordersSheet = ss.getSheetByName('Orders');
  ordersSheet._rows[0] = ordersSheet._rows[0].filter((c) => c !== 'order_number');
  ctx.setupDatabase();
  assert.equal(ordersSheet._rows[0].includes('order_number'), true);
});

test('Menu & Modifiers POST endpoints require valid auth and return all menu prices', () => {
  const ctx = bootBackend();

  const unauth = post(ctx, { action: 'menu', passcode: 'test-pass-999' });
  assert.equal(unauth.ok, false);
  assert.equal(unauth.error.code, 'UNAUTHORIZED');

  const token = loginAndGetToken(ctx);
  const menuRes = post(ctx, { action: 'menu', session_token: token });
  assert.equal(menuRes.ok, true);
  const byId = Object.fromEntries(menuRes.data.menuItems.map((m) => [m.item_id, m.price_vnd]));
  assert.deepEqual(byId, {
    MY_VAN_THAN: 45000,
    MY_DAC_BIET: 50000,
    SUI_CAO: 50000,
    MY_TRON: 50000,
    BUN_THANG: 40000,
    MY_TRE_EM: 35000,
    QUAY: 5000,
  });

  const modRes = post(ctx, { action: 'modifiers', session_token: token });
  assert.equal(modRes.ok, true);
  assert.equal(modRes.data.modifiers.length, 6);
});

test('createOrder rejects unknown item, sold-out item, zero/negative/large qty, invalid modifier, and invalid seat', () => {
  const ctx = bootBackend();
  const token = loginAndGetToken(ctx);

  // Mark QUAY as sold out in MenuItems sheet
  const menuSheet = ctx._ss.getSheetByName('MenuItems');
  menuSheet._rows[7][4] = false; // QUAY is_active = false

  const baseReq = (items, orderType = 'DINE_IN') =>
    post(ctx, {
      action: 'createOrder',
      session_token: token,
      idempotency_key: 'idemp-' + Math.random().toString(36).slice(2, 12),
      order_type: orderType,
      items,
    });

  // Unknown item
  assert.equal(baseReq([{ item_id: 'PHO_BO', quantity: 1, seat_id: 'T1-S1' }]).ok, false);
  // Sold-out item
  const soldOut = baseReq([{ item_id: 'QUAY', quantity: 1, seat_id: 'T1-S1' }]);
  assert.equal(soldOut.ok, false);
  assert.match(soldOut.error.message, /sold out/i);
  // Zero quantity
  assert.equal(baseReq([{ item_id: 'MY_VAN_THAN', quantity: 0, seat_id: 'T1-S1' }]).ok, false);
  // Negative quantity
  assert.equal(baseReq([{ item_id: 'MY_VAN_THAN', quantity: -2, seat_id: 'T1-S1' }]).ok, false);
  // Large invalid quantity (>100)
  assert.equal(baseReq([{ item_id: 'MY_VAN_THAN', quantity: 101, seat_id: 'T1-S1' }]).ok, false);
  // Invalid modifier
  assert.equal(
    baseReq([{ item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T1-S1', modifier_ids: ['BAD_MOD'] }]).ok,
    false
  );
  // DINE_IN without seat
  assert.equal(baseReq([{ item_id: 'MY_VAN_THAN', quantity: 1 }]).ok, false);
  // DINE_IN invalid seat
  assert.equal(baseReq([{ item_id: 'MY_VAN_THAN', quantity: 1, seat_id: 'T10-S9' }]).ok, false);
});

test('createOrder persists DINE_IN multi-item order with toppings, free modifiers, custom notes, AuditLog, and ignores client prices', () => {
  const ctx = bootBackend();
  const token = loginAndGetToken(ctx);

  const res = post(ctx, {
    action: 'createOrder',
    session_token: token,
    idempotency_key: 'idemp-order-0001',
    order_type: 'DINE_IN',
    notes: 'Khách quen',
    subtotal_vnd: 100, // tampered
    total_vnd: 100, // tampered
    items: [
      {
        item_id: 'MY_DAC_BIET',
        quantity: 2,
        seat_id: 'T1-S1',
        modifier_ids: ['NO_VEG', 'MORE_NOODLES'],
        topping_units: 2,
        custom_note: 'Nước dùng nóng',
        unit_price_vnd: 1, // tampered
      },
      {
        item_id: 'QUAY',
        quantity: 3,
        seat_id: 'T1-S2',
        modifier_ids: [],
        topping_units: 0,
      },
    ],
  });

  assert.equal(res.ok, true);
  // Line 1: 2 * (50,000 + 2 * 15,000) = 160,000
  // Line 2: 3 * 5,000 = 15,000
  // Total: 175,000 VND
  assert.equal(res.data.order.total_vnd, 175000);
  assert.equal(res.data.order.base_subtotal_vnd, 115000);
  assert.equal(res.data.order.topping_subtotal_vnd, 60000);
  assert.match(res.data.order.order_number, /^#\d{6}-001$/);
  assert.equal(res.data.replayed, false);

  // Verify database persistence across Orders, OrderItems, IdempotencyKeys, AuditLog
  assert.equal(ctx._ss.getSheetByName('Orders').getLastRow(), 2);
  assert.equal(ctx._ss.getSheetByName('OrderItems').getLastRow(), 3);
  assert.equal(ctx._ss.getSheetByName('IdempotencyKeys').getLastRow(), 2);
  assert.equal(ctx._ss.getSheetByName('AuditLog').getLastRow(), 2);
  assert.equal(ctx._ss.getSheetByName('AuditLog')._rows[1][2], 'CREATE_ORDER');
});

test('createOrder supports TAKEAWAY without seat_id and prevents duplicate requests via idempotency_key', () => {
  const ctx = bootBackend();
  const token = loginAndGetToken(ctx);

  const payload = {
    action: 'createOrder',
    session_token: token,
    idempotency_key: 'idemp-takeaway-001',
    order_type: 'TAKEAWAY',
    notes: 'Đóng hộp riêng',
    items: [{ item_id: 'BUN_THANG', quantity: 1, topping_units: 1 }],
  };

  const first = post(ctx, payload);
  assert.equal(first.ok, true);
  assert.equal(first.data.order.total_vnd, 55000);
  assert.equal(first.data.replayed, false);

  const duplicate = post(ctx, payload);
  assert.equal(duplicate.ok, true);
  assert.equal(duplicate.data.replayed, true);
  assert.equal(duplicate.data.order.order_id, first.data.order.order_id);
  // Still only 1 order row in Orders sheet
  assert.equal(ctx._ss.getSheetByName('Orders').getLastRow(), 2);
});

test('createOrder handles LockService contention and rolls back partial database write failures', () => {
  const ctx = bootBackend();
  const token = loginAndGetToken(ctx);

  // 1. Concurrent lock contention
  ctx._setLockBusy(true);
  const lockedRes = post(ctx, {
    action: 'createOrder',
    session_token: token,
    idempotency_key: 'idemp-lock-test-1',
    order_type: 'TAKEAWAY',
    items: [{ item_id: 'MY_TRE_EM', quantity: 1 }],
  });
  assert.equal(lockedRes.ok, false);
  assert.equal(lockedRes.error.code, 'LOCK_TIMEOUT');
  ctx._setLockBusy(false);

  // 2. Partial write failure on OrderItems must roll back Orders row
  ctx._ss.getSheetByName('OrderItems')._failOnNextWrite = true;
  const failRes = post(ctx, {
    action: 'createOrder',
    session_token: token,
    idempotency_key: 'idemp-rollback-1',
    order_type: 'TAKEAWAY',
    items: [{ item_id: 'MY_TRE_EM', quantity: 1 }],
  });
  assert.equal(failRes.ok, false);
  assert.equal(failRes.error.code, 'INTERNAL_ERROR');
  // Orders sheet must remain at 1 header row (no orphan order)
  assert.equal(ctx._ss.getSheetByName('Orders').getLastRow(), 1);
});
