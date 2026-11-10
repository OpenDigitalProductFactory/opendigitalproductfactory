---
status: active
---

# Repair delivery-shape consistency in plan coverage

Backlog item: BI-MCP-EFF-852B5BBE. Workroom: WC-6ABDEF73.
Blocks the duplicate-plugin repair tracked by BI-024A5CDE.

## Observed defect

The live plugin Workroom is allowed to implement with delivery-break-fix@1.0.0.
The plan-coverage writer instead demands an initiative_scope_baseline and tells
the caller to reclaim implementation for a spec-approval reviewer packet. The
claim returns allowed and no spec-approval packet. The required recovery cannot
produce the prerequisite. The existing efficiency report records 19/19 failed
coverage calls; that sample is not proof of a platform-wide work stoppage.

Source grounding: apps/web/lib/planning/plan-backlog-coverage.ts unconditionally
reads the scope-baseline activity. apps/web/lib/planning/plan-coverage-recovery.ts
routes fix profiles to spec approval. The canonical shape policy in
apps/web/lib/backlog/initiative-readiness/shape-requirements.ts requires no such
baseline for break-fix or small work; medium work uses item-body acceptance.

## Intended repair

1. Add regression coverage for the contradiction across delivery shapes and
   sensitivity, including medium item-body acceptance and legacy unshaped work.
2. Derive coverage obligations from the same authoritative shape/baseline
   contract used by initiative readiness. Keep immutable plan/head/author checks,
   live backlog mappings, dependency validation and atomic rationale enforced.
3. Bind any lightweight coverage evidence to its actual scope source and detect
   changed shape or acceptance criteria when checking resumability. Preserve
   independent review and baseline requirements wherever the shape requires them.
4. Align recovery output, coverage consumers and planning instructions; never
   return a reviewer route that the selected delivery shape cannot produce.
5. Run focused planning/readiness tests, consumer and hook conformance tests,
   source checks and normal PR gates. Validate through the canonical deployment
   path before retrying the original immutable plugin plan.

## Backlog coverage

One atomic deliverable maps to BI-MCP-EFF-852B5BBE: writer, reader, recovery and
instruction consistency. Shipping only a writer change would leave readers and
agents rejecting its evidence; the parts must agree in one reversible change.
There is no coverage receipt. No initiative scope baseline exists for this item.
The original refusal has not been bypassed or reported as passed.

## Authorized one-run planning exception

Operator authorization: Mark explicitly replied "authorize the fix" after the
scoped exception was presented in this thread. This records authorization to
permit source implementation of this coverage-gate
repair before obtaining the currently unreachable plan-coverage receipt, only
for BI-MCP-EFF-852B5BBE in WC-6ABDEF73 on codex/plan-coverage-repair. The operator's explicit decision is recorded here before using the exception. This exception
authorizes only the missing pre-implementation plan-coverage receipt; it
authorizes no runtime writes or other gate bypass.

The exception would expire when this repair merges or is abandoned. The missing
pre-implementation coverage receipt must remain reported as unrun, never passed.
Tests, independent review, authorization/grant checks, DCO, PR protection, merge
queue and canonical deployment remain mandatory. Any additional refusal stops
for its own supported recovery; this exception cannot waive it.

## Risks and rollback

The main risk is admitting work with insufficient or stale scope evidence.
Negative tests must retain baseline enforcement for large, xlarge and legacy
work, sensitivity escalation, immutable artifact validation and changed scope.
Rollback is a normal revert through the merge queue; retain recorded evidence
and do not downgrade historical receipts. The previous reader rejects schema v3
as invalid, so those receipts cannot satisfy coverage after rollback. Recover
through a forward repair or supported schema-v2 recording with a valid approved
baseline; never relabel or delete recorded v3 evidence. Until deployment and functional
verification, neither this repair nor the duplicate-plugin fix is complete.

## Source verification

At commit 9c6ab90456e30c33c254b9538c46f2f565df245e, all 77 repository
preflight guards passed. Canonical integration evidence cmuqdhd000e2i01p7rjebyq5e
records 3,215 passing tests, both typechecks and clean migration application.
The production build remains delegated to the cloud merge queue.

Independent review cmuqdiivy0e6j01p733ptamq8 passed with no blocking findings.
Its follow-up exposed three failing regression tests: preserve existing approved
baseline requirements, invalidate proportional coverage when a baseline arrives,
and fail closed on malformed baseline history. All 52 focused tests now pass,
including unknown-version rejection. These follow-up edits require fresh exact
commit integration and semantic-review evidence before publication.

Consumer audit: the MCP decomposition pack calls the shared checker with the
default Prisma adapter, which includes Workroom shape lookup. External coverage
guards use that checker. The xlarge branch gate and parent inheritance remain
baseline-bound schema v2; proportional v3 does not confer parent approval.
The previous reader explicitly rejects non-v2 receipts, so rollback fails closed.
Runtime deployment and live MCP verification remain unrun.
