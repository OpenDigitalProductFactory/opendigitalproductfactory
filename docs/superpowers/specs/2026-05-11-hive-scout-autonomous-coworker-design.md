# Hive Scout Autonomous Coworker and Proceduralization Design

| Field | Value |
| --- | --- |
| Date | 2026-05-11 |
| Status | Draft for review |
| Related repo areas | `apps/web/lib/actions/hive-scout/ingest-500-agents.ts`, `apps/web/lib/queue/functions/hive-scout-ingest.ts`, `apps/web/scripts/hive-scout-manual-run.ts`, `skills/platform/scout-external-catalogs.skill.md`, `prompts/specialist/hive-scout-archetype-gap.prompt.md`, `apps/web/lib/actions/agent-task-scheduler.ts`, `apps/web/lib/tak/scheduled-task-runs.ts`, `apps/web/lib/ai-operations-map/*` |
| Related specs | `2026-05-11-autonomous-coworker-runtime-design.md`, `2026-04-27-routing-control-data-plane-design.md`, `2026-04-23-ai-provider-finance-bridge-design.md`, `2026-04-18-purpose-first-product-estate-design.md` |

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

- [ingest-500-agents.ts](D:/DPF/apps/web/lib/actions/hive-scout/ingest-500-agents.ts:1) fetches and parses the MIT-licensed `500-AI-Agents-Projects` README, maps industries to IT4IT value streams, detects likely gaps, and creates deduplicated `BacklogItem` rows.
- [hive-scout-ingest.ts](D:/DPF/apps/web/lib/queue/functions/hive-scout-ingest.ts:1) originally ran the ingest through Inngest on a weekly cadence; the seeded scheduled coworker path now supports a faster daily cadence while the platform is still evolving.
- [index.ts](D:/DPF/apps/web/lib/queue/functions/index.ts:1) registers the function in the queue runtime.
- [scout-external-catalogs.skill.md](D:/DPF/skills/platform/scout-external-catalogs.skill.md:1) describes the operator-facing intent.
- [hive-scout-archetype-gap.prompt.md](D:/DPF/prompts/specialist/hive-scout-archetype-gap.prompt.md:1) provides the backlog-item body template.
- [hive-scout-manual-run.ts](D:/DPF/apps/web/scripts/hive-scout-manual-run.ts:1) supports local replays and idempotence checks.

### 2.2 What it does not yet do

Hive Scout is not yet aligned with the autonomous coworker runtime direction:

- it is not represented as a first-class coworker `TaskRun`,
- it does not project into the AI Operations Map as meaningful autonomous work,
- it does not use AI reasoning for ambiguous gap detection,
- it does not generate capability-needs or proceduralization candidates,
- it does not yet participate in provider burn-rate-aware background work scheduling,
- it does not yet create a governed review loop richer than filing backlog suggestions.

### 2.3 Live-state note

The current-state statements above are repo-verified, not live-runtime counts. The local Postgres instance was unreachable from the original shell on 2026-05-11, so run counts, backlog deltas, and active queue state must be re-confirmed against a running install before Slice 1 acceptance.

## 3. Why the Recent Work Applies

### 3.1 Autonomous coworker runtime

[2026-05-11-autonomous-coworker-runtime-design.md](D:/DPF/docs/superpowers/specs/2026-05-11-autonomous-coworker-runtime-design.md:1) establishes the platform doctrine:

> Move repeatable cognitive load from humans to AI coworkers, then move stabilized coworker behavior into procedural code.

Hive Scout is almost a textbook fit:

- humans should not manually browse external agent catalogs and remember what DPF already covers,
- coworkers can compare, summarize, and propose,
- repeated patterns in those proposals should become deterministic filters, mappings, and rules.

### 3.2 Scheduled coworker TaskRun substrate

The newest scheduled-coworker work links proactive runs into `TaskRun` through [agent-task-scheduler.ts](D:/DPF/apps/web/lib/actions/agent-task-scheduler.ts:1) and [scheduled-task-runs.ts](D:/DPF/apps/web/lib/tak/scheduled-task-runs.ts:1).

That makes Hive Scout a strong next consumer:

- it is already periodic,
- it is low-risk,
- it produces operator-reviewable output,
- it benefits from durable attribution and evidence.

### 3.3 AI Operations Map visibility

The AI Operations Map already projects proactive `TaskRun`, `ToolExecution`, receipt, backlog-evidence, and external-evidence records in [load-map-data.ts](D:/DPF/apps/web/lib/ai-operations-map/load-map-data.ts:1).

Hive Scout should appear there as real AI workforce activity instead of being hidden inside a standalone queue function.

### 3.4 Use-it-or-lose-it economics

