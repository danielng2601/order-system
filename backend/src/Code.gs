/**
 * ROMS V1.0 - Google Apps Script Web App Entrypoint (Phase 1.5 Hardened)
 *
 * Security & CORS design:
 * - GET is restricted to public ?action=health (never accepts passcodes or tokens in query strings).
 * - All authenticated reads (bootstrap, menu, modifiers) and writes (createOrder) use POST
 *   with Content-Type: text/plain;charset=utf-8 to avoid CORS OPTIONS preflight.
 * - POST { action: "login", passcode } exchanges STAFF_PASSCODE for a 6-hour session_token
 *   stored in CacheService.getScriptCache().
 */

/**
 * Handles HTTP GET requests (public health check only).
 * @param {GoogleAppsScript.Events.DoGet} e
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = sanitizeText(params.action || 'health', 40);

    if (action === 'health') {
      return jsonResponse_({
        ok: true,
        data: {
          service: ROMS_CONFIG.APP_NAME,
          version: ROMS_CONFIG.APP_VERSION,
          schemaVersion: ROMS_CONFIG.SCHEMA_VERSION,
          phase: ROMS_CONFIG.PHASE,
          timezone: ROMS_CONFIG.TIMEZONE,
          currency: ROMS_CONFIG.CURRENCY,
          printerEnabled: ROMS_CONFIG.PRINTER_ENABLED,
          serverTime: formatLocalTimestamp(),
        },
        error: null,
      });
    }

    if (action === 'bootstrap' || action === 'menu' || action === 'modifiers') {
      return jsonResponse_({
        ok: false,
        data: null,
        error: {
          code: 'METHOD_NOT_ALLOWED',
          message: 'Use POST for "' + action + '" so credentials are never sent in URL query strings.',
        },
      });
    }

    return jsonResponse_({
      ok: false,
      data: null,
      error: { code: 'BAD_REQUEST', message: 'Unsupported GET action: ' + action },
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: err.message || 'Unexpected server error' },
    });
  }
}

/**
 * Handles HTTP POST requests.
 * @param {GoogleAppsScript.Events.DoPost} e
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doPost(e) {
  let payload;
  try {
    const rawBody = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    payload = JSON.parse(rawBody);
  } catch (parseErr) {
    return jsonResponse_({
      ok: false,
      data: null,
      error: { code: 'BAD_REQUEST', message: 'Invalid JSON request body.' },
    });
  }

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return jsonResponse_({
      ok: false,
      data: null,
      error: { code: 'BAD_REQUEST', message: 'Request body must be a JSON object.' },
    });
  }

  const action = sanitizeText(payload.action, 40);
  if (!action) {
    return jsonResponse_({
      ok: false,
      data: null,
      error: { code: 'BAD_REQUEST', message: 'Missing required field: action.' },
    });
  }

  if (action === 'login') {
    return handleLogin_(payload.passcode);
  }

  const authCheck = isAuthorizedPost_(payload);
  if (!authCheck.authorized) {
    return jsonResponse_({
      ok: false,
      data: null,
      error: {
        code: authCheck.code,
        message: authCheck.message,
      },
    });
  }

  if (action === 'ping') {
    return jsonResponse_({
      ok: true,
      data: {
        pong: true,
        serverTime: formatLocalTimestamp(),
        phase: ROMS_CONFIG.PHASE,
      },
      error: null,
    });
  }

  if (
    action === 'bootstrap' ||
    action === 'menu' ||
    action === 'modifiers' ||
    action === 'syncStatus' ||
    action === 'getFloorState' ||
    action === 'listActiveOrders' ||
    action === 'getOrderDetail'
  ) {
    try {
      const ss = getDatabaseSpreadsheet();
      if (action === 'getOrderDetail') {
        const detailRes = handleGetOrderDetail_(ss, payload);
        if (detailRes.error) {
          return jsonResponse_({ ok: false, data: null, error: detailRes.error });
        }
        return jsonResponse_({ ok: true, data: detailRes.data, error: null });
      }
      let data;
      if (action === 'bootstrap') data = handleGetBootstrap_(ss);
      else if (action === 'menu') data = handleGetMenu_(ss);
      else if (action === 'modifiers') data = handleGetModifiers_(ss);
      else if (action === 'syncStatus') data = handleGetSyncStatus_(ss);
      else if (action === 'getFloorState') data = handleGetFloorState_(ss);
      else if (action === 'listActiveOrders') data = handleListActiveOrders_(ss, payload.filters);
      return jsonResponse_({ ok: true, data: data, error: null });
    } catch (err) {
      return jsonResponse_({
        ok: false,
        data: null,
        error: { code: 'INTERNAL_ERROR', message: err.message || 'Unexpected server error' },
      });
    }
  }

  const writeActions = ['createOrder', 'addItemsToOrder', 'moveOrderItem', 'mergeOrders', 'splitOrder'];
  if (writeActions.indexOf(action) === -1) {
    return jsonResponse_({
      ok: false,
      data: null,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Action "' + action + '" is scheduled for Phase 3.',
      },
    });
  }

  const lock = LockService.getScriptLock();
  try {
    const acquired = lock.tryLock(ROMS_CONFIG.LOCK_TIMEOUT_MS);
    if (!acquired) {
      return jsonResponse_({
        ok: false,
        data: null,
        error: {
          code: 'LOCK_TIMEOUT',
          message: 'Hệ thống đang xử lý đơn khác. Vui lòng thử lại.',
        },
      });
    }

    const ss = getDatabaseSpreadsheet();
    let result;
    if (action === 'createOrder') result = handleCreateOrder_(ss, payload);
    else if (action === 'addItemsToOrder') result = handleAddItemsToOrder_(ss, payload);
    else if (action === 'moveOrderItem') result = handleMoveOrderItem_(ss, payload);
    else if (action === 'mergeOrders') result = handleMergeOrders_(ss, payload);
    else if (action === 'splitOrder') result = handleSplitOrder_(ss, payload);

    if (result.error) {
      return jsonResponse_({
        ok: false,
        data: null,
        error: result.error,
      });
    }

    return jsonResponse_({
      ok: true,
      data: result.data,
      error: null,
    });
  } catch (err) {
    return jsonResponse_({
      ok: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: err.message || 'Unexpected server error' },
    });
  } finally {
    try {
      lock.releaseLock();
    } catch (releaseErr) {
      // Ignore if lock was not held
    }
  }
}

/**
 * Exchanges a valid STAFF_PASSCODE for a short-lived session_token in CacheService.
 * @param {string=} providedPasscode
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function handleLogin_(providedPasscode) {
  if (!isValidPasscode_(providedPasscode)) {
    return jsonResponse_({
      ok: false,
      data: null,
      error: { code: 'UNAUTHORIZED', message: 'Mã nhân viên không đúng hoặc chưa được cấu hình.' },
    });
  }

  const token = Utilities.getUuid() + '-' + Utilities.getUuid().slice(0, 8);
  const ttl = ROMS_CONFIG.SESSION_TTL_SECONDS;
  const expiresAtMs = Date.now() + ttl * 1000;
  const sessionRecord = {
    created_at: formatLocalTimestamp(),
    expires_at_ms: expiresAtMs,
  };

  const cache = CacheService.getScriptCache();
  cache.put('SESSION_' + token, JSON.stringify(sessionRecord), ttl);

  return jsonResponse_({
    ok: true,
    data: {
      session_token: token,
      expires_at: formatLocalTimestamp(new Date(expiresAtMs)),
      expires_at_ms: expiresAtMs,
      ttl_seconds: ttl,
    },
    error: null,
  });
}

/**
 * Verifies either a valid session_token in CacheService or a valid passcode in POST body.
 * @param {Object} payload
 * @return {{ authorized: boolean, code?: string, message?: string }}
 */
