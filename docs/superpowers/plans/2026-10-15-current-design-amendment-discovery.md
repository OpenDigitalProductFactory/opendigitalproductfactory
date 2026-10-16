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
3. Recheck the Workroom identity after the provider read. A changed head,
   ambiguous room/design, missing file or unavailable source yields explicit
   unavailable evidence, never a fabricated unchanged digest or permission.
4. Feed the verified content digest into `judgedDesignDigest`. Current verified
   bytes take precedence over historical receipts. Identical bytes at a new
   commit remain current; restored baseline bytes end the amendment. With an
   amendment, the existing approval/baseline requirements become stale and the
   existing independent reviewer route is issued. Failed reviews remain failed.
5. Share this server resolution across governed claims, the exact item detail
   read and completion evaluation. Do not introduce a provider request for
   every item in a bulk backlog list. Keep the pure projector free of I/O.
   Reuse one resolution across targets in an exact item read.
6. Add regressions before implementation: all historical gates pass with a new
   unreviewed design; unchanged bytes at a new commit; restoration; a failed
   approval; inherited scope; unavailable/ambiguous source; concurrent head
   change. Assert the resulting independent packet and supersession binding,
   not only a helper return value. Preserve original receipt discovery tests.
7. Run graph-related and affected suites, both web TypeScript programs and
   required guards. Obtain an independent source assessment, publish a DCO PR
   through protected CI/merge queue, then verify E27's exact amended design
   produces the existing review packet on the containing canonical release.

One PR delivers the initial amendment discovery repair. It does not implement
E27 engagement execution or change its scope baseline. It does not hold the
already publishing `v2026.10.16` release.

## Acceptance mapping

The existing first acceptance criterion (router/evaluator artifact agreement)
owns this continuation. The original large-design advisory is unchanged.
Contracts: exact-head canonical design, immutable bytes, inherited scope,
independent supersession, current identity recheck. Verification: existing
judged-design-artifact suite plus affected claim/detail/completion regressions.
No source tests or runtime acceptance have yet run for this continuation.

## Rollback and limits

Revert through the protected PR workflow. No schema migration or data rewrite.
Provider failure reports unavailable and retains the original baseline/history;
it must not authorize implementation or silently approve changed design bytes.
