---
title: Graph/Data Trust Vector Design
authoredAt: 2026-05-26
authoredBy: codex
status: draft
specKind: design
epic: EP-REDUCTION-GEAR-ARCH
relatedEpics:
  - EP-ASSURANCE-LEDGER
  - EP-WWMD-MCP
  - EP-BUILD-STUDIO
  - EP-AI-OPSMAP
  - EP-TAK-3F9A21
relatedSpecs:
  - docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md
  - docs/superpowers/specs/2026-05-19-wwmd-mcp-exposure-design.md
  - docs/superpowers/specs/2026-05-24-reduction-gear-architecture-design.md
  - docs/superpowers/specs/2026-05-13-code-intelligence-graph-adoption-design.md
  - docs/superpowers/specs/2026-05-21-supply-chain-and-desired-state-assurance-design.md
relatedPlans:
  - docs/superpowers/plans/2026-05-13-portal-ux-data-source-trust-repair.md
  - docs/superpowers/plans/2026-05-13-code-intelligence-graph-adoption.md
  - docs/superpowers/plans/2026-05-21-assurance-ledger-phase-0.md
relatedPrinciples:
  - docs/founder-kernel/wiki/principles/never-fabricate.md
  - docs/founder-kernel/wiki/principles/never-assume-verify.md
  - docs/professions/data-architect/wiki/trust-the-data-spine.md
  - docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md
  - docs/founder-kernel/wiki/principles/no-hardcoded-colors.md
externalReferences:
  - https://www.w3.org/TR/prov-dm/
  - https://openlineage.io/docs/spec/facets/
  - https://openlineage.io/docs/1.38.0/spec/facets/dataset-facets/data_quality_metrics/
  - https://openlineage.io/docs/next/spec/facets/dataset-facets/data_quality_assertions/
  - https://docs.greatexpectations.io/docs/reference/api/core/expectationvalidationresult_class/
  - https://docs.greatexpectations.io/docs/core/trigger_actions_based_on_results/choose_a_result_format/
  - https://docs.open-metadata.org/latest/how-to-guides/data-quality-observability/quality
  - https://www.servicenow.com/docs/r/zurich/servicenow-platform/configuration-management-database-cmdb/r_CMDBHealthMetrics.html
  - https://www.servicenow.com/docs/r/zurich/servicenow-platform/configuration-management-database-cmdb/c_MonitorCMDBHealth.html
  - https://learn.microsoft.com/en-us/purview/concepts-data-quality-rules
  - https://learn.microsoft.com/en-us/purview/unified-catalog-data-quality-scores
  - https://productresources.collibra.com/docs/collibra/latest/Content/UnifiedDataQuality/co_about-data-quality-scores.htm
  - https://productresources.collibra.com/docs/collibra/latest/Content/Settings/OperatingModel/QualityScoreAggregations/co_asset-data-quality.htm
---

# Graph/Data Trust Vector Design

## 1. Purpose

DPF already treats WWMD decisions as vectorized, explainable evaluations: retrieved principles, evidence grade, freshness, risk, confidence, and a ledger combine into an outcome such as `recommend`, `escalate`, or `defer`. Graph-backed and data-centric interfaces need the same discipline.

When a page, coworker, MCP tool, graph traversal, code analysis, estate discovery view, portfolio health result, compliance answer, or assurance result presents a claim, the claim must carry structured trust metadata alongside the result. A single hardcoded score is not enough. Users and coworkers need the reason a result is trusted, stale, inferred, partially covered, contradicted, or unavailable.

The first user-visible problem is simple:

> "No critical findings" is only a current fact if the scan is current enough. If the latest scan is 45 days old, DPF should say: "No critical findings in the latest scan, but scan freshness is low because the latest code analysis is 45 days old."

This spec defines the reusable substrate for that behavior.

## 2. Current Runtime Truth

This section separates what exists today from the future-state design.

### 2.1 Live Backlog / Epic State

