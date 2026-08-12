# Verified Business Analysis Plan — design

- **Date:** 2026-08-01
- **Status:** ready for implementation
- **Backlog:** `BI-8EC3E4BF`
- **Follow-on backlog:** `BI-36358ACF`
- **Parent epic:** `EP-PLANNING-ANALYTICS`
- **Extends:** [Business Operations and Performance Views](2026-07-28-business-operations-and-performance-views-design.md)
- **Kernel decision:** `DI-0A0D8B84EE30` — extend the existing metric catalog with a typed plan contract, high confidence

## Executive decision

DPF will add a versioned `BusinessAnalysisPlan` contract between a business question and metric execution. The plan names canonical metric keys, intent, grouping dimensions, filters, time windows, comparison basis, source requirements, and verification checks. A deterministic validator normalizes an accepted plan and assigns a stable fingerprint. Unsupported or ambiguous input fails closed as an inspectable refusal; it never degrades into generated SQL or a guessed metric.

This slice is deliberately a contract/compiler, not a new analytics store. It extends the `PerformanceMetricDefinition` authority in `packages/storefront-templates`, keeps the in-flight `BI-PLAN-005` rollup and `/performance` work untouched, and gives later UI and scheduling work a stable substrate.

## Research and benchmarking

The 2026-08-01 market review found a useful product signal in SpotOnix: business users benefit when interpretation is visible before execution, ambiguity is clarified instead of guessed, and accepted analytical logic can be reused. SpotOnix's published terms describe its named frameworks and methods as proprietary and prohibit using the material to develop competing products. DPF therefore does **not** copy its context-graph, algebra, node taxonomy, UI, or wording. It records only the independently observable customer problem and implements an original design grounded in DPF substrate and open standards.

