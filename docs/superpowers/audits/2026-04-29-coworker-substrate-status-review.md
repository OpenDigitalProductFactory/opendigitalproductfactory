# Coworker substrate status review - 2026-04-29

| Field | Value |
| --- | --- |
| Spec under review | [`docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md`](../specs/2026-04-29-coworker-execution-adapter-substrate-design.md) |
| Evidence note | [`docs/superpowers/audits/evidence/2026-04-29-codex-jsonl-probe.md`](./evidence/2026-04-29-codex-jsonl-probe.md) |
| Source draft reviewed | [`docs/superpowers/specs/2026-04-29-orchestration-primitives-design.md`](../specs/2026-04-29-orchestration-primitives-design.md) |
| Related prior design | [`docs/superpowers/specs/2026-03-20-execution-adapter-framework-design.md`](../specs/2026-03-20-execution-adapter-framework-design.md) |
| Generated | 2026-04-29 |
| Reviewer stance | Architecture review and repair |

## Executive read

The 2026-04-29 orchestration draft is directionally strong. It correctly identifies repeated retry, polling, fan-out, and budget drift as a substrate problem rather than a one-off bug. The draft should not ship as-is, though. It currently mixes three different concerns:

1. coworker/runtime orchestration substrate
2. older routing-layer "execution adapter" terminology
3. large migration aspirations that are not yet broken into a safe first slice

This review tightens the architecture around one governing idea:

- DPF should add a small coworker execution substrate for in-process control flow and event semantics
- that substrate should be explicit about what it owns and what it does not
- the first implementation slice should prove the substrate on low-risk loops and on Build Studio orchestration internals before touching the highest-blast-radius coworker loop

## Findings

### 1. Naming collision with the existing execution-adapter design

The repo already has an approved "Execution Adapter Framework" design dated 2026-03-20. In that document, an execution adapter means provider-dispatch plumbing inside `callProvider()` and the routing layer, not orchestration semantics.

If the new substrate reuses the same label without qualification, reviewers will confuse:

- routing/provider adapters
- coworker/runtime orchestration primitives

The repaired spec therefore uses the term `coworker execution substrate` and treats `execution adapter` as a compatibility term only where needed.

### 2. Current repo truth was partially overstated in the source draft

The source draft is correct that event and retry semantics are fragmented, but several repo facts needed correction:

- The canonical event bus implementation is [`apps/web/lib/tak/agent-event-bus.ts`](../../../apps/web/lib/tak/agent-event-bus.ts). The top-level [`apps/web/lib/agent-event-bus.ts`](../../../apps/web/lib/agent-event-bus.ts) is an intentional 2-line shim re-exporting it; substrate work should target the `tak/`-scoped file. (An earlier draft of this audit had the direction inverted; the source draft was correct.)
- The bus is still thread-keyed, but it already contains `task:status` and `task:artifact` event families. This means Phase 1 should extend a partially task-aware bus, not invent task semantics from zero.
- Task states already include `submitted`, `working`, `input-required`, `auth-required`, `completed`, `failed`, `canceled`, `rejected`, and `archived` in [`apps/web/lib/tak/task-states.ts`](../../../apps/web/lib/tak/task-states.ts). The new substrate should reuse that vocabulary rather than propose it as net-new.

These are repairable design issues, not reasons to reject the direction.

### 3. The first slice was still too big

The source draft recommended foundation plus polling-loop migration. That is much better than starting with `agentic-loop.ts`, but it still bundled:

- new primitive runtime
- new event envelope
- heartbeat semantics
- governance-profile resolution
- event-bus compatibility work
- call-site migration

That is too much to debug at once in a brittle area. The repaired plan splits the work into:

1. pure substrate foundation
2. low-risk loop migration
3. Build Studio internal orchestration refactor
4. provider fallback migration
5. deliberation migration
6. coworker loop migration last

### 4. Build Studio needs to be a proving ground before the main coworker loop

Repo evidence points to Build Studio as the better first proving ground:

- `build-orchestrator.ts` already contains explicit sequential phase execution, bounded retries, and batched parallel dispatch.
- those behaviors are real substrate candidates but are still narrower and easier to observe than the full coworker loop.
- the user has repeatedly steered this area toward reliability and brittleness reduction before breadth expansion.

The revised plan therefore makes Build Studio the first substantive consumer after low-risk polling loops.

### 5. Refactoring must be first-class, not incidental

This lane will fail if it only adds wrappers while leaving old constants, duplicate retry tables, and stale helper semantics in place. The implementation plan now reserves 20 percent of implementation effort for:

- deleting superseded constants
- consolidating duplicated loop helpers
- moving call-site-specific policies into the substrate registry
- simplifying event-emission branches after migration

That refactor budget is mandatory, not optional cleanup.

## Decision

Proceed, but with the repaired artifact set in this thread instead of the raw 2026-04-29 draft alone.

Recommended active artifacts:

- audit: this file
- evidence: `docs/superpowers/audits/evidence/2026-04-29-codex-jsonl-probe.md`
- spec: `docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md`
- plan: `docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md`

Recommended status for `2026-04-29-orchestration-primitives-design.md`:

- keep as useful draft input
- do not treat it as the implementation-facing canonical artifact without the repairs captured in the new spec and plan

## What changed from the original direction

- narrowed the naming so it no longer collides with routing execution adapters
- corrected repo-truth statements around the event bus and task states
- promoted Build Studio to the first real migration target after low-risk loops
- made compatibility and projection rules explicit
- added a required 20 percent refactor budget

## What still needs live verification later

- exact Build Studio hot spots that should migrate in the first implementation PR
- event-envelope compatibility impact on current SSE subscribers
- whether any current callers depend on ambiguous free-text exhaustion behavior

Those are implementation-time checks, not reasons to block the design.