DPF MCP was available during this research pass on 2026-05-26. Live backlog/epic lookup was performed through `list_epics` and `list_backlog_items`; no DB fallback was used.

Relevant live epics:

| Epic | Current state | Why it shapes this design |
| --- | --- | --- |
| `EP-REDUCTION-GEAR-ARCH` | Open; 77 total items, 58 open, 7 in progress, 10 done | Home for reusable observation/evidence/calibration substrate. |
| `EP-ASSURANCE-LEDGER` | Open; 5 total items, 2 open, 3 done | Home for SBOM, scan, finding, and compliance evidence. |
| `EP-WWMD-MCP` | Open; 13 total items, 12 open, 1 in progress | WWMD pattern to mirror for explainable trust and advisory output. |
| `EP-BUILD-STUDIO` | Open; 51 total items, 18 open, 11 in progress, 16 done | First user-facing surface for code intelligence and assurance gates. |
| `EP-AI-OPSMAP` | Open; 9 total items, 3 open, 1 in progress, 5 done | Future data-centric operator surface with stale/runtime-state risks. |
| `EP-TAK-3F9A21` | Open; 5 total items, 3 open, 2 done | Memory/evidence freshness, identity, and receipt observability overlap. |

Relevant live backlog items:

| Item | Current state | Design implication |
| --- | --- | --- |
| `BI-REFACTOR-CC46703A` | Open, priority 2 | Do not add another finding-shaped model. Trust vector must normalize around existing findings/evidence first. |
| `BI-B1C0F266` | Open | Principle-vector work is adjacent; graph/data trust should interoperate but not overload WWMD tables. |
| `BI-MEM-5A41C7` | Open | Freshness rules and effectiveness checks are cross-cutting. |
| `BI-OBS-4B63F2` | Open | Supervisor-facing receipts and observability are needed for AI trust. |
| `BI-F499EBBA` | Open | Coworker memory shape contracts are a future consumer of trust metadata. |
| `BI-5B8FE5C1` | Open under `EP-REDUCTION-GEAR-ARCH` | Workspace primitives should consume trust without each board inventing labels. |

MCP `wiki_query` did not return principle results for the trust-vector search phrases in this session, so local founder-kernel principle files and repo specs were used for grounding.

### 2.2 Existing Substrates

DPF has enough substrate to avoid a parallel trust island:

- WWMD / decision perspective:
  - The WWMD spec requires unsupported claims to carry less confidence than source-backed facts and uses `PerspectiveMaterial.evidenceGrade`, `freshness`, confidence weighting, and ledgered `DecisionInteraction` records.
  - `PerspectiveMaterial` already stores `freshness`, `evidenceGrade`, `stalenessPolicy`, `lastValidatedAt`, and `confidenceWeight`.
  - `DecisionInteraction` already stores evidence bundles, sources, risk tier, confidence before/after, outcome type, and conflict state.
- Source provenance:
  - `apps/web/lib/surface-data-provenance.ts` defines `DataSourceProvenance` and `ProvenancedMetric<T>`.
  - The portal UX data-source plan intentionally put provenance on read models first, not in a new table.
- Code graph:
  - `CodeGraphIndexState` stores `indexStatus`, `lastIndexedAt`, branch/head SHA, dirty workspace state, indexed file count, and last error.
  - `CodeGraphFileHash` stores per-file coverage with source `authority`.
  - `getCodeGraphFreshness()` and `summarizeCodeGraphCoverage()` already return warnings, but no trust vector or age-based freshness decay.
  - `CodeIntelligenceStatusCard` displays index state and warnings.
  - MCP tools `get_code_graph_freshness` and `inspect_build_code_impact` already expose code graph data to coworkers/external clients.
- Assurance ledger:
  - `AssuranceRun`, `BomDocument`, `AssuranceFinding`, `ToolExecution`, and `ToolExecutionReceipt` already record scan/BOM/finding facts and receipts.
  - `BomSummary` returns `state: "missing" | "current" | "stale"`, document metadata, counts, finding summary, and scanner readiness.
  - `BuildAssuranceGateCard` shows BOM current/stale, findings, generated time, and scanner detail, but "No active findings" is not qualified by scan freshness.