[2026-04-23-ai-provider-finance-bridge-design.md](D:/DPF/docs/superpowers/specs/2026-04-23-ai-provider-finance-bridge-design.md:32) and [2026-04-27-routing-control-data-plane-design.md](D:/DPF/docs/superpowers/specs/2026-04-27-routing-control-data-plane-design.md:448) already define use-it-or-lose-it handling for subscription providers.

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

The following parts should remain deterministic code:

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

Hive Scout v2 should therefore follow a hybrid model:

1. Deterministic scout code fetches and normalizes raw catalog entries.
2. A governed autonomous coworker run evaluates ambiguous items in batches.
3. The coworker emits structured judgments, not prose-only output.
4. Stable judgments are promoted into rules, mappings, filters, or typed schema.
5. Human reviewers only see compact proposals and exceptions.

This is the same ladder established by the autonomous runtime doctrine, applied to external-catalog scouting.

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

Ownership is a dedicated `external-catalog-scout` specialist. Do **not** attach the scouting role to `portfolio-advisor` or any other broad-authority coworker.

Reasons:

- DPF's agent standards mandate small, context-specific tool surfaces. A dedicated specialist makes the grant surface auditable in one place instead of diluting a multi-purpose advisor.
- Self-assessment and capability-need attribution are meaningful only when gaps are scoped to one coworker's job. Folding scouting into `portfolio-advisor` blurs whose capability is lacking when, for example, novelty detection is weak.
- Hive contribution attribution needs a stable, distinguishable coworker role so cross-install contribution provenance can remain obfuscated-but-not-anonymous.

The `external-catalog-scout` agent must have:

- bounded tool grants restricted to external catalog fetch, backlog item create/propose, `BacklogItemActivity` write, self-assessment write, and capability-need write,
- read-only access to existing `Agent`, `SkillDefinition`, and `Archetype` rows for fit reasoning,
- no authority to register `Agent`, `SkillDefinition`, or `Archetype` rows directly; those remain human-reviewed proposals,
- no internet write authority and no MCP token issuance.

### 5.3 Evidence and review

Each meaningful Hive Scout run should produce:

- `TaskRun` identity,
- `ToolExecution` audit for the scout steps,
- `BacklogItemActivity` or equivalent evidence linkage for created suggestions,
- structured summary artifacts suitable for the AI Operations Map,
- repeatable pattern markers for future proceduralization.

### 5.4 Authority resolution

The scout run authenticates as the `external-catalog-scout` agent acting under a system principal, typically the same principal that owns other proactive scheduled work on the install. `TaskRun.userId` must carry the resolved `Principal` id, not the agent id and not a bespoke scout identity (AGENTS.md §11 principal convergence, parent spec §9.2). The agent's identity belongs in `currentAgentId`; the surface the schedule fired through belongs in `a2aMetadata.sourceRef.kind = "scheduled-task"`. Do not introduce a new identity-bearing row for the scout. The existing `Agent` row plus its `PrincipalAlias` linkage is sufficient.

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

### Slice 1: TaskRun-ize Hive Scout

Goal: make Hive Scout a first-class proactive coworker run.

Scope:

- create a `ScheduledAgentTask` row owned by `external-catalog-scout` that replaces the current Inngest-only schedule,
- route execution through the scheduled coworker substrate added in the parent spec's Slice 1,
- create one `TaskRun` per scheduled execution before the first fetch or tool call,
- preserve the existing deterministic fetch, parse, and dedupe logic inside the run as tool calls or pre-tool steps, not as a parallel queue function,
- emit `TaskMessage` for run start, batch checkpoints, and final summary,
- record `BacklogItemActivity` evidence linking each created suggestion back to the source run,
- retire `hive-scout-ingest.ts` as the durable schedule entry point once the scheduled-task path is verified; keep `hive-scout-manual-run.ts` as an operator-only replay tool.

Acceptance:

- each Hive Scout execution produces exactly one `TaskRun`, with zero scheduled executions missing `taskRunId` over a rolling 7-day window,
- `TaskRun` is created before any external fetch or tool call, verified by an ordering test and matching the parent spec §5.1 invariant,
- each created `BacklogItem` has a `BacklogItemActivity` row pointing at the source `TaskRun`,
- the run appears in AI Operations Map alongside other proactive runs,
- failure modes are explicit: upstream fetch failure ends the run as `failed` with `exceptionClass = "tool-error"` and `exceptionDetail.kind = "upstream-unavailable"`; parser failure ends as `failed` with `exceptionClass = "schema-violation"` and `exceptionDetail.kind = "parse-error"`, then writes the raw payload as a `TaskArtifact` for diagnosis; partial success ends as `completed` with skipped-entry count in `progressPayload`,
- build gate passes: vitest for affected code, `apps/web` production build, migration apply if any, and UX verification of the Operations Map projection.

### Slice 2: Add autonomous ambiguity review

Goal: keep procedural code for parsing/dedupe, but let the coworker judge novelty and fit for ambiguous entries.

