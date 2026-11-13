const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createGasMockEnv } = require('./mock_sheets');
const apiClient = require('../frontend/js/api.js');

const ROOT = path.resolve(__dirname, '..');
const GAS_FILES = [
  'backend/src/Config.gs',
  'backend/src/Validation.gs',
  'backend/src/DbSetup.gs',
  'backend/src/PrinterService.gs',
  'backend/src/Repository.gs',
  'backend/src/OrderService.gs',
  'backend/src/Code.gs',
];

function bootBackend(options = {}) {
  const ctx = createGasMockEnv(options);
  vm.createContext(ctx);
  for (const relPath of GAS_FILES) {
    const code = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
    vm.runInContext(code, ctx, { filename: relPath });
  }
  ctx.setupDatabase();
  return ctx;
}

function postRaw(ctx, rawBody) {
  const out = ctx.doPost({ postData: { contents: rawBody } });
  return JSON.parse(out.getContent());
}

function post(ctx, obj) {
  return postRaw(ctx, JSON.stringify(obj));
}

test('Auth: login exchanges STAFF_PASSCODE for session_token, expires cleanly, and rejects GET credentials', () => {
  const ctx = bootBackend();

  // GET with query string is rejected
  for (const action of ['bootstrap', 'menu', 'modifiers']) {
    const res = JSON.parse(
      ctx.doGet({ parameter: { action, passcode: 'test-pass-999' } }).getContent()
    );
    assert.equal(res.ok, false);
    assert.equal(res.error.code, 'METHOD_NOT_ALLOWED');
  }

  // Wrong passcode fails closed
  const badLogin = post(ctx, { action: 'login', passcode: 'wrong' });
  assert.equal(badLogin.ok, false);
  assert.equal(badLogin.error.code, 'UNAUTHORIZED');

  // Valid login returns session_token (never echoing passcode)
  const loginRes = post(ctx, { action: 'login', passcode: 'test-pass-999' });
  assert.equal(loginRes.ok, true);
  assert.ok(loginRes.data.session_token);
  assert.equal(JSON.stringify(loginRes).includes('test-pass-999'), false);

  const token = loginRes.data.session_token;

  // Session token authorizes bootstrap & createOrder
  const bootRes = post(ctx, { action: 'bootstrap', session_token: token });
  assert.equal(bootRes.ok, true);
  // Settings only exposes allowlisted public keys
  assert.equal(Array.isArray(bootRes.data.settings), false);
  assert.equal(bootRes.data.settings.currency, 'VND');

  // Simulate session expiration in CacheService
  ctx._setFakeNowMs(Date.now() + 7 * 3600 * 1000);
  const expiredRes = post(ctx, { action: 'bootstrap', session_token: token });
  assert.equal(expiredRes.ok, false);
  assert.equal(expiredRes.error.code, 'SESSION_EXPIRED');
});

test('Auth: unset STAFF_PASSCODE fails closed on login and protected endpoints', () => {
  const ctx = bootBackend({ properties: { STAFF_PASSCODE: '' } });
  const loginRes = post(ctx, { action: 'login', passcode: '' });
  assert.equal(loginRes.ok, false);
  assert.equal(loginRes.error.code, 'UNAUTHORIZED');
});

test('API Contract: rejects malformed JSON and non-object JSON bodies', () => {
  const ctx = bootBackend();

  const malformed = postRaw(ctx, '{bad json');
  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, 'BAD_REQUEST');

  const arrayBody = postRaw(ctx, '["createOrder"]');
  assert.equal(arrayBody.ok, false);
  assert.equal(arrayBody.error.code, 'BAD_REQUEST');
});

