# Recorded host-preflight omission

Status: active
Backlog: BI-7FF02040. Workroom: WC-35D6C17D.
Base: ea62f5fb890390bde854b618834f5e77fd3865ea.

## Problem and existing authority

The documented DPF_SKIP_PREGATE_PREFLIGHT_REASON is an explicit no-execution omission, not a verification pass. The current CLI sends it through runWithGuardReceipt, whose correct retained-uncertainty refusal runs before null identity is checked. As observed on the exact Workrooms597 publication, a valid operator-approved omission still fails. Original receipt/lock and child uncertainty must remain untouched.

Existing BI-10AD69D2 and mirrored BI-295A345C own abandoned-outcome reconciliation, not this no-execution CLI branch. BI-32325F52 owns effective PR-body identity, BI-D0F1D6DD moving-base identity, and BI-981F26DB/PR6758 adjacent planner/receipt changes. Read those records; no duplication or source takeover. Native scope admission is limited to scripts/pregate-preflight.mjs, scripts/pregate-preflight.test.mjs and this plan. No Workrooms implementation exists in this dependency tree.

## Ordered repair

1. Add an isolated actual CLI regression using a disposable detached Git fixture, no inherited credentials, no guard execution and no external GitHub/MCP submission. Persist the fixture's own unknown/live/unreadable host receipt and execution lock. With a nonempty explicit skip reason, require an attributable skipped/inconclusive outcome, no guard/lease/lock claim or PASS and unchanged receipt/lock bytes. Without a reason, require the existing refusal. Observe the failing old behavior before changing code.
2. In the CLI alone, route the explicit reason through existing runPreflight's no-work branch and existing outcome recorder outside guard execution/reuse admission. Normal execution continues through unchanged runWithGuardReceipt and its conservative refusal. Do not change the helper, erase evidence, disable hooks, add an alternate worktree identity to the original work or infer consent from a nonempty arbitrary environment value; the existing audited operator-skip procedure still governs real publication.
3. Run affected CLI, receipt, guard-outcome and pre-push contract tests plus proportional policy checks; freeze DCO commit and independently review exact delta. Publish only through normal gated protected delivery. Source fixtures prove this path; original Workrooms publication must separately exercise the approved omission and retain its unknown original record.

## Acceptance and coverage

- Explicit no-execution omission records its reason, skipped/inconclusive and gatePassedfalse, preserving original uncertain receipt and lock byte-for-byte.
- Empty/missing reason keeps existing unknown/live/unreadable refusal; normal execution/reuse remains unchanged.
- Actual isolated CLI and native outcome evidence, affected tests and protected delivery prove this correction without certifying the original product.

Requirement reference: recorded-omission-preserves-original.
Contract reference: runPreflight.
Flow reference: preflight-no-execution-omission.
Verification reference: isolated-preflight-cli-regression.

Atomic internal sequencing: one CLI correction, one regression and this ordered plan implement BI-7FF02040. No independent deliverable or new substrate. Coverage receipt requires immutable plan publication before implementation admission.

## Risks and rollback

A skip accidentally executing a guard, claiming a resource, mutating an old receipt or being displayed as PASS is a blocker. The fixture asserts all these boundaries, including no-reason negative controls. Rollback is a protected revert; original unknown records remain. No user command, credential, budget, access or runtime-container change.

