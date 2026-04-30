# Orchestration Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.

**Goal:** Land four orchestration primitives (`Sequential` / `Parallel` / `Loop` / `Branch`) plus a unified event envelope; migrate ~13 in-process retry/iteration surfaces; retire all legacy retry constants and the legacy positional bus API.

**Architecture:** New `apps/web/lib/orchestration/` module owns deterministic primitives, typed `Outcome<T>` (succeeded/failed/exhausted/cancelled), governance-derived budgets, runId-scoped heartbeats. The existing `agentEventBus` evolves to carry a shared envelope (`runId`, `userId`, `threadId?`, `taskRunId?`, `agentId?`, `governanceProfile`, `cost`) on every event variant; subscribers filter by `{ threadId }` or `{ userId }`.

**Tech Stack:** TypeScript strict, Vitest, Next.js 14 App Router, Prisma 5, Inngest (durable shell preserved). No new runtime dependencies.

**Spec:** [docs/superpowers/specs/2026-04-29-orchestration-primitives-design.md](../specs/2026-04-29-orchestration-primitives-design.md)

**Branch:** `spec/orchestration-primitives` is the spec branch. Implementation work uses topic branches `feat/orch-phase-N-<slice>` per the AGENTS.md PR-based workflow. All commits signed off (`git commit -s`) per memory.

---

## Per-PR Test Gate Checklist

Every migration PR (Phases 2–6) must satisfy ALL of these before merge:

- [ ] **Behavior parity test** — exercises the migrated call site; passes against new primitive (Phase 6 explicitly breaks parity for silent-exhaustion paths and asserts the new fail-loud behavior)
- [ ] **Terminal-outcome test** — every code path returns a typed `Outcome` (no `null`, no free-text best-effort)
- [ ] **Event emission test** — at least one terminal event (`*:succeeded` / `*:failed` / `*:exhausted` / `*:cancelled`) per primitive run
- [ ] **Heartbeat test** — Loops with possibly-slow steps emit `loop:still_working` within `1.5 × heartbeatMs` (skip if surface always completes < heartbeatMs)
- [ ] **Cost monotonicity test** — cumulative `cost.tokens` and `cost.ms` non-decreasing across events for the same `runId`
- [ ] `pnpm --filter web typecheck` clean
- [ ] `pnpm --filter web exec vitest run <affected>` green
- [ ] `cd apps/web && npx next build` clean
- [ ] DCO sign-off on every commit (memory: 2026-04-24 DCO app)

---

## Phase 1 — Foundation (sub-phased into three PRs)

The bus refactor touches 16 files and 44 emit/subscribe sites. Splitting Phase 1 keeps diffs reviewable and lets later phases land on a stable foundation.

### Phase 1A — Orchestration Module Skeleton (PR 1)

**Branch:** `feat/orch-phase-1a-skeleton`

**Goal:** Land the new module with primitives, types, and the governance registry. **No bus changes yet, no call-site migrations yet.** The module is wired up but unused.

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
- [ ] **Step 3:** Mark these tests `it.todo` for now with a comment pointing to Phase 1B Task 1B.5; they activate once the bus envelope is in place
- [ ] **Step 4:** Commit: `test(orchestration): structural terminal-event scaffolding (it.todo until 1B)`

#### Task 1A.9 — Open Phase 1A PR

- [ ] **Step 1:** `git checkout -b feat/orch-phase-1a-skeleton` (off `main`, not the spec branch)
- [ ] **Step 2:** Verify per-PR gates: typecheck, vitest run on `apps/web/lib/orchestration/**`, next build
- [ ] **Step 3:** Open PR with title `feat(orchestration): module skeleton — primitives, profiles, heartbeat (Phase 1A)`. Body cites the spec, lists the four primitives, notes "no call-site migrations yet"
- [ ] **Step 4:** Wait for review/merge before starting 1B

---

### Phase 1B — Bus Envelope Refactor (PR 2)

**Branch:** `feat/orch-phase-1b-bus-envelope`

**Goal:** Refactor `agent-event-bus.ts` so every emitted event carries the `OrchestrationEnvelope` (`runId?`, `userId`, `threadId?`, `taskRunId?`, `agentId?`, `governanceProfile?`, `emittedAt`, `cost?`). Add `subscribe({ threadId })` and `subscribe({ userId })` overloads. Existing positional `subscribe(threadId, handler)` and `emit(threadId, event)` remain as compatibility shims (retired in Phase 7). Migrate **all 40 emit sites** to populate `userId` from their call context.

