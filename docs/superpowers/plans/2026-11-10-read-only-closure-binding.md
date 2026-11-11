# Verified-existing source inquiry closure

Backlog: BI-CAP-EB412C95. Delivery workroom: WC-2A5A8FC7.
Read-only reproduction: WC-E83F6482 (preserved).
Status: design; implementation and coverage receipt pending.

## Problem and grounding

The original read_project_file failure no longer reproduces. At canonical
41afd6e6bb5bce14b3fd84068cdaac5a2e930402, both the live reader and immutable
provider reader return lines 1–6 of
apps/web/lib/inference/terminal-writer-dispatch-guard.ts, blob
2bfe744267dc2c1bdad65fee0318140f96085a37. Verification preflight returned CAN-TEST.

The source-inquiry contract in
docs/superpowers/specs/2026-10-14-worktree-provisioning-under-gpp-design.md
deliberately forbids provisioning a worktree. However,
apps/web/lib/backlog/initiative-readiness/repository-artifact.ts requires a live
capsule head to match the research artifact. The optional workroom selector in
apps/web/lib/mcp/backlog-workroom-read-source.ts also requires branch/base/head.
This prevents a read-only inquiry from satisfying research for verified-existing
closure. It is not evidence of a runtime source outage.

## Proposed repair

Extend only author-owned research binding to admit a genuine source-inquiry room
against a server-verified immutable canonical-repository blob. Reuse existing
provider reads, actor/workroom access, artifact observation and publication locks.
Do not invent a branch or head, accept caller attestation as authority, widen an
independent review lane, or change worktree provisioning. Preserve source and
manual evidence requirements in completion-evidence-policy.ts.

Kernel consultation DI-487089B3BC02 preferred this approach to requiring a delivery
worktree for every read-only inquiry, but returned low confidence with incomplete
feature coverage. It is advisory, not implementation authorization. Owner's
explicit bounded repair direction is recorded in this chat. Oversight confirmed
the exact approach remains inside that repair scope; this is task authorization,
not a fabricated kernel approval or gate pass.

## Atomic delivery sequence

All steps belong to BI-CAP-EB412C95 and form one revertible change.

1. Pin a failing regression for the actual author research route with a live
   source-inquiry room and no branch/head. Pin refusals for wrong item/repository,
   stale or changed room/actor access, blob mismatch, and non-research lanes.
2. Extend the existing artifact admission and receipt publication seams. Ensure
   the exact immutable locator and actor are rechecked under existing locks.
   Delivery-head and independent-review paths retain their current checks.
3. Exercise verified-existing completion end to end with source and manual
   evidence. Neither evidence alone nor a free-form room note may close work.
4. Run affected tests, typecheck, the required build gate and independent review.
   Publish a DCO-signed PR, then verify the same research and completion route on
   the canonical deployed revision. Update the BI only after acceptance passes.

## Acceptance and traceability

- REQ-RO-1: Legitimate read-only research binds a provider-verified immutable
  artifact without creating or claiming a write branch.
- CONTRACT-RO-1: Existing actor access, canonical repository, exact subject,
  immutable blob and transactional freshness checks remain mandatory.
- FLOW-RO-1: Source inquiry → author research receipt → source/manual evidence →
  governed verified-existing completion.
- VERIFY-RO-1: Positive end-to-end regression and stale/mismatched/unauthorized
  negative cases pass; existing delivery and independent-review tests pass.

## Risks and rollback

This touches evidence authority: a permissive fallback could authorize an
unrelated artifact or stale actor. Restrict eligibility to the explicit inquiry
shape and author research; fail closed on missing proof. Rollback is one PR
revert. No schema, new MCP tool, grant expansion, runtime upgrade, or verification
depth blocking is part of this change.

## Backlog coverage

Atomic mapping: REQ-RO-1, CONTRACT-RO-1, FLOW-RO-1 and VERIFY-RO-1 all map to
BI-CAP-EB412C95. Live coverage receipt pending immutable publication of this plan;
do not treat this document as a substitute for that receipt.