- Estate / discovery:
  - `InventoryEntity` and `InventoryRelationship` already carry confidence and first/last seen timestamps.
  - `PortfolioQualityIssue` already records stale entity/relationship and attribution/quality problems.
  - `EstateItem` derives identity confidence, version confidence, freshness, and blast radius labels.
  - Estate MCP tools already explain posture, version confidence, and blast radius, but return labels rather than structured trust metadata.
- Portfolio health:
  - `computePortfolioCompleteness()` returns orthogonal scores for required fields, enrichment, open quality issues, and product count.
  - Existing provenance badges distinguish live, connected, computed, catalog, seed-default, demo-placeholder, and not-connected sources.
- Graph-backed portfolio/infrastructure view:
  - `getFullGraphData()` enriches Postgres graph data with Neo4j infrastructure topology, then silently falls back to Postgres-only data if Neo4j fails.
  - That fallback needs to become visible trust metadata before users rely on missing graph edges as "no dependencies."
- Reduction Gear:
  - `GearInterface` is already the canonical observation/decision envelope for interface events while source tables remain authoritative write models.
  - It is a good audit/calibration stream when a trusted result crosses a workflow/autonomy boundary, not the mandatory storage place for every page read.

### 2.3 Architecture Decision via `principle_decide`

`principle_decide` was run for three options:

1. Extend only `DataSourceProvenance` with one-off page freshness labels.
2. Create a persisted `TrustAssessment` table immediately and force all surfaces to persist before display.
3. Create a reusable shared trust-vector contract, scorer, wording rules, UI primitive, and adapters that attach metadata to read models and tool results first; persist through existing evidence ledgers only when those surfaces already write evidence.

The live tool recommended option 3 with high confidence:

| Option | Composite | Result |
| --- | ---: | --- |
| `shared-contract-read-model-first` | 6.03 | Recommended |
| `persist-new-trust-assessment-table` | 4.98 | Not first slice |
| `extend-provenance-only` | 3.64 | Too narrow |

This spec adopts that recommendation.

## 3. Research & Benchmarking

This is not a generic analytics score. The benchmark pattern is "structured quality/provenance metadata travels with the thing being asserted, while UI shows a compact summary and allows inspection."

### 3.1 Standards and Open-Source Systems

