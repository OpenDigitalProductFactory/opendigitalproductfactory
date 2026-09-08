# Evidenced failure analysis and recovery readiness

Implements the failure-analysis amendment in [the shared change-review design](../specs/2026-07-27-shared-change-reviewer-control-design.md). This is one atomic delivery: a validator without producers or promotion enforcement would falsely imply protection. Local backlog bindings and review receipts belong in the live Workroom, not portable source.

## Implementation sequence

1. Extend the shared review contract with structured failure analysis, final-change evidence references, residual dispositions and a digest. Validate completeness and currency before inference; resolve evidence from the existing evidence store. Test absent, malformed, stale, unrelated and unsupported evidence before implementing the validator.
2. Bind the analysis and resolved evidence to receipt freshness and the existing single-flight request identity. Feed the same reviewed analysis through MCP and Build Studio. Require an independent omission challenge, including for proportionately small changes. Test retries, lost responses, changed evidence and reviewer outages using the existing durable review runner.
3. Connect mandatory analysis validation to shared delivery/promotion controls. Preserve genuine authorization and risk acceptance. Technical review exhaustion routes to internal repair, never a business-owner technical approval. Exercise both authoring surfaces and the promotion boundary; do not rely solely on local hooks.
4. Update contributor guidance and the PR template with concrete evidence examples. Run affected tests, typecheck and preflight; obtain independent final-change review and publish a DCO-signed PR through the existing protected process.

Each phase is internal sequencing, not independently shippable. Approximately one fifth of implementation work consolidates shared validation and receipt identity instead of adding parallel surface policies. The peer verify-first work owns work-kind minimum verification rules; this change consumes its existing evidence contract and adds failure-scenario relationships.

## Failure and recovery analysis

Missing or stale evidence could allow a regression that prevents a rescue coordinator arranging care or a donor completing a contribution. Reject it before publication with actionable missing references. A reviewer outage could stall delivery indefinitely: retain the durable request, bound retries, distinguish uncertainty from a code defect and route exhausted infrastructure recovery internally. A lost response must reuse persisted results rather than rerun paid inference or invent approval. An unrelated risk acceptance could authorize harm outside its scope: require the existing authority record and exact risk/change binding. Overly rigid validation could block small corrections: scale narrative depth to consequences while retaining evidence and an independent challenge.

Rollback is a single PR revert through the protected queue. Persisted receipts are versioned and retained; old receipts require refresh rather than silent reinterpretation. Do not drop evidence or modify production data. CI and reviewer findings determine whether the implementation fulfills these controls; this plan is not verification evidence.

## Backlog coverage

One live owning item covers this atomic outcome. The immutable plan locator and coverage receipt are recorded through the configured MCP endpoint in its Workroom. No peer-owned record is changed.
