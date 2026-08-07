# MCP standard Tasks lifecycle — convergence design (Slice 4 / BI-4)

| Field | Value |
|-------|-------|
| **Status** | **DRAFT design — pre-filing, pre-implementation.** Carries unresolved decisions that MUST be kernel-routed (`dpf-decision-via-kernel`) before an implementation plan is written. |
| **Date** | 2026-08-06 |
| **Author** | Claude Code for Mark Bodman |
| **Parent** | [MCP `2025-11-25` + A2A adoption assessment](2026-08-06-mcp-2025-11-25-and-a2a-feature-adoption-design.md) · [phased plan](../plans/2026-08-06-mcp-2025-11-25-a2a-adoption.md) Slice 4 |
| **Backlog** | **Unfiled** (backlog MCP unreachable in this web session). This design precedes the BI; once BI-4 is filed, its implementation plan hangs off it. |
| **Blast radius** | **HIGH** — the MCP transport is the coordination plane (AGENTS.md §12) and this changes long-running task execution semantics. Why this is a design, not a same-session patch. |

## 1. Problem & current state (verified substrate)

DPF exposes a **bespoke, non-standard** `tasks/submit` JSON-RPC method (`apps/web/app/api/mcp/v1/route.ts:664` → `handleTasksSubmit` `:369` → `submitRemoteCoworkerTask`, `apps/web/lib/mcp-task-submit.ts`). Verified behavior:

- **Execution is synchronous for `read` / `bounded-write`** — `submitRemoteCoworkerTask` runs `executeAutonomousAgenticLoop` inline and returns `completed`/`failed` in the same HTTP response (`mcp-task-submit.ts:228-282`). Only `high-risk` returns early as `input-required` for approval (`:184-208`). A long autonomous run therefore blocks the request instead of being polled.
- **No standard task surface** — there is no `tasks/get`, `tasks/result`, `tasks/list`, or `tasks/cancel`; no `tasks` capability is declared (`route.ts:396-398` advertises only `tools`); `tools/call` cannot be task-augmented.
- **The durable substrate already exists and is A2A-aligned.** `TaskRun` (`packages/db/prisma/schema.prisma:7708`) has a unique `taskRunId`, `userId` (auth-context binding), A2A-aligned `status` (`submitted|working|input-required|auth-required|completed|failed|canceled|rejected|archived`), `a2aMetadata` (JSON; already stores `idempotencyKey`), `progressPayload`, `completedAt`, `lastHeartbeatAt`, and relations `artifacts`/`messages`. Idempotent replay is keyed on `a2aMetadata.idempotencyKey` (`mcp-task-submit.ts:110-139`).
- **Background execution infra exists** — `apps/web/lib/queue/functions/` (queue functions) and `createAutonomousWorkRun` already separate run *creation* from *execution*; exact wiring for a background executor is a substrate item to confirm at implementation.

So the opportunity is not net-new plumbing — it is to **project the standard MCP Tasks lifecycle onto the existing `TaskRun` substrate** and converge the bespoke method, so any MCP client can create, poll, retrieve, list, and cancel durable DPF work.

## 2. Research & Benchmarking (AGENTS.md §7)

**Standard MCP Tasks (`2025-11-25`, experimental — `docs/Reference/mcp/spec/basic/utilities/tasks.mdx`).** Requestor-driven, receiver-executed. Receiver declares a `tasks` capability (`list`, `cancel`, `requests.tools.call`). A task-augmented `tools/call` (request carries `params.task.ttl`) returns a `CreateTaskResult` immediately (`taskId`, `status:working`, `createdAt`, `lastUpdatedAt`, `ttl`, `pollInterval`); the real result comes later via `tasks/result` (blocks to terminal). Poll via `tasks/get`; enumerate via paginated `tasks/list`; stop via `tasks/cancel`. Per-tool opt-in via `execution.taskSupport` (`required|optional|forbidden`). Task states: `working → input_required|completed|failed|cancelled`. Security MUSTs: bind tasks to auth context; reject cross-context `get`/`result`/`cancel`; `tasks/list` returns only the requestor's tasks; enforce TTL, rate limits, cleanup.

