---
status: active
---
# Initiative reviewer disposition and persisted status

Backlog: BI-31159978. Workroom: WC-025847D7. Profile: fix.

## Reproduction and existing substrate

Evidence cmtpygzzn0c7c01qm9d3r3w7p records TaskRun
TR-MCP-Y210Nmg3bjg3MDBnYTAxbXhheDU2MXV2aQ-E295A8007C6E on
BI-06AE6833 / WC-27D00458. Artifact commit
7d22b24673c138036685312387a425984c7a330d, blob
511894b16063195e4bf9f6977f1f5a3fd0549693, path
docs/superpowers/specs/2026-09-03-local-first-agentic-delivery-throughput-design.md.
The writer rejects pass with findings; the second attempt cannot correct it.
Other review receipts exist although reviewer prose claims they do not.

Source base 4dcd2bc75ed (PR #5116) still has the rejection in
apps/web/lib/mcp/packs/initiative-readiness-pack.ts. Its research adapter
replaces findings and reason, while mcp-task-review-contract.ts exposes only
decision for research. terminal-tool-policy.ts removes the writer after any
attempt. mcp-task-execution.ts copies model prose into final summaries and
infers approval from input-required alone.

BI-8B8731EE owns required writer enforcement; retain its provider capability
and resource-wait behavior. BI-DE58CFE8 owns same-TaskRun recovery and bound
reader history; extend that mechanism. BI-E8237EAE owns reader budgets; do
not change those budgets here. PR #5116 owns immutable objective mapping.
WC-8FB4E4D0 owns initiative-readiness-tool-grants.ts; this work uses the shared
writer definition and bound tool schema without editing that registry.

## Canonical contract and ordered fix sequence

1. Consolidate disposition guidance and validation into the existing readiness
   module boundary. Pass requires empty findings; resolutions name existing open findings only;
   positive observations belong in reason. Findings require fail and immutable
   evidence. All research and review adapters preserve the independent author's
   assessment. Server-owned artifact identity remains bound and cannot drift.
2. Extend terminal writer policy with bounded correction for explicitly
   retryable validation failures. Feed the exact rejection back to the same
   reviewer with its successful bound reads. Preserve approval separation;
   correction is a new independent proposal, never automatic approval or
   deletion of a finding. Authority, identity, provider, and transport failures
   are not generic validation retries. Exhaustion reports the exact failure and
   recovery action on the original TaskRun and request key.
3. Consolidate completion projection from persisted writer outcomes and current
   readiness. A receipt identifies only its gate. Report remaining blockers and
   never infer implementation permission from a single passing review. Approval
   is reported only for an actual pending envelope. Apply the projection to
   stored messages, progress, immediate results, and replay.
4. Exercise regression tests, protected PR and merge-queue checks, canonical
   deployment, and the live exact-bound reviewer journey. Preserve WC-27D00458
   and its branch. Read back receipt IDs and readiness before declaring done.

About 20 percent of implementation effort belongs to shared disposition and
status consolidation. No new ledger, approval layer, or provider requirement
is introduced. Eligible external providers remain subject to actual privacy,
authority, and model constraints.

## Objectives

**OBJ-RDC-001:** Instructions, provider schemas, and canonical writers enforce
one lossless disposition contract for research and independent review.

**OBJ-RDC-002:** Validation failure permits bounded independent correction on
the same immutable review, preserving idempotency and approval separation.

**OBJ-RDC-003:** Reviewer completion reports persisted receipts and actual
readiness without invented approvals or permission to implement.

**OBJ-RDC-004:** The deployed reviewer journey proves reading, independent
assessment, receipt persistence, and the corresponding readiness advance.

| Acceptance criterion | Objective links | Observable result |
| --- | --- | --- |
| AC-RDC-001 | OBJ-RDC-001 | Empty passing receipt is accepted; pass with positive observations in findings is rejected without modifying arguments; grounded fail remains non-passing. |
| AC-RDC-002 | OBJ-RDC-001, OBJ-RDC-002 | Findings refer to successful immutable reads; unsupported or contradictory evidence requires grounded correction rather than fabricated approval. |
| AC-RDC-003 | OBJ-RDC-002 | Malformed proposal can be corrected within a fixed budget; stale identity, duplicate replay, exhausted correction, and provider failure preserve identity and return precise outcomes. |
| AC-RDC-004 | OBJ-RDC-002 | Omitted writer cannot complete a review; terminal writer and reader-history regression suites continue passing. |
| AC-RDC-005 | OBJ-RDC-003 | Persisted receipts override misleading prose; current readiness names remaining gates; only an actual pending envelope requires approval. |
| AC-RDC-006 | OBJ-RDC-004 | After deployment, live exact-artifact review persists valid receipt IDs and advances only corresponding gates; failure and recovery are read back. |

## Verification and impact

Graph-linked tests: initiative-readiness-pack.test.ts,
mcp-task-review-contract.test.ts, terminal-tool-policy.test.ts,
mcp-task-terminal-writer-context.test.ts. The graph lacks execution links, so
also run the colocated mcp-task-execution.test.ts and submission/replay suites.
Add failing behavior tests before production edits. Run style-drift guard,
pregate preflight and exact-tree pregate, then mechanical PR health and cloud
build. Live workflow verification is mandatory; no migration is planned.
Documentation impact is the reviewer-facing tool contract and recovery/status
instructions, plus this architecture record.

## Delivery boundary, risk, and rollback

One atomic BI and PR: schemas, validation, correction, and status must agree to
avoid either lossy review or false completion. The primary risk is a retry after
a successful write; persisted success and idempotency must close the writer.
Another risk is treating approval waits as recoverable validation; classify
those separately. Roll back through a revert PR and canonical self-upgrade;
never alter receipts, approval records, or the preserved Workroom branch.

## Backlog coverage

Parent and sole delivery item: BI-31159978. Coverage receipt pending canonical
recording against this immutable document and the approved scope baseline.
Implementation readiness is not claimed by this document.

## October 18 recurrence: research ordering and recorded finding correction

Status: proposed continuation under BI-31159978 / WC-23EE73CF. The original
delivery and receipts above remain historical evidence; this section does not
approve new implementation or supersede an approved baseline.

The OAuth contribution BI-B986A18B / WC-20A3E867 reproduces two remaining
contract gaps on source 233d556713d4961e7ff4d088d67a90245321493b:

- `shape-lane-escalations.ts:53` and the initiative readiness runbook request
  failing-to-passing implementation proof for author research, while
  `shape-requirements.ts` requires research before implementation admission.
  A reproduction and design choice can precede the fix; passing regression
  evidence cannot honestly be reported before that fix exists.
- Receipt `initiative-98523598-6ee0-46cd-b336-2ab9d64815e9` introduced finding
  `IF-B499C4D1D733A220` against research for a real product observability gap.
  The research itself was complete. The receipt validator permits resolutions
  of open findings but has no explicit correction of erroneous gate placement.
  Marking the defect fixed to unlock research would be false.

Current medium PLAN admission IRD-B6670530D1FB reproduces the same recovery
ordering and an unreachable stale-baseline writer for this repair itself.
Design admission IRD-6A6CDBB64E46 permits this preparation only. The exact
spec-approval recovery returns no current request; no review was dispatched.

### Proposed contract boundary

Research records the current-state reproduction, named immutable source,
problem, considered options and chosen approach. It reports failing tests and
unrun implementation honestly. Delivery retains the requirement for actual
passing regression and runtime acceptance evidence. Share the wording between
claim recovery, terminal recovery and the runbook so these surfaces cannot
reintroduce conflicting proof order.

Correct erroneous gate placement through an explicit append-only disposition,
separate from a defect resolution. Bind it to the original receipt, finding,
gate, immutable evidence and authenticated accountable author. Require a reason
and a retained destination for the still-open product defect. A wrong-gate
correction must not claim that defect fixed, erase the original failure, change
its evidence, grant implementation authority, settle an uncertain execution or
silently clear an independent reviewer's finding. A reviewer-owned finding
retains reviewer ownership. Repeated correction joins its prior recorded
effect, rather than producing another disposition.

Reject direct record edits, empty passing receipts that ignore an open finding,
and use of `resolvedFindingRefs` to conceal a still-open defect. Reuse existing
receipt/activity persistence and provenance; do not add a parallel findings
ledger. Final field names and writer authorization require governed admission
and review of this contract before implementation.

### Verification owed

Reproduce research-before-implementation without requiring a green fix first;
retain delivery's regression requirement. Exercise wrong-gate correction,
unchanged original receipt, retained open product defect, foreign-author and
reviewer-owned refusal, cross-item or stale identity, duplicate correction and
transaction failure. Confirm that unrelated findings still block passing
receipts. After canonical deployment, apply the supported correction to the
original OAuth receipt and read back both its history and current readiness.

The separate approved OAuth baseline amendment remains required. This proposal
does not replace that baseline with item-body criteria. No tests, implementation
admission, coverage receipt or live correction are claimed for this section.
