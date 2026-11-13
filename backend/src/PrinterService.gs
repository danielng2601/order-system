/**
 * ROMS V1.0 - Future Printer Integration Module
 * PrinterEnabled is false by default. Printing must never block ordering.
 */

const PrinterService = {
  /**
   * Checks whether printing is enabled via Settings or config.
   * @param {Object=} settingsMap Optional key-value settings map.
   * @return {boolean}
   */
  isEnabled: function (settingsMap) {
    if (settingsMap && Object.prototype.hasOwnProperty.call(settingsMap, 'PrinterEnabled')) {
      return String(settingsMap.PrinterEnabled).toLowerCase() === 'true';
    }
    return Boolean(ROMS_CONFIG.PRINTER_ENABLED);
  },

  /**
   * Builds a kitchen/receipt print payload without performing I/O.
   * Future hardware/network printer adapters will consume this payload.
   * @param {Object} order
   * @param {Array<Object>} items
   * @return {Object}
   */
  buildPrintPayload: function (order, items) {
    return {
      order_id: order.order_id,
      order_type: order.order_type,
      status: order.status,
      payment_status: order.payment_status,
      total_vnd: order.total_vnd,
      created_at: order.created_at,
      items: (items || []).map(function (item) {
        return {
          seat_id: item.seat_id || 'TAKEAWAY',
          name: item.item_name_snapshot,
          quantity: item.quantity,
          modifiers: item.modifiers || [],
          topping_units: item.topping_units || 0,
          custom_note: item.custom_note || '',
          line_total_vnd: item.line_total_vnd,
        };
      }),
    };
  },

  /**
   * Queues a print job if PrinterEnabled is true; otherwise no-ops safely.
   * @param {Object} order
   * @param {Array<Object>} items
   * @param {Object=} settingsMap
   * @return {{ printed: boolean, skipped: boolean, reason: string }}
   */
  printOrderIfEnabled: function (order, items, settingsMap) {
    if (!this.isEnabled(settingsMap)) {
      return {
        printed: false,
        skipped: true,
        reason: 'PrinterEnabled is false',
      };
    }

    // Future integration point (e.g., thermal printer webhook / ESC-POS bridge).
    this.buildPrintPayload(order, items);
    return {
      printed: false,
      skipped: true,
      reason: 'Printer adapter not configured in Phase 0',
    };
  },
};