This is the largest single PR in the plan. Reviewers must read the diff in two passes: bus changes (one file) and emit-site changes (15 files, mechanical).

#### Task 1B.1 — Define the envelope and the new subscribe shape (typecheck-clean)

**Files:**
- Modify: `apps/web/lib/tak/agent-event-bus.ts`

**Important:** the project's pre-commit hook runs typecheck (memory: "pre-commit only runs typecheck"). Memory also says **never skip hooks** (`--no-verify` forbidden). This task therefore lands the envelope with `userId` **fully optional** so typecheck stays clean throughout Phase 1B; `userId` becomes mandatory in Task 1B.8 after all 15 emit-site sweeps complete.

- [ ] **Step 1:** Read `apps/web/lib/tak/agent-event-bus.ts` end-to-end. Note `subscribe`, `emit`, `requestCancel`, `clearCancel`, `isCancelled`, `markActive`, `markIdle`, `isActive`
- [ ] **Step 2:** Add the `OrchestrationEnvelope` type (spec §Required Envelope, lines 434–451). All fields **optional** for now: `runId?`, `userId?`, `threadId?`, `taskRunId?`, `agentId?`, `governanceProfile?`, `primitive?`, `emittedAt?`, `cost?`
- [ ] **Step 3:** Modify the existing `AgentEvent` discriminated union: every variant gets `& Partial<OrchestrationEnvelope>` as a base intersection. **Do not add required fields yet** — that comes in 1B.8
- [ ] **Step 4:** Add subscribe overloads (signatures shown below). Internal storage: keep the existing `Map<threadId, Set<handler>>` AND add `Map<userId, Set<handler>>`. On `emit`, fire to both maps if event has `userId`.

```ts
function subscribe(threadId: string, handler: (e: AgentEvent) => void): () => void;             // legacy positional
function subscribe(filter: { threadId: string }, handler: (e: AgentEvent) => void): () => void; // new
function subscribe(filter: { userId: string }, handler: (e: AgentEvent) => void): () => void;   // new
```

- [ ] **Step 5:** `pnpm --filter web typecheck` — must be clean (envelope fields are optional)
- [ ] **Step 6:** Commit: `refactor(bus): add OrchestrationEnvelope and subscribe overloads (typecheck-clean)`

#### Task 1B.2 — Test the new bus surface

**Files:**
- Modify: `apps/web/lib/tak/agent-event-bus.test.ts`

- [ ] **Step 1:** Add tests:
  - `subscribe({ threadId })` receives only events matching that threadId
  - `subscribe({ userId })` receives only events matching that userId
  - An event with both `userId` and `threadId` is delivered to both subscriber types (assert via two parallel subscribers)
  - The legacy positional `subscribe(threadId, handler)` still works (compatibility)
- [ ] **Step 2:** Run, expect failures
- [ ] **Step 3:** Adjust internal `emit` to fan out to both maps
- [ ] **Step 4:** Run, expect green
- [ ] **Step 5:** Commit: `test(bus): envelope subscription overloads`

#### Task 1B.3 — Migrate emit sites by file (one commit per file)

This is mechanical. The user-resolution rule: each emit site already has access to context that contains `userId`. Where it's not obvious, derive it once at the top of the function from `getServerSession()` or the existing `userId` parameter.

For each file, the pattern is: find every `emit(threadId, { type: ..., ... })` call, change to `emit(threadId, { type: ..., userId, emittedAt: new Date().toISOString(), ... })`. The legacy positional `emit(threadId, ...)` API stays — it just augments the event before delivery.

**Sub-task list (one PR commit each):**