Scope:

- batch unresolved entries inside the same parent `TaskRun`,
- invoke coworker reasoning through the parent spec's `AutonomousWorkRun` service; do not call `runAgenticLoop()` directly, because that bypasses the governance and audit choke point,
- represent each ambiguity-review pass as a `TaskNode` child of the scout's parent `TaskRun`, matching the Build Studio decomposition rule in parent §7.4,
- request structured JSON output,
- classify results as `new_archetype`, `existing_skill_gap`, `duplicate_pattern`, `out_of_scope`, or `needs_human_review`,
- persist rationale and evidence pointers on `TaskArtifact`,
- keep human review on the final proposal layer.

Acceptance:

- deterministic path still handles obvious duplicates with zero LLM cost,
- coworker only receives entries the deterministic path could not classify,
- every coworker classification has a structured rationale persisted as `TaskArtifact`,
- proposals appear in operator review with classification and rationale, not raw chat,
- prompt-injection guard: external catalog text passed to the coworker is treated as untrusted, so classifications cannot create backlog items directly; the proposal-mode tool boundary still applies.

### Slice 3: Add proceduralization loop

Goal: stop re-solving the same archetype decisions forever.

Scope:

- detect repeated reviewer corrections and repeated coworker conclusions,
- promote stable mappings and filters into code/policy,
- record capability needs when the coworker repeatedly lacks the right tool/model/context,
- surface Hive Scout as a proceduralization candidate source in AI Operations.

Acceptance:

- repeated false positives decline,
- repeated out-of-scope classes become deterministic filters,
- repeated “same existing coworker” outcomes become rules.

### Slice 4: Add burn-rate-aware background scheduling

Goal: use lagging prepaid quota intelligently.

Scope:

- add Hive Scout to the safe background queue class,
- let routing/provider policy prefer lagging subscription providers for this task class,
- record run trigger reasons and consumption outcomes,
- cap budget and concurrency.

Acceptance:

- Hive Scout can be triggered by quota-lag conditions,
- it remains bounded and reviewable,
- it never crowds out higher-priority operational work.

## 8. Open Decisions

1. Where does deterministic fetch live after Slice 1: in the coworker run as a tool, or in a pre-run pipeline step that hands parsed entries to the run?
   Recommendation: deterministic fetch becomes a governed MCP/tool surface the scout coworker calls in its first step. That keeps a single audit/grant choke point and avoids splitting work between Inngest and the runtime. Reconsider if fetch latency dominates and pre-run parallelism becomes necessary.

2. Should Slice 2 classification outputs auto-create draft `BacklogItem` rows, or only proposals queued for human review?
   Recommendation: proposals only. The classification model can be wrong about novelty, and Slice 3's proceduralization loop needs human-corrected ground truth to compute repeated-correction signal. Reconsider after Slice 3 evidence shows classifier precision is stable.

3. Is there value in a per-source schedule, one cron per upstream catalog, versus one schedule that fans out across all sources?
   Recommendation: one parent `TaskRun` per scheduled execution and one `TaskNode` per source. This matches the Build Studio mapping rule in parent §7.4 and keeps the operator's "one scout run" mental model intact.

4. Do Hive Scout runs need a tighter retention band than the parent spec's defaults?
   Recommendation: start by inheriting the parent spec's §6.4 defaults. Hive Scout produces low-risk, reviewable output, so there is no obvious reason to deviate. Revisit if backlog-evidence chains depend on scout runs that have already archived; in that case promote the retention floor for runs linked to open backlog items.

## 9. Recommended Next Move

The next move should **not** be "make Hive Scout smarter everywhere at once." Start with **Slice 1: TaskRun-ize Hive Scout**.

Why this sequencing:

- the scheduled-coworker/`TaskRun` substrate from the parent spec's Slice 1 exists, so the new substrate is reused rather than expanded,
- governed evidence through the `TaskRun`, `TaskArtifact`, and `BacklogItemActivity` chain is the prerequisite for later autonomous novelty reasoning,
- Hive Scout is low-risk, asynchronous, reviewable, and a strong fit for the cognitive-load ladder,
- it is also the first realistic test of use-it-or-lose-it scheduling without putting irreversible work onto a burn-rate-triggered queue.

## 10. Recommendation

Adopt Hive Scout as one of the first non-build, non-recovery proof points of the autonomous coworker runtime.

That makes it useful in four ways at once:

- it reduces human research/orchestration burden,
- it produces governed evidence in the runtime control surface,
- it creates a clean case for the platform's "AI first, then procedure" doctrine,
- it supplies a bounded background-work candidate for capacity-aware scheduling.

Adopt autonomous novelty judgment (Slice 2), proceduralization loop (Slice 3), and burn-rate-aware scheduling (Slice 4) only after Slice 1 ships and produces at least a week of clean evidence.
