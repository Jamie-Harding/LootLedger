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

This milestone connects Loot Ledger to the **TickTick Open API**, turning the **Sync now** button into a working data pipeline. Both open and completed tasks are mirrored into the local SQLite ledger, with a poller that keeps everything up to date. The system handles completions, revocations, and rollovers, while preserving a debug view of recent completions.

---

## Key Additions

- **TickTick API Client**
  - `sync/ticktickClient.ts`:
    - `listOpenTasks()` → paginated Open API fetch of active tasks (status: 0).
    - `getTaskByProjectAndId(projectId, taskId)` → verifies whether a disappeared task was actually completed, revoked, or deleted.
    - `listProjects()` → resolves project IDs/names for verification.
    - All responses normalized into strict `TickTask` objects.

- **Completion Detection**
  - `sync/index.ts`:
    - Tracks **previous vs current open tasks**.
    - Disappeared tasks are cross-checked with `getTaskByProjectAndId`:
      - `status: 2` → verified completion.
      - `status: 0` → revoked (task re-opened).
      - 404 → deleted (ignored).

    - Verified completions upserted into `completed_tasks` mirror table.
    - Revocations remove entries so a task can later be completed again.

- **Sync Worker**
  - `runOnce()`:
    - Gets a fresh access token from auth.
    - Loads `last_sync_at` from app state.
    - Fetches open tasks and detects completions/disappearances.
    - Classifies disappeared tasks (completed / revoked / deleted).
    - Inserts new completions into SQLite, removes revoked ones.
    - Updates `last_sync_at` on success.

  - `startScheduler()` runs `runOnce()` on a 2–5 minute interval with backoff on errors.

- **IPC Bridge**
  - `ipc.ts`:
    - Exposes `sync:now`, `sync:getStatus`, and `completions:recent`.
    - Renderer can request recent completions and open tasks directly.

  - `preload.ts`:
    - Exposes `window.sync` helpers in the renderer.
    - Exposes `window.completions.recent(limit)` for debug panel.

- **Renderer Debug Panel**
  - `main.tsx`:
    - Displays **Recent Completions** table (title, tags, due date, completed time).
    - Updates instantly after sync finishes.
    - Shows revocations correctly (items drop off when un-completed).

- **Auth Integration**
  - `auth/index.ts`:
    - Emits `auth:statusChanged` whenever tokens are refreshed, invalidated, or cleared.

---

## Acceptance Criteria

- Clicking **Sync now**:
  - Mirrors all open tasks into the DB.
  - Detects completions since the last sync.
  - Verified completions inserted into `completed_tasks`.
  - Revoked tasks are removed from `completed_tasks`.
  - Updates `last_sync_at`.
  - Emits a `sync:status` event → renderer updates **Last Sync** and refreshes debug panels.

- Background poller:
  - Runs on schedule, with backoff on errors.
  - Keeps both open and recently completed tasks accurate.
  - Never double-counts the same completion (seen set includes taskId + completedTime).

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
  - `src/sync/ticktickDate.ts` (parsing helpers for TickTick ISO dates)
  - `src/sync/rules.ts` (scaffolding for M4 rule evaluation)
  - `src/sync/state.ts` (backoff and last_sync tracking)

---

✅ With M3 complete, Loot Ledger now has **real two-way mirroring of open and completed tasks** from TickTick. Recent Completions update live (including revocations), Open Tasks stay in sync, and the groundwork is laid for M4’s scoring rules.

---

# Milestone 4 – Rule Engine & Tag Priority

## Overview

This milestone introduces **scoring logic** into Loot Ledger. When TickTick tasks sync in, they are no longer just mirrored — they are **evaluated against user-defined rules**. Rules determine how many points each completion is worth, with support for exclusives, additives, multipliers, and global tag priority. Evaluations now write spec-shaped metadata into the ledger, so completing tasks in TickTick directly impacts the balance.

---

## Key Additions

