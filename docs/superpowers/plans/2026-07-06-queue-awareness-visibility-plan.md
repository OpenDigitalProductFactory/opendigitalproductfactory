# EP-3516E23D Phase 3 — Queue visibility for coworker + human (BI-FD56CC6A)

**Spec:** [docs/superpowers/specs/2026-07-06-reusable-queueing-substrate-design.md](../specs/2026-07-06-reusable-queueing-substrate-design.md) §4.5
**BI:** BI-FD56CC6A (EP-3516E23D). Depends on Phase 1 (flow-telemetry spine, shipped #2652).
**Goal:** Make both the AI coworker and the human *informed* about queue state and
flow metrics — the operator's explicit ask — reading the QueueMetricSnapshot rows
Phase 1 produces, so both audiences quote the same numbers.

## Architecture

One shared read model (`queue-snapshot-service.ts`) with a pure health assessment;
every surface reads through it:
- **Coworker, pull** — a read-only MCP pack (`get_queue_status`, `list_at_risk_queues`).
- **Coworker, push** — a portal-context resolver that injects at-risk queues as
  `queue_backpressure` attention signals, plus a `queue-health` proactivity family
  that nudges assertively when a queue is backing up.
- **Human** — a `QueueHealthSection` server component of report-kit `StatCard`
  tiles, mounted on `/platform/ai/runtime-health`.

## Tasks (all complete in this PR)

1. **`lib/queue/queue-snapshot-service.ts`** — shared reader: `readQueueSnapshots`,
   `readAtRiskQueues`, pure `assessQueueHealth` (idle / healthy / watch / at-risk from
   depth, first-pass yield, SLA attainment, abandonment). Best-effort (returns [] on
   failure). 9 unit tests.
2. **`lib/mcp/packs/queue-awareness-pack.ts`** — read-only pack registered in
   `composeToolPacks`; grants mirrored in `agent-grants.ts` (`work_capsule_read`, the
   sibling ops-read grant). Provenance-free descriptions. 4 unit tests.
3. **`lib/portal-context/queue-awareness-resolver.ts`** + wiring — at-risk queues →
   `queue_backpressure` AttentionSignal (new kind), injected via `resolveSource`;
   injectable through `ResolverDeps.getQueueAttention` for hermetic envelope tests.
   4 unit tests.
4. **`lib/proactivity/`** — added `queue-health` activity family + a resolver branch
   (assertive on blocked/degraded queue signal).
5. **`lib/queue/queue-tile-model.ts`** + **`components/queue/QueueHealthSection.tsx`** —
   pure snapshot→StatCard-props mapper (3 unit tests) and the server component,
   mounted on the runtime-health page. `var(--dpf-*)` tokens only.

## Verification

- 22 new unit tests green; existing tool-registry parity, hygiene, agent-grants,
  proactivity, and portal-context suites green (envelope test made hermetic).
- `tsc --noEmit` clean across apps/web.
- Functional (post-merge, live): a coworker answers "how is queue X doing?" via
  `get_queue_status` with the same numbers the runtime-health tile shows; an at-risk
  queue surfaces a `queue_backpressure` attention item.

## Not in this phase

Field-service dispatch queue + booking→WorkItem bridge (Phase 4, BI-10E350A6);
CWQ bridge activation so real work items feed these queues (BI-C585535E) — until
then the surfaces render the sandbox-pool + any CWQ activity Phase 1 already emits.

UX-Fit-Decision: adds one always-visible read-only metric section to an existing
platform-admin page (no new route, no new nav entry, no user input). It consolidates
queue state operators otherwise cannot see at all; the tiles reuse the shared
report-kit StatCard family. Net surface is one section that removes a blind spot.
