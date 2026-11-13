/**
 * ROMS V1.0 - Google Apps Script Web App Entrypoint (Phase 0)
 *
 * Cross-domain CORS note:
 * - Frontend sends POST requests with Content-Type: text/plain;charset=utf-8
 *   containing a JSON string body to avoid CORS preflight OPTIONS requests,
 *   which GAS Web Apps do not support.
 */

/**
 * Handles HTTP GET requests.
 * Supported Phase 0 actions:
 * - ?action=health (public liveness check)
 * - ?action=bootstrap (requires passcode header/query if STAFF_PASSCODE is configured)
 * @param {GoogleAppsScript.Events.DoGet} e
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    const action = params.action || 'health';

    if (action === 'health') {
      return jsonResponse_({
        ok: true,
        data: {
          service: ROMS_CONFIG.APP_NAME,
          version: ROMS_CONFIG.APP_VERSION,
          phase: ROMS_CONFIG.PHASE,
          timezone: ROMS_CONFIG.TIMEZONE,
          currency: ROMS_CONFIG.CURRENCY,
          printerEnabled: ROMS_CONFIG.PRINTER_ENABLED,
          serverTime: formatLocalTimestamp(),
        },
        error: null,
      });
    }

    if (action === 'bootstrap') {
      if (!isAuthorizedRequest_(params.passcode)) {
        return jsonResponse_({
          ok: false,
          data: null,
          error: { code: 'UNAUTHORIZED', message: 'Invalid or missing staff passcode.' },
        });
      }
      return jsonResponse_({
        ok: true,
        data: loadBootstrapData_(),
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

  const action = payload && payload.action;
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

  const lock = LockService.getScriptLock();
  try {
    const acquired = lock.tryLock(ROMS_CONFIG.LOCK_TIMEOUT_MS);
    if (!acquired) {
      return jsonResponse_({
        ok: false,
        data: null,
        error: {
          code: 'LOCK_TIMEOUT',
          message: 'Server is busy processing another order. Please retry.',
        },
      });
    }

    // Order mutation actions will be implemented in Phase 1–3.
    return jsonResponse_({
      ok: false,
      data: null,
      error: {
        code: 'NOT_IMPLEMENTED',
        message: 'Action "' + action + '" is scheduled for Phase 1-3.',
      },
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
 * If STAFF_PASSCODE is not configured yet, rejects all protected requests (fail-closed).
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
 * Reads bootstrap catalog data from Google Sheets.
 * @return {Object}
 */
function loadBootstrapData_() {
  const ss = getDatabaseSpreadsheet();
  return {
    settings: sheetToObjects_(ss.getSheetByName(ROMS_CONFIG.SHEETS.SETTINGS)),
    menuItems: sheetToObjects_(ss.getSheetByName(ROMS_CONFIG.SHEETS.MENU_ITEMS)).filter(function (
      row
    ) {
      return row.is_active === true || String(row.is_active).toLowerCase() === 'true';
    }),
    modifiers: sheetToObjects_(ss.getSheetByName(ROMS_CONFIG.SHEETS.MODIFIERS)).filter(function (
      row
    ) {
      return row.is_active === true || String(row.is_active).toLowerCase() === 'true';
    }),
    tablesSeats: sheetToObjects_(ss.getSheetByName(ROMS_CONFIG.SHEETS.TABLES_SEATS)).filter(
      function (row) {
        return row.is_active === true || String(row.is_active).toLowerCase() === 'true';
      }
    ),
  };
}

/**
 * Converts a sheet with header row 1 into an array of objects.
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {Array<Object>}
 */
function sheetToObjects_(sheet) {
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const rows = [];
  for (let r = 1; r < values.length; r += 1) {
    const obj = {};
    for (let c = 0; c < headers.length; c += 1) {
      obj[headers[c]] = values[r][c];
    }
    rows.push(obj);
  }
  return rows;
}

/**
 * Appends an audit record to AuditLog.
 * @param {string} action
 * @param {string} entityType
 * @param {string} entityId
 * @param {string} actor
 * @param {string} requestId
 * @param {Object} details
 */
function appendAuditLog_(action, entityType, entityId, actor, requestId, details) {
  const ss = getDatabaseSpreadsheet();
  const sheet = ss.getSheetByName(ROMS_CONFIG.SHEETS.AUDIT_LOG);
  if (!sheet) return;
  const logId = 'LOG-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  sheet.appendRow([
    logId,
    formatLocalTimestamp(),
    action,
    entityType,
    entityId,
    actor || 'staff',
    requestId || '',
    JSON.stringify(details || {}),
  ]);
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