- **Evaluator Function**
  - `rewards/evaluator.ts`:
    - Implements `evaluateTask(context, rules, tagPriority)`.
    - Correct order:
      1. Override (stubbed, wired fully in M6).
      2. Highest-priority Exclusive base chosen (global tag order resolves conflicts).
      3. Additives summed (can be negative).
      4. Multipliers applied as a product.
      5. Round final once at end.

    - Scopes supported in M4:
      `tag`, `list`, `project`, `title_regex` (with `(?i)` prefix tolerance).
      _(Date-based scopes like weekday, time_range, and deadline are deferred to M5.)_
    - Returns typed breakdown:

      ```ts
      {
        pointsPrePenalty: number
        baseSource: 'override' | 'exclusive' | 'none'
        exclusiveRuleId?: string
        additiveRuleIds: string[]
        multiplierRuleIds: string[]
        additiveSum: number
        multiplierProduct: number
      }
      ```

- **Sync Integration**
  - `sync/index.ts`:
    - Converts synced TickTick completions into `TaskContext`.
    - Calls `evaluateTask()` with rules + global tag priority.
    - Creates a transaction row per task with `TaskTransactionMetaV1` stored in `metadata`.
    - Updated to use `pointsPrePenalty` instead of legacy `finalRounded`.

- **Database & Queries**
  - `db/migrations/0004_rules_and_settings.sql` / `0005_settings_normalize.sql`:
    - Adds `rules` table and `settings` (normalized key/json).
    - Seeds default `tag_priority` array.

  - `db/queries.ts`:
    - Adds CRUD for rules.
    - Adds `getTagPriority()` / `setTagPriority()`.
    - Normalizes DB rows into evaluator `Rule` shape.

- **IPC Bridge**
  - `ipc/rules.ts`: CRUD + `rules:test` endpoints. Returns `EvalBreakdown` directly. Normalizes DB scopes (e.g. `title` → `title_regex`).
  - `preload.ts`: exposes `window.rules` API (list/create/update/remove/reorder/getTagPriority/setTagPriority/test).
  - `ipc.ts`: wires `registerRulesIpc()` alongside sync/auth/db IPC.

- **Renderer UI**
  - `main.tsx`:
    - **RulesPanel**: lists rules, enable/disable, delete, quick-add, reorder with ↑/↓. Inline editor planned for M11.
    - **RuleTester**: textarea for mock TaskContext JSON → runs evaluator via IPC → shows `EvalBreakdown`.

- **Typing/Lint**
  - Shared `types.ts` defines `RuleDTO`, `TaskContext`, `EvalBreakdown`, `TaskTransactionMetaV1`.
  - Evaluator and sync updated to import/re-export rather than redefine.
  - All `any` removed.

---

## Acceptance Criteria

- ✅ Two exclusives match → higher-priority tag wins.
- ✅ No exclusive → result = sum(additives) × product(multipliers).
- ✅ Negative additives reduce score.
- ✅ Multipliers apply after subtotal, with one round at the end.
- ✅ Transactions written with spec-shaped evaluation metadata.
- ✅ Rules UI: list, enable/disable, delete, reorder.
- ✅ Rule Tester panel in renderer shows real breakdown.
- ⬜ Tag priority drag-order UI (backend helpers exist; front-end deferred to M11).
- ⬜ Override logic (stub only; full in M6).
- ⬜ Date-based scopes (`weekday`, `time_range`, `deadline`) deferred to M5.

---

## Files Edited

- **Electron Main**
  - `src/rewards/evaluator.ts`
  - `src/rewards/types.ts`
  - `src/sync/index.ts`
  - `src/db/queries.ts`
  - `src/ipc.ts`
  - `src/preload.ts`
  - `src/ipc/rules.ts`

- **Renderer**
  - `src/main.tsx` (RulesPanel + RuleTester)

---

## Files Added

- **Electron Main**
  - `src/rewards/types.ts` (canonical types)
  - `src/ipc/rules.ts` (new IPC endpoints for rules CRUD + tester)

---

✅ With M4 complete, Loot Ledger now **evaluates TickTick completions into point transactions** using rules and tag priority. The backend evaluator and a basic Rules/Test UI are functional. Override logic, tag-priority drag UI, and all date-based scopes are deferred, but scoring logic, persistence, and test flow are working end-to-end.

---