- [ ] **1B.3a:** `apps/web/lib/actions/agent-coworker.ts` (11 emit sites: lines 1029, 1092, 1131, 1146, 1173, 1182, 1209, 1212, 1247, 1249, 1280). `userId` is already available as `input.userId`
- [ ] **1B.3b:** `apps/web/lib/actions/build.ts` (4 sites: 261, 405, 680, 681). `userId` from `build.ownerUserId` or `updatedBuild.ownerUserId`
- [ ] **1B.3c:** `apps/web/lib/build-flow-state.ts` (1 site: 448). `userId` from build record — fetch if not in scope
- [ ] **1B.3d:** `apps/web/app/api/agent/send/route.ts` (5 sites: 97, 101, 106, 129, 133). `userId` from session at top of handler
- [ ] **1B.3e:** `apps/web/lib/queue/inngest-bridge.ts` (1 site: 14). The wrapper passes through; add `userId` to the function signature
- [ ] **1B.3f:** `apps/web/app/api/agent/build/advance-phase/route.ts` (1 site: 119). `userId` from session
- [ ] **1B.3g:** `apps/web/lib/mcp-tools.ts` (11 sites: 4014, 4169, 4209, 4380, 4432, 4464, 4537, 4697, 4739, 6808, 6817). `userId` is already in `context` parameter
- [ ] **1B.3h:** `apps/web/lib/queue/functions/build-review-verification.ts` (5 sites: 57, 74, 134, 142, 149). `userId` from `build.ownerUserId`
- [ ] **1B.3i:** `apps/web/lib/tak/thread-progress.ts` (1 site: 48). The projection function — add `userId` to `pushThreadProgress` signature, ripple through callers in the same commit
- [ ] **1B.3j:** `apps/web/lib/tak/mcp-catalog-sync.ts` (2 sites: 129, 167). For sync operations, use the seeded `system` user (Task 1B.6)
- [ ] **1B.3k:** `apps/web/lib/integrate/build-pipeline.ts` (1 site: 318). `userId` from `thread.ownerUserId`
- [ ] **1B.3l:** `apps/web/lib/integrate/build-orchestrator.ts` (13 sites: 561, 573, 586, 646, 657, 719, 890, 923, 978, 993, 1075, 1105, 1111). `userId` from build/thread context
- [ ] **1B.3m:** `apps/web/lib/inference/async-inference.ts` (7 sites: 93, 130, 159, 177, 198, 260, 400). `userId` from operation owner — confirm it's stored on `AsyncInferenceOperation`; if not, add to function signature
- [ ] **1B.3n:** `apps/web/lib/queue/functions/brand-extract.ts` (3 sites via `pushThreadProgress`). `userId` from task run owner
- [ ] **1B.3o:** `apps/web/lib/queue/functions/deliberation-run.ts` (5 sites via `pushThreadProgress`). `userId` from deliberation run / task owner

After each sub-task: typecheck file-scoped, then commit `chore(bus): populate userId in <file> emits`.

After all sub-tasks: `pnpm --filter web typecheck` should be fully green.

**Sequencing note:** sub-tasks **1B.3i (`thread-progress.ts`) must run before 1B.3n and 1B.3o** because brand-extract and deliberation-run go through `pushThreadProgress`. The alphabetic ordering already places `i` before `n`/`o`; do not reorder.

#### Task 1B.8 — Tighten envelope: make `userId` and `emittedAt` mandatory

**Files:**

- Modify: `apps/web/lib/tak/agent-event-bus.ts`

After all 15 sub-tasks of 1B.3 land and every emit site populates `userId`, lock the contract.

- [ ] **Step 1:** Change `AgentEvent`'s base intersection from `Partial<OrchestrationEnvelope>` to `{ userId: string; emittedAt: string } & Partial<Omit<OrchestrationEnvelope, "userId" | "emittedAt">>`
- [ ] **Step 2:** `pnpm --filter web typecheck` — expect green if 1B.3 was complete. Any failure indicates a missed emit site; fix in this task before committing
- [ ] **Step 3:** Run the full vitest suite for affected files
- [ ] **Step 4:** Commit: `refactor(bus): require userId and emittedAt on every AgentEvent`

#### Task 1B.4 — Wire orchestration primitives to the bus

**Files:**
- Modify: `apps/web/lib/orchestration/primitives/sequential.ts`
- Modify: `apps/web/lib/orchestration/primitives/parallel.ts`
- Modify: `apps/web/lib/orchestration/primitives/loop.ts`
- Modify: `apps/web/lib/orchestration/primitives/branch.ts`
- Create: `apps/web/lib/orchestration/events.ts` (typed event constructors)

