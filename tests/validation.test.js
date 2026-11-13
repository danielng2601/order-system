const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadValidationContext() {
  const ctx = {
    console,
    Intl,
    Math,
    Date,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
  };
  vm.createContext(ctx);
  for (const relPath of ['backend/src/Config.gs', 'backend/src/Validation.gs']) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    vm.runInContext(code, ctx, { filename: relPath });
  }
  vm.runInContext(
    'this.ROMS_CONFIG = ROMS_CONFIG; this.SEED_MENU_ITEMS = SEED_MENU_ITEMS; this.SEED_MODIFIERS = SEED_MODIFIERS;',
    ctx
  );
  return ctx;
}

function buildCatalog(ctx) {
  const menuById = Object.fromEntries(ctx.SEED_MENU_ITEMS.map((item) => [item.item_id, item]));
  const modifiersById = Object.fromEntries(
    ctx.SEED_MODIFIERS.map((mod) => [mod.modifier_id, mod])
  );
  return {
    menuById,
    modifiersById,
    toppingUnitPriceVnd: ctx.ROMS_CONFIG.TOPPING_UNIT_PRICE_VND,
  };
}

test('Seat ID validation accepts T1-S1..T9-S4 and rejects out-of-range seats', () => {
  const ctx = loadValidationContext();
  assert.equal(ctx.isValidSeatId('T1-S1'), true);
  assert.equal(ctx.isValidSeatId('T9-S4'), true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(ctx.parseSeatId('T3-S2'))),
    { table_number: 3, seat_number: 2 }
  );

  assert.equal(ctx.isValidSeatId('T0-S1'), false);
  assert.equal(ctx.isValidSeatId('T10-S1'), false);
  assert.equal(ctx.isValidSeatId('T1-S5'), false);
  assert.equal(ctx.isValidSeatId(''), false);
  assert.equal(ctx.isValidSeatId(null), false);
});

test('calculateLineTotalVnd computes integer VND with paid toppings', () => {
  const ctx = loadValidationContext();
  // 2 x (45,000 + 2 * 15,000) = 150,000 VND
  assert.equal(ctx.calculateLineTotalVnd(45000, 2, 2, 15000), 150000);
  // 1 x (35,000 + 0) = 35,000 VND
  assert.equal(ctx.calculateLineTotalVnd(35000, 1, 0, 15000), 35000);

  assert.throws(() => ctx.calculateLineTotalVnd(45000, 0, 0, 15000));
  assert.throws(() => ctx.calculateLineTotalVnd(45000, 1, -1, 15000));
});

test('validateAndPriceOrderPayload enforces DINE_IN seat_id and ignores client prices', () => {
  const ctx = loadValidationContext();
  const catalog = buildCatalog(ctx);

  const invalidDineIn = ctx.validateAndPriceOrderPayload(
    {
      order_type: 'DINE_IN',
      items: [{ item_id: 'MY_VAN_THAN', quantity: 1 }],
    },
    catalog
  );
  assert.equal(invalidDineIn.valid, false);

  const validMultiTable = ctx.validateAndPriceOrderPayload(
    {
      order_type: 'DINE_IN',
      items: [
        {
          seat_id: 'T1-S1',
          item_id: 'MY_VAN_THAN',
          quantity: 1,
          modifier_ids: ['NO_VEG'],
          topping_units: 1,
          unit_price_vnd: 1, // tampered client price must be ignored
        },
        {
          seat_id: 'T2-S4',
          item_id: 'QUAY',
          quantity: 3,
          topping_units: 0,
        },
      ],
    },
    catalog
  );

  assert.equal(validMultiTable.valid, true);
  // (45000 + 15000) + (5000 * 3) = 75000
  assert.equal(validMultiTable.normalized.total_vnd, 75000);
  assert.deepEqual(Array.from(validMultiTable.normalized.table_numbers), [1, 2]);
});

test('validateAndPriceOrderPayload allows TAKEAWAY without seat_id', () => {
  const ctx = loadValidationContext();
  const catalog = buildCatalog(ctx);

  const takeaway = ctx.validateAndPriceOrderPayload(
    {
      order_type: 'TAKEAWAY',
      items: [
        {
          item_id: 'BUN_THANG',
          quantity: 2,
          modifier_ids: ['LESS_NOODLES'],
          topping_units: 0,
          custom_note: 'Ít hành',
        },
      ],
    },
    catalog
  );

  assert.equal(takeaway.valid, true);
  assert.equal(takeaway.normalized.total_vnd, 80000);
  assert.equal(takeaway.normalized.items[0].seat_id, '');
});

test('generateOrderId and constantTimeEqual behave as expected', () => {
  const ctx = loadValidationContext();
  const id = ctx.generateOrderId(new Date('2026-11-13T10:00:00Z'), 'AB12');
  assert.match(id, /^ORD-\d{8}-\d{6}-AB12$/);

  assert.equal(ctx.constantTimeEqual('secret123', 'secret123'), true);
  assert.equal(ctx.constantTimeEqual('secret123', 'secret124'), false);
  assert.equal(ctx.constantTimeEqual('secret123', 'short'), false);
});
