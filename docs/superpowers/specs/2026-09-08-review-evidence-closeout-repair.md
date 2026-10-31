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

### Current reproduction and bounded follow-through (2026-10-31)

BI-0C0669B5 resumes in WC-95E5E6F9 on
`codex/coworker-grounding-failure`, based on
`bb16531c673919212f8318b3920e0b3012b9f18e`. Two separate read-only COO
checks on served `a87edcb6472381b5ba7b9ffea8dbf5db4cd8dff2` returned the
INV-5 refusal despite successful ChatGPT component calls. The second named
the exact approval reader and its supported pending mode. Neither returned a
verified count. These observations establish failure, not its extraction,
attachment or authorization cause. Private deliberation read was denied; no
alternate private endpoint, database read or broader grant is authorized.

The current loop reproduction is
`apps/web/lib/tak/agentic-loop-evidence.test.ts`: two model replies with no
tool execution exhaust the one recovery nudge, return the guard message,
but omit both a typed failure and the withheld draft. The greeting control
passes. This is a unit reproduction with mocked inference, not a live model
qualification. The initial command used a nonexistent package filter and ran
no tests; only the later `web` package run establishes the actual red result.

The ordered AC-REC-003 repair is:

1. Pin the current loop failure before production edits. Add controls for a
   real successful read, a failed read, and discovery-only calls; neither a
   model's claimed read nor a successful meta-tool proves live facts.
2. Extend the existing typed dead-end result with an evidence-unavailable
   outcome. Carry the withheld final-answer drafts separately from reply text,
   under the existing bounded recovery budget. Record the observed tool counts
   and a turn metric before the early return. These are loop observations,
   not proof that an unobserved native tool did not run.
3. Reuse existing task artifacts for explicitly unverified diagnostic drafts,
   bound to the server's current task, agent and thread. Preserve current task
   authority and execution fencing. Do not put drafts in response text,
   progress summaries, completion receipts or semantic recall. A missing task
   binding or failed artifact write remains explicit; it never becomes a claim
   that a draft was saved. Outward artifact projections and positive-evidence
   search must exclude these internal drafts. No schema, credential, grant,
   model requirement or privacy change is proposed.
4. Exercise the actual chat and MCP task boundaries: refusal is a non-success
   result, the task cannot complete from its canned text, and the draft stays
   outside outward messages. Verify existing server-bound artifact-review and
   native reader provenance controls for AC-REC-002; do not add a text-based
   evidence exemption. Any remaining AC-REC-002 miss stays open rather than
   declaring the whole item delivered.
5. Run affected tests, both web typechecks, module-size and documentation
   guards, independent source assessment and the canonical merged-code gate.
   Publish through the protected queue and advance the canonical runtime, then
   perform one new read-only acceptance check only after the repair changes.
   Historical uncertain executions remain unreplayed. This reporting repair
   does not itself establish why the original approval reader failed.

This is one bounded repair of the existing evidence outcome contract, not an
implementation of intake-only BI-E9555B2D or an expansion of the parallel
provider-quota branch. Draft retention, non-success classification and outward
isolation must be verified together. The implementation now preserves unknown tool settlement using the existing
execution-uncertain outcome and does not write an auxiliary draft artifact for
that path. Its first-failing regression expected execution-uncertain and got
evidence-unavailable; the corrected focused cohort passed 57 tests. A broader
source-local run passed 547 tests with six real-PostgreSQL cases explicitly
skipped. Both web TypeScript programs passed. These are source checks on the
uncommitted implementation, not canonical gate, deployment or live acceptance.
The isolated database tests exercise real persistence, rollback, task ownership,
generation and cancellation row locks; their actual shared-environment run is
still owed. AC-REC-002 source/provenance controls remain separate and are not
claimed complete by this reporting repair.

The native semantic operation also reused an exact-tree automatic receipt after
the caller requested high risk and high assurance. Fresh tree identity is
necessary but insufficient: an automatic receipt does not prove independent review.

