/**
 * ROMS V1.0 - Frontend Configuration Example (Environment-Separated)
 *
 * Copy this file to `frontend/js/config.js` (gitignored) for local overrides,
 * or configure `window.ROMS_RUNTIME_CONFIG` before loading `env.js` and `api.js`.
 *
 * SECURITY:
 * - Never put STAFF_PASSCODE, session tokens, API keys, or Google Sheet IDs here.
 * - GAS Web App URLs are public endpoints; authentication is enforced server-side.
 * - Never fall back from STAGING or LOCAL to PRODUCTION.
 */
window.ROMS_CONFIG = {
  APP_NAME: 'ROMS V1.0',
  ENV: 'STAGING',
  REQUEST_TIMEOUT_MS: 15000,
  CURRENCY: 'VND',
  TIMEZONE: 'Asia/Ho_Chi_Minh',
  ENVIRONMENTS: {
    LOCAL: {
      label: 'LOCAL',
      GAS_WEB_APP_URL: 'https://script.google.com/macros/s/REPLACE_WITH_LOCAL_DEPLOYMENT_ID/exec',
    },
    STAGING: {
      label: 'STAGING',
      GAS_WEB_APP_URL: 'https://script.google.com/macros/s/REPLACE_WITH_STAGING_DEPLOYMENT_ID/exec',
    },
    PRODUCTION: {
      label: 'PRODUCTION',
      GAS_WEB_APP_URL: 'https://script.google.com/macros/s/REPLACE_WITH_PROD_DEPLOYMENT_ID/exec',
    },
  },
};