- [ ] **Step 1:** Write the failing tests in each primitive's `*.test.ts`: assert each primitive emits the correct sequence of events (`*:started`, intermediate, terminal `*:succeeded`/`*:failed`/`*:exhausted`/`*:cancelled`). Use a captured-events array seeded by `subscribe({ userId: testUserId })`
- [ ] **Step 2:** Implement `events.ts` with typed constructors per spec §Event Families (lines 471–496). Each constructor takes `(envelope, payload)` and returns the discriminated event
- [ ] **Step 3:** Each primitive imports event constructors and emits at: entry (`*:started`), each step boundary, terminal
- [ ] **Step 4:** Run tests, verify they pass
- [ ] **Step 5:** Commit: `feat(orchestration): wire primitives to event bus with typed events`

#### Task 1B.5 — Activate structural terminal-event tests

**Files:**
- Modify: `apps/web/lib/orchestration/structural.test.ts`

- [ ] **Step 1:** Remove `it.todo` markers from Phase 1A Task 1A.8
- [ ] **Step 2:** Run; verify all assertions pass
- [ ] **Step 3:** Commit: `test(orchestration): activate structural terminal-event invariant`

#### Task 1B.6 — Verify `system` user exists; add seed if missing

**Files:**
- Modify: (potentially) `packages/db/prisma/seed.ts` or wherever the user seed lives
- Create: `apps/web/lib/orchestration/system-user.ts`

- [ ] **Step 1:** Check existing seed for a `system` user. Run `pnpm --filter @dpf/db prisma studio` or grep the seed file for `email.*system` / `userId.*system`
- [ ] **Step 2:** If a system user exists, document its userId in `apps/web/lib/orchestration/system-user.ts` as a constant. If not, add an upsert entry to the **canonical seed file** (`packages/db/prisma/seed.ts` per memory "DB fix = seed + migration") with a stable `userId` like `system-orchestration`. Use Prisma's `upsert` so re-seed is idempotent. Mark the user with a recognizable email (e.g. `system@dpf.local`) and a clear `displayName` like `"System (Orchestration)"`
- [ ] **Step 3:** Add a test asserting the system user exists after seeding
- [ ] **Step 4:** Commit: `feat(orchestration): system user constant + idempotent seed for infra-loop emit context`

#### Task 1B.7 — Open Phase 1B PR

- [ ] **Step 1:** Verify gates: typecheck clean, vitest green, next build clean, every commit DCO-signed
- [ ] **Step 2:** Open PR `feat(orchestration): unified event envelope + bus subscription overloads (Phase 1B)`. Body explicitly notes that legacy positional `subscribe(threadId, handler)` and `emit(threadId, event)` remain as shims and retire in Phase 7
- [ ] **Step 3:** Wait for review/merge

---

### Phase 1C — Cancellation Mapping & Run Lifecycle (PR 3)

**Branch:** `feat/orch-phase-1c-cancellation`

**Goal:** Map existing `agentEventBus.requestCancel` / `isCancelled` / `clearCancel` cancellation signals into `Outcome.cancelled` for primitives. Add a `runId` registry so primitives know whether their context's user has cancelled.

#### Task 1C.1 — Cancellation hook on RunContext

**Files:**
- Modify: `apps/web/lib/orchestration/primitives/loop.ts`
- Modify: `apps/web/lib/orchestration/primitives/branch.ts`
- Modify: `apps/web/lib/orchestration/types.ts`
- Create: `apps/web/lib/orchestration/cancellation.test.ts`

- [ ] **Step 1:** Write the failing test:
  - A `Loop` whose `RunContext.threadId` has `agentEventBus.requestCancel(threadId)` called mid-run returns `Outcome.cancelled{ reason: "user_cancelled" }`
  - Cancellation is checked at every attempt boundary (Loop) and on every branch settling (Branch)
- [ ] **Step 2:** Run test, expect failure
- [ ] **Step 3:** Implement: in `Loop` and `Branch`, before each attempt/branch settling, check `ctx.threadId && agentEventBus.isCancelled(ctx.threadId)`. If cancelled, return `Outcome.cancelled` with `reason: "user_cancelled"`, emit `*:cancelled`, clear the flag with `clearCancel(threadId)`
- [ ] **Step 4:** Run test, expect green
- [ ] **Step 5:** Commit: `feat(orchestration): map agentEventBus cancellation into Outcome.cancelled`

#### Task 1C.2 — Open Phase 1C PR

