/**
 * In-memory mock of Google Apps Script SpreadsheetApp, LockService, PropertiesService, Utilities
 * for automated offline testing of GAS backend modules.
 * NOTE: These are mocked unit/integration tests, not live Google Apps Script executions.
 */

class MockRange {
  constructor(sheet, row, col, numRows, numCols) {
    this.sheet = sheet;
    this.row = row;
    this.col = col;
    this.numRows = numRows;
    this.numCols = numCols;
  }

  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r += 1) {
      const srcRow = this.sheet._rows[this.row - 1 + r] || [];
      const rowOut = [];
      for (let c = 0; c < this.numCols; c += 1) {
        rowOut.push(srcRow[this.col - 1 + c] !== undefined ? srcRow[this.col - 1 + c] : '');
      }
      out.push(rowOut);
    }
    return out;
  }

  getValue() {
    return this.getValues()[0][0];
  }

  setValues(values) {
    if (this.sheet._failOnNextWrite) {
      this.sheet._failOnNextWrite = false;
      throw new Error('Simulated Google Sheets write failure');
    }
    for (let r = 0; r < values.length; r += 1) {
      const targetIdx = this.row - 1 + r;
      while (this.sheet._rows.length <= targetIdx) {
        this.sheet._rows.push([]);
      }
      for (let c = 0; c < values[r].length; c += 1) {
        this.sheet._rows[targetIdx][this.col - 1 + c] = values[r][c];
      }
    }
  }

  setValue(val) {
    this.setValues([[val]]);
  }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this._rows = [];
    this.frozenRows = 0;
    this._failOnNextWrite = false;
  }

  getLastRow() {
    return this._rows.length;
  }

  getName() {
    return this.name;
  }

  getLastColumn() {
    return this._rows.length > 0 ? this._rows[0].length : 0;
  }

  setFrozenRows(n) {
    this.frozenRows = n;
  }

  getRange(row, col, numRows = 1, numCols = 1) {
    return new MockRange(this, row, col, numRows, numCols);
  }

  getDataRange() {
    return this.getRange(1, 1, Math.max(1, this.getLastRow()), Math.max(1, this.getLastColumn()));
  }

  appendRow(rowValues) {
    if (this._failOnNextWrite) {
      this._failOnNextWrite = false;
      throw new Error('Simulated appendRow failure');
    }
    if (this.failOnAppend) {
      throw new Error('Simulated appendRow failure');
    }
    this._rows.push(rowValues.slice());
  }

  deleteRow(rowIndex1Based) {
    this._rows.splice(rowIndex1Based - 1, 1);
  }
}

class MockSpreadsheet {
  constructor() {
    this._sheets = new Map();
  }

  getSheetByName(name) {
    return this._sheets.get(name) || null;
  }

  insertSheet(name) {
    const s = new MockSheet(name);
    this._sheets.set(name, s);
    return s;
  }

  getId() {
    return 'mock-spreadsheet-id';
  }

  getName() {
    return 'ROMS_Mock_DB';
  }
}

function createGasMockEnv(options = {}) {
  const ss = new MockSpreadsheet();
  let uuidCounter = 1;
  let lockBusy = Boolean(options.lockBusy);
  const propsMap = Object.assign(
    {
      ROMS_ENV: 'LOCAL',
      LOCAL_SPREADSHEET_ID: 'mock-spreadsheet-id',
      STAFF_PASSCODE: 'test-pass-999',
    },
    options.properties || {}
  );

  const cacheStore = new Map();
  let fakeNowMs = null;

  const env = {
    console,
    Intl,
    Math,
    Date,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Error,
    _ss: ss,
    _cache: cacheStore,
    _setFakeNowMs: (ms) => {
      fakeNowMs = ms;
    },
    _setLockBusy: (busy) => {
      lockBusy = Boolean(busy);
    },
    SpreadsheetApp: {
      openById: () => ss,
      getActiveSpreadsheet: () => ss,
      flush: () => {},
    },
    CacheService: {
      getScriptCache: () => ({
        put: (k, v, ttlSec) => {
          const now = fakeNowMs !== null ? fakeNowMs : Date.now();
          cacheStore.set(k, { value: String(v), expiresAt: now + (ttlSec || 600) * 1000 });
        },
        get: (k) => {
          const entry = cacheStore.get(k);
          if (!entry) return null;
          const now = fakeNowMs !== null ? fakeNowMs : Date.now();
          if (now > entry.expiresAt) {
            cacheStore.delete(k);
            return null;
          }
          return entry.value;
        },
        remove: (k) => {
          cacheStore.delete(k);
        },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (Object.prototype.hasOwnProperty.call(propsMap, k) ? propsMap[k] : null),
      }),
    },
    LockService: {
      getScriptLock: () => ({
        tryLock: () => !lockBusy,
        releaseLock: () => {},
      }),
    },
    Utilities: {
      formatDate: (date, tz, format) => {
        const d = date instanceof Date ? date : new Date();
        // Shift to Asia/Ho_Chi_Minh (+07:00)
        const vn = new Date(d.getTime() + 7 * 60 * 60 * 1000);
        const yyyy = vn.getUTCFullYear();
        const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
        const dd = String(vn.getUTCDate()).padStart(2, '0');
        const HH = String(vn.getUTCHours()).padStart(2, '0');
        const MM = String(vn.getUTCMinutes()).padStart(2, '0');
        const SS = String(vn.getUTCSeconds()).padStart(2, '0');
        if (format === 'yyyy-MM-dd') return `${yyyy}-${mm}-${dd}`;
        if (format === 'yyyyMMdd-HHmmss') return `${yyyy}${mm}${dd}-${HH}${MM}${SS}`;
        if (format === 'yyyyMMdd') return `${yyyy}${mm}${dd}`;
        return `${yyyy}-${mm}-${dd}T${HH}:${MM}:${SS}+07:00`;
      },
      getUuid: () => '00000000-0000-4000-8000-' + String(uuidCounter++).padStart(12, '0'),
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text) => ({
        _text: text,
        setMimeType: function () {
          return this;
        },
        getContent: function () {
          return this._text;
        },
      }),
    },
  };

  return env;
}

module.exports = { createGasMockEnv };