| Precedent | Adopt | Reject / constrain |
| --- | --- | --- |
| [dbt Semantic Layer](https://docs.getdbt.com/) | Define metrics once above physical models; let consumers reference stable semantic keys instead of rewriting joins and formulas. | Do not introduce dbt as a runtime dependency or duplicate DPF's metric catalog. |
| [W3C PROV-O](https://www.w3.org/TR/prov-o/) | Model a plan as an entity used by an execution activity; retain source entities, derivation, responsible agent, and timestamps as compatible concepts. | Do not require RDF/OWL or a graph database for the first slice. |
| [OpenLineage facets](https://openlineage.io/docs/spec/facets/dataset-facets/) | Keep source identity/version/freshness and verification results as structured facets that adapters can populate. | Do not expose physical schemas or unrestricted column lineage to business users. |
| [SpotOnix public evaluation framing](https://beta.spotonix.com/brief/evaluation-guide/) | Treat visible interpretation, refusal, and reuse as market-validated operator needs. | Do not adopt proprietary named frameworks, scrape private systems, or treat vendor claims as implementation evidence. |

## Existing substrate and ownership

| Concern | Canonical owner | Change in this slice |
| --- | --- | --- |
| Metric definitions and archetype packs | `packages/storefront-templates/src/performance-metric-catalog.ts` | Replace prose-only aggregation strings with a closed typed calculation contract while preserving human-readable definitions. |
| Metric shape | `PerformanceMetricDefinition` in `business-view-profile.ts` | Add typed aggregation and allowed grouping/filter capabilities; no parallel registry. |
| Performance values and rollups | `BI-PLAN-005`, `apps/web/lib/performance`, database rollup models | No change; adapters will consume accepted plans later. |
| Safe workbook formulas | `apps/web/lib/workbooks/formula` | Architectural precedent only. Do not make Workbooks the business semantic authority. |
| Repeated execution | `ScheduledAgentTask` | Follow-on `BI-36358ACF`; no schema change in this slice. |

## Design grounding

- **Existing specs/plans reviewed:** the parent [Business Operations and Performance Views](2026-07-28-business-operations-and-performance-views-design.md), the live `BI-PLAN-005` performance-rollup plan, and this feature's implementation plan.
- **Current code substrate reviewed:** `PerformanceMetricDefinition`, `PERFORMANCE_METRIC_DEFINITIONS`, archetype metric packs, the workbook formula boundary, and the existing `ScheduledAgentTask` reuse seam.
- **Source of truth:** `packages/storefront-templates/src/performance-metric-catalog.ts` owns governed metric semantics; this versioned plan contract validates references to that catalog without becoming a second metric registry or an execution store.
- **Decision:** extend the existing metric catalog with a deterministic, fail-closed plan compiler now; leave execution, persistence, scheduling, and visible plan review to their owning follow-on slices.

Operational-Precedent: no-precedent (This analytics contract does not change a spatial workflow or physical-twin interaction.)

## Contract

```ts
interface BusinessAnalysisPlan {
  schemaVersion: 1;
  question: string;
  intent: "status" | "change" | "diagnosis" | "decision";
  metrics: readonly BusinessAnalysisMetricRef[];
  dimensions: readonly BusinessAnalysisDimension[];
  filters: readonly BusinessAnalysisFilter[];
  period: BusinessAnalysisPeriod;
  comparison: BusinessAnalysisComparison;
  sources: readonly BusinessAnalysisSourceRequirement[];
  checks: readonly BusinessAnalysisCheck[];
}

type BusinessAnalysisPlanResult =
  | { status: "accepted"; plan: NormalizedBusinessAnalysisPlan; fingerprint: string }
  | { status: "clarification-required"; issues: readonly BusinessAnalysisIssue[] }
  | { status: "refused"; issues: readonly BusinessAnalysisIssue[] };
```

All closed axes are TypeScript literal unions sourced from frozen tuples. This package has no runtime schema library today, so adding a dependency only for validation would widen the supply-chain surface. The validator uses explicit guards and exhaustive switches; tests ratchet the axes.

### Metric calculation contract

The current `aggregation: string` mixes display copy with executable meaning. Refactor it into:

- a closed `kind` such as `sum`, `count`, `ratio`, `median`, `closing-balance`, or `grouped-sum`;
- named input facts/metric keys;
- an optional numerator/denominator or grouping role;
- a separate `definition` string for operator-facing explanation.

The first slice validates structure; it does not execute formulas. Execution remains provider-owned so authorization, source joins, and row-level restrictions stay at their canonical boundary.

### Validation and refusal

Validation is deterministic and ordered:

1. Validate the plan shape and closed axes.
2. Resolve every metric through `PERFORMANCE_METRIC_DEFINITIONS`.
3. Check requested comparison and grain against the metric contract.
   Every metric supports `none` for status-only plans in addition to its declared comparison baseline; downstream selectors read this same contract.
4. Reject duplicate metrics/dimensions, empty identifiers, unsupported dimensions, and filters without an allowed operator.
5. Require source identity plus freshness policy for every referenced metric owner.
6. Require checks appropriate to the intent: completeness for all plans, comparison-baseline for change/diagnosis, and decision-boundary for decision plans.
7. Canonically sort set-like collections, preserve meaningful order only where declared, and fingerprint the normalized representation.

`clarification-required` is reserved for a structurally valid plan with unresolved business choices such as a missing comparison basis. `refused` covers unknown metrics, unsupported operations, policy violations, or malformed input. Neither state is executable.

### Deterministic identity

The package produces a canonical JSON representation with stable key and set ordering, then a dependency-free FNV-1a 64-bit fingerprint. The fingerprint is an identity/checksum, not a security primitive. Security-sensitive signing remains outside this package. Including `schemaVersion` and metric definition versions prevents silent reuse across semantic changes.

## UX handoff

`BI-36358ACF` will render the accepted/clarification/refusal result as a theme-aware plan card after `BI-PLAN-005` merges. The card must answer:

1. What did DPF understand?
2. Which governed metrics, segments, period, and comparison will it use?
3. Which sources and freshness limits support the answer?
4. Which checks passed, need clarification, or caused refusal?

That follow-on may persist accepted plan references and schedule watched questions through `ScheduledAgentTask`; it must not persist raw chat history as semantic authority.

## Security, privacy, and failure behavior

- Metric sensitivity stays attached to the canonical metric definition and is included in validation output for downstream authorization.
- Plans contain semantic source owner identifiers, not credentials, SQL, secrets, unrestricted physical column names, or row data.
- A plan never grants access. Execution rechecks the current principal and organization scope.
- Source freshness is a requirement, not a claim that data is current. Providers attach observed watermarks at execution.
- Unknown schema versions refuse rather than being coerced.

## Architectural alignment

- **Deployment contracts:** pure TypeScript, no host path, service, port, or deployment delta.
- **Canonical identity:** organization and product scope remain execution context; the plan does not create a parallel business identity.
- **No parallel utilities:** metric resolution extends the existing catalog; deterministic serialization is local to the new contract because no shared canonical serializer exists.
- **No second rule home:** durable rules remain in `AGENTS.md`/kernel; this document owns only the feature design.
- **Data model:** no Prisma change in this slice. Persistence is deferred until the UI/scheduling design proves the existing scheduled-task JSON contract insufficient.

## Acceptance and verification

- Contract tests start red for accepted, clarification, refusal, deterministic identity, and catalog compatibility cases.
- `@dpf/storefront-templates` test and typecheck pass.
- The production web build passes because the package is consumed by the portal build graph.
- No live UX gate is required for this contract-only slice; `BI-36358ACF` owns visual and interaction verification.
- Documentation impact: architecture/spec and generated package exports are updated; user documentation waits for the visible workflow.
