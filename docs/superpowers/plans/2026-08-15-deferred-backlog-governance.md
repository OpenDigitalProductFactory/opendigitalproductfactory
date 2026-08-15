# Deferred Backlog Governance Implementation Plan

**Umbrella BI:** `BI-59F6ED17`  
**Operational successor:** `BI-E84CC4A6`  
**Epic:** `EP-DELIVERY-FLOW`  
**Architecture decisions:** `DI-03B7564E648A`, `DI-6FA2FA858D95`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

## Outcome

Separate terminal retired records from still-wanted deferred work, then make `deferred` a governed, queryable decision instead of an indefinite parking state. A retained deferred item must answer:

- why it is not actionable now;
- who is accountable for the next decision;
- what observable condition allows it to resume; and
- when it must be reviewed even if that condition has not occurred.

After the contract is deployed, review the 230 rows that were deferred at campaign start and give every row an evidence-backed disposition.

## Grounding and overlap

- `BacklogItem` is the canonical demand record (`packages/db/prisma/schema.prisma`). It currently carries `status`, `triageOutcome`, accountability, resolution, duplicate linkage, and activity history, but no active deferral projection.
- `BacklogItemActivity` already provides the transition history and actor attribution. A second history table would duplicate this contract.
- `update_backlog_item_status` currently accepts `status=deferred` without a reason and returns early for same-status calls, so legacy rows cannot be reviewed in place.
- Live PostgreSQL evidence shows the lifecycle is overloaded: of 230 `status=deferred` rows, 105 have `triageOutcome=discard` and 55 have `triageOutcome=duplicate`. Those 160 rows are terminal records, not deferred demand.
- `/ops` currently tells operators that deferred work has no automatic resume date (`apps/web/components/ops/BacklogItemRow.tsx`).
- Work-management room cycles already use `nextReviewAt`, but those records govern execution rooms rather than the canonical product backlog. Reusing the concept does not mean joining the two lifecycles.
- No live BI, open PR, spec, plan, or code-graph result already implements governed BacklogItem deferral metadata. The existing `EP-DELIVERY-FLOW` is the correct parent program.

## Architecture decision

WWMD considered three shapes:

1. active fields on `BacklogItem` plus `BacklogItemActivity` history;
2. a parallel `BacklogDeferral` child ledger; and
3. activity JSON only.

`principle_decide` selected option 1 with high confidence (composite `15.338`, margin `0.393`, no commandment conflict). The strongest contributors were Research and Use Standards and Worktree-Is-Source-Control-Not-Runtime; the shape also preserves the single source of truth and avoids a second event ledger.

A second consultation (`DI-6FA2FA858D95`) considered whether terminal duplicate/discard rows should remain overloaded onto `deferred`, map to `done`, or gain an honest `retired` status. It selected `retired` with high confidence (composite `15.270`, margin `8.704`, no commandment conflict). `done` remains reserved for completed outcomes; `retired` means intentionally removed from executable demand while its evidence remains queryable.

The active projection will use:

- `deferReason String?`
- `deferTrigger String?`
- `deferReviewAt DateTime?`
- `deferOwnerPrincipalId String?` related to canonical `Principal`
- `deferredAt DateTime?`

All fields remain nullable at the database layer for forward migration of historical rows. Application invariants require all five for new or reviewed deferred decisions. Nulls on legacy deferred rows mean **nonconformant and awaiting review**, never inferred or fabricated.

## Standards and benchmarking

- The Scrum Guide makes backlog transparency and continuous refinement prerequisites for sound decisions. Adopt: deferred work stays visible and inspectable. Reject: treating a low-ordered item as sufficient explanation for indefinite parking.
- The Kanban Guide requires explicit workflow policies and active management of ageing items. Adopt: an explicit deferral policy, review horizon, and overdue signal. Reject: a hidden queue with no ageing control.
- PMI defines refinement as progressive elaboration and reprioritization. Adopt: review may reactivate, retain, or retire; it is not a ceremonial timestamp refresh.

## Phase 1 — Define and enforce the active deferral projection (`BI-59F6ED17`)

**Independently shippable:** yes.

1. Add `retired` to the canonical BacklogItem status union and every validated mirror.
2. Add the five nullable fields, the named Principal relation, reverse relation, and indexes for status/review and owner/status.
3. Add a forward-only migration that adds fields and foreign key, moves existing `duplicate`/`discard` outcomes from `deferred` to `retired`, and does not invent values for still-wanted legacy rows.
4. Add a pure deferral-contract validator and closed request shape shared by MCP and server-action paths.
5. Extend `update_backlog_item_status`:
   - transition to `deferred` requires a complete deferral object;
   - same-status `deferred` updates review the active projection and emit an activity;
   - transitions away from `deferred` clear the active projection while retaining history;
   - actor principal resolution uses the existing Principal convergence helpers;
   - duplicate/discard retirement writes `retired` and clears active deferral fields, while a retained defer requires the contract.
