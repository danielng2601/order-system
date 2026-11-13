const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function makeSessionStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _raw: map,
  };
}

function loadFrontendEnvAndApi({ search = '', romsConfig, sessionStorage, fetchImpl } = {}) {
  const envCode = fs.readFileSync(path.join(ROOT, 'frontend/js/env.js'), 'utf8');
  const apiCode = fs.readFileSync(path.join(ROOT, 'frontend/js/api.js'), 'utf8');

  const g = {
    URL,
    URLSearchParams,
    Date,
    Number,
    String,
    Object,
    Array,
    Error,
    setTimeout,
    clearTimeout,
    navigator: { onLine: true },
    location: { search },
    sessionStorage: sessionStorage || makeSessionStorage(),
    ROMS_CONFIG: romsConfig,
    fetch: fetchImpl || (async () => {
      throw new Error('Unexpected fetch call');
    }),
  };
  g.window = g;
  vm.createContext(g);
  vm.runInContext(envCode, g, { filename: 'frontend/js/env.js' });
  vm.runInContext(apiCode, g, { filename: 'frontend/js/api.js' });
  return g;
}

test('Phase 4A Env Separation: STAGING never falls back to PRODUCTION and invalid env fails closed', async () => {
  const cfg = {
    ENV: 'STAGING',
    ENVIRONMENTS: {
      LOCAL: { label: 'LOCAL', GAS_WEB_APP_URL: 'http://localhost:8080/exec' },
      STAGING: {
        label: 'STAGING',
        GAS_WEB_APP_URL: 'https://script.google.com/macros/s/REPLACE_WITH_STAGING_DEPLOYMENT_ID/exec',
      },
      PRODUCTION: {
        label: 'PRODUCTION',
        GAS_WEB_APP_URL: 'https://script.google.com/macros/s/PROD_URL_EXAMPLE/exec',
      },
    },
  };

  // STAGING has placeholder -> must fail with UNCONFIGURED, never fall back to PRODUCTION
  const gStaging = loadFrontendEnvAndApi({ search: '?env=staging', romsConfig: cfg });
  const resolved = gStaging.ROMS_ENV.resolveConfig(gStaging);
  assert.equal(resolved.env, 'STAGING');
  assert.equal(resolved.isConfigured, false);
  assert.equal(resolved.errorCode, 'UNCONFIGURED');
  await assert.rejects(() => gStaging.ROMS_API.checkHealth(), (err) => err.code === 'UNCONFIGURED');

  // Unknown env -> must fail closed with INVALID_ENV
  const gInvalid = loadFrontendEnvAndApi({ search: '?env=prod_typo', romsConfig: cfg });
  const badResolved = gInvalid.ROMS_ENV.resolveConfig(gInvalid);
  assert.equal(badResolved.valid, false);
  assert.equal(badResolved.errorCode, 'INVALID_ENV');
  await assert.rejects(() => gInvalid.ROMS_API.login('1234'), (err) => err.code === 'INVALID_ENV');

  // LOCAL allows http://localhost, STAGING rejects http://localhost
  assert.equal(gStaging.ROMS_ENV.isValidUrlForEnv('http://localhost:8080/exec', 'LOCAL'), true);
  assert.equal(gStaging.ROMS_ENV.isValidUrlForEnv('http://localhost:8080/exec', 'STAGING'), false);
});

test('Phase 4A Env Separation: sessionStorage tokens and URLs are isolated between STAGING and PRODUCTION', () => {
  const sharedStorage = makeSessionStorage();
  const cfg = {
    ENV: 'STAGING',
    ENVIRONMENTS: {
      STAGING: { label: 'STAGING', GAS_WEB_APP_URL: 'https://script.google.com/macros/s/STAGING_ID/exec' },
      PRODUCTION: { label: 'PRODUCTION', GAS_WEB_APP_URL: 'https://script.google.com/macros/s/PROD_ID/exec' },
    },
  };

  const gStaging = loadFrontendEnvAndApi({
    search: '?env=staging',
    romsConfig: cfg,
    sessionStorage: sharedStorage,
  });
  gStaging.ROMS_API.setSession('tok_staging_123', Date.now() + 60000);

  const gProd = loadFrontendEnvAndApi({
    search: '?env=production',
    romsConfig: cfg,
    sessionStorage: sharedStorage,
  });
  assert.equal(gProd.ROMS_API.getSessionToken(), '');
  assert.equal(gProd.ROMS_API.getApiUrl(), 'https://script.google.com/macros/s/PROD_ID/exec');
  assert.equal(gStaging.ROMS_API.getSessionToken(), 'tok_staging_123');
});

