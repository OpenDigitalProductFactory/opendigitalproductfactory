---
status: draft
---

# External MCP coworker handoff through auth-bound tasks

**Backlog item:** BI-6804F720
**Workroom:** WC-4DC4E103
**Blocks:** BI-2C50F548
**Kernel decision:** DI-BCCA7F3AC101
**Superseded decision:** DI-A308C6C7E47C

## Objective baseline

An authenticated external MCP contributor can ask or summon a named coworker
without a portal parent thread. The server creates the canonical conversation
identity, dispatches exactly one visible and auditable task, and returns a
stable task handle. No caller-supplied tool argument can select an existing
`AgentThread`.

Success is observable when all of the following hold:

- `request_coworker` and `summon_coworker` work for authenticated external PAT
  calls that do not carry portal thread context;
- the same deterministic `requestKey` replays one prior task instead of
  dispatching a second interaction;
- direct portal and internal-session calls preserve their current visible
  collaboration-card behavior;
- malformed or missing external identity inputs fail with a typed error and an
  exact repair action;
- shared adapter tests cover Codex, Claude, Grok, embedded, and generic MCP
  caller classification without a host-specific dispatch implementation; and
- the current `missing_threadId` reproduction is green end to end against the
  live development install.

## Problem

The MCP route authenticates external clients with a persistent PAT. That
identity reaches `governedExecuteTool`, but PAT authentication does not provide
an `AgentThread`. Both named coworker handlers currently assume a portal parent
thread and refuse before dispatch with `missing_threadId`.

The refusal protects the lineage model, but the platform offers no lawful next
step to the external caller. As a result, an external contributor can discover
an independent reviewer and can hold the correct reviewer packet, yet cannot
create the peer interaction required by initiative readiness.

The failure is reproduced by BI-2C50F548 / WC-7B7175A9:

- `find_coworker` resolved the independent Change Reviewer;
- `request_coworker` and `summon_coworker` both returned
  `missing_threadId`;
- the implementation claim then correctly refused with
  `initiative_not_ready`; and
- no self-approval, raw database write, synthetic principal, or readiness
  bypass was attempted.

## Standards correction

The repository's local MCP snapshot documents protocol revision `2025-11-25`,
where Streamable HTTP may establish a protocol session and return
`MCP-Session-Id`. That snapshot is not sufficient for this decision.

The official `2026-07-28` MCP specification removes the
`initialize`/`initialized` handshake and protocol-level sessions. Every request
is self-describing. `MCP-Session-Id` is not part of the current wire contract.
DPF's external compatibility window is current plus one prior revision, so a
new design cannot make the retired session header its identity substrate.

This evidence supersedes DI-A308C6C7E47C, which selected a server-minted
transport session before the current standard was considered. DI-BCCA7F3AC101
re-evaluated the options with the current standard and selected the auth-bound
task adapter with high confidence, no commandment conflict, and autonomous
eligibility.

## Existing substrate to preserve

- `McpApiToken` and the governed MCP wrapper remain the authentication,
  capability, grant, and audit boundary.
- `submitRemoteCoworkerTask` remains the external task entry point.
- `AgentThread` remains the canonical conversation identity and lineage model.
- `TaskRun` remains the durable external execution handle and status surface.
- `requestCoworker` and `summonCoworker` remain the portal-thread interaction
  owners.
- The agent registry, lifecycle checks, clearance rules, and tool grants remain
  the target-authority source of truth.
- `requestKey` / task idempotency remains the exactly-once retry mechanism.
- `callerClient` remains presentation and telemetry context, never authority.

No new table, session store, reviewer-dispatch tool, host-specific handler, or
caller-selectable thread identifier is introduced.

## Options considered

| Option | Wins on | Loses on |
|---|---|---|
| Auth-bound task adapter | Reuses canonical task/thread creation, works with stateless MCP, preserves authority | Requires a deterministic request key and async task result |
| Explicit task handle before tools/call | Makes the task boundary visible to the client | Adds a two-call ceremony and requires every host/skill to compose it correctly |
| One thread per PAT | Small implementation and no new caller input | Merges unrelated concurrent tasks that share a persistent credential |
| Client correlation id mapped to thread | Easy host-side correlation | Lets the client define logical lineage and creates same-token collision/spoofing risk |

