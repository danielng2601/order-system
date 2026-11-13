/**
 * ROMS V1.0 - Phase 1 POS Application Controller
 * Loads menu, modifiers, and seats dynamically from GAS backend.
 * Uses ROMS_FORMAT.escapeHtml() for all dynamic text rendered into HTML.
 */
(function (global, document) {
  'use strict';

  const fmt = global.ROMS_FORMAT;
  const api = global.ROMS_API;
  const cart = global.ROMS_CART.createCart();

  const state = {
    connected: false,
    menuItems: [],
    modifiers: [],
    tablesSeats: [],
    toppingUnitPriceVnd: 15000,
    activeCategory: 'ALL',
    searchQuery: '',
    activeTable: 1,
    activeSeat: 1,
    modalContext: null,
  };

  function el(id) {
    return document.getElementById(id);
  }

  function getActiveSeatId() {
    return 'T' + state.activeTable + '-S' + state.activeSeat;
  }

  function setConnectionBadge(text, level) {
    const badge = el('conn-badge');
    if (!badge) return;
    badge.textContent = text;
    badge.className = 'status-badge status-' + (level || 'neutral');
  }

  function initSeatSelectors() {
    const tableSel = el('active-table-select');
    const seatSel = el('active-seat-select');
    const modalSeatSel = el('modal-seat-select');

    if (tableSel) {
      tableSel.innerHTML = '';
      for (let t = 1; t <= 9; t += 1) {
        const opt = document.createElement('option');
        opt.value = String(t);
        opt.textContent = 'Bàn ' + t;
        tableSel.appendChild(opt);
      }
      tableSel.value = String(state.activeTable);
    }

    if (seatSel) {
      seatSel.innerHTML = '';
      for (let s = 1; s <= 4; s += 1) {
        const opt = document.createElement('option');
        opt.value = String(s);
        opt.textContent = 'Ghế ' + s;
        seatSel.appendChild(opt);
      }
      seatSel.value = String(state.activeSeat);
    }

    if (modalSeatSel) {
      modalSeatSel.innerHTML = '';
      for (let t = 1; t <= 9; t += 1) {
        for (let s = 1; s <= 4; s += 1) {
          const seatId = 'T' + t + '-S' + s;
          const opt = document.createElement('option');
          opt.value = seatId;
          opt.textContent = 'Bàn ' + t + ' - Ghế ' + s + ' (' + seatId + ')';
          modalSeatSel.appendChild(opt);
        }
      }
    }

    updateActiveSeatBadge();
  }

  function updateActiveSeatBadge() {
    const badge = el('active-seat-badge');
    if (badge) {
      badge.textContent = getActiveSeatId();
    }
  }

  function renderOrderTypeUI() {
    const isDineIn = cart.getState().orderType === 'DINE_IN';
    el('type-dinein-btn').classList.toggle('active', isDineIn);
    el('type-takeaway-btn').classList.toggle('active', !isDineIn);
    el('seat-picker-bar').hidden = !isDineIn;
    el('takeaway-hint').hidden = isDineIn;
    el('cart-type-label').textContent = isDineIn ? 'Tại bàn' : 'Mang về';
  }

  function renderCategoryTabs() {
    const container = el('category-tabs');
    if (!container) return;

    const categories = ['ALL'];
    state.menuItems.forEach(function (item) {
      if (item.category && categories.indexOf(item.category) === -1) {
        categories.push(item.category);
      }
    });

    container.innerHTML = categories
      .map(function (cat) {
        const label = cat === 'ALL' ? 'Tất cả' : cat;
        const activeClass = state.activeCategory === cat ? ' active' : '';
        return (
          '<button type="button" class="cat-tab' +
          activeClass +
          '" data-cat="' +
          fmt.escapeHtml(cat) +
          '">' +
          fmt.escapeHtml(label) +
          '</button>'
        );
      })
      .join('');
  }

  function renderMenuGrid() {
    const grid = el('menu-grid');
    const emptyState = el('menu-empty-state');
    if (!grid || !emptyState) return;

    if (!state.connected && state.menuItems.length === 0) {
      grid.hidden = true;
      emptyState.hidden = false;
      return;
    }

    const q = state.searchQuery.trim().toLowerCase();
    const filtered = state.menuItems.filter(function (item) {
      const catOk = state.activeCategory === 'ALL' || item.category === state.activeCategory;
      const searchOk =
        !q ||
        item.name.toLowerCase().indexOf(q) !== -1 ||
        item.category.toLowerCase().indexOf(q) !== -1;
      return catOk && searchOk;
    });

    if (filtered.length === 0) {
      grid.hidden = true;
      emptyState.hidden = false;
      emptyState.innerHTML = '<p>Không tìm thấy món phù hợp.</p>';
      return;
    }

    emptyState.hidden = true;
    grid.hidden = false;
    grid.innerHTML = filtered
      .map(function (item) {
        const soldOut = !item.is_active;
        const disabledAttr = soldOut ? ' disabled' : '';
        const soldOutBadge = soldOut ? ' <span class="status-badge status-error">Hết món</span>' : '';
        return (
          '<article class="menu-card' +
          (soldOut ? ' sold-out' : '') +
          '" data-item-id="' +
          fmt.escapeHtml(item.item_id) +
          '">' +
          '<div>' +
          '<div class="menu-card-cat">' +
          fmt.escapeHtml(item.category) +
          soldOutBadge +
          '</div>' +
          '<h3 class="menu-card-name">' +
          fmt.escapeHtml(item.name) +
          '</h3>' +
          '<div class="menu-card-price">' +
          fmt.escapeHtml(fmt.formatVnd(item.price_vnd)) +
          '</div>' +
          '</div>' +
          '<div class="menu-card-actions">' +
          '<button type="button" class="btn btn-primary" data-action="quick-add" data-item-id="' +
          fmt.escapeHtml(item.item_id) +
          '"' +
          disabledAttr +
          '>+ Thêm</button>' +
          '<button type="button" class="btn" data-action="customize" data-item-id="' +
          fmt.escapeHtml(item.item_id) +
          '"' +
          disabledAttr +
          '>Tùy chỉnh</button>' +
          '</div>' +
          '</article>'
        );
      })
      .join('');
  }

  function renderCart() {
    const cartState = cart.getState();
    const summary = cart.getSummary();
    const listEl = el('cart-items-list');
    const emptyEl = el('cart-empty');
    const isDineIn = cartState.orderType === 'DINE_IN';

    el('cart-count-badge').textContent = String(summary.totalUnits);
    el('subtotal-base-val').textContent = fmt.formatVnd(summary.baseSubtotalVnd);
    el('subtotal-topping-val').textContent = fmt.formatVnd(summary.toppingSubtotalVnd);
    el('grand-total-val').textContent = fmt.formatVnd(summary.totalVnd);

    el('clear-cart-btn').disabled = summary.lineCount === 0;
    el('review-order-btn').disabled = summary.lineCount === 0;

    const mobileBar = el('mobile-cart-bar');
    if (mobileBar) {
      mobileBar.hidden = summary.lineCount === 0;
      el('mobile-cart-count').textContent = summary.totalUnits + ' món';
      el('mobile-cart-total').textContent = fmt.formatVnd(summary.totalVnd);
    }

    if (summary.lineCount === 0) {
      emptyEl.hidden = false;
      listEl.innerHTML = '';
      return;
    }

    emptyEl.hidden = true;
    listEl.innerHTML = cartState.items
      .map(function (line) {
        const seatChip = isDineIn
          ? '<span class="chip">' + fmt.escapeHtml(line.seat_id) + '</span>'
          : '<span class="chip">Mang về</span>';
        const modChips = line.modifier_names
          .map(function (m) {
            return '<span class="chip">' + fmt.escapeHtml(m) + '</span>';
          })
          .join('');
        const toppingChip =
          line.topping_units > 0
            ? '<span class="chip chip-topping">+' +
              line.topping_units +
              ' topping (+' +
              fmt.escapeHtml(fmt.formatVnd(line.topping_subtotal_vnd)) +
              ')</span>'
            : '';
        const noteHtml = line.custom_note
          ? '<div class="cart-line-note">Ghi chú: ' + fmt.escapeHtml(line.custom_note) + '</div>'
          : '';

        return (
          '<div class="cart-line" data-line-id="' +
          fmt.escapeHtml(line.cart_line_id) +
          '">' +
          '<div class="cart-line-top">' +
          '<span class="cart-line-title">' +
          fmt.escapeHtml(line.item_name) +
          '</span>' +
          '<span class="cart-line-price">' +
          fmt.escapeHtml(fmt.formatVnd(line.line_total_vnd)) +
          '</span>' +
          '</div>' +
          '<div class="cart-line-meta">' +
          seatChip +
          modChips +
          toppingChip +
          '</div>' +
          noteHtml +
          '<div class="cart-line-controls">' +
          '<div class="mini-stepper">' +
          '<button type="button" class="mini-btn" data-cart-action="dec" data-line-id="' +
          fmt.escapeHtml(line.cart_line_id) +
          '" aria-label="Giảm">−</button>' +
          '<span>' +
          line.quantity +
          '</span>' +
          '<button type="button" class="mini-btn" data-cart-action="inc" data-line-id="' +
          fmt.escapeHtml(line.cart_line_id) +
          '" aria-label="Tăng">+</button>' +
          '</div>' +
          '<div class="cart-line-actions">' +
          '<button type="button" class="btn btn-sm" data-cart-action="edit" data-line-id="' +
          fmt.escapeHtml(line.cart_line_id) +
          '">Sửa</button>' +
          '<button type="button" class="btn btn-sm" data-cart-action="dup" data-line-id="' +
          fmt.escapeHtml(line.cart_line_id) +
          '">Nhân bản</button>' +
          '<button type="button" class="btn btn-sm btn-danger-ghost" data-cart-action="remove" data-line-id="' +
          fmt.escapeHtml(line.cart_line_id) +
          '">Xóa</button>' +
          '</div>' +
          '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function openItemModal(mode, menuItem, existingLine) {
    const isDineIn = cart.getState().orderType === 'DINE_IN';
    state.modalContext = {
      mode: mode,
      menuItem: menuItem,
      cartLineId: existingLine ? existingLine.cart_line_id : null,
      quantity: existingLine ? existingLine.quantity : 1,
      toppingUnits: existingLine ? existingLine.topping_units : 0,
      selectedModIds: existingLine ? existingLine.modifier_ids.slice() : [],
      seatId: existingLine && existingLine.seat_id ? existingLine.seat_id : getActiveSeatId(),
      customNote: existingLine ? existingLine.custom_note : '',
    };

    el('item-modal-title').textContent = menuItem.name;
    el('item-modal-price').textContent = fmt.formatVnd(menuItem.price_vnd) + ' / phần';
    el('modal-topping-label').textContent =
      'Thêm topping (' + fmt.formatVnd(state.toppingUnitPriceVnd) + ' / phần)';
    el('modal-seat-field').hidden = !isDineIn;
    el('modal-seat-select').value = state.modalContext.seatId;
    el('modal-note-input').value = state.modalContext.customNote;
    el('item-modal-save').textContent = mode === 'edit' ? 'Lưu thay đổi' : 'Thêm vào giỏ';

    const modList = el('modal-modifiers-list');
    modList.innerHTML = state.modifiers
      .map(function (mod) {
        const checked = state.modalContext.selectedModIds.indexOf(mod.modifier_id) !== -1;
        return (
          '<label class="mod-option">' +
          '<input type="checkbox" value="' +
          fmt.escapeHtml(mod.modifier_id) +
          '"' +
          (checked ? ' checked' : '') +
          ' />' +
          '<span>' +
          fmt.escapeHtml(mod.name) +
          '</span>' +
          '</label>'
        );
      })
      .join('');

    updateModalPreview();
    el('item-modal').hidden = false;
  }

  function updateModalPreview() {
    if (!state.modalContext) return;
    const mc = state.modalContext;
    el('modal-qty-val').textContent = String(mc.quantity);
    el('modal-top-val').textContent = String(mc.toppingUnits);
    const toppingPerItem = mc.toppingUnits * state.toppingUnitPriceVnd;
    el('modal-top-subtotal').textContent = '+' + fmt.formatVnd(toppingPerItem * mc.quantity);
    const lineTotal = (mc.menuItem.price_vnd + toppingPerItem) * mc.quantity;
    el('modal-line-total').textContent = fmt.formatVnd(lineTotal);
  }

  function closeItemModal() {
    state.modalContext = null;
    el('item-modal').hidden = true;
  }

  function saveItemModal() {
    if (!state.modalContext) return;
    const mc = state.modalContext;
    const checkedBoxes = el('modal-modifiers-list').querySelectorAll('input[type="checkbox"]:checked');
    const modIds = [];
    const modNames = [];
    let modDeltaSum = 0;

    checkedBoxes.forEach(function (box) {
      const mod = state.modifiers.find(function (m) {
        return m.modifier_id === box.value;
      });
      if (mod) {
        modIds.push(mod.modifier_id);
        modNames.push(mod.name);
        modDeltaSum += Number(mod.price_delta_vnd || 0);
      }
    });

    const isDineIn = cart.getState().orderType === 'DINE_IN';
    const seatId = isDineIn ? el('modal-seat-select').value : '';
    const customNote = el('modal-note-input').value;

    if (mc.mode === 'edit' && mc.cartLineId) {
      cart.updateItem(mc.cartLineId, {
        quantity: mc.quantity,
        topping_units: mc.toppingUnits,
        seat_id: seatId,
        modifier_ids: modIds,
        modifier_names: modNames,
        modifier_deltas_sum_vnd: modDeltaSum,
        custom_note: customNote,
      });
    } else {
      cart.addItem({
        item_id: mc.menuItem.item_id,
        item_name: mc.menuItem.name,
        unit_price_vnd: mc.menuItem.price_vnd,
        quantity: mc.quantity,
        seat_id: seatId,
        modifier_ids: modIds,
        modifier_names: modNames,
        modifier_deltas_sum_vnd: modDeltaSum,
        topping_units: mc.toppingUnits,
        custom_note: customNote,
      });
    }

    closeItemModal();
    renderCart();
  }

  function openCheckoutModal() {
    const cartState = cart.getState();
    const summary = cart.getSummary();
    const isDineIn = cartState.orderType === 'DINE_IN';

    el('checkout-error').hidden = true;
    el('checkout-error').textContent = '';
    el('checkout-review-view').hidden = false;
    el('checkout-review-footer').hidden = false;
    el('checkout-success-view').hidden = true;
    el('checkout-submit-btn').disabled = false;
    el('checkout-submit-btn').textContent = 'Xác nhận đặt món';

    const tablesText =
      isDineIn && summary.tableNumbers.length > 0
        ? 'Bàn: ' + summary.tableNumbers.join(', ')
        : 'Không chọn bàn';

    el('checkout-meta').innerHTML =
      '<div><strong>Loại đơn:</strong> ' +
      (isDineIn ? 'Tại bàn (DINE_IN)' : 'Mang về (TAKEAWAY)') +
      '</div>' +
      (isDineIn ? '<div><strong>' + fmt.escapeHtml(tablesText) + '</strong></div>' : '') +
      (cartState.orderNotes
        ? '<div><strong>Ghi chú đơn:</strong> ' + fmt.escapeHtml(cartState.orderNotes) + '</div>'
        : '');

    el('checkout-items-list').innerHTML = cartState.items
      .map(function (line) {
        const details = [];
        if (isDineIn) details.push(line.seat_id);
        if (line.modifier_names.length > 0) details.push(line.modifier_names.join(', '));
        if (line.topping_units > 0) details.push('+' + line.topping_units + ' topping');
        if (line.custom_note) details.push('Ghi chú: ' + line.custom_note);
        return (
          '<div class="checkout-item-row">' +
          '<div>' +
          '<div><strong>' +
          line.quantity +
          ' × ' +
          fmt.escapeHtml(line.item_name) +
          '</strong></div>' +
          (details.length > 0
            ? '<div class="muted-small">' + fmt.escapeHtml(details.join(' · ')) + '</div>'
            : '') +
          '</div>' +
          '<div><strong>' +
          fmt.escapeHtml(fmt.formatVnd(line.line_total_vnd)) +
          '</strong></div>' +
          '</div>'
        );
      })
      .join('');

    el('checkout-totals').innerHTML =
      '<div class="total-row"><span>Tạm tính món</span><span>' +
      fmt.escapeHtml(fmt.formatVnd(summary.baseSubtotalVnd)) +
      '</span></div>' +
      '<div class="total-row"><span>Topping thêm</span><span>' +
      fmt.escapeHtml(fmt.formatVnd(summary.toppingSubtotalVnd)) +
      '</span></div>' +
      '<div class="total-row grand"><span>Tổng thanh toán</span><span>' +
      fmt.escapeHtml(fmt.formatVnd(summary.totalVnd)) +
      '</span></div>';

    el('checkout-modal').hidden = false;
  }

  async function submitCheckout() {
    const btn = el('checkout-submit-btn');
    const errEl = el('checkout-error');
    btn.disabled = true;
    btn.textContent = 'Đang gửi đơn...';
    errEl.hidden = true;

    try {
      const res = await cart.submitOrder(api);
      const order = res.data.order;
      el('checkout-review-view').hidden = true;
      el('checkout-review-footer').hidden = true;
      el('checkout-success-view').hidden = false;
      el('confirmed-order-number').textContent = order.order_number || order.order_id;
      el('confirmed-order-id').textContent = 'Mã hệ thống: ' + order.order_id;
      el('confirmed-order-total').textContent = 'Tổng cộng: ' + fmt.formatVnd(order.total_vnd);
      el('order-notes-input').value = '';
      renderCart();
    } catch (err) {
      errEl.textContent = err.message || 'Gửi đơn thất bại. Giỏ hàng vẫn được giữ nguyên.';
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = 'Xác nhận đặt món';
    }
  }

  async function loadBootstrapFromBackend() {
    const errEl = el('settings-error');
    const connectBtn = el('connect-btn');
    errEl.hidden = true;
    connectBtn.disabled = true;
    connectBtn.textContent = 'Đang kết nối...';

    try {
      const res = await api.fetchBootstrap();
      if (!res || !res.ok) {
        throw new Error((res && res.error && res.error.message) || 'Không thể tải thực đơn.');
      }
      state.connected = true;
      state.menuItems = res.data.menuItems || [];
      state.modifiers = res.data.modifiers || [];
      state.tablesSeats = res.data.tablesSeats || [];
      state.toppingUnitPriceVnd = Number(res.data.toppingUnitPriceVnd || 15000);
      cart.setToppingUnitPriceVnd(state.toppingUnitPriceVnd);

      setConnectionBadge('Đã kết nối', 'ok');
      el('settings-panel').hidden = true;
      el('refresh-menu-btn').hidden = false;

      renderCategoryTabs();
      renderMenuGrid();
      renderCart();
    } catch (err) {
      setConnectionBadge('Lỗi kết nối', 'error');
      errEl.textContent = err.message || String(err);
      errEl.hidden = false;
    } finally {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Kết nối & Tải thực đơn';
    }
  }

  function bindEvents() {
    el('toggle-settings-btn').addEventListener('click', function () {
      el('settings-panel').hidden = !el('settings-panel').hidden;
    });

    el('connect-btn').addEventListener('click', function () {
      api.setApiUrl(el('gas-url-input').value);
      api.setPasscode(el('staff-passcode-input').value);
      loadBootstrapFromBackend();
    });

    el('refresh-menu-btn').addEventListener('click', loadBootstrapFromBackend);

    el('type-dinein-btn').addEventListener('click', function () {
      cart.setOrderType('DINE_IN');
      renderOrderTypeUI();
      renderCart();
    });

    el('type-takeaway-btn').addEventListener('click', function () {
      cart.setOrderType('TAKEAWAY');
      renderOrderTypeUI();
      renderCart();
    });

    el('active-table-select').addEventListener('change', function (e) {
      state.activeTable = Number(e.target.value);
      updateActiveSeatBadge();
    });

    el('active-seat-select').addEventListener('change', function (e) {
      state.activeSeat = Number(e.target.value);
      updateActiveSeatBadge();
    });

    el('menu-search-input').addEventListener('input', function (e) {
      state.searchQuery = e.target.value;
      renderMenuGrid();
    });

    el('category-tabs').addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-cat]');
      if (!btn) return;
      state.activeCategory = btn.getAttribute('data-cat');
      renderCategoryTabs();
      renderMenuGrid();
    });

    el('menu-grid').addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-action]');
      if (!btn || btn.disabled) return;
      const itemId = btn.getAttribute('data-item-id');
      const action = btn.getAttribute('data-action');
      const menuItem = state.menuItems.find(function (m) {
        return m.item_id === itemId;
      });
      if (!menuItem || !menuItem.is_active) return;

      if (action === 'quick-add') {
        const isDineIn = cart.getState().orderType === 'DINE_IN';
        cart.addItem({
          item_id: menuItem.item_id,
          item_name: menuItem.name,
          unit_price_vnd: menuItem.price_vnd,
          quantity: 1,
          seat_id: isDineIn ? getActiveSeatId() : '',
          modifier_ids: [],
          modifier_names: [],
          topping_units: 0,
          custom_note: '',
        });
        renderCart();
      } else if (action === 'customize') {
        openItemModal('add', menuItem, null);
      }
    });

    el('cart-items-list').addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-cart-action]');
      if (!btn) return;
      const action = btn.getAttribute('data-cart-action');
      const lineId = btn.getAttribute('data-line-id');
      const line = cart.getState().items.find(function (it) {
        return it.cart_line_id === lineId;
      });
      if (!line) return;

      if (action === 'inc') {
        cart.updateItem(lineId, { quantity: line.quantity + 1 });
        renderCart();
      } else if (action === 'dec') {
        if (line.quantity > 1) {
          cart.updateItem(lineId, { quantity: line.quantity - 1 });
        } else {
          cart.removeItem(lineId);
        }
        renderCart();
      } else if (action === 'dup') {
        cart.duplicateItem(lineId);
        renderCart();
      } else if (action === 'remove') {
        cart.removeItem(lineId);
        renderCart();
      } else if (action === 'edit') {
        const menuItem = state.menuItems.find(function (m) {
          return m.item_id === line.item_id;
        }) || {
          item_id: line.item_id,
          name: line.item_name,
          price_vnd: line.unit_price_vnd,
        };
        openItemModal('edit', menuItem, line);
      }
    });

    el('clear-cart-btn').addEventListener('click', function () {
      if (cart.getSummary().lineCount === 0) return;
      if (global.confirm('Bạn có chắc muốn xóa toàn bộ giỏ hàng không?')) {
        cart.clearCart();
        el('order-notes-input').value = '';
        renderCart();
      }
    });

    el('order-notes-input').addEventListener('input', function (e) {
      cart.setOrderNotes(e.target.value);
    });

    el('modal-qty-dec').addEventListener('click', function () {
      if (!state.modalContext) return;
      state.modalContext.quantity = Math.max(1, state.modalContext.quantity - 1);
      updateModalPreview();
    });

    el('modal-qty-inc').addEventListener('click', function () {
      if (!state.modalContext) return;
      state.modalContext.quantity = Math.min(100, state.modalContext.quantity + 1);
      updateModalPreview();
    });

    el('modal-top-dec').addEventListener('click', function () {
      if (!state.modalContext) return;
      state.modalContext.toppingUnits = Math.max(0, state.modalContext.toppingUnits - 1);
      updateModalPreview();
    });

    el('modal-top-inc').addEventListener('click', function () {
      if (!state.modalContext) return;
      state.modalContext.toppingUnits = Math.min(20, state.modalContext.toppingUnits + 1);
      updateModalPreview();
    });

    el('item-modal-close').addEventListener('click', closeItemModal);
    el('item-modal-save').addEventListener('click', saveItemModal);

    el('review-order-btn').addEventListener('click', openCheckoutModal);
    el('mobile-open-cart-btn').addEventListener('click', function () {
      el('cart-pane').scrollIntoView({ behavior: 'smooth' });
    });

    el('checkout-modal-close').addEventListener('click', function () {
      el('checkout-modal').hidden = true;
    });
    el('checkout-back-btn').addEventListener('click', function () {
      el('checkout-modal').hidden = true;
    });
    el('checkout-submit-btn').addEventListener('click', submitCheckout);
    el('start-new-order-btn').addEventListener('click', function () {
      el('checkout-modal').hidden = true;
    });

    global.addEventListener('beforeunload', function (e) {
      if (cart.getSummary().lineCount > 0) {
        e.preventDefault();
        e.returnValue = '';
      }
    });
  }

  function init() {
    el('gas-url-input').value = api.getApiUrl();
    el('staff-passcode-input').value = api.getPasscode();
    initSeatSelectors();
    renderOrderTypeUI();
    renderMenuGrid();
    renderCart();
    bindEvents();

    if (api.getPasscode() && api.getApiUrl().indexOf('REPLACE_WITH_DEPLOYMENT_ID') === -1) {
      loadBootstrapFromBackend();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})(window, document);
