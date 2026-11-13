/**
 * ROMS V1.0 - Hardened Cross-Domain GAS API Client (Phase 1.5)
 *
 * - Never sends passcodes or session tokens in URL query strings.
 * - Exchanges STAFF_PASSCODE for a short-lived session_token via POST login.
 * - Never stores raw passcode in sessionStorage or localStorage.
 * - Uses Content-Type: text/plain;charset=utf-8 on POST to avoid CORS OPTIONS preflight.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ROMS_API = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const STORAGE_KEYS = {
    SESSION_TOKEN: 'roms_session_token',
    EXPIRES_AT_MS: 'roms_session_expires_ms',
    API_URL: 'roms_gas_url',
  };

  function getGlobal() {
    return typeof window !== 'undefined' ? window : globalThis;
  }

  function getStorage() {
    const g = getGlobal();
    return g.sessionStorage || null;
  }

  function getApiUrl() {
    const storage = getStorage();
    const stored = storage ? storage.getItem(STORAGE_KEYS.API_URL) : '';
    if (stored) return stored;
    const g = getGlobal();
    return (g.ROMS_CONFIG && g.ROMS_CONFIG.GAS_WEB_APP_URL) || '';
  }

  function setApiUrl(url) {
    const storage = getStorage();
    if (storage) {
      storage.setItem(STORAGE_KEYS.API_URL, String(url || '').trim());
    }
  }

  function getSessionToken() {
    const storage = getStorage();
    if (!storage) return '';
    const token = storage.getItem(STORAGE_KEYS.SESSION_TOKEN) || '';
    const expiresAtMs = Number(storage.getItem(STORAGE_KEYS.EXPIRES_AT_MS) || 0);
    if (!token) return '';
    if (expiresAtMs && Date.now() > expiresAtMs) {
      clearSession();
      return '';
    }
    return token;
  }

  function setSession(token, expiresAtMs) {
    const storage = getStorage();
    if (storage) {
      storage.setItem(STORAGE_KEYS.SESSION_TOKEN, String(token || ''));
      storage.setItem(STORAGE_KEYS.EXPIRES_AT_MS, String(expiresAtMs || 0));
    }
  }

  function clearSession() {
    const storage = getStorage();
    if (storage) {
      storage.removeItem(STORAGE_KEYS.SESSION_TOKEN);
      storage.removeItem(STORAGE_KEYS.EXPIRES_AT_MS);
    }
  }

  function makeApiError(message, code) {
    const err = new Error(message);
    err.code = code || 'API_ERROR';
    return err;
  }

  function assertConfiguredUrl() {
    const baseUrl = getApiUrl();
    if (!baseUrl || baseUrl.indexOf('REPLACE_WITH_DEPLOYMENT_ID') !== -1) {
      throw makeApiError('Chưa cấu hình URL của Google Apps Script Web App.', 'UNCONFIGURED');
    }
    return baseUrl;
  }

  async function parseSafeJson(response) {
    const text = await response.text();
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      throw makeApiError('Máy chủ trả về dữ liệu không hợp lệ (không phải JSON).', 'INVALID_RESPONSE');
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.ok !== 'boolean') {
      throw makeApiError('Phản hồi từ máy chủ không đúng định dạng chuẩn.', 'INVALID_RESPONSE');
    }
    return parsed;
  }

  async function executeFetch(url, fetchOptions) {
    const g = getGlobal();
    if (g.navigator && g.navigator.onLine === false) {
      throw makeApiError('Thiết bị đang ngoại tuyến. Vui lòng kiểm tra kết nối mạng.', 'OFFLINE');
    }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timeoutMs = (g.ROMS_CONFIG && g.ROMS_CONFIG.REQUEST_TIMEOUT_MS) || 15000;
    const timer = controller
      ? setTimeout(function () {
          controller.abort();
        }, timeoutMs)
      : null;

    try {
      const opts = Object.assign({}, fetchOptions, {
        redirect: 'follow',
      });
      if (controller) {
        opts.signal = controller.signal;
      }
      const response = await g.fetch(url, opts);
      if (!response.ok) {
        throw makeApiError('Lỗi kết nối máy chủ (HTTP ' + response.status + ').', 'HTTP_ERROR');
      }
      return await parseSafeJson(response);
    } catch (err) {
      if (err && err.name === 'AbortError') {
        throw makeApiError('Kết nối quá thời gian chờ. Vui lòng thử lại.', 'TIMEOUT');
      }
      if (err && err.code) {
        throw err;
      }
      throw makeApiError('Không thể kết nối đến máy chủ. Vui lòng kiểm tra mạng.', 'NETWORK_ERROR');
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function requestHealth() {
    const baseUrl = assertConfiguredUrl();
    const url = new URL(baseUrl);
    url.searchParams.set('action', 'health');
    return executeFetch(url.toString(), { method: 'GET' });
  }

  async function requestPost(action, payload, includeSession) {
    const baseUrl = assertConfiguredUrl();
    const body = Object.assign({}, payload || {}, { action: action });
    if (includeSession !== false) {
      const token = getSessionToken();
      if (!token) {
        throw makeApiError('Phiên làm việc đã hết hạn hoặc chưa đăng nhập.', 'SESSION_EXPIRED');
      }
      body.session_token = token;
    }
    const res = await executeFetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok && res.error && (res.error.code === 'SESSION_EXPIRED' || res.error.code === 'UNAUTHORIZED')) {
      clearSession();
    }
    return res;
  }

  return {
    getApiUrl: getApiUrl,
    setApiUrl: setApiUrl,
    getSessionToken: getSessionToken,
    setSession: setSession,
    clearSession: clearSession,
    checkHealth: requestHealth,
    login: async function (passcode) {
      const res = await requestPost('login', { passcode: String(passcode || '') }, false);
      if (res.ok && res.data && res.data.session_token) {
        setSession(res.data.session_token, res.data.expires_at_ms);
      }
      return res;
    },
    fetchBootstrap: function () {
      return requestPost('bootstrap', {});
    },
    getMenu: function () {
      return requestPost('menu', {});
    },
    getModifiers: function () {
      return requestPost('modifiers', {});
    },
    ping: function () {
      return requestPost('ping', {});
    },
    createOrder: function (orderPayload) {
      return requestPost('createOrder', orderPayload);
    },
  };
});
