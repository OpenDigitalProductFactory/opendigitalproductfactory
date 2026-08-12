# Inspectable and watched business analysis — design

- **Date:** 2026-08-12
- **Status:** ready for implementation
- **Backlog:** `BI-36358ACF`
- **Work capsule:** `WC-6D044755`
- **Parent epic:** `EP-PLANNING-ANALYTICS`
- **Depends on:** `BI-8EC3E4BF` (verified plan contract, merged), `BI-PLAN-005` (Performance, merged and live)
- **Extends:** [Verified Business Analysis Plan](2026-08-01-verified-business-analysis-plan-design.md) and [Business Operations and Performance Views](2026-07-28-business-operations-and-performance-views-design.md)

## Executive decision

DPF will add one local, progressive-disclosure **Performance questions** workspace to `/performance`. An owner chooses a governed metric, states the question and purpose, reviews the resulting `BusinessAnalysisPlan`, and can explicitly save the accepted plan as a watched question. Clarification and refusal remain visible and non-executable.

The accepted plan and its fingerprint are semantic authority. Repeated evaluation reuses `ScheduledAgentTask`; current values and watermarks come from the authenticated current-organization Performance read model. A deterministic watch emits a surfaced result only when the operator-confirmed materiality boundary is crossed. It never turns raw chat, prompt text, or an unscoped database query into authority.

## Research and benchmarking

