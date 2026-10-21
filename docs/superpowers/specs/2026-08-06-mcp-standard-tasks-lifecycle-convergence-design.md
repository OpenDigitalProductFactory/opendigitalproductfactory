---
status: active
---

# MCP standard Tasks lifecycle — convergence design (Slice 4 / BI-4)

| Field | Value |
|-------|-------|
| **Status** | **Phase 0 SHIPPED (BI-06B66FFD).** The read-only standard surface — `tasks` capability + `tasks/get\|result\|list\|cancel` over the existing `TaskRun` substrate, with the A2A state adapter and auth-context binding (`apps/web/lib/mcp/tasks-lifecycle.ts`) — is implemented behind the `MCP_TASKS_LIFECYCLE` flag (default on). This increment changes NO execution semantics: task-augmented `tools/call` (Phase 1) and `tasks/submit` convergence (Phase 2) remain deferred and still require the kernel-routed decisions D1–D3 below. The kernel's LATER ruling for the full Slice 4 (`DI-A573E0551352`) was **operator-overridden** to ship Phase 0 in the conformance bundle; the HIGH-blast execution phases stay gated. |
| **Date** | 2026-08-06 |
| **Author** | Claude Code for Mark Bodman |
| **Parent** | [MCP `2025-11-25` + A2A adoption assessment](2026-08-06-mcp-2025-11-25-and-a2a-feature-adoption-design.md) · [phased plan](../plans/2026-08-06-mcp-2025-11-25-a2a-adoption.md) Slice 4 |
| **Backlog** | Phase 0: BI-06B66FFD. The bounded named-reader compatibility amendment in §8 is BI-CAP-21C511CA; its feature readiness and independent approvals remain required. |
| **Blast radius** | **HIGH** — the MCP transport is the coordination plane (AGENTS.md §12) and this changes long-running task execution semantics. Why this is a design, not a same-session patch. |

## 1. Historical problem before Phase 0 (2026-08-06)

This section records the pre-delivery diagnosis. Phase 0 is now implemented as stated above; it is not evidence that a current client can invoke the protocol's task methods. The current compatibility gap and its separate scope are defined in §8.

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

## 8. Bounded owned-task reader compatibility — BI-CAP-21C511CA

**Status:** proposed feature scope, 2026-10-21. Authoring Workroom WC-0750EFD3; decision DI-8C5F6DC67C1D selects the exact-owned-read facade. This decision permits design preparation, not implementation or an independent review receipt. The implementation sequence is [the bounded reader plan](../plans/2026-10-21-owned-mcp-task-read-compatibility.md).

### 8.1 Reproduction and existing source

At served commit `95d3972ac897c3c45c9ffedad0d3b6396bf9e261`, `route.ts` admits protocol `tasks/get` and `tasks/result`, but this Codex connector exposes named `tools/call` entries, without a protocol-method invoker. Exact-name discovery of those two methods reports `unknown-tool-name`; this does not mean the server lacks the methods. The parent coordinator reported one accepted ordinary AI Ops handoff at 14:37 UTC on 2026-10-21. Its immutable request asks for a minimal note in an existing room if permitted, but carries no formal room binding. The new TaskRun's status/result remains unobserved in this authoring session. Workroom evidence records that reproduction without claiming dispatch, completion, native settlement or application acceptance.

The canonical lifecycle owner is `apps/web/lib/mcp/tasks-lifecycle.ts`. Its ordinary read admission checks the authenticated human's `userId`; that alone is insufficient for a new coworker-facing tool because one person can use several assistants and task namespaces. External task submission already persists the request key, digest, origin token reference and `taskAuthorityKey`. `auth/oauth-task-authority.ts` derives the current namespace. `mcp-task-original-result.ts` demonstrates using the origin token only to identify the original submitting assistant while current authority remains separate. Native semantic reviews retain their originating actor in the exact stored semantic-review request artifact. No new identity store is needed.

The current product UI is not a durable result substitute: Right Now projects live title/status per coworker; Workroom recovery projects bound reviewer metadata; an unbound ordinary handoff has no automatic Workroom result association. This amendment does not add a portal route, change those projections, or use their internal history endpoints.

### 8.2 Research and choice