function isAuthorizedPost_(payload) {
  const token = sanitizeText(payload && payload.session_token, 128);
  if (token) {
    const cache = CacheService.getScriptCache();
    const raw = cache.get('SESSION_' + token);
    if (!raw) {
      return {
        authorized: false,
        code: 'SESSION_EXPIRED',
        message: 'Phiên làm việc đã hết hạn hoặc không hợp lệ. Vui lòng đăng nhập lại.',
      };
    }
    try {
      const parsed = JSON.parse(raw);
      if (!parsed.expires_at_ms || Date.now() > Number(parsed.expires_at_ms)) {
        cache.remove('SESSION_' + token);
        return {
          authorized: false,
          code: 'SESSION_EXPIRED',
          message: 'Phiên làm việc đã hết hạn. Vui lòng đăng nhập lại.',
        };
      }
      return { authorized: true };
    } catch (err) {
      return {
        authorized: false,
        code: 'SESSION_EXPIRED',
        message: 'Phiên làm việc không hợp lệ. Vui lòng đăng nhập lại.',
      };
    }
  }

  if (payload && payload.passcode && isValidPasscode_(payload.passcode)) {
    return { authorized: true };
  }

  return {
    authorized: false,
    code: 'UNAUTHORIZED',
    message: 'Thiếu thông tin xác thực hoặc mã nhân viên không hợp lệ.',
  };
}

/**
 * Checks staff passcode against Script Properties STAFF_PASSCODE.
 * Never logs passcodes. Rejects all requests if STAFF_PASSCODE is unset.
 * @param {string=} providedPasscode
 * @return {boolean}
 */
function isValidPasscode_(providedPasscode) {
  const props = PropertiesService.getScriptProperties();
  const expected = props.getProperty('STAFF_PASSCODE');
  if (!expected) {
    return false;
  }
  return constantTimeEqual(String(providedPasscode || ''), String(expected));
}

/**
 * Formats a JSON TextOutput response.
 * @param {Object} body
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function jsonResponse_(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(
    ContentService.MimeType.JSON
  );
}
