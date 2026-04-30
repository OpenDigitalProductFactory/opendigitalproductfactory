# Coworker Execution Adapter Substrate Plan

> For agentic workers: use a reviewable, checkpointed execution style. Do not start with the main coworker loop. Land the substrate in narrow slices with proof and deletion each time.

**Goal:** Add a coworker execution substrate for in-process orchestration, prove it on low-risk loops and Build Studio internals, then expand to later consumers without destabilizing the main coworker runtime.

**Architecture:** `apps/web/lib/coworker-substrate/` owns primitives, typed outcomes, event-envelope helpers, heartbeat logic, and reviewed runtime budgets. Existing consumers migrate onto it in phases. Inngest stays durable. Routing execution adapters stay in `apps/web/lib/routing/`.

**Refactor budget:** 20 percent of total implementation effort is reserved for refactoring and deletion. Each migration slice must retire at least one superseded constant, helper, or ambiguous status behavior.

**Primary spec:** [`docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md`](../specs/2026-04-29-coworker-execution-adapter-substrate-design.md)

---

## Phase 0: Naming and guardrails

**Objective:** Prevent architecture drift before code lands.

- [ ] Add a short module README or header comment in `apps/web/lib/coworker-substrate/` stating that this substrate is distinct from the routing execution-adapter framework.
- [ ] In PR descriptions and follow-on docs, use `coworker substrate` or `coworker execution substrate`, not bare `execution adapter`.
- [ ] Record the migration order in the active epic or backlog item so later work does not jump straight to the main coworker loop.

**Exit criteria:**

- reviewers can distinguish routing adapters from coworker substrate work without reading the whole spec

---

## Phase 1: Foundation

**Objective:** Land the substrate as a tested library with no business call-site migration yet.

**Files:**

- Create: `apps/web/lib/coworker-substrate/index.ts`
- Create: `apps/web/lib/coworker-substrate/types.ts`
- Create: `apps/web/lib/coworker-substrate/primitives.ts`
- Create: `apps/web/lib/coworker-substrate/events.ts`
- Create: `apps/web/lib/coworker-substrate/budgets.ts`
- Create: `apps/web/lib/coworker-substrate/heartbeat.ts`
- Create: `apps/web/lib/coworker-substrate/assert-never.ts`
- Create tests alongside the module

- [ ] Implement `Outcome`, `RunContext`, `Evidence`, and budget types.
- [ ] Implement `Loop` first. `Sequential`, `Parallel`, and `Branch` can land in the same PR only if the tests stay tight and readable.
- [ ] Implement event-envelope helpers that can project onto the existing thread-keyed bus without breaking subscribers.
- [ ] Implement heartbeat helpers with quiet-window reset semantics.
- [ ] Add unit tests for:
  - typed terminal outcomes
  - heartbeat emission
  - budget resolution
  - exhaustive outcome handling

**Verification:**

- [ ] `pnpm --filter web typecheck`
- [ ] `pnpm --filter web exec vitest run apps/web/lib/coworker-substrate`

**Exit criteria:**

- substrate library exists
- foundation tests pass
- no runtime call sites depend on it yet

---

## Phase 2: Low-risk loop migration

**Objective:** Prove the substrate on narrow polling semantics before Build Studio.

**Primary target:**

- [`apps/web/lib/integrate/github-fork.ts`](../../../apps/web/lib/integrate/github-fork.ts)

- [ ] Replace custom polling with substrate `Loop`.
- [ ] Replace ambiguous `"deferred"` timeout semantics with a typed exhausted or pending outcome that callers handle explicitly.
- [ ] Preserve user-facing meaning while improving internal semantics.
- [ ] Add focused tests for:
  - ready path
  - timeout/exhaustion path
  - heartbeat behavior if the loop can run long enough to matter

**Refactor budget use:**

- [ ] delete the old local polling helper logic once the substrate-backed path is stable

**Verification:**

- [ ] `pnpm --filter web typecheck`
- [ ] focused Vitest for `github-fork.ts`
- [ ] `cd apps/web && npx next build`

**Exit criteria:**

- at least one real call site uses the substrate
- one ambiguous terminal behavior has been retired

---

## Phase 3: Build Studio proving ground

**Objective:** Move the first major orchestration consumer onto the substrate.

**Primary target:**

- [`apps/web/lib/integrate/build-orchestrator.ts`](../../../apps/web/lib/integrate/build-orchestrator.ts)

**Scope for this phase:**

- `Sequential` for phase progression
- `Parallel` for batched specialist dispatch
- `Loop` for specialist retry
- `Loop` for optimistic merge retry where appropriate

