const test = require('node:test');
const assert = require('node:assert/strict');
const format = require('../frontend/js/format.js');
const { createCart } = require('../frontend/js/cart.js');

test('formatVnd formats integer VND and escapeHtml prevents XSS', () => {
  assert.equal(format.formatVnd(45000), '45.000 VND');
  assert.equal(format.formatVnd(0), '0 VND');
  assert.equal(
    format.escapeHtml('<script>alert("xss")</script>'),
    '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
  );
});

test('Cart supports add, edit, duplicate, toppings, and immediate total recalculation', () => {
  const cart = createCart({ toppingUnitPriceVnd: 15000 });
  const line1 = cart.addItem({
    item_id: 'MY_VAN_THAN',
    item_name: 'Mỳ Vằn Thắn',
    unit_price_vnd: 45000,
    quantity: 1,
    seat_id: 'T1-S1',
    modifier_ids: ['NO_VEG'],
    modifier_names: ['Không rau'],
    topping_units: 1,
    custom_note: 'Ít hành',
  });

  // 45,000 + 15,000 = 60,000
  assert.equal(cart.getSummary().totalVnd, 60000);

  // Duplicate preserves exact configuration as separate line
  const line2 = cart.duplicateItem(line1.cart_line_id);
  assert.notEqual(line2.cart_line_id, line1.cart_line_id);
  assert.equal(cart.getSummary().lineCount, 2);
  assert.equal(cart.getSummary().totalVnd, 120000);

  // Edit line 2 quantity & toppings
  cart.updateItem(line2.cart_line_id, { quantity: 2, topping_units: 0 });
  // Line 1: 60,000; Line 2: 2 * 45,000 = 90,000 => 150,000
  assert.equal(cart.getSummary().totalVnd, 150000);
});

test('Cart preserves items on failed submission and clears items only after successful submission', async () => {
  const cart = createCart({ toppingUnitPriceVnd: 15000 });
  cart.setOrderType('TAKEAWAY');
  cart.addItem({
    item_id: 'SUI_CAO',
    item_name: 'Sủi Cảo',
    unit_price_vnd: 50000,
    quantity: 2,
    topping_units: 1,
  });

  // Failing API preserves cart & keeps same idempotency_key on retry
  const firstKey = cart.buildOrderPayload().idempotency_key;
  await assert.rejects(
    () =>
      cart.submitOrder({
        createOrder: async () => ({
          ok: false,
          error: { code: 'INTERNAL_ERROR', message: 'Network error' },
        }),
      }),
    /Network error/
  );
  assert.equal(cart.getSummary().lineCount, 1);
  assert.equal(cart.buildOrderPayload().idempotency_key, firstKey);

  // Successful API clears cart
  const okRes = await cart.submitOrder({
    createOrder: async () => ({
      ok: true,
      data: { order: { order_id: 'ORD-1', order_number: '#261113-001', total_vnd: 130000 } },
    }),
  });
  assert.equal(okRes.ok, true);
  assert.equal(cart.getSummary().lineCount, 0);
});
