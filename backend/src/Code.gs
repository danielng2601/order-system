/**
 * ROMS V1.0 - Google Apps Script Web App Entrypoint (Phase 1)
 *
 * Cross-domain CORS note:
 * - Frontend sends POST requests with Content-Type: text/plain;charset=utf-8
 *   containing a JSON string body to avoid CORS preflight OPTIONS requests,
 *   which GAS Web Apps do not support.
 */

/**
 * Handles HTTP GET requests.
 * Supported actions:
 * - ?action=health (public liveness check)
 * - ?action=bootstrap&passcode=... (full menu, modifiers, seats, settings)
 * - ?action=menu&passcode=... (menu items & topping price)
 * - ?action=modifiers&passcode=... (active modifiers)
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

    if (!isAuthorizedRequest_(params.passcode)) {
      return jsonResponse_({
        ok: false,
        data: null,
        error: { code: 'UNAUTHORIZED', message: 'Invalid or missing staff passcode.' },
      });
    }

    const ss = getDatabaseSpreadsheet();

    if (action === 'bootstrap') {
      return jsonResponse_({
        ok: true,
        data: handleGetBootstrap_(ss),
        error: null,
      });
    }

    if (action === 'menu') {
      return jsonResponse_({
        ok: true,
        data: handleGetMenu_(ss),
        error: null,
      });
    }

    if (action === 'modifiers') {
      return jsonResponse_({
        ok: true,
        data: handleGetModifiers_(ss),
        error: null,
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
 * Acquires a script lock for all state-mutating operations.
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

  const action = sanitizeText(payload && payload.action, 40);
  if (!action) {
    return jsonResponse_({
      ok: false,
      data: null,
      error: { code: 'BAD_REQUEST', message: 'Missing required field: action.' },
    });
  }

  if (!isAuthorizedRequest_(payload.passcode)) {
    return jsonResponse_({
      ok: false,
      data: null,
      error: { code: 'UNAUTHORIZED', message: 'Invalid or missing staff passcode.' },
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

  if (action !== 'createOrder') {
    return jsonResponse_({
      ok: false,
      data: null,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Action "' + action + '" is scheduled for Phase 2-3.',
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
    const result = handleCreateOrder_(ss, payload);
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
 * Checks staff passcode against Script Properties STAFF_PASSCODE.
 * Never logs passcodes. Rejects all protected requests if STAFF_PASSCODE is unset.
 * @param {string=} providedPasscode
 * @return {boolean}
 */
function isAuthorizedRequest_(providedPasscode) {
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