DI-BCCA7F3AC101 selected the auth-bound task adapter. Its strongest
contributors were Research and Use Standards and Single Source of Truth. The
composite was `7.744`, the margin was `2.170`, and the result was stable under
sensitivity analysis.

## Decision

### 1. Route only threadless external authentication through tasks

The coworker tool handlers retain two explicit lanes:

1. When `context.threadId` exists, call the existing portal collaboration
   owner. This preserves cards, event-bus updates, conversation lineage, and
   current internal behavior.
2. When no thread exists and the execution context proves an external PAT,
   adapt the request to `submitRemoteCoworkerTask`.

All other missing-thread contexts fail closed. In particular, a malformed
internal session is not silently reclassified as an external PAT.

### 2. Share one threadless-handoff adapter

Extract one small helper used by both `request_coworker` and
`summon_coworker`. The helper owns:

- PAT-context verification;
- deterministic `requestKey` validation;
- token and user authority projection;
- target, title, objective, prompt, route, risk, and idempotency mapping;
- conversion from the task-submission result to the MCP `ToolResult`; and
- typed external-handoff failures.

This is the intentional refactor portion of the BI. It removes the temptation
to copy transport and error logic between two coordination tools and makes the
host matrix one test seam. Portal dispatch remains in the existing handlers;
the helper does not become a second collaboration owner.

### 3. Let the server create lineage

`submitRemoteCoworkerTask` derives or creates an `AgentThread` inside the
authenticated user boundary and creates the corresponding `TaskRun`. The tool
caller provides a deterministic request key, not a thread primary key.

The key is used for idempotency and may appear in audit metadata. It must never
be resolved as an unscoped `AgentThread.id`. Repeating a key under the same
authenticated token returns the existing task result only when an immutable
request digest also matches. The digest covers the token id, named target,
route, objective/prompt, risk class, authority scope, and collaboration kind.
Reusing a key with conflicting immutable request fields returns
`idempotency_conflict` rather than mutating, replaying, or duplicating the prior
interaction.

The existing task lookup currently scopes a key by `userId` alone. This BI
tightens it to the authenticated token and persisted request digest. A user may
hold several PATs and a PAT may be used by several host processes; neither case
may turn a guessed key into access to another task identity.

### 4. Preserve the exact named target

The adapter passes the canonical requested agent identity into the existing
remote task target resolver. Lifecycle, model eligibility, sensitivity,
clearance, and grant checks still run server-side. The adapter must never fall
back to the first/default coworker when the named target is absent or stale.

`targetAgent` remains a canonical agent id or a supported server-resolved
alias. Host/user-agent strings are not used to select a target, model, or
authority policy.

### 5. Use one external request contract

Both named coworker tools accept `requestKey` for the external threadless lane.
It is required only when the server must create a remote task. Existing portal
callers with `context.threadId` do not need to add it.

The minimum external request is:

```json
{
  "targetAgent": "AGT-WS-REVIEW",
  "objective": "Review the exact initiative design artifact.",
  "requestKey": "initiative-readiness:BI-6804F720:spec-approval:<head-sha>"
}
```

`questionPacketSummary`, `tier`, and `enteredVia` keep their present meanings
where supported. The adapter records an explicit route and bounded risk class;
it does not infer approval or expand the PAT's grants.

The helper supplies `collaborationKind="handoff"` for `request_coworker` and
`collaborationKind="summon"` for `summon_coworker`. This value is audit and
presentation metadata, not an authority input. It is included in the immutable
request digest so the same key cannot silently change interaction semantics.

### 6. Return the canonical task handle

A successful external dispatch returns:

- `success: true`;
- `entityId` equal to the semantic task-run id;
- an operator-readable message that the governed peer task was queued or
  replayed; and
- structured task status, idempotent-replay state, and approval requirement.

The response does not claim the review passed. Clients use the existing task
lifecycle methods to observe completion.

### 7. Make failures actionable and typed

The external lane distinguishes at least:

