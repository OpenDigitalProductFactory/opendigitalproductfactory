# Hive Scout Autonomous Coworker and Proceduralization Design

| Field | Value |
| --- | --- |
| Date | 2026-05-11 (Phase 1 landed 2026-05-11; Phase 2 ambiguity review in flight 2026-05-12) |
| Status | Phase 1 landed in main (`feat(ai): land Hive Scout taskrun phase 1 cleanly` #488). Phase 2 (autonomous ambiguity review) in progress per `docs/superpowers/plans/2026-05-12-hive-scout-v2-ambiguity-review.md`. Phases 3–4 (proceduralization loop, burn-rate-aware scheduling) deferred. |
| Related repo areas | `apps/web/lib/actions/hive-scout/ingest-500-agents.ts`, `apps/web/lib/actions/hive-scout/ingest-500-agents.test.ts`, `apps/web/lib/actions/hive-scout/ingest-500-agents-run.test.ts`, `apps/web/lib/queue/functions/hive-scout-ingest.ts`, `apps/web/lib/mcp-tools.ts`, `apps/web/scripts/hive-scout-manual-run.ts`, `apps/web/lib/actions/agent-task-scheduler.ts`, `apps/web/lib/actions/agent-task-scheduler-summary.ts`, `apps/web/lib/tak/scheduled-task-runs.ts`, `apps/web/lib/ai-operations-map/*`, `skills/platform/scout-external-catalogs.skill.md`, `prompts/templates/hive-scout-archetype-gap.prompt.md` |
| Related specs | `2026-05-11-autonomous-coworker-runtime-design.md`, `2026-04-27-routing-control-data-plane-design.md`, `2026-04-23-ai-provider-finance-bridge-design.md`, `2026-04-18-purpose-first-product-estate-design.md` |
| Related plan | `docs/superpowers/plans/2026-05-12-hive-scout-v2-ambiguity-review.md` |

## 1. Purpose

Hive Scout already gives DPF a real external-pattern scout: it reads an upstream catalog of open-source AI agent projects, detects likely archetype gaps, and files `BacklogItem` suggestions instead of importing code.

That is useful, but the May 2026 coworker/runtime work raises the bar. Background cognition should not remain a hidden cron script when the platform now has:

- governed `TaskRun` identity for autonomous coworker work,
- AI Operations Map visibility for proactive runs,
- scheduled coworker execution isolation,
- a stated doctrine of moving repeatable cognitive load from humans to coworkers and then into procedural code,
- use-it-or-lose-it subscription economics that justify proactive low-risk background work when prepaid capacity is underused.

This design updates the architectural direction for Hive Scout:

> Hive Scout should evolve from a catalog-ingest job into a governed autonomous coworker pattern that combines deterministic scouting code with bounded AI reasoning for ambiguous novelty, taxonomy fit, and archetype synthesis.

## 2. Current State

### 2.1 Repo-verified implementation

The current implementation is real and useful:

- [`apps/web/lib/actions/hive-scout/ingest-500-agents.ts`](apps/web/lib/actions/hive-scout/ingest-500-agents.ts) fetches and parses the MIT-licensed `500-AI-Agents-Projects` README, maps industries to IT4IT value streams, detects likely gaps, and creates deduplicated `BacklogItem` rows.
- [`apps/web/lib/queue/functions/hive-scout-ingest.ts`](apps/web/lib/queue/functions/hive-scout-ingest.ts) originally ran the ingest through Inngest on a weekly cadence; the seeded scheduled coworker path now supports a faster daily cadence while the platform is still evolving.
- [`apps/web/lib/queue/functions/index.ts`](apps/web/lib/queue/functions/index.ts) registers the function in the queue runtime.
- [`skills/platform/scout-external-catalogs.skill.md`](skills/platform/scout-external-catalogs.skill.md) describes the operator-facing intent.
- [`prompts/templates/hive-scout-archetype-gap.prompt.md`](prompts/templates/hive-scout-archetype-gap.prompt.md) provides the backlog-item body template. The file lives in `prompts/templates/` because it renders a backlog item body, not a coworker persona; its current frontmatter (`category: specialist`) is a known seed inconsistency to correct alongside the Slice 2 reviewer prompt landing (see §5.5).
- [`apps/web/scripts/hive-scout-manual-run.ts`](apps/web/scripts/hive-scout-manual-run.ts) supports local replays and idempotence checks.

### 2.2 Phase-1 landing update

Hive Scout phase 1 landed after this design was drafted. The platform now has:

- a seeded `external-catalog-scout` coworker and scheduled task,
- a governed `run_hive_scout_ingest` tool,
- scheduled `TaskRun` identity for Hive Scout runs,
- backlog evidence rows with `taskRunId` and scout source metadata,
- generic AI Operations Map projection through proactive `TaskRun`, tool execution, and backlog evidence sources.

The remaining Hive Scout v2 gap is narrower: ambiguous novelty, archetype/skill-gap classification, value-stream fit, proceduralization candidates, and burn-rate-aware background scheduling are not yet implemented.

### 2.3 Live-state note

The current-state statements above are repo-verified, not live-runtime counts. The local Postgres instance was unreachable from the original shell on 2026-05-11, so run counts, backlog deltas, and active queue state must be re-confirmed against a running install before Slice 1 acceptance.

## 3. Why the Recent Work Applies

### 3.1 Autonomous coworker runtime

[`2026-05-11-autonomous-coworker-runtime-design.md`](docs/superpowers/specs/2026-05-11-autonomous-coworker-runtime-design.md) establishes the platform doctrine:

> Move repeatable cognitive load from humans to AI coworkers, then move stabilized coworker behavior into procedural code.

Hive Scout is almost a textbook fit:

- humans should not manually browse external agent catalogs and remember what DPF already covers,
- coworkers can compare, summarize, and propose,
- repeated patterns in those proposals should become deterministic filters, mappings, and rules.

### 3.2 Scheduled coworker TaskRun substrate

The newest scheduled-coworker work links proactive runs into `TaskRun` through [`apps/web/lib/actions/agent-task-scheduler.ts`](apps/web/lib/actions/agent-task-scheduler.ts) and [`apps/web/lib/tak/scheduled-task-runs.ts`](apps/web/lib/tak/scheduled-task-runs.ts).

That makes Hive Scout a strong next consumer:

- it is already periodic,
- it is low-risk,
- it produces operator-reviewable output,
- it benefits from durable attribution and evidence.

### 3.3 AI Operations Map visibility

The AI Operations Map already projects proactive `TaskRun`, `ToolExecution`, receipt, backlog-evidence, and external-evidence records in [`apps/web/lib/ai-operations-map/load-map-data.ts`](apps/web/lib/ai-operations-map/load-map-data.ts).

Hive Scout should appear there as real AI workforce activity instead of being hidden inside a standalone queue function.

### 3.4 Use-it-or-lose-it economics

[`2026-04-23-ai-provider-finance-bridge-design.md`](docs/superpowers/specs/2026-04-23-ai-provider-finance-bridge-design.md) and [`2026-04-27-routing-control-data-plane-design.md`](docs/superpowers/specs/2026-04-27-routing-control-data-plane-design.md) already define use-it-or-lose-it handling for subscription providers.

When prepaid AI capacity is lagging its quota window, background work like Hive Scout becomes economically rational:

- bounded,
- asynchronous,
- reviewable,
- and capable of generating durable platform value.

This does **not** mean “burn credits for the sake of it.” It means Hive Scout is a valid candidate for low-priority background cognition when:

- the run is safe,
- the provider is lagging its committed usage window,
- the work can be interrupted or deferred without operational harm.

## 4. Target Architecture

### 4.1 Deterministic core stays procedural

The following parts remain deterministic code:

- upstream fetch and retry policy,
- parser logic,
- source URL deduplication,
- idempotent backlog item creation,
- stable value-stream alias mapping,
- admin notification,
- policy limits on which sources are allowed.

These are already code-shaped concerns and should not be pushed into prompts.

### 4.2 Ambiguous reasoning moves to the coworker

The following parts are better treated as autonomous coworker cognition:

- whether an external pattern is actually novel for DPF,
- whether it is a new coworker archetype versus a new skill on an existing coworker,
- how strongly it fits a given IT4IT/value-stream placement,
- whether multiple external projects should collapse into one synthesized internal archetype,
- whether the discovered idea is strategically relevant now versus informational only.

These are the high-context, fuzzy, judgment-heavy parts where a coworker can reduce human cognitive load.

### 4.3 Hybrid pattern

Hive Scout v2 follows a hybrid model:

1. Deterministic scout code fetches and normalizes raw catalog entries.
2. A governed autonomous coworker run evaluates candidate gaps in bounded batches.
3. The coworker emits structured judgments (typed JSON), not prose-only output.
4. Stable judgments are promoted into rules, mappings, filters, or typed schema.
5. Human reviewers only see compact proposals and exceptions.

This is the same ladder established by the autonomous runtime doctrine, applied to external-catalog scouting.

### 4.4 Operational guardrails

These are non-negotiable invariants the reviewer must respect:

- **Bounded batch.** The reviewer never sees more than 12 candidate entries per run; larger candidate sets are truncated, not deferred-by-blocking. The cap is sized to fit a single `effort: "low"` model call within the routing-spec rate-limit dampening window without splitting context, and to keep the reviewer's per-run wallclock under one minute on the cheapest capable provider. Revisit only with measured cost-per-decision data from Slice 2.
- **Failure is non-fatal, with a typed failure taxonomy.** If the reviewer fails, deterministic ingest continues and the run reports `reviewFailed` plus an enumerated `reviewFailureReason` in the run summary. Allowed reasons: `"timeout"`, `"json_parse"`, `"schema_validation"`, `"provider_rate_limit"`, `"provider_unavailable"`, `"router_no_route"`, `"budget_exhausted"`. Any other failure surfaces as `"unknown"` and is treated as critical (kill-switch candidate per §5.5).
- **Strict output contract.** Reviewer output is parsed as a JSON array of `AmbiguityReviewDecision` validated by a Zod schema (per the platform's existing prompt-response validation pattern). Entries that do not validate are silently dropped from the decision map (the entry then falls through to the deterministic path); the count of dropped entries is recorded as `reviewSchemaDropCount` for observability.
- **No tool authority inside the reviewer.** The reviewer call uses `routeAndCall` with no tool grants — it cannot fetch, parse, dedupe, write backlog items, or call other tools. The reviewer also has no DB read authority: its only context is the bounded candidate batch and a precomputed read-only summary of DPF skill/coworker names supplied as prompt input.
- **Fixed routing intent.** The reviewer call is pinned to `task type: "analysis"`, `effort: "low"`, `budget class: "minimize_cost"`. Provider selection is left to the router (per *No provider pinning*); the routing intent itself is part of the contract because it bounds cost-per-decision.
- **Opt-in by caller, kill-switchable at runtime.** The default reviewer is only enabled when `runHiveScoutIngest` is invoked through the governed `run_hive_scout_ingest` MCP tool (which sets `enableAutonomousReview: true`). Direct callers and the legacy queue function remain deterministic. Operators can additionally disable the reviewer at runtime by flipping `AppSetting` key `hive-scout.review.enabled = false`; when set, the MCP tool path skips the reviewer and records `reviewSkipReason: "operator_disabled"`. No code redeploy is required to revert.
- **Idempotent reviewer calls per source URL.** The reviewer is keyed by `sha256(sourceUrl)`. If a `BacklogItemActivity.payload.ambiguityReview` already exists for the same source URL within the rolling staleness window (default 30 days, overridable per `AppSetting`), the cached decision is reused and no provider call is made. This prevents repeated paid review of unchanged catalog rows on every cadence tick.
- **Reviewer prompt lives in the seeded prompt store.** The reviewer prompt is authored as `prompts/specialist/hive-scout-ambiguity-reviewer.prompt.md` (frontmatter `category: specialist`, `name: hive-scout-ambiguity-reviewer`), seeded into the DB and editable via Admin > Prompts. Prompt edits are versioned through the existing prompt-versioning path; runtime resolves by name, not by file path.
- **No new schema.** Review decisions are persisted as `BacklogItemActivity.payload.ambiguityReview`; no new tables or migrations are introduced. The `AppSetting` keys above use the existing settings table.
- **Public-data egress only.** The reviewed payload is a slice of the upstream MIT-licensed catalog plus DPF skill/coworker *names* (not bodies, not prompts, not tool grants). No customer data, PII, or proprietary org context is sent to the reviewer. This invariant must be enforced by a unit test that asserts the prompt input shape against an allowlist of fields.

## 5. Runtime Shape

### 5.1 Trigger and identity

Hive Scout should run as a proactive coworker task with `TaskRun` identity, not just as a free-floating queue function.

Recommended shape:

- trigger: `scheduled`
- source: `proactive`
- route context: `/platform/ai/operations` for runtime visibility, with deep links into backlog and skills
- source reference: `external-catalog-scout`
- evidence source tags: `hive-scout`, upstream catalog name, framework, value-stream confidence

### 5.2 Coworker ownership

Ownership is a dedicated `external-catalog-scout` specialist. Do **not** attach the scouting role to `portfolio-advisor` or any other broad-authority coworker. Phase 1 landed with this dedicated owner so that a domain-bounded coworker carries the scouting authority and backlog evidence attribution is unambiguous.

The seeded coworker has:

- bounded tool grants (`run_hive_scout_ingest` is the only proactive tool exposed),
- read-only external scouting (only the MIT-licensed upstream README is fetched),
- backlog proposal capability via `BacklogItem` writes,
- no direct auto-create authority for new coworkers or skills (those remain human-approved promotions out of the backlog).

### 5.3 Evidence and review

Each meaningful Hive Scout run produces:

- one `TaskRun` (proactive, scheduled source),
- `ToolExecution` rows for `run_hive_scout_ingest`,
- a `BacklogItemActivity` row of `kind: "evidence"` per created suggestion, linked by `taskRunId`,
- the run summary projected through the AI Operations Map via the existing generic projection (no Hive-Scout-specific UI),
- proceduralization markers in `BacklogItemActivity.payload.ambiguityReview` for later mining.

The activity payload for a Phase 2 run carries this shape:

```ts
{
  taskRunId: string | null;
  catalog: "500-AI-Agents-Projects";
  catalogLicense: "MIT";
  sourceUrl: string;
  framework: "crewai" | "autogen" | "agno" | "langgraph" | null;
  valueStream: string | null;
  valueStreamConfidence: "mapped" | "needs-mapping";
  ambiguityReview: {
    sourceUrl: string;
    classification: "new_archetype" | "existing_skill_gap" | "duplicate_pattern" | "out_of_scope" | "needs_human_review";
    novelty: "high" | "medium" | "low";
    valueStream: string | null;
    valueStreamConfidence: "high" | "medium" | "low";
    rationale: string;
  } | null;
}
```

`ambiguityReview` is `null` when the reviewer was disabled, failed, or the entry was not part of a reviewed batch. This makes it safe to query for "items the reviewer touched" without joining a second table.

**Authoritative vs advisory `valueStream`.** The outer `valueStream` field is the **authoritative** mapping used for backlog routing and AI Operations Map facets; it is derived deterministically from `INDUSTRY_TO_VALUE_STREAM`. The nested `ambiguityReview.valueStream` field is the reviewer's **advisory** proposal. When the two disagree, the disagreement is preserved in the activity payload as a proceduralization signal (Slice 3 mines these) and the deterministic value wins. Consumers MUST read the outer field for routing decisions and the nested field only for proceduralization or audit.

### 5.4 Authority resolution

The scout run authenticates as the `external-catalog-scout` agent acting under a system principal, typically the same principal that owns other proactive scheduled work on the install. Per [AGENTS.md §11 principal convergence](AGENTS.md) and parent spec [`2026-05-11-autonomous-coworker-runtime-design.md` §9.2](docs/superpowers/specs/2026-05-11-autonomous-coworker-runtime-design.md), `TaskRun.userId` must carry the resolved `Principal` id — not the agent id and not a bespoke scout identity. The agent's identity belongs in `currentAgentId`; the surface the schedule fired through belongs in `a2aMetadata.sourceRef.kind = "scheduled-task"`. Do not introduce a new identity-bearing row for the scout. The existing `Agent` row plus its `PrincipalAlias` linkage is sufficient.

The seeded `external-catalog-scout` coworker is `active` by default on fresh install (per the platform doctrine that bundled coworkers are plumbing, not opt-in registrations). Operators can disable it through the standard scheduled-task admin surface; they should not need to "register" it.

### 5.5 Reviewer observability and SLO hooks

Slice 2 emits per-run reviewer telemetry through the existing `TaskRun` summary and `BacklogItemActivity` substrate. No new metrics tables. The fields below are computed inside `extractHiveScoutSummary` and projected through the AI Operations Map without new UI:

| Field | Source | Purpose |
| --- | --- | --- |
| `reviewBatchSize` | reviewer call site | actual entries sent (≤ 12) |
| `reviewBatchUtilization` | `reviewBatchSize / 12` | sizing signal for the §4.4 cap |
| `reviewParseSuccessRate` | parsed entries / batch size | strict-output contract health |
| `reviewSchemaDropCount` | invalid entries dropped | proceduralization signal (prompt drift) |
| `reviewClassificationHistogram` | counts per classification | distribution health (e.g., 100% `out_of_scope` is a bug) |
| `reviewCacheHitRate` | cached / total candidates | §4.4 idempotency check |
| `reviewLatencyMs` | reviewer wallclock | provider/route selection signal |
| `reviewFailureReason` | enum from §4.4 | kill-switch trigger source |
| `reviewSkipReason` | `"operator_disabled" \| "no_subscription_lagging" \| ...` | audit trail for skipped runs |

**Kill-switch trigger conditions.** The reviewer is automatically paused (next run sets `reviewSkipReason: "auto_paused"`) and an admin notification is filed when, over the last 5 runs:

- `reviewParseSuccessRate < 0.5` (output contract collapsing), or
- `reviewFailureReason == "unknown"` appears more than once (uncategorized failure mode), or
- `reviewClassificationHistogram` shows ≥ 90% in a single class (degenerate output).

Auto-pause is a soft pause — operator clears it by flipping `hive-scout.review.enabled` after addressing the root cause. This pattern keeps the platform's "evidence before diagnosis" doctrine front-of-mind: the spec does not let the reviewer fail silently or self-degrade indefinitely.

## 6. Use-It-or-Lose-It Scheduling Policy

Hive Scout is a good consumer of underused prepaid AI capacity, but only under policy.

### 6.1 Concrete trigger signal

Do not invent new burn-rate terminology. Reuse the existing `burn_rate_score` and regime model already defined in [2026-04-27-routing-control-data-plane-design.md §6.5 and §11](2026-04-27-routing-control-data-plane-design.md):

```text
burn_rate_score = quota_consumed_fraction / window_elapsed_fraction
```

Regimes already defined in the routing spec:

- `regime == "lagging"` when `burn_rate_score < 0.85`,
- `regime == "on-track"` when `0.85 <= burn_rate_score <= 1.15`,
- `regime == "ahead"` when `burn_rate_score > 1.15`,
- `regime == "unknown"` when the cap is not known yet; no burn-rate adjustment.

Hive Scout's burn-rate-aware trigger fires only when all of the following are true:

1. At least one subscription-served provider is in `regime == "lagging"`.
2. `timeToWindowEndMs < 25%` of `windowDuration`, matching the existing watchdog detector in the routing spec.
3. The deterministic scout core has new or stale source material to evaluate.
4. No higher-priority operational `TaskRun` is queued for the same provider class.

A run triggered by burn-rate assist must record `a2aMetadata.triggerReason = "burn-rate-lagging"` plus the observed `burn_rate_score` at trigger time. Manual and scheduled-cadence triggers record their own reasons: `"manual"`, `"cadence"`, `"stale-source"`, or `"new-source"`.

### 6.2 Safe use cases

Burn-rate-aware preference is appropriate when:

- the task is background-only,
- the output is reviewable before irreversible action,
- no sensitive external data is involved,
- the run can be rate-limited, paused, or deferred.

Hive Scout meets those conditions.

### 6.3 Not a forced-consumption engine

Do **not** let use-it-or-lose-it logic turn Hive Scout into busywork.

Guardrails:

- only run when there is new or stale source material worth evaluating,
- cap spend per run and per quota window, with the implementation setting the actual budget variable,
- batch similar entries,
- prefer the cheapest capable model first through dynamic routing; do not pin Hive Scout to one provider,
- stop when marginal novelty falls below a threshold,
- emit `triggerReason` in `a2aMetadata` so operators can audit why each run happened.

### 6.4 Policy recommendation

Hive Scout should be eligible for a background "subscription utilization assist" queue class:

- lower priority than operational recovery,
- higher priority than cosmetic research,
- auto-paused when no provider is in `regime == "lagging"` near window end,
- safe to resume when the §6.1 trigger condition becomes true again.

This queue class is a new concept; it does not exist yet. Slice 4 introduces it and must coordinate with the routing scorer so background scout runs are not double-counted against the same lagging provider.

## 7. Implementation Slices

### Slice 1: TaskRun-ize Hive Scout — LANDED 2026-05-11 (PR #488)

Goal: make Hive Scout a first-class proactive coworker run.

Scope (delivered):

- routed Hive Scout through the scheduled coworker substrate,
- creates `TaskRun` for each run,
- writes structured run summaries (`extractHiveScoutSummary`),
- projects runs into the AI Operations Map via the generic projection,
- preserves the existing deterministic ingest logic.

Acceptance (met):

- each Hive Scout run has one `TaskRun`,
- run appears in AI Operations Map,
- backlog suggestions link back to source run evidence via `taskRunId`.

### Slice 2: Add autonomous ambiguity review — IN FLIGHT

Plan: [`docs/superpowers/plans/2026-05-12-hive-scout-v2-ambiguity-review.md`](docs/superpowers/plans/2026-05-12-hive-scout-v2-ambiguity-review.md).

Goal: keep procedural code for fetch/parse/dedupe/write, but let the coworker judge novelty and value-stream fit for the candidate-gap set.

Scope:

- batch candidate gaps (deterministically detected via `isGap()`),
- invoke `routeAndCall` with task type `analysis`, effort `low`, budget class `minimize_cost`,
- classify each entry as `new_archetype`, `existing_skill_gap`, `duplicate_pattern`, `out_of_scope`, or `needs_human_review`,
- skip `duplicate_pattern` and `out_of_scope` before backlog write,
- defer `needs_human_review` (status `deferred`),
- persist the decision as `BacklogItemActivity.payload.ambiguityReview`,
- keep human review on the final proposal layer.

Acceptance:

- deterministic path still handles obvious duplicates (URL hash dedupe runs first),
- reviewer batch capped at 12 entries per run,
- reviewer is opt-in: only enabled through the governed `run_hive_scout_ingest` tool,
- reviewer is runtime-disable-able via `AppSetting` `hive-scout.review.enabled = false` without code redeploy,
- reviewer failure does not block the deterministic ingest (`reviewFailed` + typed `reviewFailureReason` reported),
- repeated runs over unchanged source URLs hit the per-source cache and do not re-bill the provider,
- created suggestions carry structured review evidence,
- proposals are reviewable in the existing backlog UI without new screens,
- §5.5 telemetry fields appear in the run summary and AI Operations Map projection.

Rollback path: if Slice 2 misbehaves in production, the operator sets `hive-scout.review.enabled = false`. The MCP tool path then skips `routeAndCall`, records `reviewSkipReason: "operator_disabled"`, and Hive Scout reverts to its pre-Slice-2 deterministic-only behavior on the very next run. No code revert, no migration rollback, no data backfill is required because no new schema was introduced.

### Slice 3: Add proceduralization loop — DEFERRED

Goal: stop re-solving the same archetype decisions forever.

Scope:

- mine `BacklogItemActivity.payload.ambiguityReview` for repeated reviewer conclusions and repeated human corrections,
- promote stable mappings (industry → value stream) into the `INDUSTRY_TO_VALUE_STREAM` constant or its DB-backed successor,
- promote stable "out of scope" patterns into deterministic pre-filters before review,
- record `CoworkerCapabilityNeed` rows when the coworker repeatedly lacks the right model/context,
- surface Hive Scout as a proceduralization candidate source in AI Operations.

Acceptance:

- repeated false positives decline run-over-run,
- repeated out-of-scope classes become deterministic filters,
- repeated "existing skill gap" outcomes against the same coworker become rules.

### Slice 4: Add burn-rate-aware background scheduling — DEFERRED

Depends on the routing/finance work in `2026-04-27-routing-control-data-plane-design.md` and `2026-04-23-ai-provider-finance-bridge-design.md` reaching live policy enforcement of provider burn rate.

Goal: use lagging prepaid quota intelligently.

Scope:

- add Hive Scout to a `subscription-utilization-assist` background queue class (new concept; see §6.4),
- let routing/provider policy prefer lagging subscription providers for this task class,
- record run trigger reasons (cadence / stale source / new source / quota-lag assist / human trigger) and consumption outcomes,
- cap budget and concurrency per quota window.

Coordination interface with routing (the contract that lets Slice 4 land without re-shaping the router):

1. **Workload class declaration.** The scheduler tags burn-rate-triggered Hive Scout runs with `workloadClass: "subscription-utilization-assist"` in `a2aMetadata`. The router treats this class as eligible for the lagging-provider preference, ineligible for operational-recovery preemption, and rate-limit-dampened first under contention.
2. **Trigger reason as routing signal, not as routing decision.** `a2aMetadata.triggerReason = "burn-rate-lagging"` plus the observed `burn_rate_score` are recorded by the scheduler at decision time. The router does NOT re-derive burn rate from these fields; it reads its own live counters. This avoids the double-count described in §6.4.
3. **Budget envelope.** The scheduler passes `budgetEnvelopeUsd` (per run) and `concurrencyLimit` (per quota window) as routing hints; the router enforces both at call time. Defaults set in `AppSetting`, not hard-coded.
4. **Backpressure signal.** If the router rejects a Hive Scout call with `reviewFailureReason: "budget_exhausted"` or `"router_no_route"`, the scheduler skips the next N cadence ticks (exponential backoff, capped at one full cadence period). This prevents a thundering-herd against an already-saturated provider.

Acceptance:

- Hive Scout can be triggered by quota-lag conditions,
- it remains bounded and reviewable,
- it never crowds out higher-priority operational work,
- the routing scorer and the scheduler agree on which provider was actually lagging at trigger time (verified by replaying `a2aMetadata.burn_rate_score` against the routing spec's live counters in a post-run audit).

## 8. Sequencing Decision and Open Items

### 8.1 Sequencing decision: Slice 2 next

Slice 1 landed cleanly (PR #488). The next move is **Slice 2: autonomous ambiguity review**, scoped per [`docs/superpowers/plans/2026-05-12-hive-scout-v2-ambiguity-review.md`](docs/superpowers/plans/2026-05-12-hive-scout-v2-ambiguity-review.md).

Why this and not Slices 3 or 4 next:

- Slice 1's evidence rows already carry the `taskRunId` and source metadata that Slice 2 enriches — the seam exists,
- the bounded reviewer is the smallest piece of cognition that gives the human operator real value (kills duplicates, classifies novelty) without introducing budget or scheduling complexity,
- Slice 3 (proceduralization) needs review-decision rows in the backlog to mine; Slice 2 produces them,
- Slice 4 (burn-rate-aware scheduling) needs a stable, low-cost workload to dispatch; Slice 2 delivers that workload shape,
- there is no new migration, no new UI surface, and no new identity — the change rides on existing schema.

Slices 3 and 4 should wait until Slice 2 has produced at least one quarter of review-decision evidence, so that promotion rules and quota-lag triggers are grounded in observed behavior rather than speculation.

### 8.2 Open decisions for Slice 2 reviewers

These are genuinely undecided and need to be resolved before Slice 2 is signed off. Each is scoped to a single-sentence answer, not a sub-spec:

1. **Reviewer prompt provenance.** The §4.4 invariant places the reviewer prompt at `prompts/specialist/hive-scout-ambiguity-reviewer.prompt.md`. Confirm this path is created in Slice 2 (the current plan defers prompt authoring) and that the existing prompt-seeder picks it up on fresh install.
2. **Per-source cache TTL default.** §4.4 sets the staleness window default to 30 days, overridable per `AppSetting`. Confirm 30d is correct for the upstream catalog's actual update cadence; if upstream changes weekly, a shorter default is warranted.
3. **Auto-pause severity in §5.5.** The auto-pause thresholds (parse rate < 0.5, ≥ 90% single-class, repeated `unknown` failures) are operator-tunable per `AppSetting` or hard-coded — pick one. Recommendation: `AppSetting`, so operators can lower the bar during early observation.
4. **Reviewer-disagreement signal weight in Slice 3.** §5.3 says reviewer's `valueStream` is advisory and the deterministic value wins. Slice 3 will mine disagreements as proceduralization signal — confirm the promotion rule is "N consecutive disagreements on the same industry → propose a deterministic mapping update," not a one-shot promotion.
5. **Public-data egress unit test.** §4.4 requires a test asserting the prompt input shape against a field allowlist. Confirm the test owner (Slice 2 plan does not currently name it) and that the allowlist is colocated with the reviewer call site, not the test.

## 9. Research and Benchmarking

Per [`AGENTS.md`](AGENTS.md) §10, every feature spec compares prior art and explains what was adopted, rejected, and uniquely filled. Hive Scout sits at the intersection of three families of prior art — none of them solve the same problem, which is what makes a DPF-native scout worth building.

### 9.1 Open-source comparators

| Project | What it does | Pattern adopted | Pattern rejected |
| --- | --- | --- | --- |
| [`ashishpatel26/500-AI-Agents-Projects`](https://github.com/ashishpatel26/500-AI-Agents-Projects) (MIT) | Curated README catalog of ~500 open-source agent projects, hand-maintained, framework-tagged. | Catalog-as-data source; framework taxonomy (`crewai`, `autogen`, `agno`, `langgraph`); MIT license posture (reference, not vendor). | Hand-curation as the only quality gate — we add deterministic dedupe and bounded AI review on top. |
| [`e2b-dev/awesome-ai-agents`](https://github.com/e2b-dev/awesome-ai-agents) (MIT) | "Awesome list" pattern: hand-curated, README-only, no machine-readable schema. | Public-data egress posture; the "scout reads catalogs" framing. | Plain awesome-list as source — has no value-stream alignment and high duplication; would force more LLM work than necessary. |
| [`microsoft/autogen`](https://github.com/microsoft/autogen) tool-discovery patterns | Multi-agent runtime with structured tool registration. | Bounded tool grants per agent; reviewer cannot fetch/parse/write. | Free-form multi-agent conversation as the discovery primitive — too unbounded for a periodic scout. |

### 9.2 Commercial comparators

| Product | What it does | Pattern adopted | Pattern rejected |
| --- | --- | --- | --- |
| Glean Work AI agents directory | Internal "agent marketplace" with usage analytics, hand-promoted from prototypes. | Promotion-from-evidence model: do not auto-create capabilities; backlog suggestions are reviewed and promoted. | Closed marketplace with vendor-only authorship — DPF must let an org's own scout discover its own gaps. |
| Lindy / Cognosys agent libraries | Vendor-curated "templates" of pre-built agents, filed under business categories. | Industry/category labelling as a discovery aid. | Vendor taxonomy as the only taxonomy — DPF aligns to IT4IT value streams, which the vendor catalogs do not expose. |
| HubSpot/Salesforce AppExchange-style integration directories | Marketplace listings ranked by category and use-case fit. | Compact, scannable proposal cards; one-click reject/accept. | Paid placement / commercial ranking signals — Hive Scout is governance-driven, not vendor-driven. |

### 9.3 Anti-patterns identified

- **"Scout that vendors code."** Several open-source scouts auto-clone or auto-fork interesting repos. Rejected: Hive Scout is read-only and produces backlog suggestions, not branches. Vendoring is a separate human decision.
- **"Free-form LLM novelty scoring."** Several agent-marketplace projects drop the entire catalog through an LLM with a prose prompt and parse the output by regex. Rejected: deterministic URL-hash dedupe runs first; the LLM only sees the post-dedupe candidate set; output is strict JSON.
- **"One mega-coworker for everything external."** Some platforms expose a "do-anything researcher" agent. Rejected: `external-catalog-scout` has one bounded tool grant; no general web/search authority.
- **"Scout that fetches arbitrary URLs."** Common in supply-chain / dependency-discovery tools (e.g., naive Dependabot-style polling that follows redirects into unknown registries). Rejected: Hive Scout fetches one named MIT-licensed README from a hard-coded source list; egress is allow-listed, not discoverable. New sources require a code change reviewed under the §4.1 deterministic-core rules.
- **"Reviewer that retains memory across runs."** Some agent frameworks pass cross-run conversation state into background reviewers as "context." Rejected: the reviewer is stateless per call; only the per-source cache (§4.4) carries state across runs, and it carries decisions, not conversation.

### 9.4 Gaps that Hive Scout fills

- **IT4IT value-stream alignment.** No comparator maps external archetypes onto IT4IT value streams; DPF does, and the value-stream confidence field carries that judgement into the backlog.
- **Governed evidence for proceduralization.** No comparator persists structured review decisions as backlog evidence intended for later proceduralization — this is the unique DPF doctrine ("AI first, then procedure").
- **Single-org / no marketplace.** DPF is single-org-per-install (no multi-tenancy); the scout is for *your* org's gaps, not a shared directory.

## 10. Recommendation

Adopt Hive Scout as one of the first non-build, non-recovery proof points of the autonomous coworker runtime.

That makes it useful in four ways at once:

- it reduces human research/orchestration burden,
- it produces governed evidence in the runtime control surface,
- it creates a clean case for the platform's "AI first, then procedure" doctrine,
- it supplies a bounded background-work candidate for capacity-aware scheduling.

After Slice 2, Slice 3 (proceduralization mining) and Slice 4 (burn-rate-aware scheduling) are mutually unblocking — neither blocks the other — and can be sequenced based on which signal arrives first: enough review-decision rows to mine (Slice 3 trigger) or enough live burn-rate data to act on (Slice 4 trigger). The §8.2 open decisions should be resolved before Slice 2 sign-off, not deferred into Slice 3.
