#!/usr/bin/env node
/**
 * ROMS V1.0 - Phase 4A Local Deployment Preflight Check
 *
 * Validates frontend asset integrity, GitHub Pages subpath safety,
 * environment separation, GAS source completeness, appsscript.json,
 * and scans for accidental secrets or real production IDs.
 *
 * Usage: node scripts/preflight-check.js
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

function fail(msg) {
  console.error('PREFLIGHT FAIL:', msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log('OK:', msg);
}

function checkGitignore() {
  const gitignore = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
  const required = ['.env', 'backend/.clasp.json', 'frontend/js/config.js'];
  for (const item of required) {
    if (!gitignore.split(/\r?\n/).some((line) => line.trim() === item)) {
      fail(`.gitignore is missing required ignore rule: ${item}`);
    }
  }
  ok('.gitignore protects local secrets and clasp/config overrides');
}

function checkGitHubPagesWorkflow() {
  const wfPath = path.join(ROOT, '.github/workflows/deploy-pages.yml');
  if (!fs.existsSync(wfPath)) {
    fail('Missing .github/workflows/deploy-pages.yml');
    return;
  }
  const wf = fs.readFileSync(wfPath, 'utf8');
  if (!wf.includes('path: frontend')) {
    fail('.github/workflows/deploy-pages.yml must upload path: frontend');
    return;
  }
  ok('GitHub Pages workflow deploys frontend/ directory');
}

function checkFrontendAssetsAndEnv() {
  const indexPath = path.join(ROOT, 'frontend/index.html');
  const html = fs.readFileSync(indexPath, 'utf8');

  const assetRegex = /(?:src|href)=["']([^"']+)["']/g;
  const refs = [];
  let m;
  while ((m = assetRegex.exec(html)) !== null) {
    refs.push(m[1]);
  }

  if (refs.length === 0) {
    fail('No asset references found in frontend/index.html');
    return;
  }

  for (const ref of refs) {
    if (ref.startsWith('/') || /^[a-zA-Z]+:/.test(ref)) {
      fail(`Non-relative or external asset path in frontend/index.html: ${ref}`);
      continue;
    }
    const target = path.join(ROOT, 'frontend', ref);
    if (!fs.existsSync(target)) {
      fail(`Missing frontend asset referenced in index.html: ${ref}`);
    }
  }
  ok(`All ${refs.length} relative asset references in frontend/index.html exist on disk`);

  // Validate config.example.js + env.js in isolated VM
  const configCode = fs.readFileSync(path.join(ROOT, 'frontend/js/config.example.js'), 'utf8');
  const envCode = fs.readFileSync(path.join(ROOT, 'frontend/js/env.js'), 'utf8');
  const ctx = { window: {}, URL, URLSearchParams };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(configCode, ctx);
  vm.runInContext(envCode, ctx);

  if (!ctx.ROMS_CONFIG || !ctx.ROMS_CONFIG.ENVIRONMENTS) {
    fail('frontend/js/config.example.js must define ROMS_CONFIG.ENVIRONMENTS');
    return;
  }
  for (const envName of ['LOCAL', 'STAGING', 'PRODUCTION']) {
    const entry = ctx.ROMS_CONFIG.ENVIRONMENTS[envName];
    if (!entry || !entry.GAS_WEB_APP_URL) {
      fail(`ROMS_CONFIG.ENVIRONMENTS missing ${envName}`);
    } else if (!ctx.ROMS_ENV.isPlaceholderUrl(entry.GAS_WEB_APP_URL)) {
      fail(`ROMS_CONFIG.ENVIRONMENTS.${envName}.GAS_WEB_APP_URL must be a placeholder, not a real URL`);
    }
  }
  ok('Frontend config.example.js & env.js define isolated LOCAL/STAGING/PRODUCTION placeholders');
}

function checkGasBackend() {
  const manifestPath = path.join(ROOT, 'backend/src/appsscript.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.timeZone !== 'Asia/Ho_Chi_Minh') {
    fail(`appsscript.json timeZone must be Asia/Ho_Chi_Minh, got ${manifest.timeZone}`);
  }
  if (manifest.runtimeVersion !== 'V8') {
    fail(`appsscript.json runtimeVersion must be V8, got ${manifest.runtimeVersion}`);
  }
  if (!manifest.webapp || manifest.webapp.executeAs !== 'USER_DEPLOYING' || manifest.webapp.access !== 'ANYONE_ANONYMOUS') {
    fail('appsscript.json webapp must have executeAs=USER_DEPLOYING and access=ANYONE_ANONYMOUS');
  }

  const expectedGs = [
    'Config.gs',
    'Validation.gs',
    'DbSetup.gs',
    'PrinterService.gs',
    'Repository.gs',
    'OrderService.gs',
    'FloorService.gs',
    'PaymentAndLifecycleService.gs',
    'HistoryAndReportService.gs',
    'Code.gs',
  ];

  const fnLocations = new Map();
  for (const file of expectedGs) {
    const full = path.join(ROOT, 'backend/src', file);
    if (!fs.existsSync(full)) {
      fail(`Missing GAS source file: backend/src/${file}`);
      continue;
    }
    const content = fs.readFileSync(full, 'utf8');
    const fnRegex = /^function\s+([A-Za-z0-9_$]+)\s*\(/gm;
    let match;
    while ((match = fnRegex.exec(content)) !== null) {
      const fnName = match[1];
      if (fnLocations.has(fnName)) {
        fail(`Duplicate top-level GAS function "${fnName}" in ${fnLocations.get(fnName)} and ${file}`);
      } else {
        fnLocations.set(fnName, file);
      }
    }
  }

  const configContent = fs.readFileSync(path.join(ROOT, 'backend/src/Config.gs'), 'utf8');
  if (!configContent.includes('PRINTER_ENABLED: false')) {
    fail('backend/src/Config.gs must keep PRINTER_ENABLED: false');
  }
  ok(`GAS backend manifest and all ${expectedGs.length} .gs files validated (${fnLocations.size} unique top-level functions)`);
}

function scanForSecrets() {
  const dirsToScan = ['frontend', 'backend', 'scripts', '.github'];
  const secretPatterns = [
    { name: 'Real GAS Deployment URL', regex: /https:\/\/script\.google\.com\/macros\/s\/AKfycb[A-Za-z0-9_-]{10,}\/exec/ },
    { name: 'Google API Key', regex: /AIza[0-9A-Za-z_-]{30,}/ },
    { name: 'GitHub Token', regex: /gh[pousr]_[A-Za-z0-9]{20,}/ },
    { name: 'Private Key Block', regex: /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/ },
  ];

  function walk(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (/\.(js|gs|html|css|json|yml|yaml|md)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8');
        for (const pat of secretPatterns) {
          if (pat.regex.test(text)) {
            fail(`Potential ${pat.name} detected in ${path.relative(ROOT, full)}`);
          }
        }
      }
    }
  }

  for (const d of dirsToScan) {
    const fullDir = path.join(ROOT, d);
    if (fs.existsSync(fullDir)) walk(fullDir);
  }
  ok('Secret & production-ID scan passed (no real tokens or deployment IDs found)');
}

function checkJsSyntaxIndividually() {
  const jsDirs = ['frontend/js', 'scripts', 'tests'];
  let checked = 0;
  for (const dir of jsDirs) {
    const fullDir = path.join(ROOT, dir);
    if (!fs.existsSync(fullDir)) continue;
    const files = fs.readdirSync(fullDir).filter((f) => f.endsWith('.js')).sort();
    for (const file of files) {
      const target = path.join(fullDir, file);
      try {
        execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
        checked += 1;
      } catch (err) {
        fail(`JS syntax error in ${path.join(dir, file)}: ${(err.stderr || err.message || '').toString().trim()}`);
      }
    }
  }
  ok(`Individual JS syntax check passed for ${checked} files`);
}

function checkNoConflictingRootManifest() {
  if (fs.existsSync(path.join(ROOT, 'appsscript.json'))) {
    fail('Conflicting root appsscript.json detected; only backend/src/appsscript.json should exist');
    return;
  }
  ok('No conflicting root appsscript.json (canonical manifest: backend/src/appsscript.json)');
}

checkGitignore();
checkGitHubPagesWorkflow();
checkFrontendAssetsAndEnv();
checkGasBackend();
checkNoConflictingRootManifest();
checkJsSyntaxIndividually();
scanForSecrets();

if (process.exitCode && process.exitCode !== 0) {
  console.error('\nPreflight checks FAILED.');
  process.exit(process.exitCode);
}
console.log('\nAll Phase 4A preflight checks PASSED.');
