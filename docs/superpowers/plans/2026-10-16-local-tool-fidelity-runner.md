# Complete the local tool-fidelity runner

**Backlog item:** BI-C2F81AB0
**Workroom:** WC-8B480D69
**Delivery shape:** delivery-medium@1.0.0
**Source base:** 3c6f0a51b5a6acff1ca344167a068f4f8cabe461
**Status:** Design preparation; no implementation admission or runtime qualification.

For agentic workers: execute one independently reviewable backlog item at a time.
Use DPF's test-first, merged-code verification and DCO publication procedures.

## Objective and design grounding

Complete the absent live runner excluded by the
[Phase-2 plan](2026-07-17-ep-e431fc8a-phase2-fidelity-eval-plan.md).
Extend the [canonical design](../specs/2026-07-17-coworker-capability-routing-evidence-integrity-design.md),
section 11, preserving INV-1 through INV-6 and the existing taxonomy/policy.

Inspected substrate: apps/web/lib/routing/tool-fidelity-harness.ts,
apps/web/lib/routing/tool-fidelity-policy.ts,
apps/web/lib/routing/local-tool-fidelity.ts,
apps/web/lib/routing/eval-golden-test.ts,
apps/web/lib/routing/eval-runner.ts and apps/web/lib/tak/intent-taxonomy.ts.
The harness only receives a tool name, the referenced script is absent, and
the measured-cap reader takes a maximum across models. No new cap write is safe
under this repair. Reuse trace/EndpointTestRun provenance and canonical
governed read execution; no new persistence or transport contract.

Closed federated BI-DF3092F4 stays closed. BI-C5A25AB4 owns failed-probe
diagnostics and BI-CAP-FEE56611 owns the separate operation/authority question.
BI-7C93EEE7 and BI-A9059BB0 supply provenance and incomplete-output safeguards.
BI-0169B7D7 and BI-A472354E own broader routing/profile work, outside this runner.

## Acceptance criteria (verbatim)

- AC-1: A bounded runner composes the existing nine golden prompts at declared surfaces 8, 15, 24, 32 and 48, with at least five completed independent observations per declared model/adapter/surface/sensitivity cohort. It records exact model/runtime/source/tool catalog identity and distinguishes unrun, incomplete, failed and passed observations.
- AC-2: A selection success requires an actual returned first tool call in the attached allowed catalog and valid arguments; a governed-execution success additionally requires the matching successful read ToolExecution/result for that invocation. Text naming a tool, wrong/no/unattached tool, invalid arguments, refusal or synthetic proposal is never execution success.
- AC-3: Wrong-tool, malformed/no-call, invalid arguments, tool failure, unknown/truncated result, stale model/source/catalog, different-model fallback and foreign/unbound execution negatives cannot qualify a cohort or raise a cap. Pure injected fixtures never become live qualification evidence.
- AC-4: Preserve the existing >=90 percent accuracy / >=5 observation qualification threshold and fail-safe unmeasured cap. No evidence is transferred between models, versions, adapters, surfaces or sensitivity classes. Do not write production cap/confidence changes merely from harness preparation.
- AC-5: Normal current grants, sensitivity, model/residency selection, capacity, cancellation and budget boundaries govern runtime operation. A denied action remains stopped, especially evaluate_tool discovery's missing tool_evaluation_create. No paid external inference, original 870/941 replay or client/identity substitution is part of this repair.
- AC-6: Meaningful RED-to-GREEN source regressions, affected checks and typechecks, independent review, protected publication, and a qualified served containing build precede live acceptance. Runtime qualification remains UNRUN until the exact supported operation/authority is available.

## Contract and flow references

- CONTRACT-IDENTITY: Exact account/model version, adapter, sensitivity,
  source/runtime, golden and tool catalog identities bind each observation.
- CONTRACT-EXECUTION: Valid actual first selection and matching successful
  governed read are separate; a proposal is not an execution.
- CONTRACT-ISOLATION: No production cap/confidence write, paid fallback,
  grant change or original historical-review replay.
- FLOW-QUALIFY: Authorized admission -> frozen catalog -> bounded model turn
  -> schema validation -> governed read -> attributable readback -> report.
