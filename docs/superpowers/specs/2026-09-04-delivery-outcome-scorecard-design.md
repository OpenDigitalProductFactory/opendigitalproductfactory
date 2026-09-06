---
status: draft
---

# Delivery outcome scorecard

**Date:** 2026-09-04  
**Backlog:** `BI-69803ACC`  
**Parent design:** `docs/superpowers/specs/2026-09-03-local-first-agentic-delivery-throughput-design.md` §9  
**Baseline:** `docs/superpowers/evidence/2026-09-04-flow-efficiency-adversarial-fixture-baseline.md`

## Decision

Derive a versioned `DeliveryOutcomeObservation` read model from existing Workroom,
WorkroomActivity, RuntimeVerification, QueueTelemetryEvent, TaskRun, adapter telemetry,
and contributor PR snapshot facts. Do not create a scorecard table, event stream, or
second delivery ledger. The first implementation reads one bounded 30-day cohort,
projects source freshness and completeness beside every measure, and renders it inside
the existing `/build/work` route family at `?view=outcomes`.

## Problem and outcomes

DPF has delivery facts but no common outcome unit. Raw PR count rewards fragmentation,
token totals reward consumption, and a median hides the blocked tail. The operator needs
to know whether a delivery change produced more verified outcomes with equal or better
quality, less waiting, less human attention, and complete attribution.

- **OBJ-DOS-001 — coherent outcome unit.** Project one immutable, versioned observation
  per Workroom and aggregate only explicitly defined cohorts.
- **OBJ-DOS-002 — truthful flow and quality.** Report stage durations, p50/p90, first-pass
  protected-check state, rework, abandonment, and evidence completeness without turning
  missing facts into zero or success.
- **OBJ-DOS-003 — truthful economy.** Keep uncached input, cached input, cache creation,
  output, reasoning, API-equivalent cost, and actual invoiced spend distinct. Preserve
  attribution method and completeness. Parent and child views must not double count.
- **OBJ-DOS-004 — decision-ready UI.** Show the bounded cohort, verified-results signal,
  bottleneck, quality, economy, and source health first; disclose record-level evidence
  and technical detail second.

## Research and benchmarking

- DORA's current five-metric model keeps throughput and instability together and warns
  against one metric becoming a goal. Adopt the balanced outcome posture; reject its
  deployment-only unit because DPF must also measure pre-deployment Workroom flow.
  Source: <https://dora.dev/guides/dora-metrics/>.
- GitLab Value Stream Analytics defines stages from explicit start/end events and shows
  medians over bounded completed items. Adopt event-pair stage derivation; add p90 and
  incomplete-item visibility so the tail cannot disappear. Source:
  <https://docs.gitlab.com/user/group/value_stream_analytics/>.
- Apache DevLake joins source-control, CI, deployment, and incident facts into one
  project-level metric view. Adopt source-linked drill-through and cohort definitions;
  reject another ingestion platform because DPF already owns the canonical facts.
  Source: <https://devlake.apache.org/docs/v1.0/Overview/Introduction>.
- OpenTelemetry semantic conventions use shared names across signals. Adopt stable
  versioned metric/source keys in the projection; do not emit a duplicate telemetry
  signal merely to feed this screen. Source:
  <https://opentelemetry.io/docs/concepts/semantic-conventions/>.

## Existing substrate and boundaries

| Concern | Reused source | Boundary |
|---|---|---|
| Delivery identity | `Workroom` and semantic `capsuleId` | One observation per Workroom; branch is evidence, not identity. |
| Lifecycle facts | `WorkroomActivity`, Workroom status/timestamps | Event names are mapped explicitly; absent milestones stay unavailable. |
| Verified result | `RuntimeVerification` | Only a passed terminal verification marks verified. |
| Queue/capacity | `QueueTelemetryEvent`, `QueueMetricSnapshot` | Preserve lane/source; do not infer an install from a branch. |
| PR/check/review | contributor GitHub snapshots plus recorded activities/evidence | Snapshot freshness is visible; stale or missing GitHub data is not success. |
| Model/tool economy | `AdapterRunTelemetry`, `ToolExecution`, `TaskRun` hierarchy | Incremental rows only; inclusive totals are derived from unique descendant runs. |
| Presentation | `/build/work`, report-kit, shared status intents | No new global navigation, card dialect, or hardcoded colour. |

The read model is bounded by cohort start/end and row ceilings. Its source adapters return
`ready`, `empty`, `stale`, `partial`, or `failed` independently. A source failure preserves
the remaining confirmed cohort and lowers completeness; it never erases known results.

