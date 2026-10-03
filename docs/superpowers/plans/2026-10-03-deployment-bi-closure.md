# Deployment-based BI closure

BI-7161625D · WC-153F9F71 · 2026-10-03

## Objective and design grounding

Implement the operator's 2026-10-03 direction: close deployed platform delivery without declaring unrun acceptance successful, and prepare safe cleanup. Extend [the canonical closeout design](../specs/2026-09-04-delivery-closeout-cost-efficiency-design.md). Reuse `completeBacklogItemTransition`, its serializable authorization/readiness transaction, `SelfUpgradeRun`, canonical deployed identity, Git delivery observation, existing activity evidence, and `fileAcceptanceMiss`. Preserve the existing direct-platform boundary: platform/common scope, no build, product or product objective. Customer acceptance contracts remain unchanged.

## Acceptance

- AC-DEP-1: A platform BI whose merged pull request is proven included in a successful canonical deployment can close without the original author, session, or worktree.
- AC-DEP-2: Deployment closure records its deployment identity and closure basis; pending or failed acceptance is never recorded as passed.
- AC-DEP-3: Missing, unavailable, mismatched, or unmerged deployment evidence cannot authorize deployment closure; authorization and conflicting or malformed scope evidence still block.
- AC-DEP-4: Repeated completion is idempotent, and a later acceptance miss can file a corrective BI while the delivered original remains closed.
- AC-DEP-5: The cleanup report preserves live, dirty, pinned, unmerged, and unknown-ownership worktrees and performs no deletion without approval of concrete candidates.

## Atomic sequence

1. Resolve concrete scope/test impact before implementation. The initial directory claim returned unresolved impact, so no exemptions are inferred. Run gate context and the affected backlog/readiness test suites and package typecheck, all applicable guards, and governed runtime verification. Extend the canonical design and policy documentation together.
2. Add a server-owned deployment resolver in the existing readiness directory. Match the canonical served identity to a successful non-dry-run SelfUpgradeRun and prove the BI's bound repository/merged PR is included in that run's immutable upstream target. Unknown Git or runtime identity remains unavailable. Use immutable deployed lineage rather than moving origin/main. Do not depend on the original worktree.
3. Feed deployment facts into the existing terminal transition. Preserve authorization, classification, actual conflict and malformed scope blockers. Record a distinct deployment closure basis and original acceptance state in the status activity. Acceptance is not applicable to delivery closure; do not synthesize a passing acceptance receipt. Keep existing accepted-completion behavior available.
4. Extend acceptance-miss routing to deployed-closed originals while retaining their terminal status and existing deduplication. Retain independent verification obligations in durable activity evidence; closure never deletes evidence or source history.
5. Run focused tests, package typecheck, diff guards and canonical runtime checks through normal delivery gates. Publish a DCO-signed ready PR. Prepare cleanup inventory, then obtain approval only for concrete safe deletion candidates. No bulk done update or live deletion in this implementation.

## Verification contract

VER-DEP-1: Included merged PR plus matching canonical successful deployment closes through the governed transaction with pending acceptance explicitly preserved; no author worktree required.
VER-DEP-2: Missing/failed/dry-run deployment, served-identity mismatch, foreign repository, unmerged PR, unavailable ancestry and later undeployed changes cannot satisfy deployment closure.
VER-DEP-3: Authorization, conflicting/malformed baseline and customer/product boundary remain enforced. Repeated completion creates no duplicate status activity; acceptance failure creates/reuses corrective work without reopening the original.
VER-DEP-4: Existing completion/readiness and acceptance-miss tests pass; affected package typecheck and applicable gate-context guards pass. Runtime-bound checks must be run on governed served target or reported unrun.
VER-DEP-5: Janitor dry-run leaves dirty, pinned, live, unmerged and unknown-ownership trees intact. No live cleanup is authorized by this plan.

## Risks and rollback

Misidentifying repository, PR or deployed lineage could close undelivered work; reject uncertain or mismatched evidence. Acceptance consumers must not infer accepted from done alone when the status activity states deployment closure. Keep the closure basis visible in audit/resolution. Revert the change through a PR to restore prior closure eligibility; preserve historical deployment receipts and corrective BIs. No schema migration or new lifecycle enum is needed.

## Cleanup observation

The 2026-10-03 dry-run inspected 348 worktrees: 336 KEEP, 9 SKIP, 3 PINNED, zero approved removals. Ownership discovery returned no workroom list, so all otherwise-eligible trees remain protected. Raw report: `/tmp/dpf-closure-worktree-audit.json` on the operator host. These counts do not establish that all trees are orphaned. The live backlog had 667 awaiting-acceptance items; deployment eligibility has not been measured for that cohort.

## Backlog coverage

Atomic deliverable DEP-CLOSURE maps to BI-7161625D. Steps are internal sequencing of one delivery/acceptance contract change; the proof resolver without its governed consumer or the consumer without honest acceptance handling is not independently shippable. Requirement references AC-DEP-1, AC-DEP-2, AC-DEP-3, AC-DEP-4, AC-DEP-5; contract reference CONTRACT-DEP-CLOSURE (canonical proof plus governed terminal transaction); flow reference FLOW-DEP-CLOSURE (deployed proof → delivery close → independent acceptance/corrective work); verification references VER-DEP-1 through VER-DEP-5. Live immutable plan coverage receipt `cmusy7b0680ag01jzbybc7bl8` accepted the atomic plan for BI-7161625D at commit `df5fd46805183c4d13f545353988f25b6c889cff`; implementation admission `IRD-1711D0C4BFD0` was allowed. No independent deliverables or dependencies.

## Historical criterion retained by the item parser

The item retains its September operator decision as history. The current parser treats the following numbered historical sentence as a criterion because it begins with “Acceptance”. It is quoted here for exact coverage; the status already exists and this phase adds no enum:

> is an extra `BacklogItem.status`.** Closed enum today: `triaging | open | in-progress | done | deferred | retired` (`apps/web/lib/backlog/transitions.ts`). Add a first-class status (working name `awaiting-acceptance`) so delivered work is not `open` and is not yet `done`. Widening the enum is a Prisma migration plus the generated TypeScript union in the same change — not a free-form string.
