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

An attempted live Postgres check in this shell returned `ECONNREFUSED`, so this design does **not** claim a verified runtime count of Hive Scout runs, backlog items, or active queue state on 2026-05-11. The current-state statements above are repo-verified, not live-runtime counts.

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

## 4.1 Deterministic core stays procedural

The following parts should remain deterministic code:

- upstream fetch and retry policy,
- parser logic,
- source URL deduplication,
- idempotent backlog item creation,
- stable value-stream alias mapping,
- admin notification,
- policy limits on which sources are allowed.

These are already code-shaped concerns and should not be pushed into prompts.

## 4.2 Ambiguous reasoning moves to the coworker

The following parts are better treated as autonomous coworker cognition:

- whether an external pattern is actually novel for DPF,
- whether it is a new coworker archetype versus a new skill on an existing coworker,
- how strongly it fits a given IT4IT/value-stream placement,
- whether multiple external projects should collapse into one synthesized internal archetype,
- whether the discovered idea is strategically relevant now versus informational only.

These are the high-context, fuzzy, judgment-heavy parts where a coworker can reduce human cognitive load.

## 4.3 Hybrid pattern

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

Do not create a vague new “general scout” agent.

Recommended ownership:

- primary specialist: a platform/portfolio-facing coworker with backlog authority and strong archetype/skill context
- candidate owners: `portfolio-advisor` or a dedicated `external-catalog-scout` specialist

The coworker should have:

- bounded tool grants,
- read-only external scouting,
- backlog proposal capability,
- no direct auto-create authority for new coworkers or skills.

### 5.3 Evidence and review

Each meaningful Hive Scout run should produce:

- `TaskRun` identity,
- `ToolExecution` audit for the scout steps,
- `BacklogItemActivity` or equivalent evidence linkage for created suggestions,
- structured summary artifacts suitable for the AI Operations Map,
- repeatable pattern markers for future proceduralization.

## 6. Use-It-or-Lose-It Scheduling Policy

Hive Scout is a good consumer of underused prepaid AI capacity, but only under policy.

### 6.1 Safe use cases

Burn-rate-aware preference is appropriate when:

- the task is background-only,
- the output is reviewable before irreversible action,
- no sensitive external data is involved,
- the run can be rate-limited, paused, or deferred.

Hive Scout meets those conditions.

### 6.2 Not a forced-consumption engine

Do **not** let use-it-or-lose-it logic turn Hive Scout into busywork.

Guardrails:

- only run when there is new or stale source material worth evaluating,
- cap spend per run and per quota window,
- batch similar entries,
- prefer cheapest capable model first,
- stop when marginal novelty falls below a threshold,
- log why a run happened: cadence, stale source, new source, lagging burn-rate assist, or explicit human trigger.

### 6.3 Policy recommendation

Hive Scout should be eligible for a background “subscription utilization assist” queue class:

- lower priority than operational recovery,
- higher priority than cosmetic research,
- auto-paused when provider burn rate is already ahead,
- safe to resume when quota lag is detected.

## 7. Implementation Slices

### Slice 1: TaskRun-ize Hive Scout

Goal: make Hive Scout a first-class proactive coworker run.

Scope:

- route Hive Scout through the scheduled coworker substrate,
- create `TaskRun` for each run,
- write structured run summaries,
- project runs into the AI Operations Map,
- preserve the existing deterministic ingest logic.

Acceptance:

- each Hive Scout run has one `TaskRun`,
- run appears in AI Operations Map,
- backlog suggestions link back to source run evidence.

### Slice 2: Add autonomous ambiguity review

Goal: keep procedural code for parsing/dedupe, but let the coworker judge novelty and fit for ambiguous entries.

Scope:

- batch unresolved entries,
- invoke coworker reasoning with structured output,
- classify results as `new_archetype`, `existing_skill_gap`, `duplicate_pattern`, `out_of_scope`, or `needs_human_review`,
- persist rationale/evidence,
- keep human review on the final proposal layer.

Acceptance:

- deterministic path still handles obvious duplicates,
- coworker only receives ambiguous entries,
- proposals are structured and reviewable.

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

## 8. Recommended Next Move

The next move should **not** be “make Hive Scout smarter everywhere at once.”

The right next step is **Slice 1: TaskRun-ize Hive Scout**.

Why:

- the autonomous runtime substrate is now the platform direction,
- the scheduled coworker/TaskRun seam already exists,
- this gives immediate operator visibility and governance,
- it creates the evidence foundation needed before any deeper AI reasoning is added.

Only after that should DPF add autonomous novelty judgment and use-it-or-lose-it scheduling.

## 9. Recommendation

Adopt Hive Scout as one of the first non-build, non-recovery proof points of the new autonomous coworker runtime.

That makes it useful in three ways at once:

- it reduces human research/orchestration burden,
- it produces governed evidence in the runtime control surface,
- it creates a clean case for the platform’s “AI first, then procedure” doctrine.