## Projection contract

`DeliveryOutcomeObservation@1` contains:

- identity: Workroom, BI/campaign, repository, branch, PR, work kind, risk/evidence tier;
- milestones: claimed, first commit, PR open, review-ready, merge, verified;
- durations: active, wait, claimed→PR, PR→ready, ready→merge, merge→verified, cycle;
- quality/rework: protected first-pass result, blocking findings, post-open commits,
  repeated gates/reviews, regressions/reopens, supersession/abandonment, takeovers;
- attention: questions, approvals, interventions, takeovers, merge clicks;
- economy: five token classes, tool/non-progress calls, API-equivalent cost,
  subscription allocation, invoiced spend, attribution method/completeness;
- capacity: installation/lane, wait, admission failure, utilization/pressure when known;
- provenance: source state, observed time, cohort, and evidence links.

Every aggregate supplies numerator/denominator or sample count. Percentiles use only
valid completed durations and expose incomplete counts beside the result. Unknown money
or token classes remain `null`; they are never coerced to zero. `exclusive` economy is
the selected Workroom's directly attributed runs, while `inclusive` is the set union of
those runs and uniquely identified descendants.

## UI contract

The default `/build/work` view retains its frozen arrival shape. Its existing stat row
gains a compact `Delivery outcomes` entry and the surrounding explanatory copy shrinks
enough to keep the net visible-word delta at or below zero. The entry opens
`/build/work?view=outcomes`.

The outcome view uses one report-kit composition:

1. cohort name, 30-day period, and source-health notice;
2. verified slices, cycle p50/p90, first-pass protected checks, and attention per verified
   result;
3. stage and economy tables with `Unavailable` labels instead of zeroes;
4. a bounded Workroom table linking every aggregate to `/build/work/<capsuleId>`.

The view is server-rendered, keyboard navigable, narrow-safe, theme-token-only, and
reduced-motion neutral. It adds no polling. Refresh follows normal navigation; later
Workroom-rail/task-hub slices may supply event-driven invalidation without changing the
projection contract.

## Acceptance criteria

| ID | Objective | Acceptance |
|---|---|---|
| AC-DOS-001 | OBJ-DOS-001 | A deterministic fixture produces one `DeliveryOutcomeObservation@1` per Workroom and stable cohort aggregates. |
| AC-DOS-002 | OBJ-DOS-002 | p50/p90 and stage durations exclude incomplete pairs while reporting their incomplete counts; missing protected-check data is unavailable, never pass. |
| AC-DOS-003 | OBJ-DOS-002 | Verified, abandoned, superseded, first-pass, rework, regression, and evidence-completeness measures link to their underlying Workrooms. |
| AC-DOS-004 | OBJ-DOS-003 | Token classes and spend concepts remain separate; exclusive/inclusive child attribution deduplicates run identity and exposes completeness. |
| AC-DOS-005 | OBJ-DOS-001 | The DB adapter reads a 30-day, row-bounded cohort using existing indexed identities and returns per-source state without a GitHub/network fan-out. |
| AC-DOS-006 | OBJ-DOS-004 | `/build/work?view=outcomes` renders ready, empty, partial/stale, and failed-source states with report-kit and semantic tables on desktop and narrow layouts. |
| AC-DOS-007 | OBJ-DOS-004 | The default `/build/work` frozen route budget, keyboard semantics, contrast, light/dark tokens, and UX sweep pass. |
| AC-DOS-008 | OBJ-DOS-001 | No schema migration, second event stream, global navigation entry, or client-owned scorecard state is introduced. |

## Refactoring allocation

The evidence-backed 20% lane is spent consolidating percentile/sample accounting and
source-state semantics inside the new pure projection rather than copying calculation
rules into the UI. No speculative cleanup is added; the existing queue metric store and
report-kit remain unchanged.

## Risks and rollback

- Activity names predate this projection. Unknown names remain provenance-only and lower
  completeness; the mapping is additive and test-fixtured.
- Large histories could regress route cost. The adapter enforces time and row ceilings
  before projection, and tests assert query bounds.
- Snapshot lag could mislead. Source age/state appears beside the cohort and stale data
  cannot produce a green completeness claim.
- Rollback is one PR revert. Because the slice adds only a read model and UI branch, it
  requires no data rollback or migration.

## Non-goals

No causal model, employee leaderboard, private reasoning capture, billing system,
campaign scheduler, new PR store, or real-time subscription is part of this BI.

