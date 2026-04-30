# Orchestration Primitives Implementation Plan — Coworker Execution Substrate

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Land four orchestration primitives (`Sequential` / `Parallel` / `Loop` / `Branch`) plus a unified event envelope; migrate ~13 in-process retry/iteration surfaces; retire all legacy retry constants and the legacy positional bus API.

**Architecture:** New `apps/web/lib/orchestration/` module — the **coworker execution substrate** — owns deterministic primitives, typed `Outcome<T>` (succeeded/failed/exhausted/cancelled), governance-derived budgets, runId-scoped heartbeats. The existing `agentEventBus` evolves to carry a shared envelope (`runId`, `userId`, `threadId?`, `taskRunId?`, `agentId?`, `governanceProfile`, `cost`) on every event variant; subscribers filter by `{ threadId }` or `{ userId }`.

**Naming guardrail:** This substrate is **distinct from the routing execution-adapter framework** (`apps/web/lib/routing/`, see [2026-03-20-execution-adapter-framework-design.md](../specs/2026-03-20-execution-adapter-framework-design.md)). In code, doc prose, PR descriptions, and commit messages, refer to this layer as the "orchestration substrate" or "coworker execution substrate" — never as an "execution adapter," which is reserved for provider-dispatch plumbing.

**Refactor budget:** **20% of every migration PR's effort** is reserved for refactoring and deletion (per spec §Mandatory Refactor Budget). Each migration phase has named refactor-budget targets — at least one constant, helper, or ambiguous status behavior must retire in the merging PR. Reviewers reject wrapper-only migrations.

**Tech Stack:** TypeScript strict, Vitest, Next.js 14 App Router, Prisma 5, Inngest (durable shell preserved). No new runtime dependencies.

**Spec:** [docs/superpowers/specs/2026-04-29-orchestration-primitives-design.md](../specs/2026-04-29-orchestration-primitives-design.md)