| Reference | Relevant pattern | DPF adoption |
| --- | --- | --- |
| [W3C PROV-DM](https://www.w3.org/TR/prov-dm/) | Provenance models entities, activities, agents, responsibility, derivation, and time so consumers can assess quality/reliability/trustworthiness. | Trust evidence references should identify subject, producer/activity, source, timestamps, and lineage without forcing every response into a full PROV graph. |
| [OpenLineage facets](https://openlineage.io/docs/spec/facets/) | Facets attach atomic metadata to runs, jobs, and datasets. Data-quality facets include metrics like row/file counts and last-updated timestamps; assertion facets preserve individual assertion success. | Treat `trust` as a response facet: structured metadata attached to the result, not detached prose. Preserve dimensions instead of collapsing everything into one score. |
| [Great Expectations validation results](https://docs.greatexpectations.io/docs/reference/api/core/expectationvalidationresult_class/) and [result formats](https://docs.greatexpectations.io/docs/core/trigger_actions_based_on_results/choose_a_result_format/) | Validation results expose success, result details, metadata, exception info, and configurable verbosity from boolean-only to complete debug output. | UI defaults to compact trust tier + rationale, with expandable details for dimensions and evidence. Coworkers receive structured detail in tool results. |
| [OpenMetadata data quality](https://docs.open-metadata.org/latest/how-to-guides/data-quality-observability/quality) | Data trust is built through freshness, completeness, accuracy tests, alerts, dashboards, and resolution workflow. | DPF dimensions include freshness, coverage/completeness, evidence grade, runtime availability, and conflict/resolution state. |

### 3.2 Commercial Systems

| Reference | Relevant pattern | DPF adoption |
| --- | --- | --- |
| [ServiceNow CMDB Health KPIs](https://www.servicenow.com/docs/r/zurich/servicenow-platform/configuration-management-database-cmdb/r_CMDBHealthMetrics.html) and [dashboard](https://www.servicenow.com/docs/r/zurich/servicenow-platform/configuration-management-database-cmdb/c_MonitorCMDBHealth.html) | CMDB health aggregates correctness, completeness, compliance, staleness, duplicate/orphan/relationship health, and drill-down detail. | Estate and graph surfaces should show compact health/trust signals plus drill-down dimensions. Staleness is first-class, not a footnote. |
| [Microsoft Purview data quality rules](https://learn.microsoft.com/en-us/purview/concepts-data-quality-rules) and [scores](https://learn.microsoft.com/en-us/purview/unified-catalog-data-quality-scores) | Data quality rules include freshness, uniqueness, conformity, consistency, completeness, and sample-size-aware score derivation. | DPF trust scoring should account for sample size/coverage and should avoid presenting a tiny sample as high-confidence global truth. |
| [Collibra data quality scores](https://productresources.collibra.com/docs/collibra/latest/Content/UnifiedDataQuality/co_about-data-quality-scores.htm) and [asset quality views](https://productresources.collibra.com/docs/collibra/latest/Content/Settings/OperatingModel/QualityScoreAggregations/co_asset-data-quality.htm) | Quality scores can be calculated through knowledge-graph traversal and aggregation paths; UI separates internal and external quality sources and shows dimension rings/history. | DPF graph traversal depth/aggregation path must influence trust. External provider/tool scores should remain source-separated rather than mixed into a single unqualified platform score. |

## 4. Design Goals

- Model trust as a vector of dimensions, not a single page-specific score.
- Preserve dimensional reasons so UI and coworkers can explain trust without raw math.
- Attach trust metadata to data responses, read models, and tool outputs.
- Reuse existing provenance/evidence/assurance/graph/WWMD/GearInterface substrate.
- Keep first-slice implementation small enough to prove value in current user-visible surfaces.
- Make stale/low-confidence results visible without turning every card into a dashboard.
- Use DPF theme tokens only.
- Distinguish:
  - current fact
  - last-known fact
  - inferred result
  - low-confidence result
- Reserve at least 20% implementation capacity for refactoring existing evidence seams rather than adding new wrappers everywhere.

## 5. Non-Goals

- No new canonical trust table in the first slice.
- No ML/LLM trust classifier in v1.
- No attempt to convert every DPF response to PROV, OpenLineage, or Great Expectations format.
- No full estate/portfolio/compliance migration in the first slice.
- No raw numeric trust score as the primary UI. Numeric score may exist in structured metadata and audit payloads.
- No page-specific "trust math" hidden in React components.

## 6. Trust Vector Contract

Trust travels with the response as a structured property:

```ts
export type TrustStatementKind =
  | "current-fact"
  | "last-known-fact"
  | "inferred-result"
  | "low-confidence-result";

export type TrustTier = "high" | "medium" | "low" | "unknown";

export type TrustAction =
  | "present"
  | "qualify"
  | "warn-stale"
  | "refresh-required"
  | "escalate"
  | "defer";

export type TrustDimensionKey =
  | "freshness"
  | "sourceAuthority"
  | "evidenceGrade"
  | "coverageCompleteness"
  | "toolRecency"
  | "toolReliability"
  | "graphTraversalDepth"
  | "dataLineage"
  | "humanValidation"
  | "conflictContradiction"
  | "runtimeAvailability"
  | "sampleSize"
  | "riskImpact"
  // Master Data Management dimensions (added 2026-06-06, MDM spec §6.5).
  // This registry is the single source of trust vocabulary; MDM and
  // EP-DATA-ARCH steward drift both consume these by canonical key.
  | "validityConformity"
  | "uniqueness"
  | "relationshipIntegrity";

export type TrustDimension = {
  key: TrustDimensionKey;
  label: string;
  score: number | null; // 0..1 when applicable; null means not applicable.
  tier: TrustTier;
  weight: number;
  rationale: string;
  measuredAt?: string;
  expiresAt?: string;
  evidenceRefs: TrustEvidenceRef[];
};

export type TrustEvidenceRef = {
  kind:
    | "prisma-row"
    | "neo4j-node"
    | "neo4j-relationship"
    | "tool-execution"
    | "assurance-run"
    | "bom-document"
    | "assurance-finding"
    | "wiki-page"
    | "decision-interaction"
    | "gear-interface"
    | "external-provider";
  label: string;
  ref: string;
  sourceTable?: string;
  sourceRoute?: string;
};

export type TrustAssessment = {
  kind: "data-trust-vector";
  schemaVersion: 1;
  subject: {
    type: string;
    id: string;
    label: string;
  };
  statementKind: TrustStatementKind;
  tier: TrustTier;
  overallScore: number | null;
  action: TrustAction;
  asOf: string;
  summary: string;
  primaryRationale: string;
  dimensions: TrustDimension[];
  sourceSummary: string;
  auditRef?: TrustEvidenceRef;
};
```

`DataSourceProvenance` should gain an optional `trust?: TrustAssessment` when a metric has structured trust. Existing components can still show source-only provenance while new trust-aware surfaces render richer detail.

## 7. Dimension Semantics

| Dimension | Measures | Examples |
| --- | --- | --- |
| `freshness` | Age of the underlying data vs the surface's freshness policy. | Scan completed 45 days ago; graph indexed 2 hours ago. |
| `sourceAuthority` | Whether the source is canonical for this claim. | `AssuranceFinding` for vulnerability state; `CodeGraphIndexState` for graph freshness; provider API for connected-account data. |
| `evidenceGrade` | Evidence strength using WWMD-compatible A/B/C/D semantics. | Scan receipt = A; inferred label from raw package string = C; contradicted claim = D. |
| `coverageCompleteness` | Whether the result covers the whole subject. | Code graph covers 6/8 changed files; BOM has 312 components; portfolio score has only 2 products. |
| `toolRecency` | Whether the tool producing the answer ran recently enough. | Latest scanner run was 45 days ago. |
| `toolReliability` | Whether the producing tool is approved, healthy, and error-free. | Scanner approved; last code graph run failed; external provider degraded. |
| `graphTraversalDepth` | How indirect the graph inference is. | Direct edge has high trust; 4-hop dependency inference has lower trust unless backed by evidence. |
| `dataLineage` | Whether the path from source to answer is known. | BOM source digest, file hash authority, provider run id, derivation path. |
| `humanValidation` | Whether a human accepted, corrected, or reviewed the fact. | HITL acceptance, triage decision, compliance approval. |
| `conflictContradiction` | Whether sources disagree. | Inventory says active, discovery marks stale; findings contradict "clean" summary. |
| `runtimeAvailability` | Whether dependencies needed to answer were available. | Neo4j unavailable, so graph view is Postgres-only. |
| `sampleSize` | Whether the denominator is meaningful. | Portfolio health from 1 product vs 200 products. |
| `riskImpact` | How much trust is required before presenting the result as current. | Compliance/security claims need higher thresholds than decorative summary counts. |
| `validityConformity` | Whether the value conforms to its expected format/domain. | Email/domain/phone pass validation; status is an allowed enum value; postal code matches country format. (MDM §6.5) |
| `uniqueness` | Whether the record is free of duplicate-candidate risk. | No high-confidence duplicate candidate above the match threshold for this canonical record. (MDM §6.5) |
| `relationshipIntegrity` | Whether the record's relationships/crosswalk references resolve. | All `MasterDataSourceRef` rows resolve to a live canonical id; FK targets exist; no orphaned polymorphic pointer. (MDM §6.5) |

Not every surface needs every dimension. The scorer excludes `null` dimensions from the denominator but includes "unknown" dimensions when the missing dimension itself should reduce trust.

## 8. Score Derivation

The shared scorer produces:

- per-dimension tier and rationale
- weighted overall score
- statement kind
- action
- user/coworker wording

Baseline tiers:

| Overall score | Tier | Default action |
| ---: | --- | --- |
| `>= 0.80` | `high` | `present` |
| `>= 0.60` and `< 0.80` | `medium` | `qualify` |
| `< 0.60` | `low` | `warn-stale`, `refresh-required`, `escalate`, or `defer` depending on dimension caps |
| `null` | `unknown` | `defer` or `refresh-required` |

Hard caps:

- `conflictContradiction` low caps overall tier at `low` and action at `escalate` or `defer`.
- `runtimeAvailability` low caps overall tier at `low` for graph/data claims that require that runtime.
- `freshness` low caps current-fact claims at `last-known-fact`; high-risk claims become `refresh-required`.
- `evidenceGrade` D or contradicted zeroes the contributing evidence and prevents `present`.
- `riskImpact` high does not lower truth by itself, but it raises the minimum tier required for `present`.
- `coverageCompleteness` low prevents broad universal claims; the surface must qualify the scope.

Freshness policies are per surface and explicit. Initial defaults:

| Surface | Current | Watch | Low |
| --- | ---: | ---: | ---: |
| Assurance scan / critical finding claim | 0-7 days | 8-30 days | >30 days |
| BOM component inventory | 0-14 days | 15-45 days | >45 days |
| Code graph index for active build impact | Same commit/head when known, or 0-24 hours | 1-7 days | >7 days or dirty/missing index |
| Estate discovery evidence | 0-7 days | 8-30 days | >30 days |
| Portfolio completeness scores | Live DB read with current quality issues | Missing denominator or partial product scope | stale source/import or no denominator |

The 45-day scan example therefore becomes low freshness, last-known fact, and usually `refresh-required` for security/compliance wording.

## 9. Wording Rules

Trust wording is generated centrally so UI and coworkers do not drift.

| Statement kind | Allowed wording pattern |
| --- | --- |
| `current-fact` | "No active critical findings are present in the current scan." |
| `last-known-fact` | "No active critical findings were present in the latest scan, but scan freshness is low because it completed 45 days ago." |
| `inferred-result` | "This dependency appears impacted based on a 2-hop graph traversal; direct ownership evidence is not available." |
| `low-confidence-result` | "This result is low confidence because Neo4j was unavailable and the view fell back to Postgres-only relationships." |

UI rules:

- Show a compact `TrustBadge` near the result title or metric, not a separate trust dashboard.
- Show one short rationale inline.
- Use an expandable detail panel for dimensions and evidence refs.
- Do not require users to interpret raw math.
- Use DPF theme tokens only.
- Do not hide stale/not-connected warnings behind hover-only UI.

Coworker/tool rules:

- Tool responses include `data.trust`.
- The top-level `message` must qualify stale/low-confidence claims.
- If action is `refresh-required`, the coworker should recommend or invoke the governed refresh path if it has the grant.
- If action is `escalate` or `defer`, the coworker must not present the data as decisive.

## 10. First Slice

The smallest useful implementation should prove trust calculation, score derivation, stale wording, UI display, coworker behavior, tests, and evidence/audit handling in current surfaces.

### 10.1 Slice A: Build Studio Code Intelligence

Affected current surfaces:

- `apps/web/lib/integrate/code-graph-access.ts`
- `apps/web/lib/integrate/change-impact.ts`
- `apps/web/components/build/CodeIntelligenceStatusCard.tsx`
- `apps/web/lib/mcp-tools.ts` handlers for `get_code_graph_freshness` and `inspect_build_code_impact`
- tests under `apps/web/lib/integrate/*code-graph*`, `apps/web/components/build/CodeIntelligenceStatusCard.test.tsx`, and `apps/web/lib/mcp-tools-code-graph.test.ts`

Trust dimensions:

- `freshness`: `CodeGraphIndexState.lastIndexedAt`, dirty flag, and head SHA when comparable.
- `runtimeAvailability`: `available`, `indexStatus`, `lastError`, Neo4j query health.
- `coverageCompleteness`: changed files covered by `CodeGraphFileHash`.
- `sourceAuthority`: `CodeGraphFileHash.authority` and graph key.
- `graphTraversalDepth`: direct graph freshness is depth 0; future impact traces include hop count.
- `toolReliability`: last error / structural relationship health.

Behavior:

- `getCodeGraphFreshness()` returns `trust`.
- `summarizeCodeGraphCoverage()` returns coverage trust.
- `CodeIntelligenceStatusCard` renders `TrustBadge` and stale/dirty warning.
- `inspect_build_code_impact` includes trust metadata and qualified message.
- Existing warnings remain but are generated from trust dimensions where possible.

### 10.2 Slice B: Build Assurance Gate

Affected current surfaces:

- `apps/web/lib/assurance/bom-read.ts`
- `apps/web/components/build/BuildAssuranceGateCard.tsx`
- `apps/web/lib/assurance/finding-read.ts` if scan recency must be selected directly
- existing assurance tests under `apps/web/lib/assurance/*` and `apps/web/components/build/BuildAssuranceGateCard.test.tsx`

Trust dimensions:

- `freshness`: latest `BomDocument.generatedAt` and latest relevant `AssuranceRun.completedAt`.
- `sourceAuthority`: `AssuranceRun`, `AssuranceFinding`, `BomDocument`.
- `evidenceGrade`: scanner run receipt and persisted finding evidence.
- `coverageCompleteness`: BOM component count and selected scope.
- `toolRecency`: latest scan age.
- `toolReliability`: scanner approval/readiness.
- `runtimeAvailability`: scanner readiness and queue/worker availability if known.
- `riskImpact`: security/compliance finding claims require current scan to present as current fact.

Behavior:

- `BomSummary` gains optional `trust`.
- `BuildAssuranceGateCard` shows compact trust badge and one concise rationale.
- Empty findings text becomes freshness-aware:
  - Current: "No active findings."
  - Stale: "No active findings in the latest scan. Scan freshness is low because the latest scan completed 45 days ago."
- The Run scan action remains the primary refresh affordance.

### 10.3 Deferred Surfaces

The first slice should not touch these unless implementation discovers a shared helper must be broadened:

- Estate discovery item cards and MCP tools: adopt after Build Studio proves the contract.
- Portfolio completeness/health: adopt after `ProvenancedMetric` can carry `trust`.
- Graph-backed infrastructure view: adopt once the Neo4j fallback can return structured availability metadata rather than a silent catch.
- Wiki retrieval / WWMD: consume trust vector output later; do not merge data-response trust into `PerspectiveMaterial`.

## 11. Persistence and Audit

First slice persistence rule:

- Trust metadata travels in read models and tool results.
- MCP/tool calls already persist `ToolExecution.result`, so trust metadata is audit-visible there when a coworker/tool invokes it.
- Assurance scan/BOM jobs continue to persist facts in `AssuranceRun`, `BomDocument`, `AssuranceFinding`, and `ToolExecutionReceipt`.
- GearInterface receives trust-related observations only when the result crosses an autonomy/workflow boundary already covered by Reduction Gear emission.
- No new `TrustAssessment` table until at least two user-visible surfaces prove read-model metadata is insufficient.

Future persisted projection trigger:

Add a projection table only if operators need to query historical trust assessments independently of source executions, or if multiple surfaces need to compare trust trends over time without re-reading source ledgers.

## 12. UI Pattern

New UI primitive:

```tsx
<TrustBadge
  trust={assessment}
  compact
  disclosureLabel="Trust details"
/>
```

Rendering:

- high: compact badge with "High trust" and success token.
- medium: compact badge with "Medium trust" and accent/warning token depending on action.
- low: compact badge with "Low trust" and warning/error token.
- unknown: compact badge with "Trust unknown" and muted/warning token.

Detail disclosure:

- primary rationale
- source summary
- dimensions as rows with tier label and rationale
- evidence references as concise links/labels when available

Accessibility:

- Badge has descriptive `aria-label`.
- Details can be expanded with keyboard.
- Warnings use visible text, not color alone.

## 13. Coworker Response Contract

Any MCP/coworker tool returning data-centric assertions should eventually conform:

```json
{
  "success": true,
  "message": "No active findings in the latest scan, but scan freshness is low because the latest scan completed 45 days ago.",
  "data": {
    "result": {
      "activeCriticalFindings": 0
    },
    "trust": {
      "kind": "data-trust-vector",
      "schemaVersion": 1,
      "statementKind": "last-known-fact",
      "tier": "low",
      "action": "refresh-required",
      "summary": "Low trust",
      "primaryRationale": "Latest scan completed 45 days ago; current policy requires security finding claims to be refreshed after 30 days."
    }
  }
}
```

The top-level `message` cannot contradict `data.trust`. Low trust means the coworker qualifies or refreshes; it does not make an unqualified claim.

## 14. Refactoring Allocation

At least 20% of first-slice implementation time should remove fragmentation:

- Extract shared trust-vector types, scoring, and wording under `apps/web/lib/trust-vector/`.
- Avoid duplicating stale wording in `CodeIntelligenceStatusCard`, `BuildAssuranceGateCard`, and MCP handlers.
- Extend `DataSourceProvenance` instead of inventing a competing provenance type.
- Keep component styling token-based and reuse `DataSourceBadge` design language where possible.
- Keep source tables authoritative; adapters convert source facts into trust dimensions.

## 15. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Trust becomes another generic score that hides reasons. | Preserve dimensions, rationale, evidence refs, and statement kind. UI hides raw math but not reasons. |
| Surfaces hand-roll trust differently. | Shared scorer/wording helpers and tests are required in the first slice. |
| Trust metadata becomes stale itself. | Every assessment has `asOf`; dimensions can have `measuredAt`/`expiresAt`. |
| A new table duplicates existing ledgers. | First slice is read-model/tool-result metadata only; persistence uses existing ledgers. |
| Low-confidence UI becomes noisy. | Compact badge + one rationale + expandable details. |
| Coworker messages ignore structured trust. | MCP handler tests assert stale/low-confidence wording in `message` and `data.trust`. |
| Graph fallback hides partial truth. | Runtime availability dimension marks Postgres-only fallback as low/partial. |

## 16. Open Questions

1. Should code graph freshness compare `lastIndexedHeadSha` to the active build's diff head when available, or is age/dirty state enough for v1?
2. Should `BomSummary` select latest `AssuranceRun.completedAt` separately from BOM generation time so "scan freshness" is distinct from "BOM freshness"?
3. Should `TrustAssessment.overallScore` be stored in `ToolExecution.summary` for search/filtering, or only in JSON result for v1?
4. How should trust vector dimensions map into Reduction Gear's `torqueConfidence` once Ring 1 to Ring 2 telemetry is broad enough?

## 17. Acceptance Criteria

The first implementation slice is complete when:

- Shared trust-vector types, scoring, and wording helpers exist with unit tests.
- Code graph freshness and coverage responses include `trust`.
- Build Studio code intelligence UI shows trust tier and stale/dirty rationale.
- Assurance Gate UI qualifies stale "no active findings" states.
- MCP/coworker code graph messages include stale/low-confidence wording and structured `data.trust`.
- Tests cover the 45-day stale scan example or equivalent assurance freshness case.
- UI uses theme tokens only.
- No new trust table or migration is added.
- The implementation plan's verification commands pass, or pre-existing failures are documented.
