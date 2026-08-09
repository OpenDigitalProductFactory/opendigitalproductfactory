# MCP 2026-07-28 Stateless Core and Tasks Migration — Decomposed Implementation Plan

**Date:** 2026-08-08

**Status:** Governed implementation scope; ready for separate build threads after review

**Umbrella backlog item:** `BI-AF9F9729` under `EP-HEADLESS-EMPLOYEE`

**Design:** [MCP 2026-07-28 stateless core and Tasks extension convergence](../specs/2026-08-06-mcp-standard-tasks-lifecycle-convergence-design.md)

**Migration decision:** `DI-1C305D329ECE` — dual wire, one route

**Planning WorkCapsule:** `WC-C7C6FEFC`

**Backlog coverage receipt:** `cmsl138wy01gi01qq19cg3xrf` (`decomposed`; four live product BIs)

> **For build threads:** claim one mapped BI and use one isolated worktree/branch/PR. Re-run substrate and standards verification against current `origin/main`; use test-first implementation; keep the legacy adapter until its evidence gate passes; use the canonical shared nonproduction lease for runtime and client conformance. Do not create `/api/mcp/v2`, another tool registry, another authorization pipeline, or another task store.

## 1. Outcome

Move DPF's external MCP surfaces from the 2025-11-25 stateful handshake and experimental Tasks shape to the final 2026-07-28 stateless core and official `io.modelcontextprotocol/tasks` extension without breaking known clients.

The result has one canonical `/api/mcp/v1` route, one per-request identity and authorization pipeline, one governed tool-execution service, and `TaskRun` as the sole durable task aggregate. A bounded version adapter temporarily serves legacy clients. The main web endpoint and ADP converge on common protocol-envelope primitives without merging their domain responsibilities. External MCP clients, Build Studio, in-platform AI coworkers, and federated A2A all reach the same application services and authority rules.

## 2. Scope and sequencing

| Key | Deliverable | Live BI | Depends on | Independently shippable |
| --- | --- | --- | --- | --- |
| M0 | Standards/substrate reconfirmation and contract fixtures | umbrella coordination | — | no production behavior |
| M1 | 2026-07-28 stateless core on canonical external route | `BI-214CB18D` | M0 | yes, legacy remains available |
| M2 | Official Tasks extension over `TaskRun` | `BI-B6F8BFF4` | M1 | yes, feature-gated |
| M3 | ADP stateless protocol migration | `BI-A712B61F` | M1 | yes |
| M4 | Compatibility telemetry and evidence-gated retirement | `BI-106E1DEC` | M1–M3 | yes |
| M5 | Cross-surface and canonical-runtime acceptance | umbrella closeout | M1–M4 | no separate product slice |

M1 and M2 are ordered because task negotiation and task responses depend on the final per-request envelope. M3 can proceed in parallel with M2 after M1's shared boundary contracts stabilize. M4 instruments both protocols and owns retirement, so it closes after M1–M3. Federated A2A `BI-90E338D8` may build its core service independently, but its external MCP adapter stays disabled until M2 is complete.

## 3. Non-negotiable invariants

1. `/api/mcp/v1` remains the only canonical external MCP route.
2. Each 2026 request independently authenticates and resolves token scope, Principal, authorized agent Principal/GAID or delegation, organization/environment, role capabilities, agent grants, and policy.
3. No connection, initialize exchange, or client-supplied GAID is an authority source.
4. `TaskRun` plus its canonical message/artifact/evidence owners remains the only durable task state.
5. Legacy and 2026 adapters call the same registry, governed execution, task, audit, and projection services.
6. Protocol statelessness never weakens durable audit, cancellation, idempotency, recovery, or enterprise privacy.
7. Cross-org responses apply the canonical identity-boundary projection: authorized public GAIDs only, with internal participants/topology screened.
8. Build Studio and AI coworkers do not gain route-local MCP or A2A state machines; they call the same application service.
9. A2A continues over the authenticated federation substrate. MCP is an entry surface, not a sovereign-peer transport.
10. Retirement is evidence-gated and operator-approved, not date-assumed.

## 4. M0 — Reconfirm standards, substrate, and overlap

**Delivery:** umbrella coordination; no production code.