6. Return the projection from `list_backlog_items`, `query_backlog`, `get_backlog_item`, and identity-scoped backlog reads. Add filters for `deferralConformance` and `deferralReviewDueBefore` rather than forcing N+1 reads.
7. Update MCP definitions, descriptions, validation, tests, and grant parity.

**Primary files:**

- `packages/db/prisma/schema.prisma`
- `packages/db/prisma/migrations/20260815*_govern_backlog_deferrals/migration.sql`
- `apps/web/lib/backlog/deferral-contract.ts`
- `apps/web/lib/backlog/transitions.ts`
- `apps/web/lib/mcp/packs/backlog-status-tool-definition.ts`
- `apps/web/lib/mcp/packs/backlog-pack-definitions.ts`
- `apps/web/lib/mcp/packs/backlog-pack.ts`
- focused MCP/backlog tests

**Verification:** validator red/green tests; MCP transition tests covering incomplete, complete, same-state review, reactivation, retirement, and legacy nonconformance; Prisma generation; migration apply against a DB containing deferred legacy rows; post-migration assertions prove duplicate/discard rows are `retired` and still-wanted rows remain `deferred`.

## Phase 2 — Make the debt legible in `/ops` (`BI-59F6ED17`)

**Independently shippable:** no; it is the operator surface of Phase 1 and must ship in the same PR so the new invariant is usable.

1. Extend backlog types/loaders with the deferral projection and owner display name.
2. When an operator chooses `deferred`, reveal required reason, trigger, owner, and review-date controls.
3. Show concise `why · trigger · owner · review` information on deferred rows.
4. Give retired records a separate terminal lens and visibly distinguish compliant, review-due, overdue, and legacy-incomplete deferrals.
5. Replace the current “someone reopens it; no automatic resume date” copy with the governed contract.
6. Use existing theme tokens and shared report/status primitives; do not add a parallel dashboard.

**Primary files:**

- `apps/web/lib/explore/backlog.ts`
- `apps/web/lib/explore/backlog-data.ts`
- `apps/web/lib/actions/backlog.ts`
- `apps/web/components/ops/BacklogPanel.tsx`
- `apps/web/components/ops/BacklogItemRow.tsx`
- focused component/action tests and UX-fit evidence

**Verification:** server-render and interaction tests; production build; `/ops` functional path with a seeded administrator: defer an item, inspect it, review it in place, reactivate it, and confirm the active projection clears.

## Phase 3 — Reconcile the 230-item legacy pool (`BI-E84CC4A6`)

**Independently shippable:** yes; blocked by deployed Phases 1–2.

1. Freeze the starting manifest of 230 semantic BI IDs and hashes of the evidence used for review.
2. Cluster exact and semantic duplicates, especially repeated automated PIR fingerprints.
3. Treat the migration of the 160 already-classified duplicate/discard records as a mechanically verified terminal-state correction, then inspect every still-wanted or unclassified record's full body/activity, duplicate linkage, epic/spec/plan, current main, open PRs, current live runtime, and any named dependency.
4. Apply exactly one disposition:
   - **reactivate** when the work remains valid and its blocker is already cleared;
   - **retain deferred** only with owner, reason, objective trigger, and review date;
   - **retire duplicate/superseded** with canonical linkage and preserved occurrence evidence; or
   - **discard** when evidence shows it is invalid, obsolete, or merely a fixture.
5. Review retained items in bounded cohorts, with the review date based on the actual trigger class rather than one arbitrary bulk date.
6. Re-query live state and publish a reconciliation summary proving all 230 starting IDs are accounted for exactly once.

### Evidence-backed starting disposition ledger

The read-only audit of all 230 starting rows produced a complete, mutually
exclusive disposition before mutation:

| Disposition | Count | Rows / rule |
|---|---:|---|
| Retire | 209 | 160 already-triaged duplicates/discards; 10 obsolete/superseded/container/noise rows; 3 build-failure or stale-signal artifacts; all 36 reviewed Hive Scout proposals |
| Mark done from verified existing evidence | 5 | `BI-9DFAFB4A`, `BI-CAP-953AF920`, `BI-0EEBA669`, `BI-3EC7FDB0`, `BI-5457E216` |
| Retain deferred with the complete contract | 11 | `BI-1C070099`, `BI-06B66FFD`, `BI-5A3C14C1`, `BI-5FB59BC6`, `BI-A2D9A618`, `BI-B7F47740`, `BI-D2E3F2FD`, `BI-D43D3D76`, `BI-1E03B447`, `BI-28E5CBBD`, `BI-B459B303` |
| Reactivate as open buildable demand | 5 | `BI-53D7E70C`, `BI-5743D81F`, `BI-8CC1CA25`, `BI-IMP-10B49FEA`, `BI-IMP-615553AD` |

`209 + 5 + 11 + 5 = 230`; no starting row is omitted or counted twice.