- [ ] Extract substrate-backed helpers without changing Build Studio product behavior first.
- [ ] Migrate one behavior at a time, starting with the least coupled helper.
- [ ] Keep current progress events visible during the migration. If event semantics improve, preserve the user-facing progress stream instead of requiring UI rewrites in the same PR.
- [ ] Add or update tests around orchestrator behavior.

**Refactor budget use:**

- [ ] retire `MAX_SPECIALIST_RETRIES` if the budget registry fully supersedes it
- [ ] remove duplicated retry or merge-loop scaffolding that becomes dead code
- [ ] simplify event emission branches where the substrate now owns heartbeat or progress cadence

**Verification:**

- [ ] `pnpm --filter web typecheck`
- [ ] focused Vitest for Build Studio orchestration paths
- [ ] `cd apps/web && npx next build`
- [ ] UX verification on the running Build Studio path

**Exit criteria:**

- Build Studio is the first major substrate consumer
- at least one old constant or duplicate helper is deleted, not merely bypassed

---

## Phase 4: Provider fallback migration

**Objective:** Move routing fallback walking onto the substrate only after the substrate has already proved stable elsewhere.

**Primary target:**

- [`apps/web/lib/routing/fallback.ts`](../../../apps/web/lib/routing/fallback.ts)

- [ ] Migrate backoff and retry walking to `Loop`.
- [ ] Preserve provider-specific side effects such as model degradation, retirement, and auth disablement.
- [ ] Make terminal outcomes explicit instead of relying on the current mixed control-flow style.

**Refactor budget use:**

- [ ] delete superseded backoff plumbing once substrate-backed behavior is verified

**Verification:**

- [ ] `pnpm --filter web typecheck`
- [ ] focused Vitest for fallback behavior
- [ ] `cd apps/web && npx next build`

**Exit criteria:**

- substrate now covers both internal orchestration and provider fallback semantics

---

## Phase 5: Deliberation migration

**Objective:** Introduce `Branch` where the code really models strategy branches rather than simple parallelism.

**Primary target:**

- [`apps/web/lib/queue/functions/deliberation-run.ts`](../../../apps/web/lib/queue/functions/deliberation-run.ts)

- [ ] Map worker-branch dispatch and synthesis to `Branch`.
- [ ] Keep route-decision persistence and diversity-degradation evidence intact.
- [ ] Be explicit about which branch groups remain ordered and which can truly run in parallel.

**Refactor budget use:**

- [ ] remove duplicated branch-state scaffolding that the substrate now centralizes

**Verification:**

- [ ] `pnpm --filter web typecheck`
- [ ] focused Vitest for deliberation paths
- [ ] `cd apps/web && npx next build`

**Exit criteria:**

- branch-oriented orchestration has a canonical primitive

---

## Phase 6: Main coworker loop migration

**Objective:** Migrate the highest-risk runtime last, after the substrate is already proven elsewhere.

- [ ] inventory every distinct terminal path before refactoring
- [ ] map each current terminal path onto typed outcomes explicitly
- [ ] migrate callers in the same slice where necessary so no one depends on ambiguous free-text exhaustion behavior
- [ ] add replay-style or fixture-based tests for the highest-risk paths

**Required replay coverage:**

- [ ] normal successful multi-step run
- [ ] repeated-tool or stuck behavior
- [ ] cancellation
- [ ] exhaustion
- [ ] fatal failure

**Verification:**

- [ ] `pnpm --filter web typecheck`
- [ ] focused Vitest plus replay fixtures
- [ ] `cd apps/web && npx next build`
- [ ] UX verification on the running coworker path

**Exit criteria:**

- main coworker loop is substrate-backed
- compatibility assumptions are explicit instead of hidden

---

## Phase 7: Retirement sweep

**Objective:** Finish the migration as an architectural simplification, not a layering exercise.

- [ ] delete dead constants
- [ ] delete dead retry helpers
- [ ] remove stale comments that describe the pre-substrate behavior
- [ ] add a light review rule or grep-based check so new ad hoc retry loops do not creep back in casually

**Verification:**

- [ ] `pnpm --filter web typecheck`
- [ ] targeted Vitest for touched areas
- [ ] `cd apps/web && npx next build`

**Exit criteria:**

- one control-flow vocabulary remains
- the codebase is smaller and clearer than before the migration

---

## Sequence summary

1. Foundation
2. Low-risk loop migration
3. Build Studio proving ground
4. Provider fallback migration
5. Deliberation migration
6. Main coworker loop migration
7. Retirement sweep

This order is intentional. It reduces brittleness first, proves the substrate where DPF already hurts most, and keeps the highest-blast-radius coworker change until the end.