1. Verify the final MCP 2026-07-28 announcement, stateless core, discovery, transport-header, caching, MRTR, and Tasks extension documents. Record exact normative versions in tests/docs; do not follow an SDK release label as the protocol authority.
2. Re-read the current main route, ADP server, auth/grant registry, tool executor, `TaskRun`, task lifecycle adapter, submission service, queues, audit/telemetry, Build Studio adapters, coworker tools, and A2A service after refreshing `origin/main`.
3. Confirm no peer PR or synchronized BI now owns any mapped deliverable. Reconcile remote historic BI-06B66FFD as a legacy Phase-0 predecessor rather than current completion.
4. Capture request/response fixtures for one known 2025 client and the official 2026 shapes: discovery, list/caching, tool call, input required, task creation/get/update/cancel, terminal success, and terminal error.
5. Identify every in-repo MCP client/adapter and record its upgrade owner. Include Codex/Claude/Grok configuration, Build Studio, AI coworker/tool callers, ADP, tests, scripts, and A2A MCP entry points.

### M0 done

- official source links and exact contracts are pinned in the design/tests;
- current shared owners and adapter boundaries are named;
- the client inventory has an owner and conformance target;
- no competing live implementation scope remains unresolved.

## 5. M1 — Stateless core on `/api/mcp/v1` (`BI-214CB18D`)

### 5.1 Define one protocol envelope

1. Add a typed protocol-version discriminator and request-envelope parser in the existing MCP shared-contract owner. Keep 2026 and legacy wire types at the boundary.
2. Require `MCP-Protocol-Version` and match it to body `_meta`; validate `Mcp-Method` on every Streamable HTTP request and `Mcp-Name` for `tools/call`, `resources/read`, `prompts/get`, and extension methods that define a routing name. Return HTTP 400 plus `-32020 HeaderMismatch` without invoking a tool on mismatch.
3. Support schema-declared `x-mcp-header` tool parameters and validate decoded `Mcp-Param-*` values against the body. Keep the body authoritative and enforce the standard ASCII/base64-sentinel rules.
4. Parse 2026 protocol version, client identity/version, and capabilities from per-request metadata. Require the normative fields and reject unsupported explicit versions.
5. Shape server identity and negotiated extension metadata in each 2026 response `_meta`. Legacy initialize output stays within the legacy adapter.

### 5.2 Re-resolve authority per request

1. Extract the existing authentication/grant/caller-resolution path into or behind a request-scoped application boundary if it is currently coupled to initialize/session state.
2. Resolve the human/service Principal first, then the authorized acting agent Principal/GAID or explicit delegation. Treat any caller-supplied GAID as an assertion to verify, never authority.
3. Intersect bearer-token scope, user role capabilities, agent tool grants, organization/environment policy, and task/link ownership on every request.
4. Preserve existing audit correlation using explicit request/task/capsule identifiers; do not replace protocol sessions with an invented application session.

### 5.3 Implement final core utilities

1. Implement `server/discover` from canonical capability/identity owners. Return supported versions, authorized capability declarations, server identity, and optional instructions—not a duplicate tool/resource/prompt catalog.
2. Add `ttlMs` and `cacheScope` to complete `server/discover`, `tools/list`, `prompts/list`, `resources/list`, `resources/templates/list`, and `resources/read` results. Pin private/authority-sensitive results to `private` scope.
3. Implement 2026 multi-round-trip input-required responses through the existing approval/input service and explicit continuation identifiers.
4. Preserve one POST endpoint. Allow request-scoped SSE only as the response to its originating POST; do not restore standalone GET/DELETE session endpoints or resumable streams. Use `subscriptions/listen` if M4 proves change notifications are required.
5. Keep the 2025 adapter behavior stable for known clients, including initialize/initialized, while ensuring it invokes the same governed handlers.
6. Put adapter selection and preferred-version rollout behind an operator-controlled compatibility setting with a safe rollback.

### M1 verification

- contract tests: missing/malformed/mismatched protocol/method/name/parameter headers, `-32020`, metadata, discovery, server `_meta`, all cacheable result directives, POST/SSE, MRTR, and unsupported versions;
- security tests: fresh auth each request, revoked token between requests, changed grants between requests, GAID spoofing, cross-org context, and filtered discovery;
- compatibility tests: known legacy initialize/client path unchanged and no duplicate tool execution;
- production build and documentation impact gate;
- canonical-runtime smoke test through an actual 2026 client and a known legacy client.

### M1 done

- 2026 requests require no initialize, initialized notification, or MCP session ID;
- legacy and 2026 requests reach one governed execution pipeline;
- discovery, transport headers, response metadata, cache directives, and MRTR conform;
- disabling preferred 2026 selection restores the legacy adapter without data rollback.

## 6. M2 — Official Tasks extension (`BI-B6F8BFF4`)