| Error | Meaning | Repair |
|---|---|---|
| `missing_requestKey` | No deterministic external task identity was supplied | Retry with the recovery packet's `requestKey` |
| `external_handoff_context_required` | No portal thread and no verified PAT context exist | Reconnect through the configured authenticated MCP endpoint |
| `invalid_params` | Target, objective, key, or task payload is malformed | Correct the named field from the returned message |
| `idempotency_conflict` | The key already names a different immutable task request | Generate the canonical key for this exact reviewer packet; do not reuse another task's key |
| `remote_handoff_failed` | The governed task owner rejected target, authority, lifecycle, or execution | Preserve and surface its typed structured error |

The current generic `missing_threadId` remains valid for internal-only tools
that genuinely require portal conversation state. It is no longer the terminal
answer for these two external coworker entry points.

### 8. Keep host behavior shared

Codex, Claude, Grok, embedded adapters, and generic MCP clients all enter the
same PAT-authenticated MCP route and the same coworker tool pack. Host
classification is covered as metadata and compatibility evidence; it does not
branch the coordination implementation.

The compatibility test matrix includes current and N-1 protocol envelopes. The
current `2026-07-28` path is stateless. The `2025-11-25` path may still arrive
through the existing initialize-compatible route, but threadless PAT handoff
uses the same application task adapter rather than protocol session affinity.

## Data and authority model

No schema migration is required.

The relevant identity chain is:

```text
authenticated PAT principal
        |
        v
submitRemoteCoworkerTask(requestKey, named target)
        |
        +--> AgentThread (server-created canonical lineage)
        |
        +--> TaskRun (durable external handle)
        |
        +--> named coworker execution under its own grants
```

Authority never flows from `requestKey`, `callerClient`, `targetAgent`, or
question text. Those fields shape a request after authentication; the governed
wrapper and target resolver decide whether the action may run.

## Concurrency and idempotency

- Two retries with the same PAT, `requestKey`, and immutable request digest
  return one task.
- Two different keys create separate threads/tasks even when they share a PAT.
- The same key under a different token/user cannot read or reuse another
  principal's task.
- The same token/key with a different target, objective, risk, scope, route, or
  collaboration kind returns `idempotency_conflict`.
- No process-local cache or sticky server affinity is required.

The implementation must prove these rules through the existing task
idempotency boundary rather than a handler-local mutex.

## UX contract

This BI changes no portal layout. Its UX surface is the co-worker response seen
by an external contributor and, indirectly, whether a reviewer interaction
appears in the portal.

The first failure sentence names the missing or rejected concept in plain
language. The second sentence gives one exact next action. Successful dispatch
names the target and task state without implying approval. No raw database id
other than the stable semantic task id is required for the operator to proceed.

This prevents the contradiction reported in the onboarding BI: the platform
must not tell the operator to open or request a review through a route that the
same install cannot execute.

## Security and privacy

- Never accept `threadId` as an ordinary argument for these tools.
- Never trust client correlation metadata as lineage authority.
- Scope task lookup and idempotency to the authenticated principal/token.
- Preserve the PAT's capability and grants; the adapter cannot widen them.
- Preserve target coworker lifecycle, clearance, sensitivity, and tool-grant
  checks.
- Do not echo PAT material or internal primary keys in errors.
- Record the task, target, request key, auth source, and outcome in existing
  audit substrates.
- Treat target resolution ambiguity as an error, not a fallback.

## Scalability and operations

The path performs the same indexed thread upsert and task creation already used
by `tasks/submit`. It adds no session table, sticky routing, in-memory state, or
per-host worker. Any web instance can process a retry from durable data.

Operational telemetry distinguishes queued, idempotent replay, input required,
target rejected, and execution failure. The metric dimension uses normalized
caller-client classes and must not include raw request keys or objectives.

## Implementation boundaries

Expected implementation scope after approval:

- `apps/web/lib/mcp/packs/coworker-pack.ts`
- `apps/web/lib/mcp/packs/coworker-pack.test.ts`
- `apps/web/lib/mcp/external-coworker-task-adapter.ts` and its focused test;
- `apps/web/lib/mcp-task-submit.ts` and its focused tests for token-bound digest
  replay/conflict semantics; and
- focused route tests only for execution-context projection regressions.

`apps/web/app/api/mcp/v1/route.ts`, Prisma schema, portal UI, and internal
session-token code are not expected to change.