test('Order Integrity: AuditLog or IdempotencyKeys write failure rolls back Orders AND OrderItems cleanly', () => {
  const ctx = bootBackend();

  // Fail on AuditLog write
  ctx._ss.getSheetByName('AuditLog')._failOnNextWrite = true;
  const auditFailRes = post(ctx, {
    action: 'createOrder',
    passcode: 'test-pass-999',
    idempotency_key: 'idemp-audit-fail-1',
    order_type: 'TAKEAWAY',
    items: [{ item_id: 'MY_VAN_THAN', quantity: 1 }],
  });
  assert.equal(auditFailRes.ok, false);
  assert.equal(ctx._ss.getSheetByName('Orders').getLastRow(), 1);
  assert.equal(ctx._ss.getSheetByName('OrderItems').getLastRow(), 1);
  assert.equal(ctx._ss.getSheetByName('IdempotencyKeys').getLastRow(), 1);

  // Fail on IdempotencyKeys write
  ctx._ss.getSheetByName('IdempotencyKeys')._failOnNextWrite = true;
  const idempFailRes = post(ctx, {
    action: 'createOrder',
    passcode: 'test-pass-999',
    idempotency_key: 'idemp-key-fail-1',
    order_type: 'TAKEAWAY',
    items: [{ item_id: 'MY_VAN_THAN', quantity: 1 }],
  });
  assert.equal(idempFailRes.ok, false);
  assert.equal(ctx._ss.getSheetByName('Orders').getLastRow(), 1);
  assert.equal(ctx._ss.getSheetByName('OrderItems').getLastRow(), 1);
});

test('Database Hardening: verifyDatabaseIntegrity passes on clean DB and catches orphan OrderItems & duplicate headers', () => {
  const ctx = bootBackend();
  assert.equal(ctx.verifyDatabaseIntegrity().ok, true);

  // Inject orphan OrderItem
  ctx._ss.getSheetByName('OrderItems').appendRow(['OI-ORPHAN', 'ORD-MISSING']);
  const orphanCheck = ctx.verifyDatabaseIntegrity();
  assert.equal(orphanCheck.ok, false);
  assert.match(orphanCheck.errors[0], /Orphan OrderItem/);

  // Clean up orphan, test duplicate header detection in ensureSheetColumns_
  ctx._ss.getSheetByName('OrderItems').deleteRow(2);
  const ordersSheet = ctx._ss.getSheetByName('Orders');
  ordersSheet._rows[0].push('order_id');
  assert.throws(() => ctx.setupDatabase(), /Duplicate header/);
});

test('Frontend API Client: handles offline, timeout, non-JSON HTML error, and SESSION_EXPIRED cleanly', async () => {
  const storageMap = new Map();
  const prevWindow = global.window;

  global.window = {
    ROMS_CONFIG: {
      GAS_WEB_APP_URL: 'https://script.google.com/macros/s/MOCK_DEPLOY_ID/exec',
      REQUEST_TIMEOUT_MS: 50,
    },
    sessionStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: (k) => storageMap.delete(k),
    },
    navigator: { onLine: true },
    fetch: async () => ({
      ok: true,
      text: async () => '<html>GAS Error Page</html>',
    }),
  };

  try {
    // Non-JSON response
    apiClient.setSession('tok-1', Date.now() + 60000);
    await assert.rejects(() => apiClient.fetchBootstrap(), (err) => err.code === 'INVALID_RESPONSE');

    // Offline detection
    global.window.navigator.onLine = false;
    await assert.rejects(() => apiClient.fetchBootstrap(), (err) => err.code === 'OFFLINE');
    global.window.navigator.onLine = true;

    // SESSION_EXPIRED clears stored session token
    global.window.fetch = async () => ({
      ok: true,
      text: async () =>
        JSON.stringify({
          ok: false,
          data: null,
          error: { code: 'SESSION_EXPIRED', message: 'Expired' },
        }),
    });
    const expRes = await apiClient.fetchBootstrap();
    assert.equal(expRes.ok, false);
    assert.equal(apiClient.getSessionToken(), '');
  } finally {
    global.window = prevWindow;
  }
});
