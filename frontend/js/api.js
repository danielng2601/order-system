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
    VERIFIED_ENV_URL: 'roms_verified_env_url',
    VERIFIED_ENV_NAME: 'roms_verified_env_name',
  };

  function getGlobal() {
    return typeof window !== 'undefined' ? window : globalThis;
  }

  function getStorage() {
    const g = getGlobal();
    return g.sessionStorage || null;
  }

  function resolveEnvState() {
    const g = getGlobal();
    if (g.ROMS_ENV && typeof g.ROMS_ENV.resolveConfig === 'function') {
      return g.ROMS_ENV.resolveConfig(g);
    }
    return null;
  }

  function getStorageKey(baseKey) {
    const envState = resolveEnvState();
    if (envState && envState.storagePrefix) {
      return envState.storagePrefix + baseKey.replace(/^roms_/, '');
    }
    return baseKey;
  }

  function getApiUrl() {
    const envState = resolveEnvState();
    if (envState && !envState.valid) {
      return '';
    }
    const storage = getStorage();
    const stored = storage ? storage.getItem(getStorageKey(STORAGE_KEYS.API_URL)) : '';
    if (stored) return stored;
    if (envState) {
      return envState.gasWebAppUrl || '';
    }
    const g = getGlobal();
    return (g.ROMS_CONFIG && g.ROMS_CONFIG.GAS_WEB_APP_URL) || '';
  }

  function isManualOverride() {
    const envState = resolveEnvState();
    const storage = getStorage();
    const stored = storage ? storage.getItem(getStorageKey(STORAGE_KEYS.API_URL)) : '';
    if (!stored) return false;
    if (!envState || !envState.gasWebAppUrl) return true;
    return stored !== envState.gasWebAppUrl;
  }

  function clearApiUrlOverride() {
    const storage = getStorage();
    if (storage) {
      storage.removeItem(getStorageKey(STORAGE_KEYS.API_URL));
    }
    clearSession();
  }

  function setApiUrl(url) {
    const g = getGlobal();
    const envState = resolveEnvState();
    if (envState && !envState.valid) {
      throw makeApiError(envState.errorMessage, envState.errorCode || 'INVALID_ENV');
    }
    const trimmed = String(url || '').trim();
    const prevUrl = getApiUrl();

    if (!trimmed) {
      clearApiUrlOverride();
      return;
    }

    if (envState && g.ROMS_ENV && typeof g.ROMS_ENV.detectCrossEnvironmentUrl === 'function') {
      const conflictEnv = g.ROMS_ENV.detectCrossEnvironmentUrl(trimmed, envState.env, g);
      if (conflictEnv) {
        throw makeApiError(
          'Không thể dùng URL của môi trường ' + conflictEnv + ' trong môi trường ' + envState.env + '.',
          'CROSS_ENV_OVERRIDE'
        );
      }
    }

    if (envState && g.ROMS_ENV && typeof g.ROMS_ENV.isValidUrlForEnv === 'function') {
      if (!g.ROMS_ENV.isValidUrlForEnv(trimmed, envState.env)) {
        throw makeApiError(
          'URL của Google Apps Script Web App không hợp lệ cho môi trường ' + envState.env + '.',
          'UNCONFIGURED'
        );
      }
    }

    const storage = getStorage();
    if (storage) {
      storage.setItem(getStorageKey(STORAGE_KEYS.API_URL), trimmed);
    }
    clearVerifiedHandshake();
    if (prevUrl && prevUrl !== trimmed) {
      clearSession();
    }
  }

  function getSessionToken() {
    const storage = getStorage();
    if (!storage) return '';
    const token = storage.getItem(getStorageKey(STORAGE_KEYS.SESSION_TOKEN)) || '';
    const expiresAtMs = Number(storage.getItem(getStorageKey(STORAGE_KEYS.EXPIRES_AT_MS)) || 0);
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
      storage.setItem(getStorageKey(STORAGE_KEYS.SESSION_TOKEN), String(token || ''));
      storage.setItem(getStorageKey(STORAGE_KEYS.EXPIRES_AT_MS), String(expiresAtMs || 0));
    }
  }

  function clearVerifiedHandshake() {
    const storage = getStorage();
    if (storage) {
      storage.removeItem(getStorageKey(STORAGE_KEYS.VERIFIED_ENV_URL));
      storage.removeItem(getStorageKey(STORAGE_KEYS.VERIFIED_ENV_NAME));
    }
  }

  function clearSession() {
    const storage = getStorage();
    if (storage) {
      storage.removeItem(getStorageKey(STORAGE_KEYS.SESSION_TOKEN));
      storage.removeItem(getStorageKey(STORAGE_KEYS.EXPIRES_AT_MS));
    }
    clearVerifiedHandshake();
  }

  function makeApiError(message, code) {
    const err = new Error(message);
    err.code = code || 'API_ERROR';
    return err;
  }

  function assertConfiguredUrl() {
    const g = getGlobal();
    const envState = resolveEnvState();
    if (envState && !envState.valid) {
      throw makeApiError(envState.errorMessage, envState.errorCode || 'INVALID_ENV');
    }
    const baseUrl = getApiUrl();
    const isPlaceholder =
      g.ROMS_ENV && typeof g.ROMS_ENV.isPlaceholderUrl === 'function'
        ? g.ROMS_ENV.isPlaceholderUrl(baseUrl)
        : !baseUrl || baseUrl.indexOf('REPLACE_WITH_') !== -1 || baseUrl.indexOf('YOUR_') !== -1;
    if (isPlaceholder) {
      const envLabel = envState ? ' (' + envState.env + ')' : '';
      throw makeApiError('Chưa cấu hình URL của Google Apps Script Web App' + envLabel + '.', 'UNCONFIGURED');
    }
    if (envState && g.ROMS_ENV && typeof g.ROMS_ENV.detectCrossEnvironmentUrl === 'function') {
      const conflictEnv = g.ROMS_ENV.detectCrossEnvironmentUrl(baseUrl, envState.env, g);
      if (conflictEnv) {
        throw makeApiError(
          'URL đang trỏ tới môi trường ' + conflictEnv + ' trong khi ứng dụng đang chạy ở ' + envState.env + '.',
          'CROSS_ENV_OVERRIDE'
        );
      }
    }
    if (envState && g.ROMS_ENV && typeof g.ROMS_ENV.isValidUrlForEnv === 'function') {
      if (!g.ROMS_ENV.isValidUrlForEnv(baseUrl, envState.env)) {
        throw makeApiError('URL của Google Apps Script Web App không hợp lệ cho môi trường ' + envState.env + '.', 'UNCONFIGURED');
      }
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

  function isHandshakeVerifiedForCurrentConfig() {
    const envState = resolveEnvState();
    if (!envState || !envState.valid) return false;
    const storage = getStorage();
    if (!storage) return false;
    const verifiedUrl = storage.getItem(getStorageKey(STORAGE_KEYS.VERIFIED_ENV_URL)) || '';
    const verifiedEnv = storage.getItem(getStorageKey(STORAGE_KEYS.VERIFIED_ENV_NAME)) || '';
    return verifiedUrl === getApiUrl() && verifiedEnv === envState.env;
  }

  async function verifyEnvironmentHandshake() {
    const g = getGlobal();
    const envState = resolveEnvState();
    if (!envState || !envState.valid) {
      clearSession();
      throw makeApiError(
        (envState && envState.errorMessage) || 'Cấu hình môi trường không hợp lệ.',
        (envState && envState.errorCode) || 'INVALID_ENV'
      );
    }

    const baseUrl = assertConfiguredUrl();
    let healthRes;
    try {
      healthRes = await requestHealth();
    } catch (err) {
      clearVerifiedHandshake();
      if (err && err.code) {
        throw err;
      }
      throw makeApiError('Không thể xác minh môi trường backend.', 'ENV_HANDSHAKE_FAILED');
    }

    if (!healthRes || !healthRes.ok || !healthRes.data || typeof healthRes.data !== 'object') {
      clearSession();
      throw makeApiError('Phản hồi health check từ backend không hợp lệ.', 'ENV_HANDSHAKE_FAILED');
    }

    const backendEnv = String(healthRes.data.environment || '').trim().toUpperCase();
    const allowedEnvs = g.ROMS_ENV && Array.isArray(g.ROMS_ENV.ALLOWED_ENVS)
      ? g.ROMS_ENV.ALLOWED_ENVS
      : ['LOCAL', 'STAGING', 'PRODUCTION'];

    if (allowedEnvs.indexOf(backendEnv) === -1 || backendEnv !== envState.env) {
      clearSession();
      throw makeApiError(
        'Môi trường không khớp: Frontend là ' +
          envState.env +
          ' nhưng Backend trả về ' +
          (backendEnv || 'UNSPECIFIED') +
          '. Đã chặn kết nối.',
        'ENV_MISMATCH'
      );
    }

    const storage = getStorage();
    if (storage) {
      storage.setItem(getStorageKey(STORAGE_KEYS.VERIFIED_ENV_URL), baseUrl);
      storage.setItem(getStorageKey(STORAGE_KEYS.VERIFIED_ENV_NAME), envState.env);
    }

    return {
      env: envState.env,
      backendEnv: backendEnv,
      url: baseUrl,
      health: healthRes.data,
    };
  }

  async function requestPost(action, payload, includeSession) {
    const g = getGlobal();
    const baseUrl = assertConfiguredUrl();
    if (action !== 'login' && g.ROMS_ENV && !isHandshakeVerifiedForCurrentConfig()) {
      await verifyEnvironmentHandshake();
    }
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
    isManualOverride: isManualOverride,
    clearApiUrlOverride: clearApiUrlOverride,
    getSessionToken: getSessionToken,
    setSession: setSession,
    clearSession: clearSession,
    checkHealth: requestHealth,
    verifyEnvironmentHandshake: verifyEnvironmentHandshake,
    login: async function (passcode, options) {
      await verifyEnvironmentHandshake();
      const includeBootstrap = Boolean(options && options.includeBootstrap);
      const res = await requestPost(
        'login',
        { passcode: String(passcode || ''), include_bootstrap: includeBootstrap },
        false
      );
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
    syncStatus: function () {
      return requestPost('syncStatus', {});
    },
    getFloorState: function () {
      return requestPost('getFloorState', {});
    },
    listActiveOrders: function (filters) {
      return requestPost('listActiveOrders', { filters: filters || {} });
    },
    getOrderDetail: function (orderId) {
      return requestPost('getOrderDetail', { order_id: orderId });
    },
    addItemsToOrder: function (payload) {
      return requestPost('addItemsToOrder', payload);
    },
    moveOrderItem: function (payload) {
      return requestPost('moveOrderItem', payload);
    },
    mergeOrders: function (payload) {
      return requestPost('mergeOrders', payload);
    },
    splitOrder: function (payload) {
      return requestPost('splitOrder', payload);
    },
    settlePayment: function (payload) {
      return requestPost('settlePayment', payload);
    },
    updateOrderItem: function (payload) {
      return requestPost('updateOrderItem', payload);
    },
    removeOrderItem: function (payload) {
      return requestPost('removeOrderItem', payload);
    },
    cancelOrder: function (payload) {
      return requestPost('cancelOrder', payload);
    },
    listOrderHistory: function (payload) {
      return requestPost('listOrderHistory', payload || {});
    },
    getReports: function (payload) {
      return requestPost('getReports', payload || {});
    },
  };
});