The overlapping external-readiness task released its coworker-pack claims on
2026-08-23 after confirming that it had only a local, unpublished
`request_coworker` half-change. `WC-12BC22D4` owns the complete request plus
summon contract so both doors land against one shared adapter and immutable
task identity. The releasing task will reconcile by normal ancestry after this
change publishes; it will not mutate these paths in parallel.

## Live evidence (development install, 2026-08-23 CDT)

- `BI-B131F357` and `WC-DD1EF64C` resolve with immutable plan commit
  `544830a220adbda0570da17e391dabd0d429b1fc` and provider blob
  `5c1b7349c2848f6676ea8e4e075105b6526bb144`.
- `BI-6804F720` is the canonical routing defect. `BI-91AF30A5` was identified
  during reproduction and later retired as a duplicate; related plan-coverage
  remediation remains tracked by `BI-0996913C`. The remediation's former
  `BI-B9403248` citation was queried and returned `not_found`; current main no
  longer hardcodes it.
- Coworker discovery resolves `AGT-WS-REVIEW` (Change Reviewer). The reviewer
  registry grants `initiative_design_review`, while the external human PAT
  correctly does not expose `record_initiative_design_review` for self-use.
- Both `request_coworker` and `summon_coworker`, called with the same subject
  and immutable artifact locator, return `missing_threadId` before dispatch.
- No spec-approval receipt or `initiative_scope_baseline` can be produced on
  the installed runtime through that documented route. No self-approval,
  synthetic receipt, direct database write, or reviewer-principal weakening
  was attempted.
- Focused source regressions prove the repaired threadless lane for Codex,
  Claude, Grok, embedded, and generic MCP metadata. Live success evidence must
  follow merge and governed deployment because the installed runtime still
  serves the pre-fix implementation.

## Verification plan

### Unit and integration tests

- reproduce `missing_threadId` for both handlers on current main;
- prove external request and summon calls use the auth-bound task adapter;
- prove portal-thread calls still use their original collaboration owners;
- prove a missing `requestKey` returns `missing_requestKey` without dispatch;
- prove an unverified non-PAT context returns
  `external_handoff_context_required`;
- prove the exact target and authority fields reach remote task submission;
- prove duplicate request keys replay one task;
- prove another token under the same user cannot replay that task;
- prove a conflicting immutable envelope returns `idempotency_conflict`;
- prove task-owner typed failures survive ToolResult conversion;
- exercise normalized Codex, Claude, Grok, embedded, and generic caller
  metadata through one shared adapter; and
- run related route, coworker-pack, task-submit, grant, and authorization tests.

### Functional verification

On the governed development install, use an authenticated external MCP task to:

1. discover the independent Change Reviewer;
2. call `request_coworker` with a deterministic packet;
3. observe a semantic task id and one visible peer interaction;
4. retry and confirm an idempotent replay rather than a duplicate;
5. repeat through `summon_coworker`;
6. inspect the completed result and audit lineage; and
7. use the repaired path to obtain an independent review for BI-2C50F548.

Structural tests alone do not satisfy this acceptance path.

## Rollback

The change is code-only and schema-free. Rollback restores the two handlers to
their prior missing-thread refusal while leaving any already-created
AgentThread and TaskRun records as immutable audit history. No destructive data
cleanup is required.

## Acceptance criteria traceability

| BI acceptance criterion | Design coverage |
|---|---|
| Verified external task identity reaches request and summon | Auth-bound task adapter; server-created AgentThread and TaskRun |
| Caller cannot spoof another task through ordinary arguments | No `threadId` argument; PAT-scoped task creation and lookup |
| Missing/invalid identity is typed and actionable | Explicit error table and repair messages |
| Codex/Claude/Grok/embedded/generic compatibility | Shared handler lane and host-metadata test matrix |
| Regression reproduces and proves fixed propagation | Unit, integration, and live functional verification plan |

## Open review questions

1. Should the immutable request digest be stored in the existing `a2aMetadata`
   JSON only, or does the task owner already expose a canonical digest field
   that should be reused?
2. Does the live task activity projection already render collaboration kind,
   or does it need a read-model-only label change after the backend contract is
   proven?
