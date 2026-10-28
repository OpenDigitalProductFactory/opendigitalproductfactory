---
backlog: BI-AA8EE6CE
status: active
---

# Finish merged break-fix reviews

## Outcome and observed state

BI-CAP-AB63E190, BI-95BB9CB1 and BI-1CC992A5 need recorded independent
post-implementation reviews and governed completion. Live observations on
2026-10-28 show the latter two already have passing receipts from platform
review runs. Their earlier native executions remain input-required with
executionUncertainty.settlement=unknown. A different task's receipt does not
settle those historical executions or authorize their replay.

## Design grounding

Extend the existing initiative review packet, platform review room, exact-task
receipt reconciliation and canonical workforce registry. Reuse
[completion recovery](2026-09-01-completion-readiness-recovery-design.md) and
[CLI failure diagnostics](2026-10-15-reviewer-cli-failure-recovery.md). Preserve
original request identity, uncertainty and bounded retry ceilings. No new table,
tool, reviewer role or execution authority is introduced.

WWMD DI-A7009B9406C3 recommends the existing active Release Acceptance reviewer
AGT-132, rather than author self-review or another overlapping role. Add only
file_read, initiative_design_review and workroom_evidence_write to its canonical profile. Keep the
primary reviewer's existing grants and every delivery-actor exclusion.

## Ordered repair

1. Add first-failing invariants for an independent second reviewer and a failed
   exact-task run whose canonical receipt already exists.
2. Record research and immutable plan coverage for this ordered fix.
3. Provision AGT-132 through canonical seeded grants, honoring durable revocations.
   The scheduled review stage also requires record_workroom_evidence, backed by
   workroom_evidence_write. Its full grant bundle must be available on the second
   reviewer, so the scheduler can start it and record the completing stage evidence.
   Reconcile failed exact-task receipts through the existing compare-and-set
   completion writer and background scan, without another inference. Preserve
   canceled, rejected, archived and displaced executions. Failed runs with a
   safe terminal-writer checkpoint retain the existing same-task bounded replay;
   uncertain runs never acquire retry authority from a provider error or silence.
4. Run affected unit tests, package typechecks, derived-artifact and style guards,
   pregate, independent semantic review, DCO PR and protected merge queue.
5. Upgrade through the portal, verify reviewer eligibility and actual PIR receipts,
   record the earlier two task identities alongside their separately fulfilled
   review obligations without calling those original executions settled, and
   verify all three items close through the governed completion path. Check the
   wider WC-PIR queue and acceptance sweep's enabled authorization and results.

## Traceability and verification

Atomic implementation: BI-AA8EE6CE. REQ-PIR-CLOSE requires all three receipts
and closure. CONTRACT-REVIEW-INDEPENDENCE retains the independent actor check;
CONTRACT-EXACT-RECEIPT requires a receipt attributable to the exact TaskRun;
FLOW-PIR-RECOVER connects dispatch, receipt readback and governed completion.
VERIFY-PIR-RECOVERY covers first-failing grant and failed-run regressions,
negative cancellation/uncertainty cases, live grants, receipts and closure.
These are dependent steps of one closure repair, not separate product features.

Rollback removes the extra default grants and restores prior receipt scan
behavior; retained receipts and historical failures are never deleted. No schema
migration or visual interface change is required. The source change does not
claim to resolve native process settlement: unknown historical executions stay
held and their original evidence remains available.

## Live follow-up: complete the scheduled reviewer grant bundle

PR #6721 and upgrade SUR-5FADD163 deployed at 4f00cb56885b0c7e801728fdd5c2566f442a91dd.
The live preflight returned CAN-TEST. AGT-132 is active, unarchived and in_process,
and the dispatcher created WC-PIR-CAP-AB63E190 for the independent review.
The scheduled run then refused before inference: required governed tool
record_workroom_evidence was not authorized. The canonical tool registry maps it
to workroom_evidence_write; the first grant change omitted that prerequisite.

Complete the same WWMD-selected existing reviewer with that narrow grant.
First extend the seeded reviewer invariant to require the entire scheduled PIR
bundle while excluding the delivery actor; reproduce its failure before changing
the registry. Regenerate capability inventory, run DB tests/typechecks and the
governed publication gates, then self-upgrade and rerun the existing scheduled task.
Do not create another task, change room ownership, bypass the denied private author
room, relax independence, or edit live grants directly. Acceptance still requires
the genuine PIR receipt and closure of BI-CAP-AB63E190; the other two are done.

## Backlog coverage

BI-AA8EE6CE has atomic coverage receipt `cmvsjgna700km01mf55h2ykid`,
bound to this ordered design at `5a081d38986ca8aed17de484696116ecb4aa918e`.
Research receipt: `initiative-48d6d442-3585-4747-94fa-d7b84874831e`.
Implementation admission: `IRD-6C54B08185E0`, WC-9C19B12A.
The PIR-RECOVERY deliverable maps to BI-AA8EE6CE with no independent children.
