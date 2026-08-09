# Decision Finding Actionability Implementation Plan

**Backlog:** BI-76EEDEE8 · **Epic:** EP-0AF96937 · **Capsule:** WC-3C3830C9

**Design:** `docs/superpowers/specs/2026-07-04-decision-governance-surface-redesign-design.md` §10
**Decision:** DI-259D90CF912B — `actionability-contract`, high confidence

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time —
> one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation,
> `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and
> `dpf-pr-with-dco` for handoff.

## Outcome

The Decision Review queue contains only current, specific, human-actionable findings. A click from
the queue reaches one canonical detail workflow that explains the evidence and the achievable next
step. The shared governance-finding contract prevents future producers from attaching an action
label to a dead destination or audit-only page.

## UX fit review — decision conflict resolution

- **Decision:** fits-with-guardrails
- **Owning area:** Platform > Decision governance
- **Route family:** canonical `/coworker-decisions/review` and
  `/coworker-decisions/decisions/[interactionId]`; `/platform/ai/decisions/[interactionId]` becomes
  compatibility navigation, not a second detail dialect
- **Primary persona:** founder/operator reviewing AI governance exceptions; should not need to know
  `DecisionInteraction`, `principle_decide`, profile ids, or which route produced the record
- **Navigation layer:** contextual action only
- **Reuse/convergence:** reuse `StatusBadge`, the existing rich decision-record projection,
  `buildDecisionHelp`, and `isFounderActionable`; extend the shared `GovernanceFinding` contract
- **Source truth:** `DecisionInteraction` lifecycle + `outcomePayload` evidence; no new table
- **Empty/failure behavior:** closed/internal/blank findings remain in audit history and do not enter
  the action queue; a directly opened incomplete historical record says context was never captured
- **AI boundary:** no prompt send; human-owned mutations remain in their owning workflow
- **Evidence before merge:** query-shape tests, pure projection tests, contract tests, detail-route
  compatibility test, UX-budget measurement, desktop+narrow browser exercise, light+dark, permission
  denial, production build
- **Captured in:** this plan and `docs/ux-fit/2026-08-08-decision-finding-actionability.ux-fit.json`

## Phase 1 — Make “open” truthful

**Deliverable.** Reproduce the live seven-card defect in tests, then make the review query select
only `principleConflict=true`, `humanOutcome=DbNull`, nonblank, founder-actionable rows. Apply the
same predicate in the pure projection as defense in depth.

**Files.**

- `apps/web/app/(shell)/coworker-decisions/review/page.tsx`
- `apps/web/lib/wiki/decision-review-findings.ts`
- their focused tests

**Functional verification.** A fixture matching the six resolved rows and the unlinked blank
`DI-8BA5F423591B` shape produces zero open conflict cards; a build-linked unresolved conflict
produces one.

## Phase 2 — Converge detail and make the action honest

**Deliverable.** Route conflict findings to the canonical coworker-decision record, change the CTA
to “Review blocked decision”, preserve the compatibility route, and show an explicit missing-context audit
state on direct historical access. The next-action panel must link to Build Studio/task context when
work is waiting; otherwise it must state that the record is historical and no action is required.

**Files.**

- `apps/web/lib/wiki/decision-review-findings.ts`
- `apps/web/app/(shell)/coworker-decisions/decisions/[interactionId]/page.tsx`
- `apps/web/app/(shell)/platform/ai/decisions/[interactionId]/page.tsx`
- `apps/web/lib/wiki/decision-help.ts`
- route/component tests

**Functional verification.** The populated, build-linked fixture offers one working owning-workflow
link. The blank unlinked fixture exposes audit facts but no “resolve” action. Compatibility links
arrive at the same canonical experience.

## Phase 3 — Enforce actionability at the shared boundary

**Deliverable.** Evolve `GovernanceFinding` so detail navigation and executable action are distinct.
Add a pure validator/projector that refuses partial or non-executable action declarations. Adapt
decision-review findings and tests first; other streams keep optional detail-only navigation.

**Files.**

- `apps/web/lib/governance/finding-contract.ts`
- `apps/web/lib/governance/finding-contract.test.ts`
- decision-review adapter call sites

**Functional verification.** Contract tests prove that label-without-target, target-without-label,
blank target, and audit-only “action” fail closed, while detail-only links and complete actions
remain representable.

## Phase 4 — Make the learning durable

**Deliverable.** Add the “finding must carry an achievable outcome” rule to the platform usability
standards and shared finding contract, update decision-governance user guidance, and commit a
measured UX-fit manifest. The root instruction plane remains shrink-only; this domain rule belongs
in its owning standard and executable boundary rather than the always-on agent context.

**Files.**

- `docs/platform-usability-standards.md`
- relevant `docs/user-guide/ai-workforce/` decision guidance
- `docs/ux-fit/2026-08-08-decision-finding-actionability.ux-fit.json`

**Functional verification.** Documentation links resolve, the manifest exactly covers UI-impacting
files, and the UX budget does not regress the canonical routes.

## Phase 5 — Make one ruling clear repeated work

**Deliverable.** Keep every decision interaction in the audit ledger, but project exact repeated
WWWD asks as one work item with an occurrence count. When the owner answers, atomically attach the
ruling to every unresolved occurrence with the same profile + domain + normalized question and
record the representative interaction as provenance. Align Decision log counts to the same
`humanOutcome` disposition signal used by Review.

**Files.**

- `apps/web/lib/decision/review-identity.ts`
- `apps/web/app/(shell)/coworker-decisions/review/page.tsx`
- `apps/web/components/wiki/OrgDecisionCaptureList.tsx`
- `apps/web/lib/actions/org-decision-capture.ts`
- `apps/web/app/(shell)/coworker-decisions/decisions/page.tsx`
- `packages/db/prisma/migrations/20260808235500_backfill_decision_review_cluster_dispositions/migration.sql`
- focused tests and §10.7 of the design

**Functional verification.** Two casing/whitespace variants under the same profile and domain
render once as “2 matching asks”; one capture resolves both in a transaction; different domains or
profiles remain distinct; the audit ledger retains both rows; all awaiting-review counts exclude a
non-null `humanOutcome`. The forward migration carries an existing owner disposition to exact open
historical twins and leaves near-matches untouched.

## Backlog coverage

Decision: **atomic**. The query filter, canonical detail, repeat lifecycle, and contract guard are not independently
safe deliverables: a filter without the contract allows recurrence; a contract without lifecycle
cleanup preserves the current false queue; and route convergence without an honest action leaves
the same dead end under a different URL; clustering without atomic disposition would only hide
stale work. They ship together under BI-76EEDEE8.

Coverage receipt: `cmsl14y3u0ade01o2qdm5c6qb` · umbrella `BI-76EEDEE8` · atomic.

## Risks and rollback

- **Risk:** legitimate conflicts disappear. **Mitigation:** founder-actionability remains
  inclusion-by-contract for build/task-linked and non-internal rows; fixtures cover both sides.
- **Risk:** legacy links break. **Mitigation:** preserve the platform route as a server redirect and
  test encoded interaction ids.
- **Risk:** shared contract breaks unrelated streams. **Mitigation:** additive detail/action fields,
  adapter-local migration, focused mixed-stream tests.
- **Rollback:** revert the code. The forward data repair is intentionally not reversed: it appends
  lifecycle disposition to exact historical twins without changing sealed evidence fields or
  deleting audit rows.

## Completion gate

1. Focused Vitest suites for findings, governance contract, help, and both detail routes.
2. `pnpm --filter web build` with zero errors.
3. Shared local-CI merged-code gate before push.
4. Browser verification of `/coworker-decisions/review` and a populated/missing-context detail at
   desktop+narrow widths and light+dark themes.
5. Live-state query confirms the seven historical rows no longer project as seven open findings.
6. Documentation impact and measured UX-fit evidence committed.
7. Migration applies to a fixture with exact and near-match rows: exact twins inherit provenance;
   near-matches remain unresolved.