**Benchmarks / verdicts:**

| Option | Verdict | Why |
|--------|---------|-----|
| Adopt the standard `tasks` surface over `TaskRun` | **Adopt** | The substrate is already durable and A2A-aligned; this is a projection, matching the assessment's Slice 4 and the adopt-standards kernel principle. |
| Swap in `@modelcontextprotocol/sdk` task machinery | **Reject** | DPF's transport is hand-rolled through `governedExecuteTool`; the SDK would fork governance and the frozen tool-name contract (parent spec §1.2). Adopt the wire shape, not the library. |
| Delete `tasks/submit` and replace outright | **Reject (now)** | External callers depend on it; converge behind a flag and deprecate on a timeline (§5). |
| Treat MCP tasks as ephemeral (delete on TTL) | **Defer to kernel** | Collides with DPF's audit doctrine that `TaskRun` is a durable business/BI record — Decision D1. |

**A2A alignment.** `TaskRun.status` already uses A2A task vocabulary; the ops-map projects these as edges. The only mismatch is spelling (`input-required`/`canceled` in DPF vs `input_required`/`cancelled` in the MCP spec) — handled by a boundary adapter (§3), leaving the internal enum (which the ops map and other consumers read) untouched.

## 3. Target design

- **Capability:** advertise `tasks: { list: {}, cancel: {}, requests: { tools: { call: {} } } }` in `initialize` (only when negotiated version ≥ `2025-11-25`).
- **taskId = `TaskRun.taskRunId`** (already unique, receiver-generated). No new id space.
- **Auth-context binding (security MUST):** every `tasks/get|result|cancel` verifies `TaskRun.userId` == the token/session user; `tasks/list` filters on `userId` (index `@@index([userId, status])`). Cross-context access → `-32602`.
- **Task-augmented `tools/call`:** when `params.task` is present and the target tool opts in, create the `TaskRun`, enqueue background execution, and return `CreateTaskResult` immediately instead of running the loop inline. Non-augmented calls behave exactly as today.
- **Per-tool opt-in:** add `execution.taskSupport` to `tools/list` output — `optional` for long-running autonomous/coworker tools, absent (`forbidden`) for quick backlog reads. Enforce `-32601` on augmentation of a forbidden tool.
- **State adapter (boundary only):** map DPF→MCP at the wire — `working→working`, `input-required→input_required`, `completed→completed`, `failed→failed`, `canceled→cancelled`; collapse `submitted→working`, `auth-required→input_required`, `rejected→failed`, `archived→`(expired). Do **not** change the internal enum.
- **`tasks/result`:** for terminal tasks return the underlying `CallToolResult` (reuse the existing `structuredContent`/`isError` shaping in `handleToolsCall`); for non-terminal, block to terminal (bounded). Include `_meta["io.modelcontextprotocol/related-task"] = { taskId }`.
- **Timestamps/TTL/poll:** map `createdAt`/`updatedAt` → `createdAt`/`lastUpdatedAt`; surface `ttl` and `pollInterval` per Decision D1.
- **Optional:** `notifications/tasks/status` on transitions (nice-to-have, not required by spec).
- **Errors:** `-32602` for unknown/terminal-cancel/bad cursor; `-32603` internal — per spec §Error Handling.

## 4. Decisions to route through the kernel FIRST (`dpf-decision-via-kernel`)

