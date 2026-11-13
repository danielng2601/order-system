/**
 * ROMS V1.0 - Phase 2 POS Application Controller
 * Includes Đặt món (Phase 1), Sơ đồ bàn (3x3), Đơn đang mở, Add Items, Move Item,
 * Merge Orders, Split Order, and Multi-Device Sync Polling.
 */
(function (global, document) {
  'use strict';

  const fmt = global.ROMS_FORMAT;
  const api = global.ROMS_API;
  const cart = global.ROMS_CART.createCart();

  const state = {
    connected: false,
    activeTab: 'order',
    menuItems: [],
    modifiers: [],
    tablesSeats: [],
    toppingUnitPriceVnd: 15000,
    activeCategory: 'ALL',
    searchQuery: '',
    activeTable: 1,
    activeSeat: 1,
    modalContext: null,
    floorData: null,
    activeOrders: [],
    selectedMergeIds: [],
    currentDetail: null,
    splitOrderData: null,
    orderFilters: { order_type: '', table_number: '', seat_id: '', order_number: '' },
  };

  let syncManager = null;

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

  function updateSyncStatusUI(syncState) {
    const label = el('sync-status-label');
    if (!label || !state.connected) return;
    label.hidden = false;
    if (!syncState.isOnline) {
      label.textContent = 'Ngoại tuyến';
      return;
    }
    const timeStr = syncState.lastSyncAt
      ? new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(
          syncState.lastSyncAt
        )
      : '--:--';
    label.textContent = 'Đồng bộ: ' + timeStr + ' · Rev #' + syncState.currentRevision;
  }

  function switchTab(tabName) {
    state.activeTab = tabName;
    document.querySelectorAll('.nav-tab').forEach(function (btn) {
      btn.classList.toggle('active', btn.getAttribute('data-tab') === tabName);
    });
    ['order', 'floor', 'orders', 'history'].forEach(function (t) {
      const view = el('tab-' + t);
      if (view) view.hidden = t !== tabName;
    });
    if (state.connected && tabName === 'floor') {
      loadFloorState();
    } else if (state.connected && tabName === 'orders') {
      loadActiveOrders();
    }
  }

  function initSeatSelectors() {
    const tableSel = el('active-table-select');
    const seatSel = el('active-seat-select');
    const modalSeatSel = el('modal-seat-select');
    const filterTableSel = el('filter-table-num');
    const filterSeatSel = el('filter-seat-id');

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

    if (filterTableSel) {
      filterTableSel.innerHTML = '<option value="">Tất cả bàn</option>';
      for (let t = 1; t <= 9; t += 1) {
        const opt = document.createElement('option');
        opt.value = String(t);
        opt.textContent = 'Bàn ' + t;
        filterTableSel.appendChild(opt);
      }
    }

    if (filterSeatSel) {
      filterSeatSel.innerHTML = '<option value="">Tất cả ghế</option>';
    }

    if (modalSeatSel) {
      modalSeatSel.innerHTML = '';
    }

    const inactiveMap = {};
    if (Array.isArray(state.tablesSeats)) {
      state.tablesSeats.forEach(function (s) {
        if (!s.is_active) inactiveMap[s.seat_id] = true;
      });
    }

    for (let t = 1; t <= 9; t += 1) {
      for (let s = 1; s <= 4; s += 1) {
        const seatId = 'T' + t + '-S' + s;
        const isInactive = Boolean(inactiveMap[seatId]);
        if (modalSeatSel) {
          const opt = document.createElement('option');
          opt.value = seatId;
          opt.textContent = 'Bàn ' + t + ' - Ghế ' + s + ' (' + seatId + ')' + (isInactive ? ' [Tạm khóa]' : '');
          opt.disabled = isInactive;
          modalSeatSel.appendChild(opt);
        }
        if (filterSeatSel) {
          const opt2 = document.createElement('option');
          opt2.value = seatId;
          opt2.textContent = seatId;
          filterSeatSel.appendChild(opt2);
        }
      }
    }

    updateActiveSeatBadge();
  }

  function updateActiveSeatBadge() {
    const badge = el('active-seat-badge');
    if (badge) badge.textContent = getActiveSeatId();
  }

  function renderOrderTypeUI() {
    const cartState = cart.getState();
    const isDineIn = cartState.orderType === 'DINE_IN';
    const inAddMode = Boolean(cartState.targetOrder);

    el('type-dinein-btn').classList.toggle('active', isDineIn);
    el('type-takeaway-btn').classList.toggle('active', !isDineIn);
    el('type-dinein-btn').disabled = inAddMode;
    el('type-takeaway-btn').disabled = inAddMode;

    el('seat-picker-bar').hidden = !isDineIn;
    el('takeaway-hint').hidden = isDineIn;
    el('cart-type-label').textContent = isDineIn ? 'Tại bàn' : 'Mang về';

    const banner = el('add-mode-banner');
    if (banner) {
      banner.hidden = !inAddMode;
      if (inAddMode) {
        el('add-mode-order-label').textContent =
          cartState.targetOrder.order_number + ' (v' + cartState.targetOrder.expected_version + ')';
      }
    }
    el('order-notes-field').hidden = inAddMode;
    el('review-order-btn').textContent = inAddMode ? 'Xem lại & Thêm vào đơn' : 'Xem lại & Đặt món';
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

  /* ================= PHASE 2: FLOOR PLAN ================= */
  async function loadFloorState() {
    if (!state.connected) return;
    try {
      const res = await api.getFloorState();
      if (!res || !res.ok) return;
      state.floorData = res.data;
      if (syncManager && res.data.syncRevision) {
        syncManager.setRevision(res.data.syncRevision);
      }
      renderFloorPlan();
    } catch (err) {
      // Handled gracefully
    }
  }

  function renderFloorPlan() {
    const grid = el('floor-grid');
    if (!grid) return;
    if (!state.floorData || !state.floorData.tables) {
      grid.innerHTML = '<div class="empty-state">Đang tải sơ đồ bàn...</div>';
      return;
    }

    grid.innerHTML = state.floorData.tables
      .map(function (tbl) {
        const hasOcc = tbl.occupied_seats > 0;
        const ordersText =
          tbl.active_order_numbers.length > 0
            ? 'Đơn: ' + tbl.active_order_numbers.join(', ')
            : 'Bàn trống';

        const seatsHtml = tbl.seats
          .map(function (s) {
            const sub =
              s.status === 'occupied'
                ? fmt.formatVnd(s.subtotal_vnd)
                : s.status === 'unavailable'
                  ? 'Tạm khóa'
                  : 'Trống';
            return (
              '<button type="button" class="seat-btn seat-' +
              fmt.escapeHtml(s.status) +
              '" data-seat-id="' +
              fmt.escapeHtml(s.seat_id) +
              '" data-seat-status="' +
              fmt.escapeHtml(s.status) +
              '" data-order-id="' +
              fmt.escapeHtml((s.order_ids && s.order_ids[0]) || '') +
              '"' +
              (s.status === 'unavailable' ? ' disabled' : '') +
              '>' +
              '<span class="seat-btn-id">' +
              fmt.escapeHtml(s.seat_id) +
              '</span>' +
              '<span class="seat-btn-sub">' +
              fmt.escapeHtml(sub) +
              '</span>' +
              '</button>'
            );
          })
          .join('');

        return (
          '<article class="table-card' +
          (hasOcc ? ' has-occupied' : '') +
          '">' +
          '<div class="table-card-head">' +
          '<div><h3>' +
          fmt.escapeHtml(tbl.label) +
          '</h3><span class="muted-small">' +
          tbl.occupied_seats +
          '/4 ghế có khách · ' +
          fmt.escapeHtml(ordersText) +
          '</span></div>' +
          '<span class="table-total">' +
          fmt.escapeHtml(fmt.formatVnd(tbl.active_total_vnd)) +
          '</span>' +
          '</div>' +
          '<div class="seats-grid-2x2">' +
          seatsHtml +
          '</div>' +
          '</article>'
        );
      })
      .join('');
  }

  /* ================= PHASE 2: ACTIVE ORDERS ================= */
  async function loadActiveOrders() {
    if (!state.connected) return;
    try {
      const res = await api.listActiveOrders(state.orderFilters);
      if (!res || !res.ok) return;
      state.activeOrders = res.data.orders || [];
      if (syncManager && res.data.syncRevision) {
        syncManager.setRevision(res.data.syncRevision);
      }
      renderActiveOrders();
    } catch (err) {
      // Ignore transient
    }
  }

  function renderActiveOrders() {
    const listEl = el('active-orders-list');
    const mergeBtn = el('open-merge-btn');
    if (!listEl) return;

    if (mergeBtn) {
      mergeBtn.textContent = 'Gộp đơn đã chọn (' + state.selectedMergeIds.length + ')';
      mergeBtn.disabled = state.selectedMergeIds.length < 2;
    }

    if (state.activeOrders.length === 0) {
      listEl.innerHTML = '<div class="empty-state">Không có đơn hàng đang mở phù hợp.</div>';
      return;
    }

    listEl.innerHTML = state.activeOrders
      .map(function (o) {
        const checked = state.selectedMergeIds.indexOf(o.order_id) !== -1;
        const tablesStr =
          o.order_type === 'DINE_IN'
            ? 'Bàn: ' + (o.table_numbers.length ? o.table_numbers.join(', ') : '-')
            : 'Mang về';
        return (
          '<article class="order-card">' +
          '<div class="order-card-left">' +
          '<input type="checkbox" class="order-check" data-merge-id="' +
          fmt.escapeHtml(o.order_id) +
          '"' +
          (checked ? ' checked' : '') +
          ' aria-label="Chọn gộp đơn" />' +
          '<div>' +
          '<div><strong>' +
          fmt.escapeHtml(o.order_number || o.order_id) +
          '</strong> · <span class="chip">' +
          fmt.escapeHtml(o.status) +
          '</span> <span class="chip">' +
          fmt.escapeHtml(tablesStr) +
          '</span></div>' +
          '<div class="muted-small">' +
          o.item_count +
          ' dòng món · v' +
          o.version +
          ' · Cập nhật: ' +
          fmt.escapeHtml(o.updated_at.slice(11, 19)) +
          '</div>' +
          '</div>' +
          '</div>' +
          '<div class="header-actions">' +
          '<strong>' +
          fmt.escapeHtml(fmt.formatVnd(o.total_vnd)) +
          '</strong>' +
          '<button type="button" class="btn btn-sm btn-primary" data-open-order="' +
          fmt.escapeHtml(o.order_id) +
          '">Chi tiết</button>' +
          '</div>' +
          '</article>'
        );
      })
      .join('');
  }

  /* ================= PHASE 2: ORDER DETAIL + MOVE ITEM ================= */
  async function openOrderDetail(orderId) {
    try {
      const res = await api.getOrderDetail(orderId);
      if (!res || !res.ok) {
        global.alert((res && res.error && res.error.message) || 'Không tải được chi tiết đơn.');
        return;
      }
      state.currentDetail = res.data;
      if (syncManager && res.data.syncRevision) {
        syncManager.setRevision(res.data.syncRevision);
      }
      renderOrderDetailModal();
      el('order-detail-modal').hidden = false;
    } catch (err) {
      global.alert(err.message || 'Lỗi tải chi tiết đơn.');
    }
  }

  function renderOrderDetailModal() {
    const d = state.currentDetail;
    if (!d) return;
    const o = d.order;
    const isDineIn = o.order_type === 'DINE_IN';

    el('detail-order-title').textContent = (o.order_number || o.order_id) + ' — ' + fmt.formatVnd(o.total_vnd);
    el('detail-order-sub').textContent =
      (isDineIn ? 'Tại bàn' : 'Mang về') + ' · Trạng thái: ' + o.status + ' · v' + o.version;

    el('detail-split-btn').disabled = d.items.length < 2;

    const seatOptionsHtml = (function () {
      let opts = '';
      for (let t = 1; t <= 9; t += 1) {
        for (let s = 1; s <= 4; s += 1) {
          const sid = 'T' + t + '-S' + s;
          opts += '<option value="' + sid + '">' + sid + '</option>';
        }
      }
      return opts;
    })();

    // Group items by table & seat
    const groups = {};
    d.items.forEach(function (it) {
      const key = isDineIn ? 'Bàn ' + it.table_number + ' · ' + it.seat_id : 'Mang về';
      if (!groups[key]) groups[key] = { items: [], subtotal: 0 };
      groups[key].items.push(it);
      groups[key].subtotal += Number(it.line_total_vnd || 0);
    });

    const groupsHtml = Object.keys(groups)
      .map(function (gKey) {
        const g = groups[gKey];
        const rowsHtml = g.items
          .map(function (it) {
            const modText = (it.modifiers || [])
              .map(function (m) {
                return typeof m === 'string' ? m : m.name;
              })
              .join(', ');
            const extraParts = [];
            if (modText) extraParts.push(modText);
            if (it.topping_units > 0) extraParts.push('+' + it.topping_units + ' topping');
            if (it.custom_note) extraParts.push('Ghi chú: ' + it.custom_note);

            const moveControl = isDineIn
              ? '<select class="select-touch move-seat-sel" data-move-item-id="' +
                fmt.escapeHtml(it.order_item_id) +
                '" aria-label="Chuyển ghế">' +
                seatOptionsHtml +
                '</select>'
              : '';

            return (
              '<div class="detail-item-row">' +
              '<div>' +
              '<div><strong>' +
              it.quantity +
              ' × ' +
              fmt.escapeHtml(it.item_name_snapshot) +
              '</strong> (' +
              fmt.escapeHtml(fmt.formatVnd(it.line_total_vnd)) +
              ')</div>' +
              (extraParts.length > 0
                ? '<div class="muted-small">' + fmt.escapeHtml(extraParts.join(' · ')) + '</div>'
                : '') +
              '</div>' +
              moveControl +
              '</div>'
            );
          })
          .join('');

        return (
          '<div class="group-box">' +
          '<div class="group-box-head"><span>' +
          fmt.escapeHtml(gKey) +
          '</span><span>' +
          fmt.escapeHtml(fmt.formatVnd(g.subtotal)) +
          '</span></div>' +
          rowsHtml +
          '</div>'
        );
      })
      .join('');

    const lineageHtml =
      o.parent_order_ids && o.parent_order_ids.length
        ? '<p class="muted-small">Nguồn gốc: ' + fmt.escapeHtml(o.parent_order_ids.join(', ')) + '</p>'
        : '';

    el('detail-modal-body').innerHTML = lineageHtml + groupsHtml;

    // Set current seat value on each move-seat dropdown
    el('detail-modal-body')
      .querySelectorAll('.move-seat-sel')
      .forEach(function (sel) {
        const itemId = sel.getAttribute('data-move-item-id');
        const found = d.items.find(function (it) {
          return it.order_item_id === itemId;
        });
        if (found) sel.value = found.seat_id;
      });
  }

  /* ================= PHASE 2: MERGE & SPLIT MODALS ================= */
  function openMergeModal() {
    const selectedOrders = state.activeOrders.filter(function (o) {
      return state.selectedMergeIds.indexOf(o.order_id) !== -1;
    });
    if (selectedOrders.length < 2) return;

    const totalVnd = selectedOrders.reduce(function (s, o) {
      return s + Number(o.total_vnd || 0);
    }, 0);

    el('merge-modal-body').innerHTML =
      '<p>Bạn sắp gộp <strong>' +
      selectedOrders.length +
      '</strong> đơn hàng thành một đơn mới. Các đơn nguồn sẽ chuyển sang trạng thái <strong>Merged</strong>.</p>' +
      selectedOrders
        .map(function (o) {
          return (
            '<div class="group-box"><strong>' +
            fmt.escapeHtml(o.order_number || o.order_id) +
            '</strong> · Bàn: ' +
            fmt.escapeHtml(o.table_numbers.join(', ') || 'Mang về') +
            ' · ' +
            fmt.escapeHtml(fmt.formatVnd(o.total_vnd)) +
            '</div>'
          );
        })
        .join('') +
      '<div class="totals-box"><div class="total-row grand"><span>Tổng sau khi gộp</span><span>' +
      fmt.escapeHtml(fmt.formatVnd(totalVnd)) +
      '</span></div></div>' +
      '<p id="merge-error" class="inline-error" hidden></p>';

    el('merge-confirm-btn').disabled = false;
    el('merge-modal').hidden = false;
  }

  function openSplitModal() {
    const d = state.currentDetail;
    if (!d || d.items.length < 2) return;
    state.splitOrderData = d;

    const itemsHtml = d.items
      .map(function (it) {
        return (
          '<label class="mod-option">' +
          '<input type="checkbox" class="split-item-chk" value="' +
          fmt.escapeHtml(it.order_item_id) +
          '" />' +
          '<span>' +
          fmt.escapeHtml(it.seat_id || 'Mang về') +
          ' · ' +
          it.quantity +
          '× ' +
          fmt.escapeHtml(it.item_name_snapshot) +
          ' (' +
          fmt.escapeHtml(fmt.formatVnd(it.line_total_vnd)) +
          ')</span>' +
          '</label>'
        );
      })
      .join('');

    el('split-modal-body').innerHTML =
      '<p>Chọn các món muốn tách sang <strong>đơn mới</strong> (phải giữ lại ít nhất 1 món ở đơn gốc <strong>' +
      fmt.escapeHtml(d.order.order_number || d.order.order_id) +
      '</strong>):</p>' +
      '<div class="orders-list">' +
      itemsHtml +
      '</div>' +
      '<p id="split-preview-text" class="muted-small">Đã chọn: 0 món (0 VND)</p>' +
      '<p id="split-error" class="inline-error" hidden></p>';

    el('split-confirm-btn').disabled = false;
    el('split-modal').hidden = false;
  }

  /* ================= ITEM & CHECKOUT MODALS (PHASE 1 + ADD MODE) ================= */
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
    const inAddMode = Boolean(cartState.targetOrder);

    el('checkout-error').hidden = true;
    el('checkout-error').textContent = '';
    el('checkout-review-view').hidden = false;
    el('checkout-review-footer').hidden = false;
    el('checkout-success-view').hidden = true;
    el('checkout-submit-btn').disabled = false;
    el('checkout-submit-btn').textContent = inAddMode ? 'Xác nhận thêm món' : 'Xác nhận đặt món';

    const tablesText =
      isDineIn && summary.tableNumbers.length > 0
        ? 'Bàn: ' + summary.tableNumbers.join(', ')
        : 'Không chọn bàn';

    el('checkout-meta').innerHTML =
      (inAddMode
        ? '<div><strong>Thêm vào đơn:</strong> ' + fmt.escapeHtml(cartState.targetOrder.order_number) + '</div>'
        : '') +
      '<div><strong>Loại đơn:</strong> ' +
      (isDineIn ? 'Tại bàn (DINE_IN)' : 'Mang về (TAKEAWAY)') +
      '</div>' +
      (isDineIn ? '<div><strong>' + fmt.escapeHtml(tablesText) + '</strong></div>' : '') +
      (!inAddMode && cartState.orderNotes
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
          '<div><div><strong>' +
          line.quantity +
          ' × ' +
          fmt.escapeHtml(line.item_name) +
          '</strong></div>' +
          (details.length > 0
            ? '<div class="muted-small">' + fmt.escapeHtml(details.join(' · ')) + '</div>'
            : '') +
          '</div><div><strong>' +
          fmt.escapeHtml(fmt.formatVnd(line.line_total_vnd)) +
          '</strong></div></div>'
        );
      })
      .join('');

    let seatTableBreakdownHtml = '';
    if (isDineIn) {
      const seatSubs = {};
      const tableSubs = {};
      cartState.items.forEach(function (line) {
        if (!line.seat_id) return;
        seatSubs[line.seat_id] = (seatSubs[line.seat_id] || 0) + line.line_total_vnd;
        const m = /^T([1-9])-S([1-4])$/.exec(line.seat_id);
        if (m) {
          const tKey = 'Bàn ' + m[1];
          tableSubs[tKey] = (tableSubs[tKey] || 0) + line.line_total_vnd;
        }
      });
      const seatKeys = Object.keys(seatSubs).sort();
      const tableKeys = Object.keys(tableSubs).sort();
      if (seatKeys.length > 0) {
        seatTableBreakdownHtml +=
          '<div class="total-row muted-small"><span>Theo ghế: ' +
          seatKeys.map(function (k) { return fmt.escapeHtml(k + ': ' + fmt.formatVnd(seatSubs[k])); }).join(' · ') +
          '</span></div>';
      }
      if (tableKeys.length > 1) {
        seatTableBreakdownHtml +=
          '<div class="total-row muted-small"><span>Theo bàn: ' +
          tableKeys.map(function (k) { return fmt.escapeHtml(k + ': ' + fmt.formatVnd(tableSubs[k])); }).join(' · ') +
          '</span></div>';
      }
    }

    el('checkout-totals').innerHTML =
      seatTableBreakdownHtml +
      '<div class="total-row"><span>Tạm tính món</span><span>' +
      fmt.escapeHtml(fmt.formatVnd(summary.baseSubtotalVnd)) +
      '</span></div>' +
      '<div class="total-row"><span>Topping thêm</span><span>' +
      fmt.escapeHtml(fmt.formatVnd(summary.toppingSubtotalVnd)) +
      '</span></div>' +
      '<div class="total-row grand"><span>' +
      (inAddMode ? 'Tổng cộng thêm' : 'Tổng thanh toán') +
      '</span><span>' +
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
      if (syncManager && res.data.syncRevision) {
        syncManager.setRevision(res.data.syncRevision);
      }
      el('checkout-review-view').hidden = true;
      el('checkout-review-footer').hidden = true;
      el('checkout-success-view').hidden = false;
      el('confirmed-order-number').textContent = order.order_number || order.order_id;
      el('confirmed-order-id').textContent = 'Mã hệ thống: ' + order.order_id + ' (v' + order.version + ')';
      el('confirmed-order-total').textContent = 'Tổng đơn: ' + fmt.formatVnd(order.total_vnd);
      el('order-notes-input').value = '';
      renderOrderTypeUI();
      renderCart();
    } catch (err) {
      if (err && (err.code === 'SESSION_EXPIRED' || err.code === 'UNAUTHORIZED')) {
        setConnectionBadge('Hết phiên', 'error');
        el('settings-panel').hidden = false;
      }
      errEl.textContent = err.message || 'Gửi đơn thất bại. Giỏ hàng vẫn được giữ nguyên.';
      errEl.hidden = false;
      btn.disabled = false;
      btn.textContent = cart.getState().targetOrder ? 'Xác nhận thêm món' : 'Xác nhận đặt món';
    }
  }

  async function loadBootstrapFromBackend(passcodeForLogin) {
    const errEl = el('settings-error');
    const connectBtn = el('connect-btn');
    errEl.hidden = true;
    connectBtn.disabled = true;
    connectBtn.textContent = 'Đang kết nối...';

    try {
      if (passcodeForLogin !== undefined && passcodeForLogin !== '') {
        const loginRes = await api.login(passcodeForLogin);
        if (!loginRes || !loginRes.ok) {
          throw new Error(
            (loginRes && loginRes.error && loginRes.error.message) || 'Đăng nhập thất bại.'
          );
        }
        el('staff-passcode-input').value = '';
      }

      const res = await api.fetchBootstrap();
      if (!res || !res.ok) {
        const err = new Error((res && res.error && res.error.message) || 'Không thể tải thực đơn.');
        err.code = res && res.error && res.error.code;
        throw err;
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
      el('sync-now-btn').hidden = false;

      if (syncManager) {
        syncManager.setRevision(res.data.syncRevision || 1);
        syncManager.start();
      }

      initSeatSelectors();
      renderCategoryTabs();
      renderMenuGrid();
      renderCart();
    } catch (err) {
      setConnectionBadge(err.code === 'SESSION_EXPIRED' ? 'Hết phiên' : 'Lỗi kết nối', 'error');
      errEl.textContent = err.message || String(err);
      errEl.hidden = false;
      el('settings-panel').hidden = false;
    } finally {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Kết nối & Tải thực đơn';
    }
  }

  function bindEvents() {
    document.querySelectorAll('.nav-tab').forEach(function (btn) {
      btn.addEventListener('click', function () {
        switchTab(btn.getAttribute('data-tab'));
      });
    });

    el('toggle-settings-btn').addEventListener('click', function () {
      el('settings-panel').hidden = !el('settings-panel').hidden;
    });

    el('connect-btn').addEventListener('click', function () {
      api.setApiUrl(el('gas-url-input').value);
      const passcode = el('staff-passcode-input').value;
      if (!passcode && !api.getSessionToken()) {
        el('settings-error').textContent = 'Vui lòng nhập mã nhân viên.';
        el('settings-error').hidden = false;
        return;
      }
      loadBootstrapFromBackend(passcode);
    });

    el('refresh-menu-btn').addEventListener('click', function () {
      loadBootstrapFromBackend();
    });

    el('sync-now-btn').addEventListener('click', function () {
      if (syncManager) syncManager.pollOnce();
      if (state.activeTab === 'floor') loadFloorState();
      if (state.activeTab === 'orders') loadActiveOrders();
    });

    el('floor-refresh-btn').addEventListener('click', loadFloorState);
    el('orders-refresh-btn').addEventListener('click', loadActiveOrders);

    el('cancel-add-mode-btn').addEventListener('click', function () {
      cart.setTargetOrder(null);
      renderOrderTypeUI();
      renderCart();
    });

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
        if (line.quantity > 1) cart.updateItem(lineId, { quantity: line.quantity - 1 });
        else cart.removeItem(lineId);
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
        }) || { item_id: line.item_id, name: line.item_name, price_vnd: line.unit_price_vnd };
        openItemModal('edit', menuItem, line);
      }
    });

    el('clear-cart-btn').addEventListener('click', function () {
      if (cart.getSummary().lineCount === 0) return;
      if (global.confirm('Bạn có chắc muốn xóa toàn bộ giỏ hàng không?')) {
        cart.clearCart();
        el('order-notes-input').value = '';
        renderOrderTypeUI();
        renderCart();
      }
    });

    el('order-notes-input').addEventListener('input', function (e) {
      cart.setOrderNotes(e.target.value);
    });

    /* Floor plan seat clicks */
    el('floor-grid').addEventListener('click', function (e) {
      const seatBtn = e.target.closest('button[data-seat-id]');
      if (!seatBtn || seatBtn.disabled) return;
      const seatId = seatBtn.getAttribute('data-seat-id');
      const status = seatBtn.getAttribute('data-seat-status');
      const orderId = seatBtn.getAttribute('data-order-id');

      if (status === 'occupied' && orderId) {
        openOrderDetail(orderId);
      } else {
        const match = /^T([1-9])-S([1-4])$/.exec(seatId);
        if (match) {
          state.activeTable = Number(match[1]);
          state.activeSeat = Number(match[2]);
          el('active-table-select').value = String(state.activeTable);
          el('active-seat-select').value = String(state.activeSeat);
          updateActiveSeatBadge();
          cart.setTargetOrder(null);
          cart.setOrderType('DINE_IN');
          renderOrderTypeUI();
          switchTab('order');
        }
      }
    });

    /* Active orders filters & actions */
    ['filter-order-type', 'filter-table-num', 'filter-seat-id'].forEach(function (id) {
      el(id).addEventListener('change', function () {
        state.orderFilters.order_type = el('filter-order-type').value;
        state.orderFilters.table_number = el('filter-table-num').value;
        state.orderFilters.seat_id = el('filter-seat-id').value;
        loadActiveOrders();
      });
    });

    el('filter-order-search').addEventListener('input', function (e) {
      state.orderFilters.order_number = e.target.value;
      loadActiveOrders();
    });

    el('active-orders-list').addEventListener('click', function (e) {
      const openBtn = e.target.closest('button[data-open-order]');
      if (openBtn) {
        openOrderDetail(openBtn.getAttribute('data-open-order'));
        return;
      }
      const chk = e.target.closest('input[data-merge-id]');
      if (chk) {
        const oid = chk.getAttribute('data-merge-id');
        if (chk.checked) {
          if (state.selectedMergeIds.indexOf(oid) === -1) state.selectedMergeIds.push(oid);
        } else {
          state.selectedMergeIds = state.selectedMergeIds.filter(function (x) {
            return x !== oid;
          });
        }
        renderActiveOrders();
      }
    });

    /* Order Detail Modal actions */
    el('detail-modal-close').addEventListener('click', function () {
      el('order-detail-modal').hidden = true;
    });

    el('detail-add-items-btn').addEventListener('click', function () {
      if (!state.currentDetail) return;
      const o = state.currentDetail.order;
      cart.clearCart();
      cart.setTargetOrder(o);
      if (o.order_type === 'DINE_IN' && state.currentDetail.items.length > 0) {
        const firstSeat = state.currentDetail.items[0].seat_id;
        const m = /^T([1-9])-S([1-4])$/.exec(firstSeat || '');
        if (m) {
          state.activeTable = Number(m[1]);
          state.activeSeat = Number(m[2]);
          el('active-table-select').value = String(state.activeTable);
          el('active-seat-select').value = String(state.activeSeat);
          updateActiveSeatBadge();
        }
      }
      el('order-detail-modal').hidden = true;
      renderOrderTypeUI();
      renderCart();
      switchTab('order');
    });

    el('detail-modal-body').addEventListener('change', async function (e) {
      const sel = e.target.closest('.move-seat-sel');
      if (!sel || !state.currentDetail) return;
      const itemId = sel.getAttribute('data-move-item-id');
      const targetSeat = sel.value;
      const order = state.currentDetail.order;
      try {
        const res = await api.moveOrderItem({
          idempotency_key: fmt.generateUuid(),
          order_id: order.order_id,
          order_item_id: itemId,
          target_seat_id: targetSeat,
          expected_version: order.version,
        });
        if (!res || !res.ok) {
          global.alert((res && res.error && res.error.message) || 'Không thể chuyển ghế.');
        } else if (syncManager && res.data && res.data.syncRevision) {
          syncManager.setRevision(res.data.syncRevision);
        }
        await openOrderDetail(order.order_id);
        if (state.activeTab === 'floor') loadFloorState();
        if (state.activeTab === 'orders') loadActiveOrders();
      } catch (err) {
        global.alert(err.message || 'Lỗi chuyển ghế.');
      }
    });

    el('detail-split-btn').addEventListener('click', openSplitModal);

    /* Merge Modal */
    el('open-merge-btn').addEventListener('click', openMergeModal);
    el('merge-modal-close').addEventListener('click', function () { el('merge-modal').hidden = true; });
    el('merge-cancel-btn').addEventListener('click', function () { el('merge-modal').hidden = true; });
    el('merge-confirm-btn').addEventListener('click', async function () {
      const btn = el('merge-confirm-btn');
      const errEl = el('merge-error');
      btn.disabled = true;
      errEl.hidden = true;
      const selectedOrders = state.activeOrders.filter(function (o) {
        return state.selectedMergeIds.indexOf(o.order_id) !== -1;
      });
      try {
        const res = await api.mergeOrders({
          idempotency_key: fmt.generateUuid(),
          source_orders: selectedOrders.map(function (o) {
            return { order_id: o.order_id, expected_version: o.version };
          }),
        });
        if (!res || !res.ok) {
          throw new Error((res && res.error && res.error.message) || 'Gộp đơn thất bại.');
        }
        state.selectedMergeIds = [];
        el('merge-modal').hidden = true;
        await loadActiveOrders();
        if (syncManager && res.data.syncRevision) syncManager.setRevision(res.data.syncRevision);
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        btn.disabled = false;
      }
    });

    /* Split Modal */
    el('split-modal-close').addEventListener('click', function () { el('split-modal').hidden = true; });
    el('split-cancel-btn').addEventListener('click', function () { el('split-modal').hidden = true; });
    el('split-modal-body').addEventListener('change', function () {
      if (!state.splitOrderData) return;
      const checked = el('split-modal-body').querySelectorAll('.split-item-chk:checked');
      let sum = 0;
      checked.forEach(function (c) {
        const it = state.splitOrderData.items.find(function (x) { return x.order_item_id === c.value; });
        if (it) sum += Number(it.line_total_vnd || 0);
      });
      el('split-preview-text').textContent = 'Đã chọn: ' + checked.length + ' món (' + fmt.formatVnd(sum) + ')';
    });

    el('split-confirm-btn').addEventListener('click', async function () {
      if (!state.splitOrderData) return;
      const btn = el('split-confirm-btn');
      const errEl = el('split-error');
      const checked = Array.from(el('split-modal-body').querySelectorAll('.split-item-chk:checked')).map(function (c) {
        return c.value;
      });
      if (checked.length === 0) {
        errEl.textContent = 'Vui lòng chọn ít nhất 1 món để tách.';
        errEl.hidden = false;
        return;
      }
      btn.disabled = true;
      errEl.hidden = true;
      try {
        const res = await api.splitOrder({
          idempotency_key: fmt.generateUuid(),
          source_order_id: state.splitOrderData.order.order_id,
          expected_version: state.splitOrderData.order.version,
          split_item_ids: checked,
        });
        if (!res || !res.ok) {
          throw new Error((res && res.error && res.error.message) || 'Tách đơn thất bại.');
        }
        el('split-modal').hidden = true;
        el('order-detail-modal').hidden = true;
        if (syncManager && res.data.syncRevision) syncManager.setRevision(res.data.syncRevision);
        if (state.activeTab === 'orders') loadActiveOrders();
        if (state.activeTab === 'floor') loadFloorState();
      } catch (err) {
        errEl.textContent = err.message;
        errEl.hidden = false;
        btn.disabled = false;
      }
    });

    /* Item & Checkout Modal controls */
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
    el('checkout-modal-close').addEventListener('click', function () { el('checkout-modal').hidden = true; });
    el('checkout-back-btn').addEventListener('click', function () { el('checkout-modal').hidden = true; });
    el('checkout-submit-btn').addEventListener('click', submitCheckout);
    el('start-new-order-btn').addEventListener('click', function () { el('checkout-modal').hidden = true; });

    document.addEventListener('visibilitychange', function () {
      if (syncManager) syncManager.setPaused(document.hidden);
    });
    global.addEventListener('online', function () {
      if (syncManager) syncManager.setOnline(true);
    });
    global.addEventListener('offline', function () {
      if (syncManager) syncManager.setOnline(false);
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
    syncManager = global.ROMS_SYNC.createSyncManager({
      apiClient: api,
      pollIntervalMs: 15000,
      onStatusChange: updateSyncStatusUI,
      onRemoteChange: function () {
        if (state.activeTab === 'floor') loadFloorState();
        if (state.activeTab === 'orders') loadActiveOrders();
        if (state.currentDetail && !el('order-detail-modal').hidden) {
          openOrderDetail(state.currentDetail.order.order_id);
        }
      },
    });
    initSeatSelectors();
    renderOrderTypeUI();
    renderMenuGrid();
    renderCart();
    bindEvents();

    if (api.getSessionToken() && api.getApiUrl().indexOf('REPLACE_WITH_DEPLOYMENT_ID') === -1) {
      loadBootstrapFromBackend();
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})(window, document);
