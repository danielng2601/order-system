# Multi-Device Synchronization — ROMS V1.0

## Architecture (Lightweight Polling, Not WebSockets)
Because the system runs on **GitHub Pages (static)** + **Google Apps Script Web App**, real-time WebSocket push is not supported. Instead, ROMS uses a lightweight revision-based polling strategy:

1. **Monotonic Revision Cursor (`Settings.SyncRevision`):** Incremented atomically inside `ScriptLock` on every mutating write (`createOrder`, `addItemsToOrder`, `moveOrderItem`, `mergeOrders`, `splitOrder`).
2. **Lightweight Poll (`POST { action: "syncStatus" }`):** `frontend/js/sync.js` polls every 15 seconds while the browser tab is active (`!document.hidden`) and online.
3. **Conditional Refresh:** Only when `remoteSyncRevision > currentRevision` does the client refresh `getFloorState`, `listActiveOrders`, or an open `getOrderDetail` modal.
4. **Cart Safety:** Background sync refreshes **never** overwrite unsaved items in the user's local cart.
5. **Optimistic Concurrency (`version`):** Every order mutation sends `expected_version`. If another device modified the order first, GAS returns `VERSION_CONFLICT` with `latestOrder` so the user can reload safely without silent overwrites.

## Known Sync Latency & Limitations
- Typical propagation delay between devices is **up to 15 seconds** (or immediate on manual **Đồng bộ** click or tab focus).
- Background tabs pause polling to conserve GAS quotas and resume immediately when focused.