- [ ] **Step 1:** Verify gates
- [ ] **Step 2:** Open PR `feat(orchestration): cancellation mapping (Phase 1C)`. Phase 1 complete after merge

---

## Phase 2 — Low-Risk Polling Migrations (one PR)

**Branch:** `feat/orch-phase-2-polling`

**Goal:** Migrate `sandbox-db.ts` polls and `github-fork.ts` poll. These are infra-tier (use `system` profile), have simple exit predicates, and the github-fork migration **fixes a known silent-failure bug** (`{status: "deferred"}`).

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

### Task 2.4 — Open Phase 2 PR

- [ ] **Step 1:** Per-PR gates checklist
- [ ] **Step 2:** Open PR. Body **explicitly highlights** the github-fork behavior change with a "Migration notes for callers" section
- [ ] **Step 3:** Wait for merge

---

## Phase 3 — Build Orchestrator & Pipeline (one PR)

**Branch:** `feat/orch-phase-3-build-orch`

**Goal:** Migrate four related surfaces in one coherent PR: phase loop, tasks-within-phase fan-out, specialist retry, optimistic merge retry, and pipeline step retry.

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

### Task 3.6 — Open Phase 3 PR

- [ ] **Step 1:** Per-PR gates
- [ ] **Step 2:** Open PR. Body lists the four surfaces, the deleted constants, and the governance profiles chosen at each call site
- [ ] **Step 3:** Wait for merge

---

## Phase 4 — Provider Fallback Chain (one PR)

**Branch:** `feat/orch-phase-4-fallback`

**Goal:** Migrate `apps/web/lib/routing/fallback.ts:79` `callWithFallbackChain` to `Loop`. This is the cleanest test of `Loop`'s `strategy` function because each attempt genuinely picks a different endpoint.

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

### Task 4.2 — Open Phase 4 PR

- [ ] **Step 1:** Per-PR gates
- [ ] **Step 2:** Open PR
- [ ] **Step 3:** Wait for merge

---

## Phase 5 — Deliberation (one PR)

**Branch:** `feat/orch-phase-5-deliberation`

**Goal:** Migrate `deliberation-run.ts` worker branches and adjudicator to `Branch`. **Important behavior change:** today branches dispatch sequentially (verified at lines 114–260). Migrating to true parallel `Branch` is a semantic upgrade — the spec calls this out explicitly.

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

### Task 5.4 — Open Phase 5 PR

- [ ] **Step 1:** Per-PR gates
- [ ] **Step 2:** Open PR. Body notes the **deliberate sequential dispatch** preserves today's semantics; opening parallel dispatch is a follow-up
- [ ] **Step 3:** Wait for merge

---

## Phase 6 — Agentic Loop (one PR — HIGHEST RISK)

**Branch:** `feat/orch-phase-6-agentic-loop`

**Goal:** Migrate `apps/web/lib/tak/agentic-loop.ts:486-1107` (~620 lines) from a hand-rolled `for` loop with 6+ early exit paths to `Loop` with named exit predicates. **This migration explicitly breaks silent-success behavior** in favor of `Outcome.exhausted` per the spec's Agentic Loop Special Handling section.

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

### Task 6.6 — Open Phase 6 PR

