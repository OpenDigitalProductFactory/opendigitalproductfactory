# Codex probe evidence - 2026-04-29

This note captures the repo-grounded probes used to repair the coworker substrate design on 2026-04-29. Despite the filename, this is not a raw session dump. It is the distilled evidence record that the audit and spec cite.

## Scope

- Verify the real event-bus location and current shape
- Verify the current task-state vocabulary
- Verify concrete retry, polling, sequential, and fan-out call sites
- Verify where current code still returns ambiguous timeout/deferred semantics
- Verify overlap with the older execution-adapter design

## Evidence

### E1. Event bus is already task-aware, but still thread-keyed

Files:

- canonical implementation: [`apps/web/lib/tak/agent-event-bus.ts`](../../../../apps/web/lib/tak/agent-event-bus.ts) (~120 lines)
- intentional shim: [`apps/web/lib/agent-event-bus.ts`](../../../../apps/web/lib/agent-event-bus.ts) (2 lines, `export * from "./tak/agent-event-bus";`)

Observed:

- subscribers are keyed by `threadId`
- current API is `subscribe(threadId, handler)` and `emit(threadId, event)`
- event union already includes `task:status` and `task:artifact`
- imports across the codebase use both paths; both resolve to the same module via the shim

Implication:

- the substrate should extend the `tak/`-scoped implementation rather than propose a net-new task event family from scratch
- compatibility shims matter because multiple current event families already exist here, and the top-level path is itself a compatibility shim that callers may still rely on

### E2. Task-state vocabulary already exists and already matches the intended A2A-shaped direction

File:

- [`apps/web/lib/tak/task-states.ts`](../../../apps/web/lib/tak/task-states.ts)

Observed states:

- `submitted`
- `working`
- `input-required`
- `auth-required`
- `completed`
- `failed`
- `canceled`
- `rejected`
- `archived`

Implication:

- the substrate should reuse the existing state vocabulary
- docs should not present these as a fresh proposal

### E3. Build Studio already contains the substrate-worthy patterns

File:

- [`apps/web/lib/integrate/build-orchestrator.ts`](../../../apps/web/lib/integrate/build-orchestrator.ts)

Observed:

- bounded retry constant: `MAX_SPECIALIST_RETRIES = 2`
- sequential phase execution via `for (const phase of phases)`
- batched parallel dispatch with `Promise.all(...)`
- optimistic merge retry path around task-result persistence

Implication:

- Build Studio is the best early proving ground for the substrate after low-risk loops
- the migration can reduce real duplication immediately without starting at the main coworker loop

### E4. Provider fallback still walks a custom retry/backoff chain

File:

- [`apps/web/lib/routing/fallback.ts`](../../../apps/web/lib/routing/fallback.ts)

Observed:

- fallback chain built from routing decision candidates
- retry/backoff implemented inline in the loop
- special handling for rate limits, auth failures, and model retirement lives inside the same call path

Implication:

- this path is a strong later `Loop` consumer
- it should migrate only after the substrate has already proved itself on lower-risk cases

### E5. GitHub fork readiness still returns an ambiguous `"deferred"` status after polling

File:

- [`apps/web/lib/integrate/github-fork.ts`](../../../apps/web/lib/integrate/github-fork.ts)

Observed:

- fork creation polls until ready
- timeout returns `{ status: "deferred" }`

Implication:

- this is a clean first migration target for typed exhausted or still-pending outcomes
- it exercises polling semantics without the blast radius of the main coworker runtime

### E6. Deliberation runner is still sequential and branch-oriented

File:

- [`apps/web/lib/queue/functions/deliberation-run.ts`](../../../apps/web/lib/queue/functions/deliberation-run.ts)

Observed:

- branch nodes are separated into worker branches and adjudicator branches
- worker branches run through a sequential `for` loop
- route decisions and diversity degradation are persisted/emitted inline

Implication:

- the future `Branch` primitive should model strategic branch semantics here
- this lane is a semantic upgrade, not just a wrapper extraction

### E7. Older "execution adapter" already means something else in DPF

Files:

- [`docs/superpowers/specs/2026-03-20-execution-adapter-framework-design.md`](../../specs/2026-03-20-execution-adapter-framework-design.md)
- [`docs/superpowers/plans/2026-03-20-execution-adapter-framework.md`](../../plans/2026-03-20-execution-adapter-framework.md)

Observed:

- execution adapter there means provider-dispatch adapters around `callProvider()`
- scope is routing/provider execution, not coworker/runtime orchestration

Implication:

- the new lane needs qualified naming to avoid architecture and PR-review confusion

## Conclusions

1. The substrate problem is real and already visible in the repo.
2. The 2026-04-29 draft had the right instinct but needed tighter repo grounding.
3. Build Studio should be the first major consumer after the low-risk loop migrations.
4. The terminology must separate routing execution adapters from coworker execution substrate work.