1. **D1 — TTL & retention.** The spec expects a `ttl` after which results may be deleted; DPF keeps `TaskRun` as a durable audit/BI record. Options: (a) add a nullable `ttl` column + a "results-served-until" window that stops serving `tasks/result` after expiry but **never deletes** the row; (b) advertise `ttl: null` (unlimited) for governed tasks; (c) store MCP ttl in `a2aMetadata` only. Cost axis: external resource-management conformance vs. audit/provenance permanence.
2. **D2 — Cancellation authority & mechanism.** Who may `tasks/cancel`, and how is a mid-flight autonomous loop stopped? Options: cooperative cancel via the existing heartbeat/stall infra (`lastHeartbeatAt`, `StallEvent`) + quiescence, gated on token scope + agent grants + `CoworkerActionEnvelope`. Verify (do not assume) which identities may cancel a running side-effecting task; best-effort stop then force `cancelled`.
3. **D3 — Back-compat & deprecation of `tasks/submit`.** Options: (a) keep `tasks/submit` as a thin shim over the new path (recommended), (b) run both independently with a deprecation notice, (c) hard-cut (rejected). Decide the deprecation window and the migration message for external callers.
4. **D4 — Async execution model.** Moving read/bounded-write off synchronous inline execution onto the background queue is the core architectural change. Confirm the executor (`apps/web/lib/queue/functions/` + `createAutonomousWorkRun`), idempotency under enqueue, and the concurrency cap per requestor (spec §Resource Management).

## 5. Phased implementation (behind a flag; each independently verifiable)

- **Phase 0 — read-only surface (no execution change).** Add the `tasks` capability + `tasks/get`, `tasks/result`, `tasks/list`, `tasks/cancel` reading/writing existing `TaskRun` rows (including those created today by `tasks/submit`), with the state adapter and auth-context binding. No change to how tasks execute. *Verify:* a client polls a `high-risk` (already-async) submission to terminal and retrieves its result; cross-user access rejected.
- **Phase 1 — task-augmented `tools/call` (flagged).** Honor `params.task` on opted-in tools: create `TaskRun`, enqueue background execution, return `CreateTaskResult`. *Verify:* a real long-running coworker tool call returns immediately, executes in the background, and is retrievable via `tasks/result`.
- **Phase 2 — converge `tasks/submit`.** Reimplement the bespoke method as a shim over the standard path (per D3), preserving idempotency and current response fields for existing callers; emit a deprecation notice. *Verify:* existing `tasks/submit` callers get identical outcomes; output parity on read/bounded-write/high-risk.
- **Phase 3 — polish.** `notifications/tasks/status`, `pollInterval` tuning, per-requestor concurrency cap + rate limiting, audit logging (spec §Security).

## 6. Risks & rollback

- **Blast radius:** changes execution semantics on the coordination plane. Mitigate: capability + per-phase flags; Phase 0 is read-only; the synchronous path stays default until Phase 1's flag is enabled. Rollback = disable the flag (capability stops being advertised; `tasks/submit` unchanged).
- **State-mapping drift:** keep the adapter at the wire boundary only; a unit test pins every DPF↔MCP state pair so the internal enum and ops-map consumers are never touched.
- **Security:** auth-context binding and `tasks/list` scoping are MUSTs — cover with tests for cross-user rejection before Phase 0 ships.
- **Back-compat:** parity tests for `tasks/submit` before it becomes a shim (Phase 2).

## 7. Non-goals

- Client-side tasks (DPF is the server/receiver; `sampling`/`elicitation` task-augmentation is out of scope).
- Deleting `TaskRun` rows on TTL (subject to D1; default is retain-and-stop-serving).
- Changing the internal `TaskRun.status` enum or the ops-map A2A edge model.
- SSE streaming for `tasks/result` (single-POST + blocking-to-terminal is sufficient; streaming is a separate design if adopted).

## Backlog coverage (pending — file in a runtime session)

Not yet in the live backlog. Before implementation, in a runtime-capable session: file **BI-4** (child of the umbrella from the parent plan) via `dpf-file-backlog-item`; route **D1–D4** through `dpf-decision-via-kernel` and record outcomes; then write the BI-4 implementation plan under `docs/superpowers/plans/` and call `record_plan_backlog_coverage`, copying the live receipt into that plan. Until then this is a pre-filing design, not a governed plan.
