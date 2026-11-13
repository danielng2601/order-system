/**
 * ROMS V1.0 - Phase 0 Application Shell
 * Provides connection diagnostics and runtime configuration for staff testing.
 */
(function (global, document) {
  'use strict';

  function formatVnd(amount) {
    return new Intl.NumberFormat('vi-VN').format(Number(amount || 0)) + ' VND';
  }

  function setStatus(el, text, level) {
    if (!el) return;
    el.textContent = text;
    el.className = 'status-badge status-' + (level || 'neutral');
  }

  function init() {
    const apiUrlInput = document.getElementById('gas-url-input');
    const passcodeInput = document.getElementById('staff-passcode-input');
    const saveBtn = document.getElementById('save-config-btn');
    const healthBtn = document.getElementById('check-health-btn');
    const healthOutput = document.getElementById('health-output');
    const healthBadge = document.getElementById('health-badge');

    if (apiUrlInput) {
      apiUrlInput.value = global.ROMS_API.getApiUrl();
    }
    if (passcodeInput) {
      passcodeInput.value = global.ROMS_API.getPasscode();
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', function () {
        if (apiUrlInput) global.ROMS_API.setApiUrl(apiUrlInput.value);
        if (passcodeInput) global.ROMS_API.setPasscode(passcodeInput.value);
        setStatus(healthBadge, 'Saved to session', 'info');
      });
    }

    if (healthBtn) {
      healthBtn.addEventListener('click', async function () {
        setStatus(healthBadge, 'Checking...', 'info');
        if (healthOutput) healthOutput.textContent = 'Connecting to GAS Web App...';
        try {
          const result = await global.ROMS_API.checkHealth();
          if (result && result.ok) {
            setStatus(healthBadge, 'Connected', 'ok');
          } else {
            setStatus(healthBadge, 'Error', 'error');
          }
          if (healthOutput) {
            healthOutput.textContent = JSON.stringify(result, null, 2);
          }
        } catch (err) {
          setStatus(healthBadge, 'Offline / Unconfigured', 'error');
          if (healthOutput) {
            healthOutput.textContent = err.message || String(err);
          }
        }
      });
    }
  }

  global.ROMS_FORMAT = { formatVnd: formatVnd };
  document.addEventListener('DOMContentLoaded', init);
})(window, document);