| Precedent | Adopt | Reject / constrain |
| --- | --- | --- |
| [dbt Semantic Layer](https://docs.getdbt.com/) | Reuse stable governed metric keys instead of rebuilding formulas in the UI or scheduler. | No new analytics runtime or second metric catalog. |
| [W3C PROV-O](https://www.w3.org/TR/prov-o/) | Retain plan identity, source identity, observed watermark, evaluation time, and derivation context. | No graph database or RDF requirement. |
| [OpenLineage dataset facets](https://openlineage.io/docs/spec/facets/dataset-facets/) | Carry source freshness and definition identity as structured evidence. | Do not expose unrestricted physical schema or row data. |
| [SpotOnix public evaluation framing](https://beta.spotonix.com/brief/evaluation-guide/) | Make interpretation reviewable before execution; clarify ambiguity; retain accepted analytical logic for reuse. | Do not copy proprietary frameworks, graph taxonomy, implementation, interface, or wording. |
| Existing DPF Product Intelligence controls | Preview scope and consequences before creating a schedule. | Do not reuse prompt text as structured watch configuration or route Performance through research proposals. |

## Substrate verification

| Concern | Existing authority | Decision |
| --- | --- | --- |
| Plan semantics and fingerprint | `packages/storefront-templates/src/business-analysis-plan.ts` | Reuse unchanged as the plan compiler. |
| Metric capabilities | `PerformanceMetricDefinition` | Extend with typed materiality capabilities; do not create a watch-only metric registry. |
| Values, organization isolation, lineage, freshness | `apps/web/lib/performance/business-performance-provider.ts` | Extract the current-organization resolver for reuse; preserve deny-by-default multi-org behavior. |
| Repetition and ownership | `ScheduledAgentTask` | Add one closed `business-analysis-watch` discriminator and structured `taskConfig`; no Prisma model or migration. |
| Execution evidence | `TaskRun.progressPayload` | Record deterministic evaluations with plan fingerprint and watermark; no inference loop. |
| UI home | `/performance` and report-kit | Add a local disclosure below the owner brief; no global nav, route, dashboard, or card family. |

## UX architecture

### Owner job and placement

- **Owning area:** Business > Performance.
- **Primary persona:** owner or authorized manager who wants a question to stay answered without monitoring a dashboard.
- **Navigation layer:** local disclosure and contextual action only.
- **First-view rule:** the existing owner brief remains ahead of the new surface. The default state adds one compact disclosure, not an open form.

The interaction has three explicit stages:

1. **Frame** — question, governed metric, intent, comparison, cadence, and materiality boundary.
2. **Inspect** — show what DPF understood, the metric and period, source/freshness requirement, verification checks, threshold, and stable plan identity.
3. **Confirm** — create one organization-scoped schedule only after the plan is accepted. Clarification and refusal disable confirmation and explain the next correction.

Existing watched questions remain inspectable under a secondary disclosure. Only a `material-change` evaluation appears in the visible **Changes detected** band; unchanged evaluations do not create attention noise. Stale source evidence is shown as a watch-health limitation, never as a business change.

### Interaction and accessibility guardrails

- Form controls have visible labels, error association, keyboard order, and 44px high-frequency targets.
- All colors use `--dpf-*` variables; status is conveyed by text as well as tone.
- Inputs use bounded closed choices from the canonical metric/plan contracts.
- The preview names the write and schedule effect before confirmation.
- No card click sends a prompt or creates a schedule.
- Empty Performance history remains honest: questions are unavailable until the first snapshot exists.

## Contracts

### Materiality capability

`PerformanceMetricDefinition` declares which typed boundaries a metric can support:

```ts
type PerformanceMaterialityMode = "absolute" | "relative";
type PerformanceMaterialityDirection = "increase" | "decrease" | "either";

interface PerformanceMetricMaterialityCapability {
  modes: readonly PerformanceMaterialityMode[];
  directions: readonly PerformanceMaterialityDirection[];
}
```

The catalog does **not** choose the operator's business threshold. The UI requires a finite positive value, displays its unit, and freezes it in the accepted watch configuration.

### Watched-plan configuration

`ScheduledAgentTask.taskConfig` carries a versioned `BusinessAnalysisWatchConfig`:

- normalized accepted plan and exact fingerprint;
- one watched metric for the initial bounded slice;
- operator-confirmed mode, direction, and value;
- baseline value and watermark captured from the authenticated read model;
- most recent deterministic evaluation, including plan fingerprint, observed watermark, evaluation time, delta, and status.

The parser revalidates the plan and fingerprint on creation and every run. An unknown version, mismatched fingerprint, unsupported metric capability, missing organization scope, stale source, or unavailable value fails closed.

### Evaluation

Each due run:

1. re-resolves the task owner's current organization through the same Performance context boundary;
2. refuses if the task scope and current organization differ;
3. loads the bounded Performance read model and selected metric;
4. compares its watermark with the plan's source `maximumAge`;
5. evaluates the operator-confirmed boundary against the retained baseline;
6. records a `TaskRun.progressPayload` with the fingerprint and freshness evidence;
7. advances the baseline only after a material change so one change is not announced on every later run.

No LLM or unrestricted query participates in this path.

## Security and data architecture

- Organization identity comes from the authenticated user's current setup context. A legacy fallback is allowed only when exactly one storefront exists; multiple storefronts refuse without reading rollups or watches.
- Creation and listing bind both `ownerUserId` and `organizationId`; task execution rechecks both.
- Queries are bounded: Performance rollups retain the existing cap; watched-task lists return at most 20 recent tasks.
- No Prisma change is required. The existing JSON config is appropriate because the scheduled task owns its typed execution parameters and run evidence remains in `TaskRun`.
- Plan data contains semantic keys and policy limits, not credentials, SQL, unrestricted row data, or raw conversation history.

## Scale ceiling

This slice supports one metric per watched plan, at most 20 displayed watches per owner and organization, and the existing bounded Performance history. That keeps each evaluation O(1) over one already-bounded read model. Multi-metric expressions and portfolio-wide watch administration remain future work under `EP-PLANNING-ANALYTICS`; they must not widen this loop into an unbounded scan.

## Architecture review

- **Alignment:** well-aligned after extracting current-organization resolution and keeping scheduling/evidence on existing authorities.
- **Important guardrail:** do not persist a second plan or watch model; `ScheduledAgentTask.taskConfig` plus `TaskRun.progressPayload` are the existing normalized ownership/evidence seams.
- **Important guardrail:** do not make a newest-source watermark stand in for all sources; every evaluation checks the watched metric's own watermark and plan limit.
- **Minor guardrail:** keep the UI local and closed by default so the Performance first-view mental model and budget do not regress.
- **Escalated decisions:** none. Prior recorded decisions already select canonical scheduled-task reuse, typed operator-confirmed materiality, and local `/performance` placement.

## Acceptance and verification

- Accepted, clarification-required, and refused previews are test-covered and visibly distinct.
- The preview shows interpretation, metric, period, comparison, source, freshness limit, checks, materiality, and fingerprint.
- Creation refuses unauthenticated, ambiguous-organization, mismatched-fingerprint, stale/unavailable-baseline, and unsupported-capability cases.
- Scheduling writes one owner- and organization-scoped typed task after explicit confirmation.
- Evaluation records TaskRun evidence and surfaces only material change; unchanged and stale-source cases remain quiet and inspectable.
- Existing Performance current-org isolation, multi-org refusal, empty state, oldest-watermark behavior, and first-view budget remain green.
- Targeted tests, package/web typecheck, production build, exact-tree governed local CI, theme scan, UX route sweep, and authenticated live `/performance` verification pass.

## Documentation impact

This spec and its implementation plan own architecture and contributor context. The `/performance` copy is self-explanatory; no install or operator runbook changes are needed because the feature uses the existing scheduler and canonical self-upgrade path.
