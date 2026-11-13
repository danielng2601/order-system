/**
 * ROMS V1.0 - Order Cart State Manager (Phase 1)
 * Pure state container usable in both browser and Node.js unit tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./format.js'));
  } else {
    root.ROMS_CART = factory(root.ROMS_FORMAT);
  }
})(typeof window !== 'undefined' ? window : globalThis, function (format) {
  'use strict';

  function createCart(options) {
    const opts = options || {};
    let toppingUnitPriceVnd = Number(opts.toppingUnitPriceVnd || 15000);
    let orderType = opts.orderType === 'TAKEAWAY' ? 'TAKEAWAY' : 'DINE_IN';
    let orderNotes = '';
    let targetOrder = null; // { order_id, order_number, expected_version, order_type }
    let items = [];
    let nextLineSeq = 1;
    let isSubmitting = false;
    let pendingIdempotencyKey = null;

    function computeLineTotals(line) {
      const modDelta = (line.modifier_deltas_sum_vnd || 0);
      const baseUnit = line.unit_price_vnd + modDelta;
      const toppingUnit = line.topping_units * toppingUnitPriceVnd;
      const baseSubtotal = baseUnit * line.quantity;
      const toppingSubtotal = toppingUnit * line.quantity;
      return {
        base_subtotal_vnd: baseSubtotal,
        topping_subtotal_vnd: toppingSubtotal,
        line_total_vnd: baseSubtotal + toppingSubtotal,
      };
    }

    function setToppingUnitPriceVnd(price) {
      const p = Number(price);
      if (Number.isInteger(p) && p >= 0) {
        toppingUnitPriceVnd = p;
        items = items.map(function (line) {
          return Object.assign({}, line, computeLineTotals(line));
        });
      }
    }

    function setTargetOrder(orderInfo) {
      if (!orderInfo) {
        targetOrder = null;
      } else {
        targetOrder = {
          order_id: String(orderInfo.order_id),
          order_number: String(orderInfo.order_number || orderInfo.order_id),
          expected_version: Number(orderInfo.version || orderInfo.expected_version),
          order_type: orderInfo.order_type === 'TAKEAWAY' ? 'TAKEAWAY' : 'DINE_IN',
        };
        orderType = targetOrder.order_type;
      }
      pendingIdempotencyKey = null;
    }

    function setOrderType(type) {
      if (targetOrder) return; // locked to targetOrder's type while adding items
      if (type === 'DINE_IN' || type === 'TAKEAWAY') {
        orderType = type;
        pendingIdempotencyKey = null;
      }
    }

    function setOrderNotes(notes) {
      orderNotes = String(notes || '').slice(0, 500);
      pendingIdempotencyKey = null;
    }

    function addItem(input) {
      const qty = Math.max(1, Math.min(100, Math.floor(Number(input.quantity || 1))));
      const toppings = Math.max(0, Math.min(20, Math.floor(Number(input.topping_units || 0))));
      const line = {
        cart_line_id: 'LINE-' + nextLineSeq++,
        item_id: String(input.item_id),
        item_name: String(input.item_name || input.item_id),
        unit_price_vnd: Math.round(Number(input.unit_price_vnd || 0)),
        quantity: qty,
        seat_id: input.seat_id ? String(input.seat_id).trim() : '',
        modifier_ids: Array.isArray(input.modifier_ids) ? input.modifier_ids.slice() : [],
        modifier_names: Array.isArray(input.modifier_names) ? input.modifier_names.slice() : [],
        modifier_deltas_sum_vnd: Math.round(Number(input.modifier_deltas_sum_vnd || 0)),
        topping_units: toppings,
        custom_note: String(input.custom_note || '').trim().slice(0, 200),
      };
      const totals = computeLineTotals(line);
      items.push(Object.assign(line, totals));
      pendingIdempotencyKey = null;
      return items[items.length - 1];
    }

    function updateItem(cartLineId, updates) {
      const idx = items.findIndex(function (it) {
        return it.cart_line_id === cartLineId;
      });
      if (idx === -1) return null;

      const current = items[idx];
      const next = Object.assign({}, current);

      if (updates.quantity !== undefined) {
        next.quantity = Math.max(1, Math.min(100, Math.floor(Number(updates.quantity))));
      }
      if (updates.topping_units !== undefined) {
        next.topping_units = Math.max(0, Math.min(20, Math.floor(Number(updates.topping_units))));
      }
      if (updates.seat_id !== undefined) {
        next.seat_id = String(updates.seat_id || '').trim();
      }
      if (updates.modifier_ids !== undefined) {
        next.modifier_ids = Array.isArray(updates.modifier_ids) ? updates.modifier_ids.slice() : [];
      }
      if (updates.modifier_names !== undefined) {
        next.modifier_names = Array.isArray(updates.modifier_names) ? updates.modifier_names.slice() : [];
      }
      if (updates.modifier_deltas_sum_vnd !== undefined) {
        next.modifier_deltas_sum_vnd = Math.round(Number(updates.modifier_deltas_sum_vnd || 0));
      }
      if (updates.custom_note !== undefined) {
        next.custom_note = String(updates.custom_note || '').trim().slice(0, 200);
      }

      const totals = computeLineTotals(next);
      items[idx] = Object.assign(next, totals);
      pendingIdempotencyKey = null;
      return items[idx];
    }

    function duplicateItem(cartLineId) {
      const source = items.find(function (it) {
        return it.cart_line_id === cartLineId;
      });
      if (!source) return null;
      return addItem(source);
    }

    function removeItem(cartLineId) {
      const before = items.length;
      items = items.filter(function (it) {
        return it.cart_line_id !== cartLineId;
      });
      if (items.length !== before) {
        pendingIdempotencyKey = null;
      }
      return items.length !== before;
    }

    function clearCart() {
      items = [];
      orderNotes = '';
      targetOrder = null;
      pendingIdempotencyKey = null;
    }

    function getState() {
      return {
        orderType: orderType,
        orderNotes: orderNotes,
        targetOrder: targetOrder ? Object.assign({}, targetOrder) : null,
        toppingUnitPriceVnd: toppingUnitPriceVnd,
        items: items.map(function (it) {
          return Object.assign({}, it);
        }),
        isSubmitting: isSubmitting,
      };
    }

    function getSummary() {
      let totalUnits = 0;
      let baseSubtotalVnd = 0;
      let toppingSubtotalVnd = 0;
      let totalVnd = 0;
      const tableSet = {};

      items.forEach(function (it) {
        totalUnits += it.quantity;
        baseSubtotalVnd += it.base_subtotal_vnd;
        toppingSubtotalVnd += it.topping_subtotal_vnd;
        totalVnd += it.line_total_vnd;
        if (orderType === 'DINE_IN' && it.seat_id) {
          const match = /^T([1-9])-S([1-4])$/.exec(it.seat_id);
          if (match) {
            tableSet[Number(match[1])] = true;
          }
        }
      });

      return {
        lineCount: items.length,
        totalUnits: totalUnits,
        baseSubtotalVnd: baseSubtotalVnd,
        toppingSubtotalVnd: toppingSubtotalVnd,
        totalVnd: totalVnd,
        tableNumbers: Object.keys(tableSet).map(Number).sort(function (a, b) {
          return a - b;
        }),
      };
    }

    function buildOrderPayload() {
      if (!pendingIdempotencyKey) {
        pendingIdempotencyKey = format.generateUuid();
      }
      const mappedItems = items.map(function (it) {
        return {
          item_id: it.item_id,
          quantity: it.quantity,
          seat_id: orderType === 'DINE_IN' ? it.seat_id : '',
          modifier_ids: it.modifier_ids.slice(),
          topping_units: it.topping_units,
          custom_note: it.custom_note,
        };
      });
      if (targetOrder) {
        return {
          idempotency_key: pendingIdempotencyKey,
          order_id: targetOrder.order_id,
          expected_version: targetOrder.expected_version,
          items: mappedItems,
        };
      }
      return {
        idempotency_key: pendingIdempotencyKey,
        order_type: orderType,
        notes: orderNotes,
        items: mappedItems,
      };
    }

    async function submitOrder(apiClient) {
      if (isSubmitting) {
        throw new Error('Đơn hàng đang được gửi, vui lòng đợi.');
      }
      if (items.length === 0) {
        throw new Error('Giỏ hàng đang trống.');
      }
      if (orderType === 'DINE_IN') {
        const missingSeat = items.find(function (it) {
          return !/^T([1-9])-S([1-4])$/.test(it.seat_id || '');
        });
        if (missingSeat) {
          throw new Error('Vui lòng chọn ghế hợp lệ cho tất cả món ăn tại bàn.');
        }
      }

      isSubmitting = true;
      try {
        const payload = buildOrderPayload();
        const res = targetOrder
          ? await apiClient.addItemsToOrder(payload)
          : await apiClient.createOrder(payload);
        if (res && res.ok) {
          clearCart();
          return res;
        }
        const msg = (res && res.error && res.error.message) || 'Không thể tạo đơn hàng.';
        const err = new Error(msg);
        err.code = res && res.error && res.error.code;
        err.latestOrder = res && res.error && res.error.latestOrder;
        throw err;
      } finally {
        isSubmitting = false;
      }
    }

    return {
      setToppingUnitPriceVnd: setToppingUnitPriceVnd,
      setTargetOrder: setTargetOrder,
      setOrderType: setOrderType,
      setOrderNotes: setOrderNotes,
      addItem: addItem,
      updateItem: updateItem,
      duplicateItem: duplicateItem,
      removeItem: removeItem,
      clearCart: clearCart,
      getState: getState,
      getSummary: getSummary,
      buildOrderPayload: buildOrderPayload,
      submitOrder: submitOrder,
    };
  }

  return { createCart: createCart };
});
