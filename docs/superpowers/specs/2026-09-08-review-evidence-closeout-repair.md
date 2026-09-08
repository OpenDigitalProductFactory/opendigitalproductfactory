---
status: draft
---
# Reviewer evidence and receipt reuse repair

Closeout parent: BI-1B5B4CEC, Workroom WC-D9BE05B3. Delivery coverage:
BI-0C0669B5 (existing withheld reviewer reasoning defect) and BI-D1298AB0
(automatic receipt compatibility). Preserve the existing branch and Workroom.
The operator authorized a successor on 2026-09-08: WC-D72FAD2A, branch
`fix/reviewer-evidence-closeout`, delivers BI-D1298AB0 first. BI-0C0669B5
remains a separate independently shippable follow-up, not part of this PR.
The original readiness mapping is merged in PR #5049; this is follow-up repair,
not a replacement implementation or a claim that independent review passed.

## Grounding and reproduction

Source target: origin/main 9f176768d. The existing evidence-integrity contract is
owned by `apps/web/lib/tak/evidence-requirement.ts` and the capability-routing
[design](2026-07-17-coworker-capability-routing-evidence-integrity-design.md).
The semantic operation owns activation and receipt reuse. Extend those
contracts; do not create another ledger, reviewer role, or approval path.

On 2026-09-08 the exact-diff reviewer task ending FF01D69D6BB5 produced a
2553-character draft with zero extracted successful tools. The loop classified
the supplied code review on `/build` as live capsule status, nudged, and returned
only INV5_UNVERIFIED_MESSAGE. `resolveEvidenceRecovery` preserves withheldContent
but the loop drops it. MCP task execution treats the resulting text as completion.
The draft's correctness is unknown; it must not become an approved verdict.

The native semantic operation also reused an exact-tree automatic receipt after
the caller requested high risk and high assurance. Fresh tree identity is
necessary but insufficient: an automatic receipt does not prove independent review.

Adjacent PR #5219 handles reader-history truncation, not these failure paths.
The [reviewer disposition design](2026-09-06-reviewer-disposition-contract-design.md)
owns persisted writer outcomes; preserve its approval separation and bounded retries.

## Objectives and acceptance

- OBJ-REC-001 / AC-REC-001 (BI-D1298AB0): when current activation requires review,
  an exact-tree auto-pass dispatches independent review instead of authorizing reuse.
  High/critical escalation, reviewed reuse, low-risk reuse, identity staleness and
  inconclusive retry have executable regression coverage.
- OBJ-REC-002 / AC-REC-002 (BI-0C0669B5): source artifact content cannot by itself
  turn a bounded artifact review into a live-status request. Use server-owned
  review context, not a user-supplied bypass flag or matching a coworker name.
  Actual operational questions still require authoritative evidence.
- OBJ-REC-003 / AC-REC-003 (BI-0C0669B5): exhausted evidence recovery preserves the
  draft as an internal, explicitly unverified artifact and reports an honest
  non-success task outcome. Do not expose the draft as a factual answer, count a
  refused turn as approval, or synthesize a review receipt.
- OBJ-REC-004 / AC-REC-004: after governed delivery and runtime advance, independent
  review of the original immutable PR #5049 diff produces an actual verdict;
  close WC-D9BE05B3 only on its passing completion contract. BI-E22C3D75 keeps
  workType=refactor and its owning task receives the precise resumption evidence.

## Ordered fix and verification sequence

1. Preserve the original dirty configuration and both regression test edits.
   The original branch was reconciled without losing terminal-test coverage.
   Continue the cache repair in the authorized successor based on current main;
   carry forward its actual regression patch, not a reconstruction from memory.
2. Reproduce receipt reuse with tests before production edits. Capture the red
   assertion and passing controls. Implement compatibility inside the existing
   semantic operation, then run its operation, contract, routed-review and pack tests.
3. Reproduce artifact classification and quarantined-result loss at the actual loop
   and MCP execution boundaries. Extend existing typed result/persistence seams;
   keep required terminal writers, identity checks and live evidence enforcement.
   Make those tests green, including genuine live questions and failed tool calls.
4. Run graph-linked tests and colocated MCP execution/submission/replay tests.
   Graph has no test edges for MCP execution or readiness profiles, so include
   their colocated suites and readiness, MCP-pack and terminal-transition suites.
   Clear style-drift, typecheck, module-size and documentation guards. The loop's
   baselined size must not grow. Record blast radius and exact-tree review/gates.
5. DCO and Design-Grounding-Decision trailer; ready PR, mechanical PR health,
   protected merge queue, canonical runtime verification and acceptance evidence.

## Authority, compatibility, risk and rollback

Research and review receipts must come from the server-issued independent route.
The existing `dispatchRoutedSemanticReview` already reviews supplied immutable
artifacts directly through governed inference. Use that route; do not add a
generic exemption to the live-state evidence guard. A sensitivity floor raises
review strategy assurance but does not itself activate independent review;
the cache regression exercises high/critical risk activation explicitly.
This design is not an implementation approval. No migration or new table is
planned. Use existing internal execution artifacts and typed failure outcomes;
do not place quarantined drafts in outward progress summaries. Never count a
model's prose saying it read a file as successful authoritative tool evidence.
The main risks are a false approval from cache and an evidence bypass from a
too-broad artifact exemption. Preserve fail-closed defaults and adversarial tests.
Rollback uses a revert PR and canonical runtime advance; retain historical receipts.

## Documentation impact and backlog coverage

Reviewer behavior and operational recovery change; this design and the existing
reviewer-facing guidance must explain the new outcome. No UI route, install
configuration or schema change is intended. The two repairs are independently
shippable and map to BI-D1298AB0 and BI-0C0669B5 respectively. Canonical coverage
receipt and independent research approval remain pending; no completion claimed.
