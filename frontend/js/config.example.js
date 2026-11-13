/**
 * ROMS V1.0 - Frontend Production Configuration
 *
 * Configured for PRODUCTION deployment on GitHub Pages.
 * - ENV is set to 'PRODUCTION' with the Production GAS Web App URL.
 * - LOCAL and STAGING remain unconfigured placeholders (no fallback to Staging or Local).
 *
 * SECURITY:
 * - Never put STAFF_PASSCODE, session tokens, API keys, or Google Sheet IDs here.
 * - GAS Web App URLs are public endpoints; authentication is enforced server-side.
 */
window.ROMS_CONFIG = {
  APP_NAME: 'ROMS V1.0',
  ENV: 'PRODUCTION',
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
      GAS_WEB_APP_URL:
        'https://script.google.com/macros/s/AKfycbzU29on_Ob71j5J4iLoiJVSuVW3EkX3wO982HxHVZZVJZEIoqIk3fuo1nOQw_Y8v7c_JQ/exec',
    },
  },
};
