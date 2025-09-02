# Milestone 1 – Local Database & IPC Test Panel

## Overview

This milestone introduces a **persistent local database** (SQLite) and wires it into Electron via IPC. It establishes the **foundation for scoring and persistence**, ensures schema migrations are applied automatically, and provides a debug panel in the renderer so users can verify points increment and persist across restarts.

---

## Key Additions

- **SQLite Integration**
  - Added [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) to `@loot/electron-main`.
  - `db/index.ts` manages a single shared connection with **WAL mode** + **foreign key enforcement**.

- **Migration Runner**
  - `db/migrate.ts` applies all `.sql` migrations in order.
  - Ensures `_migrations` table exists and records applied IDs.
  - `0001_initial.sql` creates **users**, **transactions**, **rules**, **overrides**, **rewards**, **challenges**, **prefs**, and **settings** tables.

- **Database Queries**
  - `db/queries.ts`:
    - `getBalance()` → returns sum of non-voided transactions.
    - `insertTestTransaction(amount)` → inserts a manual transaction row.

- **IPC Bridge**
  - `ipc.ts`: registers `db:getBalance` and `db:insertTest` with `ipcMain.handle`.
  - `preload.ts`: exposes `window.lootDb.getBalance()` and `window.lootDb.insertTest()` in the renderer sandbox.

- **Electron Main Process**
  - `main.ts`:
    - Boots DB (`openDb → runMigrations → registerDbIpc`).
    - Creates `BrowserWindow` with `preload.js`.
    - Loads Vite dev server (dev only).
    - Wrapped DB boot in try/catch for resilience.

- **Renderer Test Panel**
  - `main.tsx`:
    - Displays current **balance**.
    - **Insert +1** button triggers IPC call and refreshes balance.
    - Balance persists across restarts (proves DB working).

---

## Acceptance Criteria

- On app launch, `0001_initial.sql` migrations apply automatically.
- Clicking **Insert +1 test transaction**:
  - Inserts a new row into `transactions`.
  - Updates balance immediately in the UI.

- Quitting & relaunching the app shows the updated balance (persistence verified).
- `window.lootDb` is available in the renderer via preload.

---

## Files Edited

- **Electron Main**
  - `packages/electron-main/package.json` → scripts for build/start, added SQLite dep, copy migrations in build.
  - `packages/electron-main/src/main.ts` → preload wiring, DB boot, BrowserWindow setup, error handling.
  - `packages/electron-main/tsconfig.json` → ensure `noEmit:false`, emit to `dist`.

- **Renderer**
  - `packages/renderer/src/main.tsx` → replaced placeholder with “M1 Test Panel” (balance + button).

---

## Files Added

- **Electron Main**
  - `packages/electron-main/src/preload.ts`
  - `packages/electron-main/src/ipc.ts`
  - `packages/electron-main/src/db/index.ts`
  - `packages/electron-main/src/db/migrate.ts`
  - `packages/electron-main/src/db/queries.ts`
  - `packages/electron-main/src/db/migrations/0001_initial.sql` (and later `0002_*.sql`)

---

✅ With M1 complete, Loot Ledger now has a working local database with migrations, IPC bridge, and a test panel. Balance updates persist across restarts, proving the foundation is solid, even though advanced scoring logic will only arrive in later milestones.

---

# Milestone 2 – TickTick OAuth (Cloudflare Proxy) & Sync Stub

## Overview

This milestone introduces a **secure TickTick login flow** using OAuth 2.0 with PKCE. It avoids shipping secrets by delegating token exchange to a **Cloudflare Worker proxy**, stores tokens in the OS keychain, and adds a **TickTick panel** in the renderer for signing in/out and testing sync. While sync logic itself is not yet implemented, the scaffolding is complete.

---

## Key Additions

- **Cloudflare Worker Token Proxy**
  - Deployed under `infra/ticktick-proxy` with Wrangler.
  - Exposes `/oauth/token` endpoint.
  - Injects `client_id` + `client_secret` via Basic Auth (from Worker secrets).
  - Forwards original OAuth code exchange to TickTick’s API.
  - Returns tokens to the desktop app but stores nothing.

- **Loopback OAuth Flow**
  - `loopback.ts` runs a temporary HTTP server on `127.0.0.1:8802`.
  - Catches `/oauth/callback` with the authorization `code`.
  - Displays “Login complete. You can close this window.”

- **Auth Module**
  - `ticktick.ts`: builds the authorize URL (PKCE), calls proxy for token exchange & refresh.
  - `index.ts`: orchestrates flow:
    - `startAuthFlow()` opens system browser, waits for callback, exchanges code, saves tokens.
    - `getValidAccessToken()` refreshes tokens if expired.
    - `logout()` clears tokens and resets status.
    - `authStatus()` reports `signed_in`, `signed_out`, or `error`.