test('Phase 4A Frontend Assets: index.html uses relative paths and loads env.js before api.js', () => {
  const html = fs.readFileSync(path.join(ROOT, 'frontend/index.html'), 'utf8');
  const envIdx = html.indexOf('js/env.js');
  const apiIdx = html.indexOf('js/api.js');
  assert.ok(envIdx > 0 && apiIdx > envIdx, 'env.js must be loaded before api.js');

  const assetRegex = /(?:src|href)=["']([^"']+)["']/g;
  let m;
  while ((m = assetRegex.exec(html)) !== null) {
    assert.equal(m[1].startsWith('/'), false, `Asset path must be relative for GitHub Pages subpath: ${m[1]}`);
    assert.equal(fs.existsSync(path.join(ROOT, 'frontend', m[1])), true, `Missing asset: ${m[1]}`);
  }
});

test('Phase 4A Backend: health reports ROMS_ENV and backupDatabaseToDrive creates timestamped copy', () => {
  const ss = { getName: () => 'ROMS_Database_Staging', getId: () => 'ss_staging_1' };
  const createdFolders = [];
  const copiedFiles = [];

  const ctx = {
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
    Utilities: {
      formatDate: () => '20261113-020000',
      getUuid: () => 'uuid-1234',
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput: (text) => ({
        _text: text,
        setMimeType() {
          return this;
        },
        getContent() {
          return this._text;
        },
      }),
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (k) => (k === 'ROMS_ENV' ? 'STAGING' : k === 'STAGING_SPREADSHEET_ID' ? 'ss_staging_1' : null),
      }),
    },
    SpreadsheetApp: {
      openById: () => ss,
      getActiveSpreadsheet: () => ss,
    },
    DriveApp: {
      getFoldersByName: (name) => {
        createdFolders.push(name);
        return { hasNext: () => false };
      },
      createFolder: (name) => ({ name }),
      getFileById: (id) => ({
        makeCopy: (backupName, folder) => {
          copiedFiles.push({ id, backupName, folderName: folder.name });
          return { getId: () => 'backup_file_1', getName: () => backupName };
        },
      }),
    },
  };
  vm.createContext(ctx);
  for (const f of ['backend/src/Config.gs', 'backend/src/Validation.gs', 'backend/src/DbSetup.gs', 'backend/src/Code.gs']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }

  const health = JSON.parse(ctx.doGet({ parameter: { action: 'health' } }).getContent());
  assert.equal(health.ok, true);
  assert.equal(health.data.environment, 'STAGING');
  assert.equal(health.data.printerEnabled, false);
  assert.equal(health.data.schemaVersion, '1.3.0');

  const backup = ctx.backupDatabaseToDrive();
  assert.equal(backup.ok, true);
  assert.equal(backup.fileId, 'backup_file_1');
  assert.equal(backup.fileName, 'ROMS_Database_Staging_STAGING_backup_20261113-020000');
  assert.equal(copiedFiles[0].folderName, 'ROMS_Backups');
});

test('Phase 4A Preflight Script: scripts/preflight-check.js exits 0', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/preflight-check.js')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(out, /All Phase 4A preflight checks PASSED/);
});

