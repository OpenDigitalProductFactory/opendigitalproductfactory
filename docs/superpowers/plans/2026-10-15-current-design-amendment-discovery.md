---
status: active
---

# Discover a changed design before another review receipt

Backlog: BI-4592CF69. Existing Workroom: WC-2A0FAF55.

## Problem and design grounding

PR #6397 merged as `378995d5294283f02bb982230334d20b0e659507`.
Its shared `judgedDesignDigest` recognizes a changed canonical design only
after a newer design-bound receipt arrives. BI-E27F3600 demonstrates the missing
initial transition: every old gate passes, no reviewer packet is issued, and
the independent writer refuses a receipt without that packet.

Extend the existing initiative readiness design, section 8.4, in
`docs/superpowers/specs/2026-08-08-initiative-readiness-and-goal-completion-reconciliation-design.md`.
Reuse canonical artifact discovery, the immutable repository blob reader,
the existing pure projector and independent baseline supersession writer.
No new gate, receipt kind, authority tier or baseline mutation is needed.

## Atomic repair

1. Resolve the subject's own valid current baseline and live Workroom identity
   through existing server readers. Inherited parent scope is never amended
   by the child. Document/build baselines keep their existing behavior.
2. For a repository design baseline, discover the canonical design at the
   recorded immutable head and verify its bytes using the canonical repository
   reader. Use the existing declared design selection; do not accept a caller
   digest or infer a change from the commit SHA alone. When the canonical path
   remains the baseline path, read that exact path at the new head.
3. Recheck the Workroom identity, baseline chain head and canonical design
   selection/subject binding after the provider read. Baseline supersession or
   selection can change while the source head stays the same. Compare semantic
   identities in the existing admission/completion transaction; use the existing
   stale-evidence/CAS refusal, not volatile heartbeat timestamps. A changed
   binding, ambiguous room/design, missing file or unavailable source yields
   explicit unavailable evidence, never an unchanged digest or permission.
   Acquire the subject/guard locks before loading claim gate facts, so a
   concurrently committed failed review cannot be hidden by an earlier read.
   A provider comparison at its 300-file cap is incomplete, even when it shows
   zero or one design; never treat it as absence or select its visible design.
4. Feed the verified content digest into `judgedDesignDigest`. Current verified
   input has three explicit states: verified, not-applicable and unavailable.
   Unavailable own-repository evidence cannot fall back to old all-pass receipts
   and cannot issue a reviewer packet or dispatch. Verified current design
   bytes take precedence over historical receipts. Identical bytes at a new
   commit remain current; restored baseline bytes end the amendment. With an
   amendment, the existing approval/baseline requirements become stale and the
   existing independent reviewer route is issued. Failed reviews remain failed.
5. Share this server resolution across governed claims, the exact item detail
   read and completion evaluation. Do not introduce a provider request for
   every item in a bulk backlog list. Keep the pure projector free of I/O.
   Reuse one resolution across targets in an exact item read. Retain the shared
   reader's 1 MiB bound and bounded transport. Bulk projections must identify
   recorded evidence as not verified against the current head.
6. Add regressions before implementation: all historical gates pass with a new
   unreviewed design; unchanged bytes at a new commit; restoration; a failed
   approval; inherited scope; unavailable/ambiguous source; concurrent head
   change; unchanged-head concurrent baseline/selection change; unavailable
   source across claim/detail/completion with no issued packet. Assert one
   resolution shared across targets, the resulting independent packet and supersession binding,
   not only a helper return value. Preserve original receipt discovery tests.
7. Run graph-related and affected suites, both web TypeScript programs and
   required guards. Obtain an independent source assessment, publish a DCO PR
   through protected CI/merge queue, then verify E27's exact amended design
   produces the existing review packet on the containing canonical release.

One PR delivers the initial amendment discovery repair. It does not implement
E27 engagement execution or change its scope baseline. It does not hold the
already publishing `v2026.10.16` release.

## Acceptance mapping

The existing medium acceptance criteria, quoted from the live item, are:

- reviewerRoutes and readiness evaluation name the same artifact for every gate: either routes target the baselined artifact, or a manifest-identical spec change re-binds the baseline artifact, with a regression test for the shortened-spec case.
- A design whose size exceeds the terminal-writer recovery cap is reported to the author when its design-spec review is requested (or the cap scales to the reviewed artifact), instead of surfacing only as a terminal_writer_context_oversize resume failure.

The recorded design note already requires independent approval to re-bind the
baseline. This repair preserves that rule; it never silently re-binds a baseline
after a text change. The first criterion owns this continuation. The existing
large-design advisory remains intact and its regression remains in validation.

Atomic deliverable `initial-design-amendment-discovery` maps to BI-4592CF69.
Requirement reference: `AC-route-evaluation-agreement` (the first criterion).
Contracts: `exact-head-canonical-design`, `immutable-bytes`, `inherited-scope`,
`independent-supersession`, `current-identity-recheck`.
Flows: `governed-claim`, `exact-item-read`, `completion-evaluation`.
Verification: `judged-design-artifact.test.ts` and
`affected-claim-detail-completion-regressions`, plus the existing size notice test.
No source tests or runtime acceptance have yet run for this continuation.

## Rollback and limits

Revert through the protected PR workflow. No schema migration or data rewrite.
Provider failure reports unavailable and retains the original baseline/history;
it must not authorize implementation or silently approve changed design bytes.

## Current packet identity correction (2026-10-16)

BI-C684AF45 exposed another issuer/admission disagreement after a substantive
design amendment. A fresh design, spec-approval or architecture request was
issued without the reviewer suffix used by the admission resolver. Admission
therefore rejected the server's own unchanged packet. Existing owned legacy
tasks masked the defect because history resolution retained their original key.

Continue the same route-agreement acceptance criterion in WC-2A0FAF55. Preserve
PR #6430 and its pending live acceptance. Reuse the existing design-phase
selector and trusted OAuth task-family resolver in the governed claim and the
bounded item-read issuer for all four independent design gates. Keep exact
packet comparison, room admission, grant checks and document preflight intact.
Do not accept a caller-supplied task-family key, reset attempts, replace uncertain
work or approve the author's design.

Regressions first: pass an actual bounded item-read packet unchanged to the
actual admission function for each gate; reject altered keys and revoked task
authority; preserve an owned uncertain legacy design request byte for byte.
Exercise the normal pre-plan claim with no plan-review obligation as well.
Run the affected review/claim suites and both web TypeScript programs, obtain
independent source assessment, publish through protected CI and the merge queue,
then verify the original request only after a containing canonical deployment.
