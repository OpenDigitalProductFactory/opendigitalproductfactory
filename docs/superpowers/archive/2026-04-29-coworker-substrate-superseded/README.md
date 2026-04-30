# Coworker Substrate — Superseded by Merge

| Field | Value |
| --- | --- |
| Archived | 2026-04-30 |
| Reason | Merged into the canonical orchestration spec/plan pair per [audits/2026-04-29-orchestration-supersession-decision.md](../../audits/2026-04-29-orchestration-supersession-decision.md) |

## What's in this directory

- `spec.md` — Codex's coworker execution adapter substrate design (originally `docs/superpowers/specs/2026-04-29-coworker-execution-adapter-substrate-design.md`)
- `plan.md` — Codex's matching implementation plan (originally `docs/superpowers/plans/2026-04-29-coworker-execution-adapter-substrate-plan.md`)

## Why these aren't the canonical artifacts anymore

On 2026-04-29 two AI co-authors independently produced near-duplicate specs for DPF's in-process orchestration substrate:

- **Claude's pair** landed via [PR #349](https://github.com/markdbodman/opendigitalproductfactory/pull/349) at `docs/superpowers/specs/2026-04-29-orchestration-primitives-design.md` and the matching plan
- **Codex's pair** sat uncommitted on disk; landed via [PR #350](https://github.com/markdbodman/opendigitalproductfactory/pull/350) alongside an audit and a supersession decision memo

The two pairs shared architecture (four primitives, typed `Outcome`, governance-derived budgets, Inngest stays durable) but diverged on naming, migration order, and first-slice scope. The supersession memo decided **merge into one repaired pair** rather than letting two near-identical specs coexist.

## What was kept from these archived files

The merge folded the following Codex repairs into the canonical pair:

- **Naming and boundary rule** — disambiguates "coworker execution substrate" (in-process control flow) from the existing "execution adapter framework" (routing/provider plumbing). Code stays under `apps/web/lib/orchestration/`; "execution adapter" is reserved for routing work.
- **Migration order** — Build Studio is the first major proving ground after low-risk polling, not the bus refactor. The bus envelope refactor was originally Phase 1B's 16-file/40-emit-site PR; the Codex audit identified that as the highest-risk slice and the merge restructured Phase 1 into a small types-only PR with emit-site migrations distributed across consumer phases.
- **Mandatory 20% refactor budget** — every migration PR must retire at least one named constant, helper, or ambiguous status behavior. Reviewers reject wrapper-only migrations.
- **Repo-truth corrections** — `apps/web/lib/tak/agent-event-bus.ts` is canonical; the top-level `apps/web/lib/agent-event-bus.ts` is a 2-line shim re-exporting it. Task states already exist in `apps/web/lib/tak/task-states.ts` with the A2A-aligned vocabulary.

## What was kept from the original committed pair

- **Cost monotonicity invariant** (`cost.tokens` and `cost.ms` non-decreasing across events for the same `runId`) — load-bearing observability rule
- **Per-PR test gate checklist** (now 10 items including refactor-budget evidence)
- **Concrete migration inventory with file + line numbers** for all 13 in-process retry/iteration surfaces
- **Inngest boundary discipline detail** — explicit `step.waitForEvent`, durable retries, `retries: N` at function boundary
- **Detailed type contracts** with per-primitive worked examples (`Sequential`, `Parallel`, `Loop`, `Branch` semantics)
- **`GovernanceProfile` naming** (matches the Prisma `AgentGovernanceProfile` model) instead of Codex's `SubstrateProfile`

## What was added in the merge (beyond either draft)

- **Heartbeat reset edge-case fix** — only substrate-emitted events reset the quiet timer, not arbitrary consumer-emitted bus events. Otherwise a chatty step inside a stalled Loop could suppress `loop:still_working` indefinitely.
- **`RunContext.runId` ↔ `ToolExecution` linkage** — substrate `runId` is persisted on `ToolExecution.routeContext` so receipts and orchestration runs can be joined for forensics.
- **Plan rigor pass** — explicit red/green test steps, induced-failure smoke checks, per-phase emit-site migration scope, per-phase refactor-budget targets, per-phase verification gates.

## Where to read instead

- **Canonical spec:** [`docs/superpowers/specs/2026-04-29-orchestration-primitives-design.md`](../../specs/2026-04-29-orchestration-primitives-design.md)
- **Canonical plan:** [`docs/superpowers/plans/2026-04-29-orchestration-primitives.md`](../../plans/2026-04-29-orchestration-primitives.md)
- **Supersession decision memo (the analytical bridge between this archive and the canonical pair):** [`docs/superpowers/audits/2026-04-29-orchestration-supersession-decision.md`](../../audits/2026-04-29-orchestration-supersession-decision.md)
- **Codex audit (kept as historical record, not archived):** [`docs/superpowers/audits/2026-04-29-coworker-substrate-status-review.md`](../../audits/2026-04-29-coworker-substrate-status-review.md)

## Do not edit the files in this directory

These archived drafts are frozen. Future changes go to the canonical spec/plan above. If you find a substantive insight in the archived material that didn't make it into the merge, open an issue or PR against the canonical artifacts — don't revive the archive.