- **Secure Token Storage**
  - `keychain.ts` uses [`keytar`](https://github.com/atom/node-keytar).
  - Stores `access_token`, `refresh_token`, and `expires_at` in the OS keychain.

- **Database App State**
  - New migration `0003_oauth_and_sync_state.sql` adds `app_state` key–value store.
  - Tracks `auth_status`, `last_sync_at`, `sync_enabled`, and `sync_backoff_ms`.

- **IPC Bridge**
  - `ipc.ts` wires:
    - `auth:start`, `auth:status`, `auth:logout`.
    - `sync:now`, `sync:getStatus`.

  - Exposed in preload as `window.oauth.*` and `window.sync.*`.

- **Renderer Test Panel**
  - Extends test UI with **TickTick panel**:
    - Shows **status** (`signed_in`, `signed_out`, or `error`).
    - Buttons: **Connect TickTick**, **Logout**, **Sync now** (stub).
    - Displays **Last Sync** (from `app_state.last_sync_at`).

---

## Acceptance Criteria

- Clicking **Connect TickTick**:
  - Opens system browser to TickTick authorize screen.
  - User grants access; loopback server receives code.
  - Tokens are stored in keychain.
  - UI updates to **signed_in** without restarting.

- Clicking **Logout**:
  - Clears tokens from keychain.
  - UI updates to **signed_out** immediately.

- **Sync now** button calls into the sync stub, returning gracefully (no crash).
- Auth status and last sync timestamp are visible in the renderer panel.

---

## Files Edited

- **Electron Main**
  - `packages/electron-main/package.json` → add `keytar`, `dotenv`; update scripts.
  - `packages/electron-main/src/main.ts` → load `.env.local`, register auth/sync IPC.
  - `packages/electron-main/src/ipc.ts` → add `auth:*` and `sync:*` channels.

- **Renderer**
  - `packages/renderer/src/main.tsx` → extend UI with TickTick panel (status + buttons).

---

## Files Added

- **Electron Main**
  - `packages/electron-main/src/auth/index.ts`
  - `packages/electron-main/src/auth/ticktick.ts`
  - `packages/electron-main/src/auth/loopback.ts`
  - `packages/electron-main/src/auth/keychain.ts`
  - `packages/electron-main/src/auth/pkce.ts`
  - `packages/electron-main/src/db/migrations/0003_oauth_and_sync_state.sql`

- **Cloudflare Worker**
  - `infra/ticktick-proxy/src/index.ts` → proxy handler
  - `infra/ticktick-proxy/wrangler.jsonc` (or `wrangler.toml`) → Worker config

---

✅ With M2 complete, Loot Ledger now has a secure TickTick login flow backed by a Cloudflare proxy, persistent token storage in the keychain, and a test panel for connecting, disconnecting, and stubbing sync. The scaffolding for synchronization is in place, proving the foundation is solid, even though real task polling will only arrive in the next milestone.

---

# Milestone 3 – TickTick Sync

## Overview

This milestone connects Loot Ledger to the **TickTick Open API**, turning the **Sync now** button into a real data flow. Completed tasks in TickTick are pulled, normalized, and written to the local SQLite ledger. A background poller keeps the database up to date, and IPC bridges ensure the renderer UI updates instantly.

---

## Key Additions

- **TickTick API Client**
  - `sync/ticktickClient.ts`:
    - `listChanges(sinceMs)` → fetches projects and completed tasks from TickTick’s Open API.
    - Normalizes into typed `TickTickChange` objects: `{ id, title, tags, projectId, due_ts, completed_ts, is_recurring, series_key }`.

- **Sync Worker**
  - `sync/index.ts`:
    - `runOnce()`:
      - Validates access token via `getValidAccessToken()`.
      - Reads `last_sync_at` from app state.
      - Calls `ticktickClient.listChanges(since)`.
      - Converts to transactions (`toTransactions`).
      - Inserts into SQLite with `insertTransaction()`.
      - Updates `last_sync_at` and resets backoff on success.

    - On errors: computes next backoff, stores it, and emits a failure status.
    - `startScheduler()` runs `runOnce()` periodically with backoff logic.

- **IPC Bridge**
  - `ipc.ts`:
    - Registers `sync:now` and `sync:getStatus`.
    - Subscribes to `syncEvents` and broadcasts `sync:status` to all windows.

  - `preload.ts`:
    - Exposes `window.sync.now()`, `window.sync.getStatus()`, and `window.sync.onStatus(cb)` in the renderer sandbox.
    - Exposes `window.oauth.onStatusChanged(cb)` for live auth updates.

- **Auth Integration**
  - `auth/index.ts`:
    - Added `broadcastAuthStatus()` calls in login, error, and logout paths.
    - All windows receive `auth:statusChanged` events immediately.

- **Renderer Updates**
  - `main.tsx`:
    - Subscribes to `sync.onStatus` → updates **Last Sync** and refreshes balance when sync finishes.
    - Subscribes to `oauth.onStatusChanged` → flips auth state in real time.
    - “Sync now” button now runs the full pipeline.

---

## Acceptance Criteria

- Clicking **Sync now**:
  - Pulls TickTick completions since `last_sync_at`.
  - Inserts them into SQLite as transactions.
  - Updates `last_sync_at`.
  - Emits a `sync:status` event → renderer updates **Last Sync**.

- Background poller keeps completions up to date on a schedule, with backoff on errors.
- Auth connect/logout propagates instantly to the UI.

---

## Files Edited

- **Electron Main**
  - `src/sync/ticktickClient.ts`
  - `src/sync/index.ts`
  - `src/auth/index.ts`
  - `src/ipc.ts`
  - `src/preload.ts`

- **Renderer**
  - `src/main.tsx`

---

## Files Added

- **Electron Main**
  - `src/sync/state.ts` (backoff tracking)
  - `src/sync/rules.ts` (transaction conversion scaffolding)

---

✅ With M3 complete, Loot Ledger now has **real data flow from TickTick into the local ledger**. Balance may still stay flat until rules are added in M4, but sync and state updates are fully functional.

---
