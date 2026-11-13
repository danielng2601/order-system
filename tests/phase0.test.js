const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function loadGasContext(files) {
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
      formatDate: () => '2026-11-13T17:00:00+07:00',
      getUuid: () => '12345678-1234-1234-1234-1234567890ab',
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
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: () => null,
      }),
    },
  };
  vm.createContext(ctx);
  for (const relPath of files) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    vm.runInContext(code, ctx, { filename: relPath });
  }
  vm.runInContext(
    'this.ROMS_CONFIG = typeof ROMS_CONFIG !== "undefined" ? ROMS_CONFIG : undefined;' +
      'this.SEED_MENU_ITEMS = typeof SEED_MENU_ITEMS !== "undefined" ? SEED_MENU_ITEMS : undefined;' +
      'this.SEED_MODIFIERS = typeof SEED_MODIFIERS !== "undefined" ? SEED_MODIFIERS : undefined;' +
      'this.PrinterService = typeof PrinterService !== "undefined" ? PrinterService : undefined;',
    ctx
  );
  return ctx;
}

test('Phase 0 required files exist', () => {
  const requiredFiles = [
    'README.md',
    'TECHNICAL_SPEC.md',
    'DATABASE_SCHEMA.md',
    'API_REFERENCE.md',
    'DEPLOYMENT.md',
    'package.json',
    '.gitignore',
    '.github/workflows/deploy-pages.yml',
    'backend/.clasp.json.example',
    'backend/src/appsscript.json',
    'backend/src/Config.gs',
    'backend/src/Validation.gs',
    'backend/src/DbSetup.gs',
    'backend/src/PrinterService.gs',
    'backend/src/Code.gs',
    'frontend/index.html',
    'frontend/css/styles.css',
    'frontend/js/config.example.js',
    'frontend/js/api.js',
    'frontend/js/app.js',
  ];

  for (const rel of requiredFiles) {
    assert.equal(fs.existsSync(path.join(ROOT, rel)), true, `Missing ${rel}`);
  }
});

test('GAS manifest appsscript.json is configured for Asia/Ho_Chi_Minh and V8', () => {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'backend/src/appsscript.json'), 'utf8')
  );
  assert.equal(manifest.timeZone, 'Asia/Ho_Chi_Minh');
  assert.equal(manifest.runtimeVersion, 'V8');
  assert.equal(manifest.webapp.executeAs, 'USER_DEPLOYING');
  assert.equal(manifest.webapp.access, 'ANYONE_ANONYMOUS');
});

test('Config.gs defines 9 tables, 4 seats/table, 36 seats, VND menu, and PrinterEnabled=false', () => {
  const ctx = loadGasContext(['backend/src/Config.gs']);
  assert.equal(ctx.ROMS_CONFIG.TIMEZONE, 'Asia/Ho_Chi_Minh');
  assert.equal(ctx.ROMS_CONFIG.CURRENCY, 'VND');
  assert.equal(ctx.ROMS_CONFIG.TABLE_COUNT, 9);
  assert.equal(ctx.ROMS_CONFIG.SEATS_PER_TABLE, 4);
  assert.equal(ctx.ROMS_CONFIG.TOTAL_SEATS, 36);
  assert.equal(ctx.ROMS_CONFIG.TOPPING_UNIT_PRICE_VND, 15000);
  assert.equal(ctx.ROMS_CONFIG.PRINTER_ENABLED, false);

  const seats = ctx.buildSeedTablesSeats();
  assert.equal(seats.length, 36);
  assert.equal(seats[0].seat_id, 'T1-S1');
  assert.equal(seats[35].seat_id, 'T9-S4');

  const pricesById = Object.fromEntries(
    ctx.SEED_MENU_ITEMS.map((item) => [item.item_id, item.price_vnd])
  );
  assert.deepEqual(pricesById, {
    MY_VAN_THAN: 45000,
    MY_DAC_BIET: 50000,
    SUI_CAO: 50000,
    MY_TRON: 50000,
    BUN_THANG: 40000,
    MY_TRE_EM: 35000,
    QUAY: 5000,
  });

  assert.equal(ctx.SEED_MODIFIERS.length, 6);
  for (const mod of ctx.SEED_MODIFIERS) {
    assert.equal(mod.price_delta_vnd, 0);
  }
});

test('PrinterService.gs skips printing safely when PrinterEnabled is false', () => {
  const ctx = loadGasContext(['backend/src/Config.gs', 'backend/src/PrinterService.gs']);
  assert.equal(ctx.PrinterService.isEnabled(), false);
  const res = ctx.PrinterService.printOrderIfEnabled({ order_id: 'ORD-1', total_vnd: 45000 }, []);
  assert.equal(res.printed, false);
  assert.equal(res.skipped, true);
});

test('Code.gs doGet health endpoint returns Phase 0 status and fail-closed auth on bootstrap', () => {
  const ctx = loadGasContext([
    'backend/src/Config.gs',
    'backend/src/Validation.gs',
    'backend/src/DbSetup.gs',
    'backend/src/PrinterService.gs',
    'backend/src/Code.gs',
  ]);

  const healthOut = ctx.doGet({ parameter: { action: 'health' } });
  const healthJson = JSON.parse(healthOut.getContent());
  assert.equal(healthJson.ok, true);
  assert.equal(healthJson.data.service, 'ROMS');
  assert.equal(healthJson.data.currency, 'VND');
  assert.equal(healthJson.data.timezone, 'Asia/Ho_Chi_Minh');
  assert.equal(healthJson.data.printerEnabled, false);

  const getBootstrapOut = ctx.doGet({ parameter: { action: 'bootstrap' } });
  const getBootstrapJson = JSON.parse(getBootstrapOut.getContent());
  assert.equal(getBootstrapJson.ok, false);
  assert.equal(getBootstrapJson.error.code, 'METHOD_NOT_ALLOWED');

  const unauthPostOut = ctx.doPost({
    postData: { contents: JSON.stringify({ action: 'bootstrap', passcode: 'guess' }) },
  });
  const unauthPostJson = JSON.parse(unauthPostOut.getContent());
  assert.equal(unauthPostJson.ok, false);
  assert.equal(unauthPostJson.error.code, 'UNAUTHORIZED');
});