| Primary comparison, checked 2026-10-21 | Adopt | Reject for this amendment |
| --- | --- | --- |
| [MCP 2025-11-25 Tasks](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2025-11-25/basic/utilities/tasks.mdx) | Bind every read to authorization context; retain the existing task/result/error owner. | Calling a named compatibility tool the protocol's blocking, exact underlying-result method. |
| [Official Python SDK task-isolation advisory](https://github.com/modelcontextprotocol/python-sdk/security/advisories/GHSA-hvrp-rf83-w775) | Centralize ownership admission before projection; return an unavailable result for foreign tasks. | Task-ID possession, default stateless access, or transport-session identity as sufficient DPF authority. |
| [Official C# SDK manual task control](https://github.com/modelcontextprotocol/csharp-sdk/blob/main/docs/concepts/tasks/tasks.md) | One bounded read snapshot with separate task state and result/error facts. | Automatic polling/cancellation, a replacement store, or SDK execution machinery. |

The [2026-07-28 Tasks extension](https://modelcontextprotocol.github.io/ext-tasks/specification/2026-07-28/tasks.html) differs from the existing experimental protocol. It is comparison evidence, not a migration target here. The [client-contract consolidation design](2026-09-04-mcp-client-contract-consolidation-design.md) rejects re-platforming inside this iteration.

Extending `get_workroom` would help a review already bound to that room, but cannot cover this ordinary accepted handoff without inventing a room association. A bounded named tool reuses the lifecycle owner across both supported task-origin shapes. Raw transport, alternate credentials and broader conversation grants are rejected. No new dependency, table, grant or execution subsystem is proposed.

### 8.3 Objectives and acceptance

**OBJ-OWNED-READ:** The submitting human and canonical assistant can obtain a bounded snapshot for one exact TaskRun under the same provable current task namespace, without conversation-read authority.

**OBJ-READ-ISOLATION:** Missing, foreign, stale or inconsistent origin/admission evidence cannot reveal task content, and authorization applies to the same snapshot that supplies the result.

**OBJ-RESULT-TRUTH:** Status, errors, uncertainty, waits and recorded receipts retain their existing meaning even when result text exceeds a context budget.

**OBJ-READ-ONLY:** Reading never dispatches, resumes, cancels, heals, retries or mutates the task, and leaves the protocol lifecycle and ordinary grants unchanged.

**OBJ-LIVE-OBSERVATION:** The original connector can observe an already-accepted owned task after governed deployment without another handoff, inference or permission expansion.

| Acceptance ID | Objective IDs | Statement |
| --- | --- | --- |
| AC-OWNED-01 | OBJ-OWNED-READ | A single named tool accepts only a bounded exact taskId and a closed status/result selector; unknown methods, identity arguments and list/cancel/retry/submit requests are rejected before projection. |
| AC-OWNED-02 | OBJ-READ-ISOLATION | Admission derives the current human, canonical assistant and task namespace from trusted current connector context and verifies complete, consistent saved external origin. Same human with another assistant or namespace is unavailable. |
| AC-OWNED-03 | OBJ-READ-ISOLATION | Same-family credential rotation remains readable; revoked current authority, missing origin token/actor/namespace, unsupported credentials, malformed identity and legacy unprovable origin fail closed without task-content fallback. |
| AC-OWNED-04 | OBJ-READ-ISOLATION | Changing ownership, namespace, origin assistant, bound request, relevant artifact checkpoint, current token authority or required Workroom admission during collection discards the result; every branch has a final complete authority/checkpoint fence. |
| AC-OWNED-05 | OBJ-OWNED-READ, OBJ-READ-ISOLATION | External-MCP tasks validate their saved request/deterministic task identity; native semantic-review tasks validate the exact stored request artifact, originating OAuth actor and current paired human/assistant content admission to its exact bound Workroom. A valid native case is supported; missing/revoked room access and incomplete historical proof are unavailable. Build Studio/session origins with copied OAuth references are rejected. Target executor identity cannot stand in for the original requester. |
| AC-OWNED-06 | OBJ-RESULT-TRUTH | Existing initiative current-actor/scope/Workroom checks and durable-inference operation binding remain effective in both modes. A refused or unknown specialized read never falls back to raw progress. |
| AC-OWNED-07 | OBJ-RESULT-TRUTH | Working/input-required and terminal success/failure retain explicit status, terminality, error disposition, uncertainty/wait/retry facts and genuine receipt identity. Oversized text is bounded with truncation/hash/original-size facts; no successful-looking bare JSON prefix or silently discarded outcome is returned. |
| AC-OWNED-08 | OBJ-READ-ONLY | Current read authority and the lifecycle feature flag are enforced; removing the submission-only thread_write grant does not remove receipt-reading authority. No added task enumeration, ordinary portal conversation/history joins, broad message/ToolExecution joins, list, cancellation, replay, execution or grant changes occur; exact admitted TaskRun/origin-artifact and existing authorized specialized reads are preserved. |
| AC-OWNED-09 | OBJ-READ-ONLY | Existing protocol routes, flags, specialized readers, submission behavior and grant mappings retain their established behavior; the new tool uses an existing appropriate read grant without provisioning it. |
| AC-OWNED-10 | OBJ-LIVE-OBSERVATION | On exact served bytes, the original connector reads its already-accepted ordinary task and an already-required native semantic-review task with provable origin/current room admission, recording actual bounded results or explicit refusals. Supporting no valid native case is incomplete delivery. An unresolved result remains unresolved; reading it never establishes original portal execution settlement or authorizes application retry. |

### 8.4 Admission and projection contract

The proposed tool is `get_mcp_task` in the existing work-thread pack, with `taskId` and `mode` (`status` by default, or `result`). Both are closed, bounded inputs; caller-supplied human, token, assistant, namespace, thread, room or provider identities are rejected. It is immediate, nonblocking, read-only and uses the existing `agent_control_read` grant, current token read authority and normal governed masking/audit path. This adds no grant to any principal. There is no automatic polling or cancellation. The standard protocol methods remain unchanged.

Before delegating to the lifecycle owner, require a current interactive OAuth context whose token row agrees with the authenticated human and canonical acting assistant. Derive the current task authority key server-side. Match the stored origin's human and namespace, and use the saved originating token/actor solely to identify the original canonical assistant. A stale origin credential may identify an immutable origin; it does not authorize current execution. The target's `currentAgentId` or `requestedAgentId` is not requester proof. PAT, credentials-client, missing-context and incomplete legacy origin are unavailable in this slice.

For an external-MCP task, validate its saved OAuth origin, request key/digest and deterministic TaskRun identity. For a native semantic review, validate the exact stored request artifact, request digest and task binding plus the original OAuth actor/token references. The stored origin must actually be OAuth; a Build Studio/session actor with copied token references is not converted into one. Resolve that packet's exact canonical Workroom and require current paired human/canonical-assistant content admission through `resolveAgentWorkroomAccess` for status, result, receipt and recovery details. Origin identity is not current room authority. Missing/unprovable binding or revoked admission returns a non-disclosing unavailable result. Do not call an execution-authority verifier that would require historical write or dispatch authority merely to read a receipt. Do not backfill missing historical identity. Valid native requests with complete proof must work; legacy refusal alone cannot satisfy this BI.

Project a consistent exact row/artifact snapshot, and fence every branch immediately before publishing against the complete identity/artifact checkpoint plus current connector and required Workroom authority. An equivalent atomic locking/version fence may provide that guarantee; an earlier admitted snapshot without a final fence does not. Discard on drift. A separate precheck followed by an unguarded helper query is insufficient. Specialized initiative admission applies to status as well as result: `handleTasksGet` alone does not provide the initiative collector's original-owner/room checks. Preserve the existing initiative and durable-operation guards, including their exact authorized proof/message/writer reads, without a raw-data fallback. Missing or incompatible proof returns a bounded, non-enumerating unavailable disposition.

Reuse canonical lifecycle state/result/error shaping; do not rederive task completion or reviewer decisions. The compatibility envelope identifies itself as a nonblocking bounded projection, not an exact protocol result. A closed per-subtype output allowlist includes canonical task identity/status/timestamps, terminality/isError, approved bounded result summary/text/error, uncertainty/approval/wait/retry facts, and permitted genuine receipt/provenance fields. Never serialize the whole saved request, arbitrary `progressPayload`, artifact packet or authority metadata. Unknown nested objects cannot silently become result content; if a subtype's mandatory outcome cannot be interpreted safely, return an explicit incompatible/unavailable disposition. Preserve mandatory facts before bounding optional text. Truncation includes field-level flags, hashes and original sizes. If mandatory facts cannot fit the selected budget, return an explicit too-large/unavailable disposition; do not drop `progressPayload` wholesale and leave a success-looking envelope. No prompts or internal origin credentials are returned. Existing context masking and untrusted-content handling still apply.

### 8.5 Verification, risk and rollback

The implementation plan maps every acceptance criterion to RED cases and the ordinary functional gate. Publication and live acceptance require their own real evidence. Source-only tests, catalog availability and a successful reader response are not proof of application success or settled provider effects. The old portal attempt remains under its prior read/settlement boundary.

Primary risks are same-human cross-assistant disclosure, race-driven identity drift, legacy-origin fallback and outcome loss under truncation. Controls are strict saved-origin admission, current authority checks, stable snapshot/recheck, specialized guard reuse and explicit result budgeting. Rollback disables/removes only the compatibility tool; it does not alter task records, protocol readers or task execution. The feature classification and all required research/design/spec/architecture/plan gates remain in force.

## Historical Phase 0 coverage

The original pre-filing note is superseded by the shipped BI-06B66FFD status above. BI-CAP-21C511CA owns only the §8 compatibility amendment; its live plan coverage and independent reviews must be recorded before implementation. Neither this amendment nor the old D1–D4 discussion authorizes an execution/protocol migration.