test('Phase 4A.1 Audit: manual URL override blocks cross-env URLs, tracks override state, and clears stale tokens', () => {
  const cfg = {
    ENV: 'STAGING',
    ENVIRONMENTS: {
      STAGING: { label: 'STAGING', GAS_WEB_APP_URL: 'https://script.google.com/macros/s/STAGING_ID/exec' },
      PRODUCTION: { label: 'PRODUCTION', GAS_WEB_APP_URL: 'https://script.google.com/macros/s/PROD_ID/exec' },
    },
  };

  const g = loadFrontendEnvAndApi({ search: '?env=staging', romsConfig: cfg });
  assert.equal(g.ROMS_API.isManualOverride(), false);

  // Attempting to override STAGING with PRODUCTION URL must throw CROSS_ENV_OVERRIDE
  assert.throws(
    () => g.ROMS_API.setApiUrl('https://script.google.com/macros/s/PROD_ID/exec'),
    (err) => err.code === 'CROSS_ENV_OVERRIDE'
  );

  // Valid custom staging URL sets override flag and clears stale session token on change
  g.ROMS_API.setSession('tok_old', Date.now() + 60000);
  g.ROMS_API.setApiUrl('https://script.google.com/macros/s/STAGING_V2/exec');
  assert.equal(g.ROMS_API.isManualOverride(), true);
  assert.equal(g.ROMS_API.getSessionToken(), '');

  // Clearing override restores default STAGING URL
  g.ROMS_API.clearApiUrlOverride();
  assert.equal(g.ROMS_API.isManualOverride(), false);
  assert.equal(g.ROMS_API.getApiUrl(), 'https://script.google.com/macros/s/STAGING_ID/exec');
});

