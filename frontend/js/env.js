/**
 * ROMS V1.0 - Explicit Environment Resolver (Phase 4A)
 *
 * Enforces strict separation between LOCAL, STAGING, and PRODUCTION.
 * - Fails closed on unknown environment names.
 * - Fails closed when the selected environment's GAS_WEB_APP_URL is missing or a placeholder.
 * - Never silently falls back from STAGING or LOCAL to PRODUCTION.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ROMS_ENV = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const ALLOWED_ENVS = ['LOCAL', 'STAGING', 'PRODUCTION'];

  function isPlaceholderUrl(url) {
    const raw = String(url || '').trim();
    if (!raw) return true;
    return raw.indexOf('REPLACE_WITH_') !== -1 || raw.indexOf('YOUR_') !== -1;
  }

  function isValidUrlForEnv(url, env) {
    const raw = String(url || '').trim();
    if (!raw || isPlaceholderUrl(raw)) return false;
    let parsed;
    try {
      parsed = new URL(raw);
    } catch (e) {
      return false;
    }
    if (parsed.protocol === 'https:') {
      return true;
    }
    if (env === 'LOCAL' && parsed.protocol === 'http:') {
      return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    }
    return false;
  }

  function readQueryEnv(globalObj) {
    try {
      const search = globalObj && globalObj.location && globalObj.location.search;
      if (!search) return '';
      const params = new URLSearchParams(search);
      return String(params.get('env') || '').trim();
    } catch (e) {
      return '';
    }
  }

  function resolveEnvironment(globalObj) {
    const g = globalObj || {};
    const runtimeCfg = g.ROMS_RUNTIME_CONFIG && typeof g.ROMS_RUNTIME_CONFIG === 'object' ? g.ROMS_RUNTIME_CONFIG : null;
    const staticCfg = g.ROMS_CONFIG && typeof g.ROMS_CONFIG === 'object' ? g.ROMS_CONFIG : null;

    const queryEnv = readQueryEnv(g);
    const configuredEnv = queryEnv || (runtimeCfg && runtimeCfg.ENV) || (staticCfg && staticCfg.ENV) || 'STAGING';
    const normalized = String(configuredEnv).trim().toUpperCase();

    if (ALLOWED_ENVS.indexOf(normalized) === -1) {
      return {
        env: normalized || 'UNKNOWN',
        valid: false,
        errorCode: 'INVALID_ENV',
        errorMessage: 'Môi trường không hợp lệ: "' + configuredEnv + '". Chỉ hỗ trợ LOCAL, STAGING, hoặc PRODUCTION.',
      };
    }

    return {
      env: normalized,
      valid: true,
      errorCode: null,
      errorMessage: '',
    };
  }

  function resolveConfig(globalObj) {
    const g = globalObj || {};
    const envInfo = resolveEnvironment(g);
    const storagePrefix = 'roms_' + envInfo.env.toLowerCase() + '_';

    if (!envInfo.valid) {
      return {
        env: envInfo.env,
        label: envInfo.env,
        valid: false,
        isConfigured: false,
        gasWebAppUrl: '',
        storagePrefix: storagePrefix,
        errorCode: envInfo.errorCode,
        errorMessage: envInfo.errorMessage,
      };
    }

    const runtimeCfg = g.ROMS_RUNTIME_CONFIG && typeof g.ROMS_RUNTIME_CONFIG === 'object' ? g.ROMS_RUNTIME_CONFIG : {};
    const staticCfg = g.ROMS_CONFIG && typeof g.ROMS_CONFIG === 'object' ? g.ROMS_CONFIG : {};
    const mergedEnvs = Object.assign({}, staticCfg.ENVIRONMENTS || {}, runtimeCfg.ENVIRONMENTS || {});
    const hasEnvMap = Object.keys(mergedEnvs).length > 0;

    let gasWebAppUrl = '';
    let label = envInfo.env;

    if (hasEnvMap) {
      const entry = mergedEnvs[envInfo.env];
      if (!entry || typeof entry !== 'object') {
        return {
          env: envInfo.env,
          label: envInfo.env,
          valid: true,
          isConfigured: false,
          gasWebAppUrl: '',
          storagePrefix: storagePrefix,
          errorCode: 'UNCONFIGURED',
          errorMessage: 'Chưa cấu hình môi trường ' + envInfo.env + ' trong ROMS_CONFIG.ENVIRONMENTS.',
        };
      }
      label = String(entry.label || envInfo.env);
      gasWebAppUrl = String(entry.GAS_WEB_APP_URL || '').trim();
    } else {
      gasWebAppUrl = String(runtimeCfg.GAS_WEB_APP_URL || staticCfg.GAS_WEB_APP_URL || '').trim();
    }

    const validUrl = isValidUrlForEnv(gasWebAppUrl, envInfo.env);
    return {
      env: envInfo.env,
      label: label,
      valid: true,
      isConfigured: validUrl,
      gasWebAppUrl: gasWebAppUrl,
      storagePrefix: storagePrefix,
      errorCode: validUrl ? null : 'UNCONFIGURED',
      errorMessage: validUrl
        ? ''
        : 'Chưa cấu hình URL của Google Apps Script Web App cho môi trường ' + envInfo.env + '.',
    };
  }

  return {
    ALLOWED_ENVS: ALLOWED_ENVS,
    isPlaceholderUrl: isPlaceholderUrl,
    isValidUrlForEnv: isValidUrlForEnv,
    resolveEnvironment: resolveEnvironment,
    resolveConfig: resolveConfig,
  };
});
