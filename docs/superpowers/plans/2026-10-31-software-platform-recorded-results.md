# Software-platform recorded-results implementation plan

Status: draft
Backlog: BI-A699AE2C · Workroom: WC-B9BF154E
Design: ../specs/2026-10-31-software-platform-recorded-results.md
Base: ea62f5fb890390bde854b618834f5e77fd3865ea.

For agentic workers: execute one independently reviewable backlog item at a time. Use dpf-tdd, affected source checks, the governed runtime gate, protected DCO publication, and actual owner portal verification. This plan is sequencing inside one atomic results workflow, not permission to close the broader cockpit BI-2D0FDF9E.

## Acceptance criteria (verbatim live BI)

- The software-platform owner can use /performance to review precisely labelled posted management-ledger income, expenses and net result for an explicit period and currency using existing records and canonical calculations.
- Missing chart, missing period records, ambiguous organization, incompatible currency, oversized or failed source reads remain unavailable with a truthful reason and a supported native next action; a recorded zero is distinguishable from missing data.
- Computation is organization-scoped and bounded outside the Operations request path, persists through the existing BusinessMetricRollup, preserves source lineage and historical comparison, and leaves restaurant behavior intact.
- Existing owner/manager and source-record access controls remain intact; worker, unauthenticated and other-organization cases do not expose financial results or widen access.
- Authorized fixtures cover populated, zero, unconfigured, empty, partial, stale, currency mismatch, source failure and recovery; affected tests, typechecks, policy guards, independent review, protected delivery and actual desktop/narrow owner portal readback provide evidence.

## Scope and overlap

BI-B78E7351 retains the two-view architecture. BI-C20A8CED/BI-5D7F02BC are assessment-only; BI-43B17C8D is a different archetype assessment. BI-7DB3B92F and docs/superpowers/plans/2026-08-12-performance-acceptance-fixture.md supply the existing fixture mechanism. BI-3EC91596 owns model-usage telemetry, not business results. Earlier DOC-89BFB246 chat retains Finance provider recovery. Work Atlas and expense branches do not own these result paths. Native scope claim returned no conflict; open PR and exact file overlap must be refreshed before publication.

## Design and references

Requirement reference: AC-SR-1 through AC-SR-5 in docs/superpowers/specs/2026-10-31-software-platform-recorded-results.md.
Contract reference: BusinessMetricRollup.
Flow reference: software-owner-recorded-results.
Verification reference: software-results-owner-acceptance.

## Phase1 — freeze source definitions and expected outcomes

Deliverable: immutable design and this plan, native research and live plan coverage. Obtain independent source/domain assessment of management-ledger labels, currency, period and zero/unknown boundaries; resolve actual findings before implementation.

Read existing ledger calculation/read service, current organization resolver, Performance metric catalog/provider/aggregator, General Ledger page and source-owned fixture. Do not inspect denied production records by fallback. Reconfirm exact child acceptance and funding ownership before any budget/provider choice. Existing design admission has unresolved funding allocation; no allocation or spend decision is implied.

Independently freeze fixture expected outcomes before implementation: populated income1200/expense200/net1000; valid posted zero-income/expense200/net-200; covered zero-net income200/expense200; missing chart; no period lines; partial current month; incompatible currencies; unbalanced/unknown-account/nonfinite/oversized data; read failure preserving prior stale projection; actual recovery and one persisted value. These are explicitly simulated nonproduction expectations, never the operating organization production figures.

Before Red, resolve every native changeImpactContract.testImpact through find_related_tests: GeneralLedger page, Performance page/dashboard, fixture, ledger service, restaurant rollup/adapter, provider, formatting, support registry, new software projector, fixture script and typed catalog. Missing graph links expand to colocated tests and existing permissions/current-organization/restaurant/ledger suites. Test source selection must name actual paths (existing catalog suite is business-view-profile.test.ts and existing pure ledger suite is ledger.test.ts).

## Phase2 — canonical scoped ledger source and deterministic projection

Deliverable: tested extension of ledger-service.ts, a deterministic software-ledger-metrics projection and existing rollup/adapter dispatch. Not independently shippable: an adapter without supported catalog/presentation would leave the owner blocked.

Use the canonical computeTrialBalance/deriveFinancialStatements functions. Extract strict scoped-period source validation into apps/web/lib/finance/ledger-period-report.ts with its colocated test, called by the existing ledger-service persistence boundary and Performance adapter; it is a pure validation/projection helper, not another ledger, storage engine or reporting route. Keep original canonical math authoritative and unmodified. Native scope includes this helper, the existing business-view-profile.test.ts and performance-metric-support.test.ts, and docs/user-guide/finance/reporting-and-close.md for source boundaries. Add explicit current-organization/UTC ledger-month bounded source read to the existing service; retain ordinary posting behavior. Limit-plus-one refuses truncation. Validate chart configuration, all account ownership/types, exact two-minor-digit currency, stored decimal precision and safe aggregate minor-unit range, finite nonnegative one-sided debit/credit values, balanced contributions, and nonempty covered period. Include reversed originals plus their compensating entries at their own actual periods; reject broken/foreign reversal chains, and exclude drafts. Use actual sourceType JournalEntry/sourceId provenance from the existing writer; optional reversalOfId is not required and must agree when present. Bounded cross-period candidate reads reject absent/ambiguous/opposite-line mismatch. A month containing only a valid reversed original remains covered, not empty. Test actual source statuses for same-month/cross-month/repeated reversal before implementing. Missing data produces unavailable reasons, never synthetic zero. No source IDs/memos reach aggregate lineage.