test('Phase 4A.2 Audit: strict spreadsheet isolation and backup environment safety in DbSetup.gs', () => {
  function runDbSetupWithProps(propsMap, driveShouldThrow = false) {
    const ss = { getName: () => 'BoundSheet', getId: () => 'bound_1' };
    const createdCopies = [];
    const ctx = {
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
      Utilities: { formatDate: () => '20261113-020000', getUuid: () => 'u1' },
      PropertiesService: {
        getScriptProperties: () => ({ getProperty: (k) => (k in propsMap ? propsMap[k] : null) }),
      },
      SpreadsheetApp: {
        openById: (id) => ({ getName: () => 'ROMS_Database_' + id, getId: () => id }),
        getActiveSpreadsheet: () => ss,
      },
      DriveApp: {
        getFoldersByName: () => {
          if (driveShouldThrow) throw new Error('Drive quota exceeded');
          return { hasNext: () => true, next: () => ({ name: 'ROMS_Backups' }) };
        },
        getFileById: () => ({
          makeCopy: (name) => {
            createdCopies.push(name);
            return { getId: () => 'b1', getName: () => name };
          },
        }),
      },
      _createdCopies: createdCopies,
    };
    vm.createContext(ctx);
    for (const f of ['backend/src/Config.gs', 'backend/src/Validation.gs', 'backend/src/DbSetup.gs']) {
      vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
    }
    return ctx;
  }

  // 1. Missing STAGING_SPREADSHEET_ID -> throws
  assert.throws(
    () => runDbSetupWithProps({ ROMS_ENV: 'STAGING' }).getDatabaseSpreadsheet(),
    /STAGING_SPREADSHEET_ID must be set/
  );

  // 2. STAGING_SPREADSHEET_ID configured correctly -> opens it
  const stgSs = runDbSetupWithProps({ ROMS_ENV: 'STAGING', STAGING_SPREADSHEET_ID: 'stg_sheet_1' }).getDatabaseSpreadsheet();
  assert.equal(stgSs.getId(), 'stg_sheet_1');

  // 3. STAGING_SPREADSHEET_ID missing while generic SPREADSHEET_ID exists -> throws (no generic fallback)
  assert.throws(
    () => runDbSetupWithProps({ ROMS_ENV: 'STAGING', SPREADSHEET_ID: 'arbitrary_id' }).getDatabaseSpreadsheet(),
    /STAGING_SPREADSHEET_ID must be set/
  );

  // 4. STAGING with PRODUCTION_SPREADSHEET_ID only -> throws
  assert.throws(
    () => runDbSetupWithProps({ ROMS_ENV: 'STAGING', PRODUCTION_SPREADSHEET_ID: 'prod_1' }).getDatabaseSpreadsheet(),
    /STAGING_SPREADSHEET_ID must be set/
  );

  // 5. PRODUCTION with STAGING_SPREADSHEET_ID only -> throws
  assert.throws(
    () => runDbSetupWithProps({ ROMS_ENV: 'PRODUCTION', STAGING_SPREADSHEET_ID: 'stg_1' }).getDatabaseSpreadsheet(),
    /PRODUCTION_SPREADSHEET_ID must be set/
  );

  // 6. Missing LOCAL_SPREADSHEET_ID -> throws
  assert.throws(
    () => runDbSetupWithProps({ ROMS_ENV: 'LOCAL', SPREADSHEET_ID: 'arb_1' }).getDatabaseSpreadsheet(),
    /LOCAL_SPREADSHEET_ID must be set/
  );

  // 7. Unknown ROMS_ENV -> throws
  assert.throws(
    () => runDbSetupWithProps({ ROMS_ENV: 'QA', STAGING_SPREADSHEET_ID: 'stg_1' }).getDatabaseSpreadsheet(),
    /ROMS_ENV must be explicitly set/
  );

  // 8. STAGING_SPREADSHEET_ID === PRODUCTION_SPREADSHEET_ID -> throws
  assert.throws(
    () =>
      runDbSetupWithProps({
        ROMS_ENV: 'STAGING',
        STAGING_SPREADSHEET_ID: 'same_id',
        PRODUCTION_SPREADSHEET_ID: 'same_id',
      }).getDatabaseSpreadsheet(),
    /cannot match PRODUCTION_SPREADSHEET_ID/
  );

  // 9. Backup environment safety: missing/invalid ROMS_ENV refuses to create Drive file
  const ctxBadBackup = runDbSetupWithProps({ SPREADSHEET_ID: 'arb_1' });
  const badBackup = ctxBadBackup.backupDatabaseToDrive();
  assert.equal(badBackup.ok, false);
  assert.equal(ctxBadBackup._createdCopies.length, 0);

  // 10. STAGING vs PRODUCTION backups have distinct environment-tagged names
  const okStg = runDbSetupWithProps({ ROMS_ENV: 'STAGING', STAGING_SPREADSHEET_ID: 'stg_1' }).backupDatabaseToDrive();
  const okProd = runDbSetupWithProps({ ROMS_ENV: 'PRODUCTION', PRODUCTION_SPREADSHEET_ID: 'prod_1' }).backupDatabaseToDrive();
  assert.equal(okStg.ok, true);
  assert.equal(okProd.ok, true);
  assert.match(okStg.fileName, /_STAGING_backup_20261113-020000/);
  assert.match(okProd.fileName, /_PRODUCTION_backup_20261113-020000/);
  assert.notEqual(okStg.fileName, okProd.fileName);

  // 11. DriveApp error is caught cleanly
  const failBackup = runDbSetupWithProps({ ROMS_ENV: 'STAGING', STAGING_SPREADSHEET_ID: 'stg_1' }, true).backupDatabaseToDrive();
  assert.equal(failBackup.ok, false);
  assert.equal(failBackup.error, 'Drive quota exceeded');
});

