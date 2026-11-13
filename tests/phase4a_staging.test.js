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
        getProperty: (k) => (k === 'ROMS_ENV' ? 'STAGING' : k === 'SPREADSHEET_ID' ? 'ss_staging_1' : null),
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
  assert.equal(backup.fileName, 'ROMS_Database_Staging_backup_20261113-020000');
  assert.equal(copiedFiles[0].folderName, 'ROMS_Backups');
});

test('Phase 4A Preflight Script: scripts/preflight-check.js exits 0', () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts/preflight-check.js')], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  assert.match(out, /All Phase 4A preflight checks PASSED/);
});