- [ ] **Step 1:** Per-PR gates with extra emphasis on replay fixtures
- [ ] **Step 2:** Open PR. Body has a dedicated "Behavior changes" section listing the seven terminal-exit mappings from the table. Reviewers focus on the silent-exhaustion path
- [ ] **Step 3:** Wait for thorough review and merge. Memory: "Manual test AI Coworker" — **before merge, manually exercise the coworker UI** for each of the six scenarios and confirm the UI handles the new outcomes correctly
- [ ] **Step 4:** After merge, monitor first 100 production runs (telemetry note in PR per spec §Risks #2). Tune profile budgets if regressions appear

---

## Phase 7 — Retirement Sweep (one PR)

**Branch:** `feat/orch-phase-7-retirement`

**Goal:** Delete every legacy retry/loop construct and the legacy positional bus API. Add mechanical grep enforcement so they cannot reappear.

### Task 7.1 — Delete the legacy positional bus API

**Files:**
- Modify: `apps/web/lib/tak/agent-event-bus.ts`

- [ ] **Step 1:** Confirm zero callers remain of `subscribe(threadIdString, handler)` (positional first arg). Grep for `subscribe(` and inspect each match. If any remain, migrate them in this PR
- [ ] **Step 2:** Confirm zero callers remain of `emit(threadIdString, ...)` positional form (now should be the envelope form everywhere)
- [ ] **Step 3:** Delete the positional overloads from `agent-event-bus.ts`. Remove the legacy code path from internal `emit` (no more `Map<threadId, handlers>` if the object form replaces it; or keep both maps with the only entry point being object-form subscribe)
- [ ] **Step 4:** Run typecheck — must be clean. If any caller still uses positional, fix in this PR
- [ ] **Step 5:** Commit: `refactor(bus): retire legacy positional subscribe/emit API`

### Task 7.2 — Delete the shim file

**Files:**
- Delete: `apps/web/lib/agent-event-bus.ts` (the 3-line shim)
- Modify: 16 importers to point at canonical `apps/web/lib/tak/agent-event-bus.ts`

- [ ] **Step 1:** Update every importer (list from recon: 16 files) to import from `@/lib/tak/agent-event-bus` instead of `@/lib/agent-event-bus`
- [ ] **Step 2:** Delete the shim file
- [ ] **Step 3:** Typecheck clean
- [ ] **Step 4:** Commit: `chore(bus): delete shim file; all importers point at canonical path`

### Task 7.3 — Retire the agentic-loop feature flag

**Files:**
- Modify: callers from Phase 6 Task 6.5

- [ ] **Step 1:** Remove the `DPF_AGENTIC_LOOP_V2` flag and the conditional path from each caller
- [ ] **Step 2:** Delete any retained legacy code paths inside `agentic-loop.ts`
- [ ] **Step 3:** Run all replay fixtures
- [ ] **Step 4:** Commit: `chore(agentic-loop): retire DPF_AGENTIC_LOOP_V2 flag and legacy path`

### Task 7.4 — Mechanical enforcement via pre-push hook

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
  # type system after Task 7.1 deletes the positional overload — calling
  # positional becomes a typecheck error, which is stronger than grep and
  # avoids false-positives on variable-form object subscriptions like
  # subscribe(filter, handler) where filter holds {threadId} or {userId}.
  # No grep check needed here.
  ```
- [ ] **Step 3:** Run the hook locally to confirm it fires when patterns reappear (test by intentionally adding a violation, confirming hook blocks, reverting)
- [ ] **Step 4:** Commit: `chore(hooks): pre-push enforcement of orchestration boundaries`

### Task 7.5 — Verification grep sweep

- [ ] **Step 1:** Run each enforcement grep manually against the current branch
- [ ] **Step 2:** Confirm zero matches outside `apps/web/lib/orchestration/`
- [ ] **Step 3:** Document the final inventory in PR description: which constants were deleted, which files lost their retry loops, which event variants migrated to the envelope

### Task 7.6 — Open Phase 7 PR

- [ ] **Step 1:** Per-PR gates
- [ ] **Step 2:** Open PR `feat(orchestration): retirement sweep — one orchestration vocabulary (Phase 7)`
- [ ] **Step 3:** This PR closes the spec. After merge, the codebase has exactly one way to express each orchestration pattern

---

## Risk Register Reminders (per spec §Risks)

- **Phase 6 regression risk** — replay fixtures (Task 6.1) and feature-flag rollout (Task 6.5) mitigate
- **Bus migration destabilizes UX** — Phase 1B's compatibility shim survives until Phase 7, giving 5 PRs of soak time
- **Budget calibration** — Phase 6 PR description includes a "first 100 runs" telemetry note; tune in Phase 7 if needed
- **Deliberation semantic drift** — Phase 5 explicitly preserves sequential dispatch; parallel is a follow-up
- **Caller dependencies on best-effort content** — Phase 6 Task 6.4 forces every caller to handle `Outcome.exhausted`; TypeScript catches non-exhaustive matches

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
- [ ] Legacy positional `subscribe(threadId, handler)` and `emit(threadId, event)` retired
- [ ] All `runAgenticLoop` callers handle `Outcome.exhausted` explicitly
- [ ] First 100 production runs after Phase 6 show no silent-exhaustion regressions

---

## Plan Review

This plan must pass `plan-document-reviewer` before execution. After review approval, hand off to `subagent-driven-development` (recommended) or `executing-plans`.