test('Phase 4A.2 Audit: frontend-backend environment handshake blocks mismatches, network failures, and custom URL bypasses', async () => {
  const cfg = {
    ENV: 'STAGING',
    ENVIRONMENTS: {
      LOCAL: { label: 'LOCAL', GAS_WEB_APP_URL: 'http://localhost:8080/exec' },
      STAGING: { label: 'STAGING', GAS_WEB_APP_URL: 'https://script.google.com/macros/s/STAGING_ID/exec' },
      PRODUCTION: { label: 'PRODUCTION', GAS_WEB_APP_URL: 'https://script.google.com/macros/s/PROD_ID/exec' },
    },
  };

  function makeFetch(healthEnv, loginCallsOut) {
    return async (url, opts) => {
      if ((!opts || opts.method === 'GET') && String(url).includes('action=health')) {
        return {
          ok: true,
          text: async () => JSON.stringify({ ok: true, data: { environment: healthEnv }, error: null }),
        };
      }
      const body = JSON.parse(opts.body);
      if (body.action === 'login') {
        loginCallsOut.push(body);
        return {
          ok: true,
          text: async () => JSON.stringify({ ok: true, data: { session_token: 'tok_' + healthEnv, expires_at_ms: Date.now() + 60000 }, error: null }),
        };
      }
      return {
        ok: true,
        text: async () => JSON.stringify({ ok: true, data: { pong: true }, error: null }),
      };
    };
  }

  // 1. STAGING frontend + STAGING backend -> allowed
  const loginCallsOk = [];
  const gOk = loadFrontendEnvAndApi({ search: '?env=staging', romsConfig: cfg, fetchImpl: makeFetch('STAGING', loginCallsOk) });
  const loginOk = await gOk.ROMS_API.login('pass123');
  assert.equal(loginOk.ok, true);
  assert.equal(loginCallsOk.length, 1);

  // 2. STAGING frontend + PRODUCTION backend -> blocked (login never sent)
  const loginCallsMismatch = [];
  const gMismatch = loadFrontendEnvAndApi({ search: '?env=staging', romsConfig: cfg, fetchImpl: makeFetch('PRODUCTION', loginCallsMismatch) });
  await assert.rejects(() => gMismatch.ROMS_API.login('pass123'), (err) => err.code === 'ENV_MISMATCH');
  assert.equal(loginCallsMismatch.length, 0);

  // 3. PRODUCTION frontend + STAGING backend -> blocked
  const loginCallsProdStg = [];
  const gProdStg = loadFrontendEnvAndApi({ search: '?env=production', romsConfig: cfg, fetchImpl: makeFetch('STAGING', loginCallsProdStg) });
  await assert.rejects(() => gProdStg.ROMS_API.login('pass123'), (err) => err.code === 'ENV_MISMATCH');
  assert.equal(loginCallsProdStg.length, 0);

  // 4. STAGING frontend + UNSPECIFIED backend -> blocked
  const loginCallsUnspec = [];
  const gUnspec = loadFrontendEnvAndApi({ search: '?env=staging', romsConfig: cfg, fetchImpl: makeFetch('UNSPECIFIED', loginCallsUnspec) });
  await assert.rejects(() => gUnspec.ROMS_API.login('pass123'), (err) => err.code === 'ENV_MISMATCH');
  assert.equal(loginCallsUnspec.length, 0);

  // 5. Unknown frontend environment -> blocked
  const gUnknown = loadFrontendEnvAndApi({ search: '?env=unknown', romsConfig: cfg, fetchImpl: makeFetch('STAGING', []) });
  await assert.rejects(() => gUnknown.ROMS_API.login('pass123'), (err) => err.code === 'INVALID_ENV');

  // 6. Network error on health check -> blocked (no silent bypass)
  const gNetErr = loadFrontendEnvAndApi({
    search: '?env=staging',
    romsConfig: cfg,
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED');
    },
  });
  await assert.rejects(() => gNetErr.ROMS_API.login('pass123'), (err) => err.code === 'NETWORK_ERROR');

  // 7. Custom URL override pointing to a PRODUCTION backend (not in config) -> blocked by handshake, and blocks mutations
  const loginCallsCustom = [];
  const gCustom = loadFrontendEnvAndApi({ search: '?env=staging', romsConfig: cfg, fetchImpl: makeFetch('PRODUCTION', loginCallsCustom) });
  gCustom.ROMS_API.setSession('stale_tok', Date.now() + 60000);
  gCustom.ROMS_API.setApiUrl('https://script.google.com/macros/s/UNLISTED_PROD_URL/exec');
  assert.equal(gCustom.ROMS_API.getSessionToken(), '');
  await assert.rejects(() => gCustom.ROMS_API.login('pass123'), (err) => err.code === 'ENV_MISMATCH');
  assert.equal(loginCallsCustom.length, 0);
  gCustom.ROMS_API.setSession('injected_tok', Date.now() + 60000);
  await assert.rejects(() => gCustom.ROMS_API.createOrder({}), (err) => err.code === 'ENV_MISMATCH');
});