### 6.1 Converge creation and persistence

1. Add typed negotiation for `io.modelcontextprotocol/tasks` and declare which server requests may become tasks.
2. Refactor task initiation into one surface-neutral service used by MCP, Build Studio, in-platform coworkers, and the A2A MCP entry adapter.
3. Validate authority and idempotency, commit the receiver-owned `TaskRun` and actor bindings, enqueue the verified shared executor, then return `resultType: "task"`. Never await the autonomous loop before returning the task handle.
4. Preserve the existing `TaskRun.taskRunId` as `taskId`; do not add an MCP task ID or table.

### 6.2 Implement lifecycle methods

1. `tasks/get`: return only tasks authorized in the current request context and include current status, requested input, expiry/serviceability, and terminal result/error where applicable.
2. `tasks/update`: validate negotiated extension capability, outstanding input keys, expected input shape, and task state; append through the canonical message/evidence owner, record the actor, and resume eligible work. Unknown or already-satisfied keys follow the standard ignore/partial-update rules.
3. `tasks/cancel`: enforce extension capability and cancellation authority, acknowledge cancellation intent, let the worker observe it at bounded checkpoints, and record the eventual outcome. Do not promise that acknowledgement stopped work or guarantees a `cancelled` terminal state.
4. Map DPF state spelling and detail at the boundary. Do not mutate the internal enum to make a wire adapter easier.
5. Treat TTL as wire serviceability/cleanup policy while retaining governed `TaskRun` evidence.
6. Set `Mcp-Name` to `taskId` for `tasks/get|update|cancel`. Return the standard missing-capability error when the client did not negotiate the extension. Defer task notifications unless needed; if enabled, use `notifications/tasks` through `subscriptions/listen`.

### 6.3 Bound the legacy adapter

1. Repoint `tasks/submit|get|result|list|cancel` to the same task application service.
2. Preserve documented legacy response shapes only in the 2025 adapter.
3. Mark legacy method use in response metadata and telemetry where the protocol permits, without changing outcome or leaking internals.
4. Delete or quarantine any old path that can execute independently after parity is proven.

### M2 verification

- red-first lifecycle tests: durable-before-handle, true non-blocking return, idempotent replay, process restart, get, update/input-required, cancel, terminal success/error, expiry projection, and worker failure;
- authority tests: cross-user, cross-agent, cross-org, guessed task ID, revoked grant, stale delegation, and unauthorized cancellation;
- one-state tests: 2026 and legacy calls resolve the same `TaskRun`, messages, artifacts, receipts, and terminal result;
- concurrency/rate-limit/backpressure tests and canonical-runtime long-running execution;
- surface tests from external MCP, Build Studio, and an in-platform coworker; A2A MCP entry remains gated until its own slice is ready.

### M2 done

- official task creation/get/update/cancel works asynchronously over `TaskRun`;
- legacy methods are adapters only;
- cancellation and requested input reach the worker through durable state;
- no second task store, worker, or authorization path exists.

## 7. M3 — ADP migration (`BI-A712B61F`)

1. Inventory ADP's clients and current initialize/session assumptions.
2. Consume M1's protocol envelope, request metadata, header validation, response server identity, discovery/cache helpers, and error primitives where their semantics are identical.
3. Keep ADP-specific tool definitions and execution in its domain adapter. Do not call the web route internally or duplicate the shared parser.
4. Resolve ADP authority per request and remove 2026 dependence on initialize/initialized or connection state.
5. Keep a bounded legacy adapter only for verified clients included in M4 telemetry.

### M3 verification and done

- 2026 contract and revocation-between-requests tests pass against ADP;
- known ADP legacy clients remain functional;
- shared contracts have one owner and ADP domain behavior has not migrated into the web route;
- production build and canonical-runtime ADP client smoke test pass.

## 8. M4 — Telemetry and retirement (`BI-106E1DEC`)

1. Extend the existing MCP call audit/telemetry owner; verify it before adding schema. Record protocol version, client kind/version, method family, legacy session use, result class, latency, compatibility failure, and Tasks extension use. Never record bearer tokens, prompts, task payloads, private GAIDs, internal participant topology, or unrestricted metadata.
2. Add an operator-readable compatibility view in the existing Platform Development/MCP operational surface if current telemetry cannot answer readiness. Reuse theme-aware tables, filters, status, and disclosure primitives; do not create a new navigation destination for one migration.
3. Publish a client matrix covering external MCP clients, Build Studio, AI coworkers, ADP, scripts/tests, and the A2A entry adapter. Each row needs last-seen version, 2026 conformance evidence, owner, and blocker.
4. Run the approved observation window, then execute a canonical-runtime retirement/rollback drill.
5. Obtain operator approval and remove the legacy adapter, initialize/initialized handling, legacy task methods, and obsolete flags/tests/docs in one bounded cleanup PR. Preserve historical audit data and the canonical route.