The Hive Scout proposals are safe to retire from executable demand because the
source record and provenance already live independently in canonical
`RawSource` plus `BacklogItemActivity`. A future demand signal may create or
reactivate a real scoped BI from that evidence. Two source-URL aliases already
produce duplicate proposal titles (`Virtual AI Tutor`, `Automated Trading Bot`),
which is further evidence that source discovery is not itself committed demand.

The 11 retained deferrals use trigger-specific review horizons rather than a
single bulk date: sequenced program slices review at the predecessor gate;
external blockers review on upstream evidence plus a quarterly safety check;
demand-gated research reviews on a concrete demand signal plus a six-month
portfolio check; and architecture-spine dependencies review when the named epic
lands plus a quarterly check. The accountable owner is the Principal responsible
for the receiving epic or portfolio decision, never a free-text label.

The five reactivated rows are current, scoped gaps. The dev-portal Prisma/Turbopack
fix hypothesized in `BI-53D7E70C` is still absent from `next.config.mjs` and the
import path, so the parent epic's terminal status is not evidence that the bug
was fixed. The healthcare intake page
has a queue but no evidence decision UX; marketing has the campaign rollup but
only the LinkedIn Ads adapter implements `fetchEngagement`; and both reference
documentation gaps remain absent from their canonical documents.

**Verification:** manifest cardinality and uniqueness checks; MCP success receipts for every mutation; zero deferred rows missing the active contract; duplicate rows have canonical linkage; live counts reconcile to the disposition ledger.

Starting snapshot: `docs/superpowers/audits/2026-08-15-deferred-backlog-starting-manifest.json`. It freezes all 230 semantic IDs, canonical evidence hashes, starting lifecycle fields, sources, and mutually exclusive proposed dispositions from a read-only canonical-runtime query.

## Backlog coverage

Coverage receipt: `cmsuougkm1of501ppea50twfr`

| Deliverable | BI | Dependency |
|---|---|---|
| Enforced deferral projection, MCP/query contract, migration, and `/ops` UX | `BI-59F6ED17` | none |
| Evidence-based review and disposition of the starting 230 deferred rows | `BI-E84CC4A6` | `BI-59F6ED17` deployed |

Decision: `decomposed` because the platform contract and the operational reconciliation are independently verifiable and have different rollback boundaries.

## UX fit review - governed backlog deferrals

- **Decision:** fits-with-guardrails
- **Owning area:** Platform
- **Route family:** existing `/ops` backlog panel and rows; no new route, dashboard, or navigation home
- **Primary persona:** contributor/platform operator deciding whether demand is actionable without remembering why it was parked
- **Navigation layer touched:** contextual form fields and row evidence only
- **Reuse/convergence:** the existing BacklogPanel remains the editor; new fields compose the shared form primitives, lifecycle colour uses the central report-kit status registry, and `LocalTime` remains the timestamp renderer
- **Source truth:** canonical `BacklogItem` active projection plus immutable `BacklogItemActivity` history
- **Empty/failure behavior:** legacy incomplete deferrals are named as needing review; invalid or unresolved owner data is rejected rather than inferred; save errors remain visibly announced
- **AI boundary:** no prompt send; the controls only submit the explicit operator lifecycle decision
- **Required guardrails:** keep retirement behind the governed evidence action, keep parked work visible and epic-blocking, use theme tokens, and avoid a second backlog surface
- **Evidence before merge:** component interaction tests, prose/style ratchets, measured `/ops` UX-budget sweep, administrator happy-path and failure-path browser exercise, light/dark visual inspection, and the production build
- **Captured in:** this plan and `docs/ux-fit/2026-08-15-governed-backlog-deferrals.ux-fit.json`

## Risks and rollback

- **Legacy compatibility:** nullable columns prevent migration failure; still-wanted legacy rows remain explicitly incomplete until reviewed. The `retired` backfill is limited to rows whose existing triage outcome already proves duplicate/discard intent.
- **Owner resolution:** reject unresolved principals instead of storing display strings or user IDs in the Principal foreign key.
- **Automation breakage:** all writers that create `deferred` rows must adopt the contract or intentionally retire as duplicate/discard. Tests enumerate the writers.
- **Bulk-review mistakes:** mutate in small cohorts, preserve a before-manifest, and record MCP receipts. Do not directly update PostgreSQL.
- **Rollback:** revert application enforcement first if a writer was missed; nullable columns can remain harmlessly. Never roll the migration backward or erase activity/history. Data dispositions are individually reversible through governed lifecycle transitions, except discard/duplicate evidence remains preserved.

## Completion gate

- Focused unit and integration tests pass.
- `pnpm --filter web build` passes.
- Migration applies against non-empty legacy state.
- UX-fit and functional `/ops` workflow pass in the governed shared environment.
- PR health is green and the merge is in the canonical served lineage.
- The post-deployment reconciliation proves every starting deferred ID has one evidence-backed disposition and no retained deferral is unattributed or horizonless.