**Supersession context:** This plan was merged with the Codex substrate review (PR #350) on 2026-04-30 per [audits/2026-04-29-orchestration-supersession-decision.md](../audits/2026-04-29-orchestration-supersession-decision.md). The principal restructure: Phase 1B was originally a 16-file/40-emit-site bus refactor as a foundation step. The Codex audit flagged that as the highest-risk slice in the lane. This revised plan splits Phase 1B into a small types-only PR; emit-site migrations move into their consumer phases (Phase 2 migrates sandbox-db + github-fork emit sites, Phase 3 migrates build-* emit sites, etc.); Phase 7 tightens the envelope to mandatory.

**Branch:** Implementation work uses topic branches `feat/orch-phase-N-<slice>` per the AGENTS.md PR-based workflow. All commits signed off (`git commit -s`) per the project DCO requirement.

---

## Per-PR Test Gate Checklist

Every migration PR (Phases 2–6) must satisfy ALL of these before merge:

- [ ] **Behavior parity test** — exercises the migrated call site; passes against new primitive (Phase 6 explicitly breaks parity for silent-exhaustion paths and asserts the new fail-loud behavior)
- [ ] **Terminal-outcome test** — every code path returns a typed `Outcome` (no `null`, no free-text best-effort, no `"deferred"`)
- [ ] **Event emission test** — at least one terminal event (`*:succeeded` / `*:failed` / `*:exhausted` / `*:cancelled`) per primitive run
- [ ] **Heartbeat test** — Loops with possibly-slow steps emit `loop:still_working` within `1.5 × heartbeatMs`; consumer-emitted events inside the step do **not** reset the heartbeat (per spec §Heartbeat Contract edge-case clarification). Skip if surface always completes < heartbeatMs
- [ ] **Cost monotonicity test** — cumulative `cost.tokens`, `cost.ms`, and `cost.attempts` non-decreasing across events for the same `runId` (per spec §Cost Monotonicity Invariant)
- [ ] **Refactor-budget evidence** — at least one named constant, helper, or ambiguous status behavior retired in this PR (per spec §Mandatory Refactor Budget). The PR description must list what was deleted under a "Refactor budget delivered" heading
- [ ] `pnpm --filter web typecheck` clean
- [ ] `pnpm --filter web exec vitest run <affected>` green
- [ ] `cd apps/web && npx next build` clean
- [ ] DCO sign-off on every commit

---

## Phase 1 — Foundation (sub-phased into three PRs)

Per the Codex substrate audit, the original "Phase 1B = 16-file/40-emit-site bus refactor" was the highest-risk slice in the lane. This revised plan splits Phase 1 across three small PRs, then distributes emit-site migration into the consumer phases that need it. The foundation never blocks consumers behind a 16-file refactor.

### Phase 1.0 — Naming guardrails (folded into 1A; informational)

These guardrails are not a separate PR — they are checklist items reviewers verify in Phase 1A and every later phase:

- [ ] **Module README/header.** The first PR landing files in `apps/web/lib/orchestration/` includes a top-of-file comment in `index.ts` (or a `README.md` in the directory) stating: this module is the **coworker execution substrate** (in-process control flow), distinct from the routing execution-adapter framework in `apps/web/lib/routing/`.
- [ ] **Terminology in PR descriptions.** Every PR in this lane uses "orchestration substrate" or "coworker execution substrate" — never bare "execution adapter."
- [ ] **Migration order recorded in epic/backlog.** The active epic for this work names the seven-phase order so later contributors do not jump straight to Phase 6 (agentic loop).

### Phase 1A — Orchestration Module Skeleton (PR 1) — ✅ SHIPPED 2026-04-29

**Status:** Shipped via [PR #353](https://github.com/markdbodman/opendigitalproductfactory/pull/353), commit `d2852ac4` ("feat(orchestration): module skeleton — primitives, profiles, heartbeat (Phase 1A)"). All Phase 1A tasks below are historical record.

**Branch:** `feat/orch-phase-1a-skeleton` (merged)

**Goal:** Land the new module with primitives, types, and the governance registry. **No bus changes, no call-site migrations.** The module is wired up but unused.

#### Task 1A.1 — Module bootstrap

**Files:**
- Create: `apps/web/lib/orchestration/index.ts`
- Create: `apps/web/lib/orchestration/types.ts`
- Create: `apps/web/lib/orchestration/assert-never.ts`

- [ ] **Step 1:** Write `apps/web/lib/orchestration/types.ts` with the type contracts from spec §Type Contracts (lines 376–416): `GovernanceProfile`, `RunContext`, `Outcome<T>`, `ExhaustionReason`, `Evidence`, plus a new `OrchestrationError` interface
- [ ] **Step 2:** Write `apps/web/lib/orchestration/assert-never.ts` — a one-line helper `export function assertNever(x: never, ctx?: string): never { throw new Error(\`Unhandled variant: \${JSON.stringify(x)} (${ctx ?? ""})\`); }`
- [ ] **Step 3:** Write `apps/web/lib/orchestration/index.ts` re-exporting the public surface
- [ ] **Step 4:** Run `pnpm --filter web typecheck`
- [ ] **Step 5:** Commit: `feat(orchestration): scaffold types and module skeleton`

#### Task 1A.2 — Governance profile registry

**Files:**
- Create: `apps/web/lib/orchestration/governance-profiles.ts`
- Create: `apps/web/lib/orchestration/governance-profiles.test.ts`

- [ ] **Step 1:** Write the failing test `governance-profiles.test.ts`:
  - asserts every `ProfileBudget` has positive `maxAttempts`/`deadlineMs`/`heartbeatMs`
  - asserts `system.tokenBudget === 0` (per spec §Governance Profile Registry)
  - asserts `deriveGovernanceProfile({ hitlPolicy: "always", autonomyLevel: "any" })` returns `"high-assurance"`
  - asserts `deriveGovernanceProfile({ autonomyLevel: "constrained", hitlPolicy: "any" })` returns `"balanced"`
  - asserts `deriveGovernanceProfile({ autonomyLevel: "autonomous", maxDelegationRiskBand: "low", hitlPolicy: "any" })` returns `"economy"`
  - asserts unknown profile slug → `resolveBudget()` throws synchronously
- [ ] **Step 2:** Run test, verify all five fail
- [ ] **Step 3:** Implement `governance-profiles.ts` with `GOVERNANCE_PROFILES` constant (spec §Shape, with quoted hyphenated keys), `resolveBudget(ctx)`, and `deriveGovernanceProfile(g)` per spec §Derivation Rule
- [ ] **Step 4:** Run test, verify all five pass
- [ ] **Step 5:** Commit: `feat(orchestration): governance profile registry with derivation`

#### Task 1A.3 — Heartbeat helper

**Files:**
- Create: `apps/web/lib/orchestration/heartbeat.ts`
- Create: `apps/web/lib/orchestration/heartbeat.test.ts`

- [ ] **Step 1:** Write the failing test using `vi.useFakeTimers()`:
  - `startHeartbeat(runId, heartbeatMs, onTick)` schedules `onTick` after `heartbeatMs` of quiet
  - `noteActivity(runId)` resets the timer
  - `stopHeartbeat(runId)` clears the timer; subsequent `vi.advanceTimersByTime` does not fire
- [ ] **Step 2:** Run test, verify it fails
- [ ] **Step 3:** Implement `heartbeat.ts` per spec §Heartbeat Contract — runId-scoped Map of timers, started at primitive entry, cleared in `finally`
- [ ] **Step 4:** Run test, verify it passes
- [ ] **Step 5:** Commit: `feat(orchestration): runId-scoped heartbeat helper`

#### Task 1A.4 — Sequential primitive

**Files:**
- Create: `apps/web/lib/orchestration/primitives/sequential.ts`
- Create: `apps/web/lib/orchestration/primitives/sequential.test.ts`

- [ ] **Step 1:** Write the failing test:
  - all-succeed: returns `Outcome.succeeded` with array of values, evidence array length === step count
  - first-fails: short-circuits, returns the failure unchanged, remaining steps not invoked (assert with spy)
  - first-exhausts: short-circuits, returns the exhaustion unchanged
  - first-cancelled: short-circuits with cancelled
- [ ] **Step 2:** Run test, verify all four fail
- [ ] **Step 3:** Implement `Sequential(steps, ctx)` per spec §Sequential — Semantics. Use `assertNever` on the outcome's status field
- [ ] **Step 4:** Run test, verify all four pass
- [ ] **Step 5:** Commit: `feat(orchestration): Sequential primitive`

#### Task 1A.5 — Parallel primitive

**Files:**
- Create: `apps/web/lib/orchestration/primitives/parallel.ts`
- Create: `apps/web/lib/orchestration/primitives/parallel.test.ts`

- [ ] **Step 1:** Write the failing test:
  - `errorPolicy: "all_must_succeed"` — any failure returns `failed` with full trail of all outcomes
  - `errorPolicy: "best_effort"` — synthesizes over succeeded; zero-succeeded returns `failed`
  - `errorPolicy: "quorum"` with `minSucceeded: 2` — passes at 2/3, fails at 1/3
  - **No default errorPolicy** — TypeScript should make this a required field; add a runtime guard test that constructing without it throws
- [ ] **Step 2:** Run test, verify all four fail
- [ ] **Step 3:** Implement `Parallel(steps, opts, ctx)` with `Promise.allSettled` internally. `synthesize` is required
- [ ] **Step 4:** Run test, verify all four pass
- [ ] **Step 5:** Commit: `feat(orchestration): Parallel primitive`

#### Task 1A.6 — Loop primitive

**Files:**
- Create: `apps/web/lib/orchestration/primitives/loop.ts`
- Create: `apps/web/lib/orchestration/primitives/loop.test.ts`

- [ ] **Step 1:** Write the failing test:
  - succeeds when `exitWhen` returns true
  - exhausts with `reason: "max_attempts"` when budget hits `maxAttempts`, evidence array contains all attempts
  - exhausts with `reason: "deadline"` when `deadlineMs` elapses (use fake timers)
  - exhausts with `reason: "token_budget"` when cumulative `tokensUsed` exceeds budget
  - `strategy` is invoked with prior outcomes + attempt number; attempt 0 receives empty priors
  - cancellation signal mid-loop returns `Outcome.cancelled{ reason: "user_cancelled" }`
- [ ] **Step 2:** Run test, verify all six fail
- [ ] **Step 3:** Implement `Loop(step, opts, ctx)`. Wire `resolveBudget(ctx)`. Heartbeat starts at entry, cleared in `finally`
- [ ] **Step 4:** Run test, verify all six pass
- [ ] **Step 5:** Commit: `feat(orchestration): Loop primitive with budget-driven exhaustion`

#### Task 1A.7 — Branch primitive

**Files:**
- Create: `apps/web/lib/orchestration/primitives/branch.ts`
- Create: `apps/web/lib/orchestration/primitives/branch.test.ts`

- [ ] **Step 1:** Write the failing test:
  - all branches succeed → `merge` invoked with all outcomes, returns merged `Outcome.succeeded`
  - one branch fails, others succeed → `merge` receives mixed; merge logic decides terminal
  - `exitEarly` predicate fires → first satisfying branch wins; remaining branches receive `Outcome.cancelled{ reason: "upstream_cancelled" }`; `branch:cancelled` events emitted for cancelled branches
  - `exitEarly` not provided → wait for all, then merge
- [ ] **Step 2:** Run test, verify all four fail
- [ ] **Step 3:** Implement `Branch(branches, opts, ctx)` with `AbortController` for each branch so `exitEarly` cancellation is real, not just a flag
- [ ] **Step 4:** Run test, verify all four pass
- [ ] **Step 5:** Commit: `feat(orchestration): Branch primitive with exitEarly cancellation`

#### Task 1A.8 — Structural "every primitive emits a terminal event" test

**Files:**
- Create: `apps/web/lib/orchestration/structural.test.ts`

- [ ] **Step 1:** Write a test that wraps each primitive's invocation, runs scenarios that hit every code path (succeed, fail, exhaust, cancel where applicable), and asserts exactly one terminal event was captured per `runId`. The wrapper observes emit calls — this is **runtime-instrumented**, not a static lint, per spec §Verification Plan
- [ ] **Step 2:** Run; expect failures because the primitives don't emit yet (events come in Phase 1B)
- [ ] **Step 3:** Mark these tests `it.todo` for now with a comment pointing to Phase 1C Task 1C.3; they activate once the bus envelope is in place
- [ ] **Step 4:** Commit: `test(orchestration): structural terminal-event scaffolding (it.todo until 1B)`

#### Task 1A.9 — Open Phase 1A PR

- [ ] **Step 1:** `git checkout -b feat/orch-phase-1a-skeleton` (off `main`, not the spec branch)
- [ ] **Step 2:** Verify per-PR gates: typecheck, vitest run on `apps/web/lib/orchestration/**`, next build
- [ ] **Step 3:** Open PR with title `feat(orchestration): module skeleton — primitives, profiles, heartbeat (Phase 1A)`. Body cites the spec, lists the four primitives, notes "no call-site migrations yet"
- [ ] **Step 4:** Wait for review/merge before starting 1B

---

### Phase 1B — Bus Envelope Foundation (PR 2)

**Branch:** `feat/orch-phase-1b-envelope-types`

**Goal:** Add `OrchestrationEnvelope` type, `subscribe({ threadId })` / `subscribe({ userId })` overloads, and tests. **All envelope fields optional. No emit-site migration.** This is a small, focused PR — the entire diff fits in one file plus its test file.

**Why this scope (not the original 16-file refactor):** Per the Codex audit and the supersession decision (2026-04-29), bundling the type addition with 40 emit-site migrations was the highest-risk slice in the lane. Splitting them lets reviewers read the type change cleanly, and lets emit-site migrations land *with their consumers* in Phases 2–6.

#### Task 1B.1 — Define the envelope and the new subscribe shape (typecheck-clean)

**Files:**
- Modify: `apps/web/lib/tak/agent-event-bus.ts`

**Important:** the project's pre-commit hook runs typecheck. **Never skip hooks** (`--no-verify` forbidden). This task lands the envelope with **all fields optional** so typecheck stays clean throughout. `userId` and `emittedAt` become mandatory in Phase 7 after every consumer phase has populated them.

- [ ] **Step 1:** Read `apps/web/lib/tak/agent-event-bus.ts` end-to-end. Note existing exports: `subscribe`, `emit`, `requestCancel`, `clearCancel`, `isCancelled`, `markActive`, `markIdle`, `isActive`
- [ ] **Step 2:** Add the `OrchestrationEnvelope` type (per spec §Required Envelope). All fields **optional**: `runId?`, `userId?`, `threadId?`, `taskRunId?`, `agentId?`, `governanceProfile?`, `primitive?`, `emittedAt?`, `cost?`
- [ ] **Step 3:** Modify the existing `AgentEvent` discriminated union: every variant gets `& Partial<OrchestrationEnvelope>` as a base intersection. **Do not add required fields** — that's Phase 7
- [ ] **Step 4:** Add subscribe overloads (signatures shown below). Internal storage: keep the existing `Map<threadId, Set<handler>>` AND add `Map<userId, Set<handler>>`. On `emit`, fire to both maps if event has `userId`.

```ts
function subscribe(threadId: string, handler: (e: AgentEvent) => void): () => void;             // legacy positional
function subscribe(filter: { threadId: string }, handler: (e: AgentEvent) => void): () => void; // new
function subscribe(filter: { userId: string }, handler: (e: AgentEvent) => void): () => void;   // new
```

- [ ] **Step 5:** `pnpm --filter web typecheck` — must be clean (envelope fields are optional)
- [ ] **Step 6:** Commit: `refactor(bus): add OrchestrationEnvelope and subscribe overloads`

#### Task 1B.2 — Test the new bus surface

**Files:**
- Modify: `apps/web/lib/tak/agent-event-bus.test.ts`

- [ ] **Step 1:** Write failing tests:
  - **Red:** `subscribe({ threadId })` receives only events matching that threadId — initially fails because new overload not implemented
  - **Red:** `subscribe({ userId })` receives only events matching that userId
  - **Red:** An event with both `userId` and `threadId` is delivered to both subscriber types (assert via two parallel subscribers)
  - **Red:** The legacy positional `subscribe(threadId, handler)` still works after the refactor (compatibility regression check)
- [ ] **Step 2:** Run vitest, confirm all four fail
- [ ] **Step 3:** **Green:** Adjust internal `emit` to fan out to both maps; implement subscribe overloads
- [ ] **Step 4:** Run vitest, confirm all four pass
- [ ] **Step 5:** **Induced-failure smoke check:** Temporarily break the userId-map fan-out (comment one line), confirm the userId-subscriber test fails as expected, then restore. This proves the test is actually exercising the new code path
- [ ] **Step 6:** Commit: `test(bus): envelope subscription overloads`

#### Task 1B.3 — Open Phase 1B PR

- [ ] **Step 1:** Verify gates: typecheck clean, vitest green, next build clean, every commit DCO-signed
- [ ] **Step 2:** Refactor-budget evidence: this PR is the foundation that *enables* later refactor-budget gains; it doesn't itself retire constants. PR description should call this out: "Phase 1B is intentionally additive — refactor-budget gains begin in Phase 2"
- [ ] **Step 3:** Open PR `refactor(bus): OrchestrationEnvelope + subscription overloads (Phase 1B)`. Body explicitly notes:
  - All envelope fields optional in this PR
  - Legacy positional `subscribe(threadId, handler)` and `emit(threadId, event)` remain as shims (retire in Phase 7)
  - **No emit-site migrations** in this PR; they happen in Phases 2–6 alongside their consumer migrations
- [ ] **Step 4:** Wait for review/merge before starting 1C

---

### Phase 1C — Wire Substrate to Bus + Cancellation Mapping (PR 3)

**Branch:** `feat/orch-phase-1c-substrate-events`

**Goal:** Wire substrate primitives to emit through the new envelope, activate the structural terminal-event tests, and map `agentEventBus.requestCancel` into `Outcome.cancelled`. After this PR merges, the substrate is fully usable and consumer migrations can begin.

#### Task 1C.1 — Wire orchestration primitives to the bus

**Files:**
- Modify: `apps/web/lib/orchestration/primitives/sequential.ts`
- Modify: `apps/web/lib/orchestration/primitives/parallel.ts`
- Modify: `apps/web/lib/orchestration/primitives/loop.ts`
- Modify: `apps/web/lib/orchestration/primitives/branch.ts`
- Create: `apps/web/lib/orchestration/events.ts` (typed event constructors)

- [ ] **Step 1: Red.** Write failing tests in each primitive's `*.test.ts`: assert each primitive emits the correct sequence of events (`*:started`, intermediate, terminal `*:succeeded`/`*:failed`/`*:exhausted`/`*:cancelled`). Use a captured-events array seeded by `subscribe({ userId: testUserId })`. Initial expected count is 0 (primitives don't emit yet); tests fail
- [ ] **Step 2:** Run vitest on `apps/web/lib/orchestration/**`, confirm new event-emission tests fail
- [ ] **Step 3: Green.** Implement `events.ts` with typed constructors per spec §Event Families. Each constructor takes `(envelope, payload)` and returns the discriminated event with `emittedAt: new Date().toISOString()` and `runId` from `ctx.runId`
- [ ] **Step 4:** Each primitive imports event constructors and emits at: entry (`*:started`), each step boundary (`*:step_started`/`*:step_completed` or `*:attempt_started`/`*:attempt_completed` or `*:branch_started`/`*:branch_completed`), terminal (`*:succeeded`/`*:failed`/`*:exhausted`/`*:cancelled`)
- [ ] **Step 5:** Run vitest, verify all primitive event tests pass
- [ ] **Step 6: Cost monotonicity proof.** Add a per-primitive test that captures the full event sequence for each terminal path and asserts cumulative `cost.tokens`, `cost.ms`, and `cost.attempts` are non-decreasing across events for the same `runId` (per spec §Cost Monotonicity Invariant)
- [ ] **Step 7:** Commit: `feat(orchestration): wire primitives to event bus with typed events`

#### Task 1C.2 — Heartbeat substrate-only reset behavior

**Files:**
- Modify: `apps/web/lib/orchestration/heartbeat.ts`
- Modify: `apps/web/lib/orchestration/heartbeat.test.ts`
- Modify: `apps/web/lib/orchestration/primitives/loop.ts`

Implements the spec §Heartbeat Contract edge-case clarification: only substrate-emitted events reset the quiet timer.

- [ ] **Step 1: Red.** Write a failing test: a `Loop` whose step emits a non-substrate bus event (e.g., `tool:invoked`) every 2 seconds, with `heartbeatMs: 5000`. Assert that `loop:still_working` fires within 5–7 seconds of step entry, *despite* the consumer-emitted events. Initial implementation may incorrectly reset on every event and never fire the heartbeat
- [ ] **Step 2:** Run vitest, expect failure
- [ ] **Step 3: Green.** Refactor heartbeat reset path: `noteActivity(runId)` is called *only* by the substrate's own emit path (the typed constructors in `events.ts`), not by the bus's general `emit()`. Consumer code emitting through the bus does not reset the substrate's quiet timer
- [ ] **Step 4:** Run vitest, expect green
- [ ] **Step 5: Induced-failure smoke check.** Temporarily call `noteActivity()` from the bus's general `emit()`, confirm the consumer-noise test fails (heartbeat never fires), then restore. Proves the test exercises the actual constraint
- [ ] **Step 6:** Commit: `fix(orchestration): heartbeat resets only on substrate events, not consumer noise`

#### Task 1C.3 — Activate structural terminal-event tests

**Files:**
- Modify: `apps/web/lib/orchestration/structural.test.ts`

- [ ] **Step 1:** Remove `it.todo` markers placed in Phase 1A Task 1A.8
- [ ] **Step 2:** Run; verify all assertions pass — every primitive emits exactly one terminal event per `runId` for every code path (succeed, fail, exhaust, cancel where applicable)
- [ ] **Step 3:** Commit: `test(orchestration): activate structural terminal-event invariant`

#### Task 1C.4 — Cancellation hook on RunContext

**Files:**
- Modify: `apps/web/lib/orchestration/primitives/loop.ts`
- Modify: `apps/web/lib/orchestration/primitives/branch.ts`
- Modify: `apps/web/lib/orchestration/types.ts`
- Create: `apps/web/lib/orchestration/cancellation.test.ts`

- [ ] **Step 1: Red.** Write failing tests:
  - A `Loop` whose `RunContext.threadId` has `agentEventBus.requestCancel(threadId)` called mid-run returns `Outcome.cancelled{ reason: "user_cancelled" }` and emits `loop:cancelled`
  - A `Branch` with the same setup cancels in-flight branches and returns `Outcome.cancelled{ reason: "user_cancelled" }`
  - Cancellation is checked at every attempt boundary (Loop) and on every branch settling (Branch)
- [ ] **Step 2:** Run, expect failure
- [ ] **Step 3: Green.** In `Loop` and `Branch`, before each attempt/branch settling, check `ctx.threadId && agentEventBus.isCancelled(ctx.threadId)`. If cancelled, return `Outcome.cancelled` with `reason: "user_cancelled"`, emit `*:cancelled`, clear the flag with `clearCancel(threadId)`
- [ ] **Step 4:** Run, expect green
- [ ] **Step 5: Induced-failure smoke check.** Disable the cancellation check in Loop, confirm the test detects the regression, restore
- [ ] **Step 6:** Commit: `feat(orchestration): map agentEventBus cancellation into Outcome.cancelled`

#### Task 1C.5 — `RunContext.runId` ↔ `ToolExecution` linkage (forensics)

**Files:**
- Modify: `apps/web/lib/mcp-governed-execute.ts`
- Modify: `apps/web/lib/mcp-governed-execute.test.ts`

Per spec §Forensics Linkage: substrate `runId` must be persisted on `ToolExecution.routeContext` so receipts and orchestration runs can be joined.

- [ ] **Step 1: Red.** Write a failing test: when `governedExecuteTool` is called with a context carrying a substrate `runId`, the resulting `ToolExecution` row's `routeContext` field contains the `runId` (or includes it in a structured way alongside route info). Initial code does not pass `runId` through, so the test fails
- [ ] **Step 2:** Run, expect failure
- [ ] **Step 3: Green.** Thread `runId` from the calling context through `governedExecuteTool` into the `ToolExecution.routeContext` write. If `routeContext` already carries a structured payload, append `runId` to it; if it's a string field, use a `JSON.stringify` envelope or a documented delimiter
- [ ] **Step 4:** Run, expect green
- [ ] **Step 5:** Commit: `feat(orchestration): persist substrate runId on ToolExecution for forensics`

#### Task 1C.6 — Open Phase 1C PR

- [ ] **Step 1:** Verify per-PR gates (note: Phase 1C is foundation work, so it's exempt from the refactor-budget gate — Phase 2 is where retirements begin)
- [ ] **Step 2:** Open PR `feat(orchestration): wire substrate to event bus, cancellation mapping, ToolExecution forensics (Phase 1C)`. Phase 1 complete after merge
- [ ] **Step 3:** Wait for review/merge before starting Phase 2

---

## Phase 2 — Low-Risk Polling Migrations (one PR)

**Branch:** `feat/orch-phase-2-polling`

**Goal:** Migrate `sandbox-db.ts` polls and `github-fork.ts` poll. These are infra-tier (use `system` profile), have simple exit predicates, and the github-fork migration **fixes a known silent-failure bug** (`{status: "deferred"}`).

**Refactor-budget targets retired in this PR:**
- `"deferred"` status string in `github-fork.ts`
- local poll-deadline constant `POLL_TIMEOUT_MS` in `sandbox-db.ts` (replaced by governance-derived `deadlineMs`)
- local poll-interval constant `POLL_INTERVAL_MS` (replaced by Loop's strategy delay)

**Emit-site migration scope:** any `agentEventBus.emit(...)` calls inside `sandbox-db.ts`, `github-fork.ts`, or their immediate callers migrate to envelope shape (populating `userId`, `emittedAt`, `runId`) **in this PR**. These are infra-tier emits — Task 2.0 establishes the `system` user constant for that purpose.

### Task 2.0 — `system` user constant for infra-tier emits

**Files:**
- Modify: `packages/db/prisma/seed.ts` (or wherever the user seed lives)
- Create: `apps/web/lib/orchestration/system-user.ts`

Per memory `feedback_db_fixes_must_hit_seed`: every DB fix must also update seed/migration. The system user is needed because infra-tier substrate emits (`sandbox-db`, `github-fork`, future `mcp-catalog-sync` migrations) have no caller-supplied `userId`.

- [ ] **Step 1:** Check existing seed for a `system` user. Run `pnpm --filter @dpf/db prisma studio` or grep the canonical seed file for `email.*system` / `userId.*system`
- [ ] **Step 2:** If a system user exists, document its userId in `apps/web/lib/orchestration/system-user.ts` as a constant. If not, add an idempotent `upsert` entry to the canonical seed file with stable userId (e.g. `system-orchestration`), email `system@dpf.local`, displayName `"System (Orchestration)"`. Use Prisma's `upsert` so re-seed is idempotent
- [ ] **Step 3:** Add a test asserting the system user exists after seeding **and that the `SYSTEM_USER_ID` constant in `system-user.ts` matches the seeded userId exactly** (assert by reading both and comparing). A typo in either side silently routes infra emits to a non-existent user; the per-PR userId test won't catch a constant/seed mismatch unless this assertion exists
- [ ] **Step 4:** Commit: `feat(orchestration): system user constant + idempotent seed`

### Task 2.1 — Migrate `sandbox-db.ts` `pollUntilReady`

**Files:**
- Modify: `apps/web/lib/integrate/sandbox/sandbox-db.ts:50-66`
- Modify: `apps/web/lib/integrate/sandbox/sandbox-db.test.ts`

- [ ] **Step 1:** Read existing `pollUntilReady` and `pollUntilHealthy` (lines 50–81). Note constants `POLL_TIMEOUT_MS = 30_000`, `POLL_INTERVAL_MS = 2_000`
- [ ] **Step 2:** Write a behavior parity test against current `pollUntilReady` so the new implementation has a baseline. Capture: (a) returns when command succeeds, (b) throws after deadline
- [ ] **Step 3:** Reimplement `pollUntilReady` using `Loop`:
  ```ts
  const result = await Loop(
    () => /* docker inspect command */,
    {
      exitWhen: (outcome) => outcome.status === "succeeded",
      strategy: () => ({ /* same command each time */ }),
    },
    { ...systemRunContext, governanceProfile: "system" }
  );
  if (result.status === "exhausted") throw new Error(`sandbox not ready within ${POLL_TIMEOUT_MS}ms`);
  if (result.status === "failed") throw result.error;
  ```
- [ ] **Step 4:** Run test, verify parity
- [ ] **Step 5:** Commit: `refactor(sandbox-db): migrate pollUntilReady to Loop`

### Task 2.2 — Migrate `sandbox-db.ts` `pollUntilHealthy`

- [ ] **Step 1:** Same shape as 2.1, applied to `pollUntilHealthy` (lines 68–81)
- [ ] **Step 2:** Behavior parity test
- [ ] **Step 3:** Reimplement
- [ ] **Step 4:** Run test
- [ ] **Step 5:** Commit: `refactor(sandbox-db): migrate pollUntilHealthy to Loop`

### Task 2.3 — Migrate `github-fork.ts` poll (silent-failure fix)

**Files:**
- Modify: `apps/web/lib/integrate/github-fork.ts:105-119`
- Modify: `apps/web/lib/integrate/github-fork.test.ts`

- [ ] **Step 1:** Read existing `createForkAndWait` (lines 77–119). Note silent-success path at line 119: `return { status: "deferred", forkOwner, forkRepo }`
- [ ] **Step 2:** Write a parity test for the success path AND a NEW test asserting the failure-mode change: timeout returns `{ status: "exhausted", reason: "deadline", evidence: [...] }` — NOT `{ status: "deferred" }`
- [ ] **Step 3:** Find every caller of `createForkAndWait` (grep `createForkAndWait`). For each caller, update to handle `Outcome.exhausted` explicitly. **This is a behavior change** — callers that previously treated `"deferred"` as "retry later, not an error" must be updated. List callers in the PR description
- [ ] **Step 4:** Reimplement `createForkAndWait` using `Loop` with `system` profile. The poll deadline becomes the Loop's `deadlineMs`
- [ ] **Step 5:** Run all tests; verify parity AND the new failure-mode assertion
- [ ] **Step 6:** Commit: `refactor(github-fork): migrate poll to Loop; remove silent "deferred" return`

### Task 2.4 — Migrate emit sites in touched files to envelope shape

**Files:**
- Modify: any file touched in Tasks 2.0–2.3 that contains `agentEventBus.emit(...)` calls

- [ ] **Step 1:** Grep the modified files for `emit(` calls. Likely sites: none in `sandbox-db.ts` itself, possibly some in `github-fork.ts`, possibly in the immediate callers updated in Task 2.3
- [ ] **Step 2:** For each emit call, populate envelope fields: `userId` (from `system-user.ts` constant for infra calls; from caller context otherwise), `emittedAt: new Date().toISOString()`, `runId` from current substrate run if any
- [ ] **Step 3:** Run typecheck — must stay clean (envelope fields still optional in this phase)
- [ ] **Step 4:** Commit: `chore(bus): populate envelope on phase 2 emit sites`

### Task 2.5 — Open Phase 2 PR

- [ ] **Step 1:** Per-PR gates checklist (note: refactor-budget evidence required — list deleted constants/strings in PR description)
- [ ] **Step 2:** Open PR. Body **explicitly highlights** the github-fork behavior change with a "Migration notes for callers" section, lists the deleted constants under "Refactor budget delivered," and lists the emit sites migrated under "Envelope migration"
- [ ] **Step 3:** Wait for merge

---

## Phase 3 — Build Orchestrator & Pipeline (one PR)

**Branch:** `feat/orch-phase-3-build-orch`

**Goal:** Migrate four related surfaces in one coherent PR: phase loop, tasks-within-phase fan-out, specialist retry, optimistic merge retry, and pipeline step retry. **This is the audit's recommended first major proving ground** — Build Studio orchestration is concrete, observable, and substrate-worthy without the blast radius of the agentic loop.

**Refactor-budget targets retired in this PR (all four constants must be deleted):**
- `MAX_SPECIALIST_RETRIES` (`build-orchestrator.ts`)
- `MAX_MERGE_RETRIES` (`build-orchestrator.ts`)
- `MAX_RETRIES` table (`build-pipeline.ts` or `build-exec-types.ts`)
- `RETRY_DELAYS_MS` array (same file)

The PR fails the per-PR refactor-budget gate if any of these survive.

**Emit-site migration scope (in this PR):**
- `apps/web/lib/integrate/build-orchestrator.ts` (~13 emit sites)
- `apps/web/lib/integrate/build-pipeline.ts` (~1 emit site)
- `apps/web/lib/actions/build.ts` (~4 emit sites)
- `apps/web/lib/build-flow-state.ts` (~1 emit site)
- `apps/web/lib/queue/functions/build-review-verification.ts` (~5 emit sites)

Each emit gets `userId` (from `build.ownerUserId` or thread context), `emittedAt`, and `runId` from the substrate `RunContext`.

### Task 3.1 — Migrate phase loop in `build-orchestrator.ts`

**Files:**
- Modify: `apps/web/lib/integrate/build-orchestrator.ts:912-1000`

- [ ] **Step 1:** Read function `runBuildOrchestrator` end-to-end. Identify the phase loop and what `parentThreadId` corresponds to in `RunContext` (it's the threadId; userId comes from the build owner)
- [ ] **Step 2:** Write parity test (in `build-orchestrator.test.ts`) that asserts current behavior: phases execute in order, task fan-out within phase is concurrent, batched at `MAX_CONCURRENT_TASKS = 2`
- [ ] **Step 3:** Replace the `for (const phase of phases)` loop with `Sequential(phases.map(p => phaseStep(p)), ctx)`
- [ ] **Step 4:** Run parity test, verify green
- [ ] **Step 5:** Commit: `refactor(build-orchestrator): migrate phase loop to Sequential`

### Task 3.2 — Migrate tasks-within-phase fan-out

- [ ] **Step 1:** Locate the batching `while (taskQueue.length > 0)` loop with `Promise.all` (lines 944–965)
- [ ] **Step 2:** Replace with `Parallel(batchTasks, { errorPolicy: "all_must_succeed", synthesize: mergeOutcomes }, ctx)` per spec
- [ ] **Step 3:** Preserve the `MAX_CONCURRENT_TASKS = 2` semantics — `Parallel` runs all branches concurrently, so to respect the cap, batch externally with `Sequential` of `Parallel` chunks. Document this composition in a comment
- [ ] **Step 4:** Run parity test, verify green
- [ ] **Step 5:** Commit: `refactor(build-orchestrator): migrate task fan-out to Parallel`

### Task 3.3 — Migrate specialist retry (`MAX_SPECIALIST_RETRIES`)

- [ ] **Step 1:** Locate `dispatchSpecialist` (lines 629–665) and constant `MAX_SPECIALIST_RETRIES = 2` (line 46)
- [ ] **Step 2:** Replace the `for (let attempt = 0; attempt <= MAX_SPECIALIST_RETRIES; attempt++)` loop with `Loop`. The `strategy` function constructs the retry prompt with prior-error context (currently inline at line 632)
- [ ] **Step 3:** **Delete `MAX_SPECIALIST_RETRIES`**. The Loop's max attempts comes from the resolved governance profile (specialist coworker → `balanced` profile by default → `maxAttempts: 4`). If 4 is too generous, set explicit `governanceProfile: "economy"` in the call site (`maxAttempts: 2`, matching today)
- [ ] **Step 4:** Run parity test
- [ ] **Step 5:** Commit: `refactor(build-orchestrator): migrate specialist retry to Loop; delete MAX_SPECIALIST_RETRIES`

### Task 3.4 — Migrate optimistic merge retry (`MAX_MERGE_RETRIES`)

- [ ] **Step 1:** Locate the merge loop (lines 1036–1086) and constant `MAX_MERGE_RETRIES = 1`
- [ ] **Step 2:** Replace with `Loop` whose `strategy` re-fetches the version. Profile: explicit `economy` (CAS retries should be cheap and bounded)
- [ ] **Step 3:** **Delete `MAX_MERGE_RETRIES`**
- [ ] **Step 4:** Run parity test
- [ ] **Step 5:** Commit: `refactor(build-orchestrator): migrate merge retry to Loop; delete MAX_MERGE_RETRIES`

### Task 3.5 — Migrate pipeline step retry

**Files:**
- Modify: `apps/web/lib/integrate/build-pipeline.ts:86-117`
- Modify: `packages/db/prisma/migrations/...` (no — this is in `build-exec-types.ts`)
- Modify: `apps/web/lib/integrate/build-exec-types.ts` (delete `MAX_RETRIES` table + `RETRY_DELAYS_MS`)

- [ ] **Step 1:** Locate the per-step retry loop (`while (attempt < maxAttempts)`) at line 95. Locate `MAX_RETRIES` table and `RETRY_DELAYS_MS` array. **Verify which file holds them** — recon found them in `build-exec-types.ts` lines 53–65, but confirm at task entry. If they're actually in `build-pipeline.ts`, adjust the file modification list
- [ ] **Step 2:** Replace the inner retry with `Loop`. The outer step iteration becomes `Sequential` over the steps array
- [ ] **Step 3:** **Delete `MAX_RETRIES` and `RETRY_DELAYS_MS`** from wherever they live. Per-step backoff becomes part of the `Loop` strategy (delay before each attempt based on attempt number)
- [ ] **Step 4:** Update `build-pipeline.test.ts` parity tests
- [ ] **Step 5:** Commit: `refactor(build-pipeline): migrate to Sequential+Loop; delete MAX_RETRIES/RETRY_DELAYS_MS`

### Task 3.6 — Migrate emit sites in touched files to envelope shape

**Files:**
- Modify: each file touched in Tasks 3.1–3.5 with `agentEventBus.emit(...)` calls

- [ ] **Step 1:** Grep the modified files for `emit(` calls. Sites by file (verified at PR #211 merge time; re-verify line numbers at task entry):
  - `build-orchestrator.ts` — ~13 sites
  - `build-pipeline.ts` — ~1 site
  - `build.ts` — ~4 sites
  - `build-flow-state.ts` — ~1 site
  - `build-review-verification.ts` — ~5 sites
- [ ] **Step 2:** For each, populate `userId` from `build.ownerUserId` or thread context, `emittedAt`, and `runId` from the surrounding substrate `RunContext`
- [ ] **Step 3:** Typecheck stays clean
- [ ] **Step 4:** Commit: `chore(bus): populate envelope on Build Studio emit sites`

### Task 3.7 — Open Phase 3 PR

- [ ] **Step 1:** Per-PR gates checklist (refactor-budget evidence required — all four named constants must be deleted)
- [ ] **Step 2:** Open PR. Body lists:
  - The five surfaces migrated and their target primitives
  - **"Refactor budget delivered"** section listing `MAX_SPECIALIST_RETRIES`, `MAX_MERGE_RETRIES`, `MAX_RETRIES`, `RETRY_DELAYS_MS` as deleted
  - The governance profiles chosen at each call site
  - **"Envelope migration"** listing the emit sites populated with envelope fields
- [ ] **Step 3:** UX verification: manually exercise Build Studio against the running app and confirm no progress-stream regressions before requesting review
- [ ] **Step 4:** Wait for merge

---

## Phase 4 — Provider Fallback Chain (one PR)

**Branch:** `feat/orch-phase-4-fallback`

**Goal:** Migrate `apps/web/lib/routing/fallback.ts:79` `callWithFallbackChain` to `Loop`. This is the cleanest test of `Loop`'s `strategy` function because each attempt genuinely picks a different endpoint.

**Refactor-budget targets retired in this PR:**
- any local backoff plumbing in `fallback.ts` superseded by `Loop`'s `strategy` and budget resolution (delay tables, attempt counters, etc.)
- the `throw` wrapper for chain exhaustion if callers can be migrated to handle `Outcome.exhausted` directly

**Emit-site migration scope (in this PR):** routing emits are limited (most routing observability uses the routing telemetry path, not the agent event bus). Migrate any `agentEventBus.emit(...)` calls in `fallback.ts` and immediate callers; expect a small handful.

### Task 4.1 — Migrate fallback chain

**Files:**
- Modify: `apps/web/lib/routing/fallback.ts:79-277`
- Modify: relevant routing tests

- [ ] **Step 1:** Read `callWithFallbackChain` end-to-end. Map each branch of error handling (rate_limit, model_not_found, auth, interface_drift) to a `strategy` decision: which endpoint to try next, with what model
- [ ] **Step 2:** Write parity test covering: (a) first endpoint succeeds, (b) first 429s, second succeeds, (c) all endpoints exhausted → throw
- [ ] **Step 3:** Reimplement using `Loop`:
  - `strategy(priors, attemptN)` returns the next endpoint + model from `chain[attemptN]`, applying degradation rules from prior outcomes
  - `exitWhen(outcome)` returns true on success
  - Exhaustion (`max_attempts === chain.length`) maps to the existing throw, but as `Outcome.exhausted` first, then the wrapper that throws can be retired by callers updating their error handling
- [ ] **Step 4:** Run parity tests
- [ ] **Step 5:** Commit: `refactor(routing): migrate fallback chain to Loop`

### Task 4.2 — Migrate emit sites in touched files to envelope shape

- [ ] **Step 1:** Grep `fallback.ts` and immediate callers for `emit(` calls; populate envelope fields
- [ ] **Step 2:** Typecheck clean
- [ ] **Step 3:** Commit: `chore(bus): populate envelope on routing fallback emit sites`

### Task 4.3 — Open Phase 4 PR

- [ ] **Step 1:** Per-PR gates checklist (refactor-budget evidence required)
- [ ] **Step 2:** Open PR. Body lists deleted backoff plumbing under "Refactor budget delivered"
- [ ] **Step 3:** Wait for merge

---

## Phase 5 — Deliberation (one PR)

**Branch:** `feat/orch-phase-5-deliberation`

**Goal:** Migrate `deliberation-run.ts` worker branches and adjudicator to `Branch`. **Important behavior change:** today branches dispatch sequentially (verified at lines 114–260). Migrating to true parallel `Branch` is a semantic upgrade — the spec calls this out explicitly.

**Refactor-budget targets retired in this PR:**
- duplicated branch-state scaffolding that the substrate now centralizes (per-branch progress tracking helpers, manual synthesis bookkeeping)
- any `pushThreadProgress` calls in deliberation that the substrate's typed events replace

**Emit-site migration scope (in this PR):**
- `apps/web/lib/queue/functions/deliberation-run.ts` (~5 sites via `pushThreadProgress`)
- `apps/web/lib/queue/functions/brand-extract.ts` (~3 sites via `pushThreadProgress`) — included here because brand-extract uses similar `pushThreadProgress` patterns and is small
- `apps/web/lib/tak/thread-progress.ts` (the projection function itself — add `userId` to its signature)

`thread-progress.ts` is touched first because brand-extract and deliberation-run both go through it.

### Task 5.1 — Decide: parallel or sequential `Branch` for V1

- [ ] **Step 1:** Read spec §Open Questions #1: "Should `Branch` allow true concurrent execution in V1, or should V1 model branch synthesis while preserving sequential dispatch for some current deliberation flows?"
- [ ] **Step 2:** **Recommendation for this plan:** start sequential (preserve today's behavior), make the parallel toggle a follow-up. This isolates the migration from the parallelism upgrade. Document this in PR description. The `Branch` primitive ALREADY runs concurrently per its spec — so for this migration, wrap deliberation branches in a `Sequential` over individual single-branch `Branch` invocations, OR pass an option to `Branch` that disables concurrency. Adding a `dispatchMode: "parallel" | "sequential"` option to `Branch` is the cleanest path; it matches the open question and lets each call site choose
- [ ] **Step 3:** If adopting the option: amend `Branch` (Phase 1A primitive) with a new task in this phase to add `dispatchMode`. Add tests
- [ ] **Step 4:** Commit: `feat(orchestration): Branch.dispatchMode for sequential|parallel branches`

### Task 5.2 — Migrate worker-branch dispatch

**Files:**
- Modify: `apps/web/lib/queue/functions/deliberation-run.ts:114-260`

- [ ] **Step 1:** Locate the worker-branch loop. Note the resume path (lines 116–118), budget halt (119–125), per-branch dispatch via `routeEndpointV2` (159–193)
- [ ] **Step 2:** Write parity tests covering: (a) all branches succeed, (b) one fails (caught, marked failed, others continue), (c) budget halted mid-loop
- [ ] **Step 3:** Replace with `Branch(workerBranches.map(b => branchStep(b)), { merge: synthesizeDeliberation, dispatchMode: "sequential" }, ctx)`. Resume path: if branch is already completed, return its prior `Outcome.succeeded` immediately
- [ ] **Step 4:** Run parity tests
- [ ] **Step 5:** Commit: `refactor(deliberation): migrate worker branches to Branch (sequential dispatchMode)`

### Task 5.3 — Migrate adjudicator branches

- [ ] **Step 1:** Locate the adjudicator loop (lines 313–318)
- [ ] **Step 2:** Fold into the `merge` function of Task 5.2's `Branch`, OR keep as a second `Branch` invocation if the adjudicator semantically waits for worker synthesis. Inspect existing code to decide
- [ ] **Step 3:** Run tests
- [ ] **Step 4:** Commit: `refactor(deliberation): fold adjudicator branches into Branch.merge`

### Task 5.4 — Migrate emit sites in touched files to envelope shape

**Files:**
- Modify: `apps/web/lib/tak/thread-progress.ts` (add `userId` to `pushThreadProgress` signature; ripple through callers)
- Modify: `apps/web/lib/queue/functions/deliberation-run.ts`
- Modify: `apps/web/lib/queue/functions/brand-extract.ts`

- [ ] **Step 1:** Add `userId` to `pushThreadProgress` signature. Update both internal `emit(...)` calls to populate envelope
- [ ] **Step 2:** Update every caller of `pushThreadProgress` to pass `userId` from their context (deliberation run owner, task run owner, etc.)
- [ ] **Step 3:** Typecheck clean
- [ ] **Step 4:** Commit: `chore(bus): populate envelope on deliberation/brand-extract emit sites`

### Task 5.5 — Open Phase 5 PR

- [ ] **Step 1:** Per-PR gates checklist (refactor-budget evidence required)
- [ ] **Step 2:** Open PR. Body notes the **deliberate sequential dispatch** preserves today's semantics; opening parallel dispatch is a follow-up. Lists deleted branch-state scaffolding under "Refactor budget delivered"
- [ ] **Step 3:** Wait for merge

---

## Phase 6 — Agentic Loop (one PR — HIGHEST RISK)

**Branch:** `feat/orch-phase-6-agentic-loop`

**Goal:** Migrate `apps/web/lib/tak/agentic-loop.ts:486-1107` (~620 lines) from a hand-rolled `for` loop with 6+ early exit paths to `Loop` with named exit predicates. **This migration explicitly breaks silent-success behavior** in favor of `Outcome.exhausted` per the spec's Agentic Loop Special Handling section.

**Refactor-budget targets retired in this PR:**
- `MAX_ITERATIONS = 200` (`agentic-loop.ts`)
- `MAX_DURATION_MS = 120_000` (`agentic-loop.ts`)
- per-call-site repetition / fabrication / frustration counters that become exit predicates inside `Loop`
- ambiguous max-iteration fallback path that returns best-available content

**Emit-site migration scope (in this PR):** the agentic loop is the largest emit-site cluster left after Phase 5. Migrate:
- `apps/web/lib/tak/agentic-loop.ts`
- `apps/web/lib/actions/agent-coworker.ts` (~11 sites)
- `apps/web/app/api/agent/send/route.ts` (~5 sites)
- `apps/web/app/api/agent/build/advance-phase/route.ts` (~1 site)
- `apps/web/lib/mcp-tools.ts` (~11 sites)
- `apps/web/lib/inference/async-inference.ts` (~7 sites)
- `apps/web/lib/queue/inngest-bridge.ts` (~1 site)
- `apps/web/lib/tak/mcp-catalog-sync.ts` (~2 sites; uses `system` user)
- any remaining stragglers found by `grep -RE 'agentEventBus.emit\(|emit\(' apps/web/lib/`

### Task 6.1 — Build replay fixtures

**Files:**
- Create: `apps/web/lib/tak/agentic-loop.fixtures.ts`
- Create: `apps/web/lib/tak/agentic-loop.replay.test.ts`

- [ ] **Step 1:** Identify 6 fixture scenarios from spec §Replay And Fixture Requirement:
  1. successful multi-step tool execution
  2. repeated-tool stuck condition
  3. fabrication recovery path
  4. sandbox unavailable path
  5. user cancellation path
  6. duration or iteration exhaustion
- [ ] **Step 2:** For each, capture a recorded conversation (mocked LLM responses + mocked tool results) as a fixture file
- [ ] **Step 3:** Write replay tests that exercise the CURRENT `runAgenticLoop` against each fixture and snapshot the outcome
- [ ] **Step 4:** Run; all 6 should pass against current code
- [ ] **Step 5:** Commit: `test(agentic-loop): replay fixtures for 6 terminal scenarios`

### Task 6.2 — Extract detector helpers as exit predicates

**Files:**
- Create: `apps/web/lib/tak/exit-predicates.ts`
- Modify: `apps/web/lib/tak/agentic-loop.ts`

- [ ] **Step 1:** Move these helpers OUT of `agentic-loop.ts` and INTO `exit-predicates.ts`, preserving their existing tests:
  - `detectFabrication` (lines 117–139)
  - `shouldNudge` (lines 189–231)
  - `repetitionDetector` logic (lines 555–607)
  - `FRUSTRATION_PATTERN` regex + frustration-counter logic
  - `STATUS_ONLY_PROGRESS_PATTERN`, `READ_FAILURE_STALL_PATTERN`
- [ ] **Step 2:** Each becomes a named function `(loopState) => { exit: boolean, reason?: string }`
- [ ] **Step 3:** Re-run existing `agentic-loop.test.ts` (which tests these helpers) to verify nothing broke
- [ ] **Step 4:** Commit: `refactor(agentic-loop): extract detectors to exit-predicates module`

### Task 6.3 — Map terminal exits to `Outcome` variants

**Files:**
- Modify: `apps/web/lib/tak/agentic-loop.ts`

Per spec §Agentic Loop Special Handling (lines 797–805):

| Current behavior | New behavior |
|---|---|
| Line 491 — cancellation `break` | `Outcome.cancelled{ reason: "user_cancelled" }` |
| Lines 503–515 — sandbox unavailable, returns user-facing text | `Outcome.exhausted{ reason: "sandbox_unavailable" }` |
| Line 552 — duration ceiling `break` | `Outcome.exhausted{ reason: "deadline" }` (Loop's deadlineMs) |
| Lines 584–606 — repetition detector | `Outcome.failed{ error: RepetitionDetected }` |
| Line 894–909 — natural no-tool completion | `Outcome.succeeded{ value: text }` |
| Lines 939–953 — proposal tool | `Outcome.succeeded{ value: proposalCard }` |
| Line 1076 — MAX_ITERATIONS exhaust | `Outcome.exhausted{ reason: "max_attempts" }` |

- [ ] **Step 1:** Replace the `for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++)` outer loop with `Loop(modelCallStep, { exitWhen: naturalCompletion, strategy: nextTurn }, ctx)`
- [ ] **Step 2:** Within the `step` function, when an exit predicate fires, return `Outcome.failed` or `Outcome.exhausted` per the table above. Loop's terminal handling propagates correctly
- [ ] **Step 3:** **Delete `MAX_ITERATIONS = 200`**. Max attempts is now governance-derived; the agentic-loop entry decides whether to use `balanced` (default) or `high-assurance` based on caller context
- [ ] **Step 4:** **Delete `MAX_DURATION_MS = 120_000`**. Deadline is governance-derived. The phase-aware extension at lines 547–551 becomes a per-call `governanceProfile` choice
- [ ] **Step 5:** Run replay fixtures from Task 6.1. **Six MUST PASS, but with different outcome shapes** — the test assertions update to match new fail-loud outcomes
- [ ] **Step 6:** Commit: `refactor(agentic-loop): migrate to Loop with typed Outcome variants`

### Task 6.4 — Update callers of `runAgenticLoop`

- [ ] **Step 1:** Grep `runAgenticLoop` for all callers
- [ ] **Step 2:** Each caller previously got back `{ content, providerId, modelId, ... }`. Now they get `Outcome<AgenticResult>`. Update each caller to `assertNever`-handle all four outcome variants
- [ ] **Step 3:** Specifically: the silent-exhaustion path that returned best-effort content now returns `Outcome.exhausted`. Each caller decides what to surface to the UI — this is the entire point of the migration; there is no shim that hides the change
- [ ] **Step 4:** Run all affected tests
- [ ] **Step 5:** Commit: `refactor(callers): handle Outcome variants from agentic-loop`

### Task 6.5 — Feature-flag the new path during rollout

**Files:**
- Modify: caller sites of `runAgenticLoop`

- [ ] **Step 1:** Wrap the new agentic-loop entry behind a feature flag (env var `DPF_AGENTIC_LOOP_V2=true` for now). Old code path retained temporarily
- [ ] **Step 2:** Add an explicit comment: `// FLAG removed in Phase 7 retirement sweep — see plan task 7.X`
- [ ] **Step 3:** Commit: `feat(agentic-loop): feature flag DPF_AGENTIC_LOOP_V2 for staged rollout`

### Task 6.6 — Migrate emit sites in agentic loop and callers

**Files:**
- Modify: every file in §Emit-site migration scope at the top of Phase 6

**Re-verify line numbers at task entry.** The site counts and line numbers in the Phase 6 scope list were taken from earlier audit recon and will likely have drifted by the time Phase 6 runs. At task entry, grep each file fresh and update the count rather than trusting the listed numbers.

- [ ] **Step 1:** For each file, grep for `emit(` calls; populate envelope fields. `userId` from caller context (input.userId, build.ownerUserId, session, etc.); `mcp-catalog-sync.ts` uses the `system` user constant
- [ ] **Step 2:** Typecheck clean
- [ ] **Step 3:** Commit: `chore(bus): populate envelope on agentic-loop and remaining caller emit sites`

### Task 6.7 — Open Phase 6 PR

- [ ] **Step 1:** Per-PR gates with extra emphasis on replay fixtures (refactor-budget evidence required: `MAX_ITERATIONS`, `MAX_DURATION_MS`, plus per-call counters)
- [ ] **Step 2:** Open PR. Body has a dedicated "Behavior changes" section listing the seven terminal-exit mappings from the table. Reviewers focus on the silent-exhaustion path
- [ ] **Step 3:** **Manual UX test before merge** — manually exercise the coworker UI for each of the six replay-fixture scenarios and confirm the UI handles the new outcomes correctly
- [ ] **Step 4:** Wait for thorough review and merge
- [ ] **Step 5:** After merge, monitor first 100 production runs (telemetry note in PR per spec §Risks #2). Tune profile budgets if regressions appear

---

## Phase 7 — Retirement Sweep (one PR)

**Branch:** `feat/orch-phase-7-retirement`

**Goal:** Tighten the envelope contract to mandatory `userId` / `emittedAt`, delete the legacy positional bus API, retire the agentic-loop feature flag, and add mechanical grep enforcement so legacy patterns cannot reappear.

**Refactor-budget targets retired in this PR:**
- legacy positional `subscribe(threadId, handler)` overload
- legacy positional `emit(threadId, event)` form
- top-level `apps/web/lib/agent-event-bus.ts` shim file
- `DPF_AGENTIC_LOOP_V2` feature flag from Phase 6 Task 6.5
- any final stragglers detected by the grep sweep

This phase is the *backstop* — most retirements should already have happened in Phases 2–6. The grep enforcement here verifies that the lane is actually clean.

### Task 7.0 — Final emit-site sweep

**Files:**
- Modify: any straggler files surfaced by `grep -RE 'agentEventBus.emit\(|emit\(' apps/web/lib/`

After Phases 2–6, every consumer should have migrated its emits to envelope shape. This task is the safety net: grep for any remaining bare positional `emit()` calls that lack envelope fields.

- [ ] **Step 1:** Grep `apps/web/lib/` for `emit(` calls. For each match, verify the call passes envelope fields (`userId`, `emittedAt`, `runId` if applicable). If any are bare, migrate them in this task before the tightening step
- [ ] **Step 2:** Typecheck clean
- [ ] **Step 3:** Commit: `chore(bus): final emit-site envelope sweep before tightening`

### Task 7.1 — Tighten envelope: make `userId` and `emittedAt` mandatory

**Files:**
- Modify: `apps/web/lib/tak/agent-event-bus.ts`

After Task 7.0 confirms zero bare emits remain, lock the contract. (This task moved from old Phase 1B.8 to here — the audit's first-slice concern was about doing it as a foundation step. With consumer phases having already populated envelope fields, the tightening becomes a structural typecheck assertion of work already done.)

- [ ] **Step 1:** Change `AgentEvent`'s base intersection from `Partial<OrchestrationEnvelope>` to `{ userId: string; emittedAt: string } & Partial<Omit<OrchestrationEnvelope, "userId" | "emittedAt">>`
- [ ] **Step 2:** `pnpm --filter web typecheck` — expect green if Phases 2–6 + Task 7.0 were complete. Any failure indicates a missed emit site; fix in this task before committing
- [ ] **Step 3:** Run the full vitest suite for affected files
- [ ] **Step 4:** Commit: `refactor(bus): require userId and emittedAt on every AgentEvent`

### Task 7.2 — Retire the legacy positional `subscribe` overload and thread-only storage

**Files:**
- Modify: `apps/web/lib/tak/agent-event-bus.ts`

**Scope clarification.** The `emit(threadId, event)` two-arg signature is kept — consumers populate envelope fields on the event object's second arg (this is what every consumer phase did). What retires here is the *positional* `subscribe(threadIdString, handler)` overload (replaced by `subscribe({ threadId }, handler)`) and any internal-only thread-only storage path that's now redundant given the envelope subscription overloads.

- [ ] **Step 1:** Confirm zero callers remain of `subscribe(threadIdString, handler)` (positional first arg, plain string). Grep for `subscribe(` and inspect each match. If any remain, migrate them to `subscribe({ threadId: ... }, handler)` in this PR
- [ ] **Step 2:** Delete the positional `subscribe(threadIdString, handler)` overload from `agent-event-bus.ts`. Calling positional now becomes a typecheck error — that's the enforcement
- [ ] **Step 3:** If both `Map<threadId, Set<handler>>` and `Map<userId, Set<handler>>` storage paths still exist with only the object-form subscribe entry point, simplify to a single subscriber-list keyed by filter shape. Don't merge if it complicates emit fan-out logic — keep both maps if they read more clearly
- [ ] **Step 4:** Run typecheck — must be clean. If any caller still uses positional, fix in this PR
- [ ] **Step 5:** Commit: `refactor(bus): retire legacy positional subscribe overload`

### Task 7.3 — Delete the shim file

**Files:**
- Delete: `apps/web/lib/agent-event-bus.ts` (the 2-line shim)
- Modify: importers to point at canonical `apps/web/lib/tak/agent-event-bus.ts`

- [ ] **Step 1:** Grep `from "@/lib/agent-event-bus"` and similar non-`tak/`-scoped imports. Update every importer to import from `@/lib/tak/agent-event-bus` instead
- [ ] **Step 2:** Delete the shim file
- [ ] **Step 3:** Typecheck clean
- [ ] **Step 4:** Commit: `chore(bus): delete shim file; all importers point at canonical path`

### Task 7.4 — Retire the agentic-loop feature flag

**Files:**
- Modify: callers from Phase 6 Task 6.5

- [ ] **Step 1:** Remove the `DPF_AGENTIC_LOOP_V2` flag and the conditional path from each caller
- [ ] **Step 2:** Delete any retained legacy code paths inside `agentic-loop.ts`
- [ ] **Step 3:** Run all replay fixtures
- [ ] **Step 4:** Commit: `chore(agentic-loop): retire DPF_AGENTIC_LOOP_V2 flag and legacy path`

### Task 7.5 — Mechanical enforcement via pre-push hook

**Files:**
- Modify: `.githooks/pre-push` (already exists per repo status)

- [ ] **Step 1:** Read existing `.githooks/pre-push` to see structure
- [ ] **Step 2:** Add four grep checks per spec §Phase 7 Mechanical enforcement:
  ```bash
  # Fail if legacy retry constants reappear outside orchestration module
  if grep -RE 'MAX_RETRIES|MAX_ATTEMPTS|maxRetries\s*=' apps/web/lib/ \
       | grep -v 'apps/web/lib/orchestration/'; then
    echo "ERROR: legacy retry constants outside orchestration module"; exit 1
  fi
  # Fail if hand-rolled retry-for loops reappear
  if grep -RE 'for\s*\(\s*let\s+attempt' apps/web/lib/ \
       | grep -v 'apps/web/lib/orchestration/'; then
    echo "ERROR: hand-rolled retry-for loops outside orchestration module"; exit 1
  fi
  # Fail if hand-rolled retry-while loops reappear
  if grep -RE 'while\s*\(\s*attempt\s*<' apps/web/lib/ \
       | grep -v 'apps/web/lib/orchestration/'; then
    echo "ERROR: hand-rolled retry-while loops outside orchestration module"; exit 1
  fi
  # NOTE: legacy positional subscribe(threadId, handler) is enforced by the
  # type system after Task 7.2 deletes the positional overload — calling
  # positional becomes a typecheck error, which is stronger than grep and
  # avoids false-positives on variable-form object subscriptions like
  # subscribe(filter, handler) where filter holds {threadId} or {userId}.
  # No grep check needed here.
  ```
- [ ] **Step 3:** Run the hook locally to confirm it fires when patterns reappear (test by intentionally adding a violation, confirming hook blocks, reverting)
- [ ] **Step 4:** Commit: `chore(hooks): pre-push enforcement of orchestration boundaries`

### Task 7.6 — Verification grep sweep

- [ ] **Step 1:** Run each enforcement grep manually against the current branch
- [ ] **Step 2:** Confirm zero matches outside `apps/web/lib/orchestration/`
- [ ] **Step 3:** Document the final inventory in PR description: which constants were deleted, which files lost their retry loops, which event variants migrated to the envelope

### Task 7.7 — Open Phase 7 PR

- [ ] **Step 1:** Per-PR gates (refactor-budget evidence required: positional bus API, shim file, feature flag all retired in this PR)
- [ ] **Step 2:** Open PR `feat(orchestration): retirement sweep — one orchestration vocabulary (Phase 7)`
- [ ] **Step 3:** This PR closes the spec. After merge, the codebase has exactly one way to express each orchestration pattern

---

## Risk Register Reminders (per spec §Risks)

- **Phase 6 regression risk** — replay fixtures (Task 6.1) and feature-flag rollout (Task 6.5) mitigate
- **Bus migration destabilizes UX** — envelope fields stay optional from Phase 1B all the way through Phase 7 Task 7.0; tightening to mandatory only happens after every consumer phase has populated them. Legacy positional API remains as a shim through every phase up to Phase 7
- **Budget calibration** — Phase 6 PR description includes a "first 100 runs" telemetry note; tune in Phase 7 if needed
- **Deliberation semantic drift** — Phase 5 explicitly preserves sequential dispatch; parallel is a follow-up
- **Caller dependencies on best-effort content** — Phase 6 Task 6.4 forces every caller to handle `Outcome.exhausted`; TypeScript catches non-exhaustive matches
- **Wrapper-only migration without real debt reduction** — every migration phase has named refactor-budget targets and the per-PR refactor-budget evidence gate. Reviewers reject migrations that don't retire at least one named constant/helper/behavior

## Out of Scope (deferred per spec)

- User-initiated cancellation API beyond what `agentEventBus.requestCancel` already provides
- Resumable runs across process restarts (Inngest handles for queued work)
- Cross-primitive budget pooling
- DB-backed orchestration run history
- OpenTelemetry export
- Architecture UX integration (events flow; UI subscription is its own spec)
- Per-org tunable profiles

## Definition of Done

- [ ] All 7 phases merged to main
- [ ] Pre-push hook enforces the four grep boundaries
- [ ] Zero matches for `MAX_RETRIES`, `MAX_SPECIALIST_RETRIES`, `MAX_MERGE_RETRIES`, `MAX_ITERATIONS`, `MAX_DURATION_MS`, `RETRY_DELAYS_MS` outside `apps/web/lib/orchestration/`
- [ ] `apps/web/lib/agent-event-bus.ts` shim deleted
- [ ] Legacy positional `subscribe(threadId, handler)` and `emit(threadId, event)` retired (typecheck-enforced after Task 7.2)
- [ ] `userId` and `emittedAt` mandatory on every `AgentEvent` (typecheck-enforced after Task 7.1)
- [ ] All `runAgenticLoop` callers handle `Outcome.exhausted` explicitly
- [ ] `RunContext.runId` persisted on `ToolExecution` rows (Task 1C.5)
- [ ] First 100 production runs after Phase 6 show no silent-exhaustion regressions
- [ ] Every migration PR (Phases 2–6 + 7) shipped at least one refactor-budget retirement (constant deleted, helper retired, or ambiguous status behavior eliminated)

---

## Plan Review

This plan must pass `plan-document-reviewer` before execution. After review approval, hand off to `subagent-driven-development` (recommended) or `executing-plans`.