Extend existing business-metric-rollup dependencies and aggregator with a software context/source path; restaurant scanner remains restaurant-only. Define monthly window boundaries consistently with existing JournalEntry.periodKey; retain the same worker/scheduler/upsert. Test dispatch cannot call hospitality loader for software. A source failure preserves last successful rows/time and records failure through existing job outcome, without a successful synthetic refresh. Current/previous UTC-month computation is idempotent and all three rows commit atomically in the existing transaction seam. Inject second-row persistence failure and verify no mixed-generation pack reaches the provider; retain prior coherent snapshot/time.

Verification: failing-then-passing pure projector/source/dispatch tests, authoritative ledger regression suite, source-scope/currency/capacity/invalid data negative controls and restaurant adapter regressions.

## Phase3 — typed pack, bounded provider and native owner surface

Deliverable: software metric definitions and three-card native Performance experience, actual currency, available/unavailable reasons and current-organization period drill-through. Atomic withPhase2.

Extend existing catalog and archetype support together. Provider continues bounded persisted read and rejects ambiguous organization. It filters relevant keys/definition identity so stale unrelated rows cannot set period or overwrite selected software metric values. Metadata permits actual currency and clear recorded/incomplete meaning. Keep null values unavailable in charts/CSV and suppress current-partial/full-prior percentage comparisons. Past interval is not proof closed books, and software freshness must remain age-sensitive after period end. Reject mixed pack generations; use UTC month keys/labels/year rollover consistently.

General Ledger drill-in resolves authenticated current organization and its existing finance capability before reading the exact month; no URL organization override/first-org fallback. Share the native service instead of adding a reporting route. Withhold or relabel period-derived financial-position cards as period movements on this scoped drill-in; do not pretend monthly movements include prior capital/opening balances. Performance page pending/empty software state links to the supported Finance workflow and explains missing history; unsupported archetypes remain truthful.

Use existing report-kit, details, controls and theme tokens. Preserve111-word Performance and121-word GeneralLedger arrival budgets and existing structural/numeric/axe ratchets; any deliberate structure change requires real governed measurement/review rather than a raised limit. Run prose-lint guard self-tests/check, style drift, UX-Fit and actual route/keyboard/narrow checks.

Verification: source rendering, zero-versus-empty, partial/comparison, currency formatting/export, permissions, scope and no-source-query-on-page tests. Recheck current organization and restaurant behavior.

## Phase4 — authorized fixture, recovery and delivery

Deliverable: existing Performance fixture mechanism extended for software with explicit nonproduction/demo proof and pre-write tenant/archetype/owner checks. No production finance writes. Route the actual ledger source/aggregator to persisted rollups; projection-only upserts do not prove source integration. Reuse existing fixture CLI/seed path; the agent operates it, never the owner.

Run appropriate affected tests and all changed package typechecks, policy guards/derived generators and exact-tree independent review. Resolve findings, freeze DCO commit, run one governed gate and follow its durable queue identity. Required GitHub checks and protected merge queue remain mandatory. Coordinate one canonical release with earlier repair chat; request no duplicate runtime advance.

Run native live readiness before served owner verification. Verify actual owner populated results/source drill-through, saved rollup reload, true recorded zero versus missing records, partial month, stale source failure, recovery, unauthenticated/worker/other-org negatives and desktop/narrow/keyboard. Record exact served bytes, fixture scope, persisted readback, screenshots and real coworker interaction where relevant. Mark unrun/inconclusive checks honestly. Update native BI/workroom evidence and original DOC-82684072 checkpoint before completion.

## Backlog coverage

Decision proposed: atomic. All phases implement the same one-owner result path; source adapter, typed keys, bounded provider, scoped drill-in and fixture proof cannot independently satisfy its acceptance. This child is independently shippable relative to the broader cockpit, which retains BI-2D0FDF9E. Initial immutable6457 coverage accepted as cmvx0bsbv3y9101pnh6tl3hxx and implementation admittedIRD-6C365D6BF583. Independent review then found5 contract issues; this amended plan/design require refreshed immutable coverage before code. Internal sequencing deliverable key software-recorded-results maps to BI-A699AE2C with independentlyShippablefalse, dependsOn[] and the references above.

## Risks and rollback

Scope leakage, currency/finality/comparison/zero mislabelling, partial read totals and false source freshness are the main risks. Freeze negative controls and mutate the guarded seams to prove detection. Bound all source reads; avoid historical scans in Operations. Protected revert removes this adapter/pack/presentation atomically and retains historical evidence; no destructive migration or journal reversal. Approximately20% of relevant effort consolidates existing ledger math, support dispatch, provider and fixture rather than creating duplicate infrastructure.


## Design review amendment

Before implementation, retain the independent6457 findings and revised controls recorded in native WC-B9BF154E assurance evidence. Recheck immutable corrected design/plan with the same reviewer and refresh live coverage. Actual feature source is still unchanged.