Adjacent PR #5219 handles reader-history truncation, not these failure paths.
The [reviewer disposition design](2026-09-06-reviewer-disposition-contract-design.md)
owns persisted writer outcomes; preserve its approval separation and bounded retries.

## Objectives and acceptance

- OBJ-REC-001 / AC-REC-001 (BI-D1298AB0): when current activation requires review,
  an exact-tree auto-pass dispatches independent review instead of authorizing reuse.
  High/critical escalation, reviewed reuse, low-risk review, identity staleness and
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

Independent review receipts must come from the server-issued review route.
Research follows the current delivery shape's author-evidence lane; it is not
an independent review verdict.
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
receipt remains historical context; the current small delivery shape requires
research, delivery and acceptance rather than a separate spec or plan gate.
Author research receipt `initiative-f0725aa1-fc50-496b-adb6-bf255fc32637` records
the verified red reproduction without claiming a green test or independent review.

## Reconciliation with current main (2026-10-02)

The existing regression patch was preserved and reapplied after refreshing to
`36f53132a129803fc1b4666a7e0ca10f9ca76c32`. PR #5231 now requires independently
challenged failure analysis on all reviews; automatic receipt creation is no
longer a supported path in the operation. Preserve that stronger policy: reject
cached automatic receipts for low, medium, high and critical risk. Keep fresh
reviewed receipt reuse, stale identity re-review and inconclusive retry intact.
The original high/critical regression remains, using an explicit automatic
receipt fixture because current main no longer creates one. Its former medium
automatic-reuse control now asserts mandatory review, not a policy rollback.

The ordered implementation remains test-first: four cache regression cases fail
with zero reviewer calls on the refreshed tree, then all 23 operation/request
tests pass with the disposition check. Broader gates, independent review and
runtime verification are still required; no delivery completion is claimed here.
Documentation impact: update the existing agent-client-governance guidance so
it no longer promises automatic approval for docs-only or low-risk changes.

## Owner review readback repair (BI-CAP-29F5787B)

The operator requested source repair after the closeout stalled because this host
cannot invoke MCP protocol `tasks/get` or `tasks/result`. Those methods already
enforce the authenticated task owner and use `readSemanticReviewRecovery`.
The initial install projected only the room's direct `taskRun` relation.
Refreshing the branch revealed PR #6423 already loads metadata-linked reviews
and projects the current source's result. Reuse that delivered repair. Its
result action still points to protocol methods this host cannot invoke, and a
historical request cannot be recovered after the branch is refreshed.

Extend the existing Workroom read, after its existing admission, with optional
`reviewTaskRunId`. Query only the authenticated user's exact requested native
semantic review whose persisted metadata binds this exact room. Reuse
`readSemanticReviewRecovery` for deadlines, digest and execution settlement.
Do not accept a caller-supplied owner or grant override; do not expose raw
provider output. Other room readers receive no owner's task recovery details.
An unavailable recovery read reports unavailable, never approval or settlement.
No schema, grant, task dispatch, retry budget or receipt writer changes are needed.

Acceptance: the admitted review owner sees the requested exact-room task and bounded
recovery without `deliberation_read`; another owner or room cannot match; anonymous
reads do not query tasks; a read failure is explicit. Cover those cases before
implementation, then run Workroom, MCP pack and review lifecycle regressions.
Preserve the original cache patch. Documentation stays in this existing design
because another live Workroom owns the shared authorization runbook.

Implementation sequence: add owner/exact-room/malformed/unavailable regressions;
observe them fail while the existing current-review controls pass; add the scoped
reader and preserve its response through the Workroom budget projection; run the
related Workroom, semantic-review lifecycle and MCP pack suites and typechecks.
Obtain independent review, a fresh exact-tree gate, and canonical rollout before
claiming the original parked task is readable. Its historical identity never
approves the refreshed source. This also covers BI-CAP-29F5787B's readback criteria;
provider settlement remains an executed-evidence requirement, not this patch's
claim. Rollback uses a revert PR and leaves original tasks and receipts intact.