- VERIFY-NEGATIVES: The failure matrix below cannot qualify a cohort.
- VERIFY-LIVE: Qualified served identity and the actual authorized operation
  are required; unavailable runtime qualification stays UNRUN.

## Ordered work

1. **Admission and test contract.** Before source implementation, reconcile
   current workroom/source, research, body acceptance and immutable plan coverage.
   Resolve CWN-63C5BE75 through its owning authority. Discovery's missing
   tool_evaluation_create remains stopped; no direct inference fallback.
   Claim exact implementation files and consume the change-impact contract.
2. **RED source regressions.** Extend the existing scorer tests with real-call
   shaped evidence fixtures, keeping fixtures labeled source-only. Cover all
   VERIFY-NEGATIVES cases before implementation. Any additional production file
   requires an exact scope claim and amended coverage, not a guessed path.
3. **Bounded runner composition.** Extend tool-fidelity-harness.ts through a
   typed observation seam rather than a second scorer. Compose the existing
   taxonomy, eligible tool catalog, schema validation, trace and governed
   execution at the supported server operation once established. Preserve
   measureToolFidelity compatibility for existing source callers.
4. **Readback and report.** Keep all scheduled case outcomes, distinct invocation
   identities, selection and execution metrics. Surfaces without sufficient
   granted tools are unrun. Default nine cases across five surfaces cap at
   45 inference turns and 45 read executions; repeats need explicit admission.
   No persistToolFidelitySamples or profile-confidence/cap mutation.
5. **Verify and publish.** Run affected harness/policy/taxonomy tests and both
   repository TypeScript programs. Follow the impact contract for all added
   guards; then exact-source independent review and the protected merge queue.
   Do not claim this plan delivers the runner.
6. **Live acceptance.** After canonical deployment containing the implementation,
   verify the exact served identity and run the admitted local-only operation.
   Read back matching tool results, report negatives and incomplete cohorts,
   and record independent acceptance. Keep historical 870/941 holds unchanged.

These steps are internal sequencing of one runner; the preparation and a pure
fixture scorer do not independently satisfy the requested live qualification.

## Failure matrix and verification

| Condition | Required result |
| --- | --- |
| Tool name appears only in prose, absent/wrong/unattached first call | Failed selection; no execution |
| Invalid arguments, proposal, failed read, foreign trace/invocation | No governed-execution success |
| Truncated, unknown, stale identity or different-model fallback | Incomplete or failed; cannot qualify |
| Duplicate result or reused invocation | No additional independent observation |
| Missing grant, unsuitable sensitivity/residency, unavailable local capacity | Held/unrun through normal policy |
| Deadline, cancellation or budget exhaustion | Stop; retain partial evidence; no hidden retry |
| Fixture-only results or qualified model A while running model B | Cannot become live evidence or raise a production cap |

Use policy constants for >=90 percent / >=5; do not restate independent policy.
All completed negative cases remain in the denominator. Incomplete scheduled
coverage prevents cohort qualification. Default class-specific samples number
three, so the nine-case run alone cannot qualify individual task classes.

## Risks and rollback

The principal risks are cross-model evidence transfer and apparent tool success
without governed execution. Identity-bound readback and zero cap writes contain
them. Revert the runner integration to restore the current fail-safe path;
retain actual audit evidence. No migration, credential rotation or historical
record rewrite is part of rollback.

## Backlog coverage

- Decision: atomic
- Parent: BI-C2F81AB0
- Receipt: blocked-by: The immutable plan is not yet committed and provider-resolvable; record governed plan coverage before any implementation claim.
- Rationale: A fixture scorer, runner adapter and readback are internal sequencing of one missing live qualification operation; none independently meets the runner acceptance criteria.
- Dependencies: CWN-63C5BE75 / BI-CAP-FEE56611 for supported runtime operation and authority; runtime stays UNRUN until resolved.
- runner -> BI-C2F81AB0
- Requirements: AC-1, AC-2, AC-3, AC-4, AC-5, AC-6
- Contracts: CONTRACT-IDENTITY, CONTRACT-EXECUTION, CONTRACT-ISOLATION
- Flow: FLOW-QUALIFY
- Verification: VERIFY-NEGATIVES, VERIFY-LIVE

Coverage remains a native pre-implementation requirement. This explicit blocked
receipt is a planning checkpoint, not an implementation exemption.
