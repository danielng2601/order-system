/**
 * ROMS V1.0 - Formatting & XSS Escaping Helpers
 * Usable in both browser (window.ROMS_FORMAT) and Node.js tests (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ROMS_FORMAT = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function formatVnd(amount) {
    const num = Math.round(Number(amount || 0));
    if (!Number.isFinite(num)) {
      return '0 VND';
    }
    return new Intl.NumberFormat('vi-VN').format(num) + ' VND';
  }

  function escapeHtml(value) {
    if (value === null || value === undefined) {
      return '';
    }
    return String(value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function generateUuid() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  return {
    formatVnd: formatVnd,
    escapeHtml: escapeHtml,
    generateUuid: generateUuid,
  };
});
