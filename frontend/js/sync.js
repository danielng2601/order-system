/**
 * ROMS V1.0 - Multi-Device Polling Synchronization Manager (Phase 2)
 * Uses lightweight syncStatus polling (not real-time WebSockets) compatible with
 * GitHub Pages + Google Apps Script.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.ROMS_SYNC = factory();
  }
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  function createSyncManager(options) {
    const opts = options || {};
    const apiClient = opts.apiClient;
    const pollIntervalMs = Number(opts.pollIntervalMs || 15000);
    const onRemoteChange = typeof opts.onRemoteChange === 'function' ? opts.onRemoteChange : function () {};
    const onStatusChange = typeof opts.onStatusChange === 'function' ? opts.onStatusChange : function () {};

    let currentRevision = Number(opts.initialRevision || 0);
    let lastSyncAt = null;
    let isOnline = typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
    let isPaused = false;
    let timerId = null;
    let inFlight = false;

    function notifyStatus() {
      onStatusChange({
        currentRevision: currentRevision,
        lastSyncAt: lastSyncAt,
        isOnline: isOnline,
        isPaused: isPaused,
      });
    }

    function setRevision(rev) {
      const n = Number(rev);
      if (Number.isInteger(n) && n >= 0) {
        currentRevision = n;
        lastSyncAt = new Date();
        notifyStatus();
      }
    }

    async function pollOnce() {
      if (inFlight || isPaused || !isOnline) {
        return { skipped: true };
      }
      if (!apiClient || !apiClient.getSessionToken || !apiClient.getSessionToken()) {
        return { skipped: true };
      }

      inFlight = true;
      try {
        const res = await apiClient.syncStatus();
        if (res && res.ok && res.data) {
          const remoteRev = Number(res.data.syncRevision || 0);
          lastSyncAt = new Date();
          isOnline = true;
          const changed = remoteRev > currentRevision;
          if (changed) {
            currentRevision = remoteRev;
            notifyStatus();
            await onRemoteChange(remoteRev);
          } else {
            notifyStatus();
          }
          return { ok: true, changed: changed, syncRevision: remoteRev };
        }
        return { ok: false };
      } catch (err) {
        if (err && err.code === 'OFFLINE') {
          isOnline = false;
        }
        notifyStatus();
        return { ok: false, error: err };
      } finally {
        inFlight = false;
      }
    }

    function start() {
      stop();
      timerId = setInterval(function () {
        pollOnce();
      }, pollIntervalMs);
    }

    function stop() {
      if (timerId) {
        clearInterval(timerId);
        timerId = null;
      }
    }

    function setPaused(paused) {
      isPaused = Boolean(paused);
      notifyStatus();
      if (!isPaused && isOnline) {
        pollOnce();
      }
    }

    function setOnline(online) {
      const wasOffline = !isOnline;
      isOnline = Boolean(online);
      notifyStatus();
      if (wasOffline && isOnline && !isPaused) {
        pollOnce();
      }
    }

    function getState() {
      return {
        currentRevision: currentRevision,
        lastSyncAt: lastSyncAt,
        isOnline: isOnline,
        isPaused: isPaused,
      };
    }

    return {
      setRevision: setRevision,
      pollOnce: pollOnce,
      start: start,
      stop: stop,
      setPaused: setPaused,
      setOnline: setOnline,
      getState: getState,
    };
  }

  return { createSyncManager: createSyncManager };
});
