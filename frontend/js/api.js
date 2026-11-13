/**
 * ROMS V1.0 - Cross-Domain GAS API Client
 *
 * Uses Content-Type: text/plain;charset=utf-8 on POST requests so the browser
 * sends a CORS simple request without triggering an OPTIONS preflight
 * (which Google Apps Script Web Apps do not handle).
 */
(function (global) {
  'use strict';

  const STORAGE_KEYS = {
    PASSCODE: 'roms_staff_passcode',
    API_URL: 'roms_gas_url',
  };

  function getApiUrl() {
    const stored = global.sessionStorage ? global.sessionStorage.getItem(STORAGE_KEYS.API_URL) : '';
    if (stored) return stored;
    return (global.ROMS_CONFIG && global.ROMS_CONFIG.GAS_WEB_APP_URL) || '';
  }

  function setApiUrl(url) {
    if (global.sessionStorage) {
      global.sessionStorage.setItem(STORAGE_KEYS.API_URL, String(url || '').trim());
    }
  }

  function getPasscode() {
    return global.sessionStorage ? global.sessionStorage.getItem(STORAGE_KEYS.PASSCODE) || '' : '';
  }

  function setPasscode(passcode) {
    if (global.sessionStorage) {
      global.sessionStorage.setItem(STORAGE_KEYS.PASSCODE, String(passcode || ''));
    }
  }

  function clearPasscode() {
    if (global.sessionStorage) {
      global.sessionStorage.removeItem(STORAGE_KEYS.PASSCODE);
    }
  }

  function assertConfiguredUrl() {
    const baseUrl = getApiUrl();
    if (!baseUrl || baseUrl.indexOf('REPLACE_WITH_DEPLOYMENT_ID') !== -1) {
      throw new Error('Chưa cấu hình URL của Google Apps Script Web App.');
    }
    return baseUrl;
  }

  async function requestGet(action, extraParams) {
    const baseUrl = assertConfiguredUrl();
    const url = new URL(baseUrl);
    url.searchParams.set('action', action);
    if (extraParams) {
      Object.keys(extraParams).forEach(function (key) {
        if (extraParams[key] !== undefined && extraParams[key] !== null) {
          url.searchParams.set(key, String(extraParams[key]));
        }
      });
    }

    const controller = new AbortController();
    const timeoutMs = (global.ROMS_CONFIG && global.ROMS_CONFIG.REQUEST_TIMEOUT_MS) || 15000;
    const timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  async function requestPost(action, payload) {
    const baseUrl = assertConfiguredUrl();
    const body = Object.assign({}, payload || {}, {
      action: action,
      passcode: getPasscode(),
    });

    const controller = new AbortController();
    const timeoutMs = (global.ROMS_CONFIG && global.ROMS_CONFIG.REQUEST_TIMEOUT_MS) || 15000;
    const timer = setTimeout(function () {
      controller.abort();
    }, timeoutMs);

    try {
      const response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8',
        },
        body: JSON.stringify(body),
        redirect: 'follow',
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error('HTTP ' + response.status);
      }
      return await response.json();
    } finally {
      clearTimeout(timer);
    }
  }

  global.ROMS_API = {
    getApiUrl: getApiUrl,
    setApiUrl: setApiUrl,
    getPasscode: getPasscode,
    setPasscode: setPasscode,
    clearPasscode: clearPasscode,
    checkHealth: function () {
      return requestGet('health');
    },
    fetchBootstrap: function () {
      return requestGet('bootstrap', { passcode: getPasscode() });
    },
    getMenu: function () {
      return requestGet('menu', { passcode: getPasscode() });
    },
    getModifiers: function () {
      return requestGet('modifiers', { passcode: getPasscode() });
    },
    ping: function () {
      return requestPost('ping', {});
    },
    createOrder: function (orderPayload) {
      return requestPost('createOrder', orderPayload);
    },
  };
})(window);