### M4 done

- all known clients have current conformance receipts;
- legacy traffic is zero for the approved window;
- compatibility telemetry is privacy-safe and operationally visible;
- rollback has been proven before removal;
- the final cleanup leaves one 2026 wire adapter and one application service.

## 9. M5 — Cross-surface and canonical-runtime acceptance

Run on the governed shared nonproduction environment and, after approval, the designated installs:

1. External MCP client: discover, call synchronously, create a long-running task, poll, provide input, cancel a second task, and retrieve a terminal result.
2. Build Studio: invoke the same service and attach `TaskRun`/receipt evidence to its existing `FeatureBuild`/`WorkCapsule`; prove no direct MCP or federation state machine was introduced.
3. In-platform AI coworker: resolve the canonical agent Principal/GAID, initiate the same work, and prove identical authority, task, and receipt contracts.
4. ADP: complete the final stateless flow and a domain tool call.
5. Federated A2A adapter: after `BI-90E338D8` is ready, prove the MCP entry creates the same receiver-owned A2A/`TaskRun` lifecycle rather than proxying MCP over federation.
6. Identity/privacy negatives: spoofed GAID, revoked token/grant, hidden internal participant, private GAID, cross-org cache reuse, cross-user task lookup, and connection-reuse after authority change.
7. Restart and failover: restart the web process after returning a task handle and prove polling/update/cancel/result continue from durable state.

Umbrella completion requires green evidence for all four child BIs, current docs, zero unresolved client owners, and an operator-approved legacy-retirement outcome. If legacy retirement is not yet approved, M1–M3 may be shipped but the umbrella remains open.

## 10. Architecture review

**Verdict:** aligned, subject to the explicit controls below.

| Lens | Result | Control |
| --- | --- | --- |
| Canonical contract | aligned | one `/api/mcp/v1`; typed boundary adapters only |
| Identity stewardship | aligned | Principal/GAID/delegation resolved per request; no connection identity |
| Authorization | aligned | one token/role/grant/policy intersection for every surface |
| Task source of truth | aligned | `TaskRun` plus existing message/artifact/evidence owners |
| Data model | aligned | verify existing metadata/audit owners before any additive field; no session/task table |
| Surface parity | aligned | thin MCP, Build Studio, coworker, ADP, and A2A adapters over shared services |
| Federation | aligned | A2A stays on `FederationLink` transport; MCP does not become peer transport |
| Privacy | aligned | public-GAID boundary projection; no private chain/topology leakage |
| Operability | aligned | measured dual-wire migration, flags at adapter boundary, evidence-gated retirement |
| Standards | aligned | final MCP 2026-07-28 and official Tasks extension are normative |

Architecture corrections carried into implementation:

1. The shipped 2025 Tasks projection is reclassified as legacy compatibility, not current conformance.
2. The migration uses two temporary wire adapters on one route, not parallel services or `/v2`.
3. Official Tasks use `tasks/get|update|cancel`; legacy `tasks/list|result|submit` never define internal service APIs.
4. Protocol statelessness removes connection authority but preserves durable `TaskRun` state.
5. All caller surfaces resolve identity and grants per request and share the same task/A2A services.

## 11. Rollback and recovery

1. Before retirement, prefer or disable the 2026 adapter through the governed compatibility setting while keeping the canonical route and data untouched.
2. Disable official task creation independently of synchronous 2026 calls if the background executor is unhealthy; existing task reads/updates/cancels remain available where safe.
3. Preserve committed `TaskRun`, message, artifact, cancellation, and audit evidence across rollback.
4. Forward-fix migrations; do not delete evidence or reintroduce route-local state.
5. After retirement, restore the legacy adapter only from its last verified commit through the normal PR/deployment path and only with operator approval.

## Backlog coverage

Live coverage is recorded against `BI-AF9F9729` for this exact plan path.

- Decision: `decomposed`
- Receipt: `cmsl138wy01gi01qq19cg3xrf`
- Mapped product BIs: `BI-214CB18D`, `BI-B6F8BFF4`, `BI-A712B61F`, `BI-106E1DEC`
- Sequencing-only work: M0 and M5 under umbrella coordination
