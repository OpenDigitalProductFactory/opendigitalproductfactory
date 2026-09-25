---
status: active
---

# Plan: portfolio budgets, investment-weighted WIP, and capacity tie-out

**Design:** [2026-09-24-portfolio-budget-and-investment-wip-design.md](../specs/2026-09-24-portfolio-budget-and-investment-wip-design.md)
**Epic:** `EP-PORTFOLIO-BUDGET-WIP`. **Umbrella item:** `BI-EA3859C9`.
**Branch base:** `main`

> **For agentic workers:** execute this plan one independently reviewable backlog item at a time — one BI, one branch, one PR. Use `dpf-tdd` for red-green implementation, `dpf-local-merge-ci-before-push` plus the plan's completion gate before any success claim, and `dpf-pr-with-dco` for handoff.

The design's four decisions (points with an optional $ rate, quarterly periods,
proposals from last quarter's delivered mix, hard stop for autonomous starts and a
warning for human ones) were accepted by the founder on 2026-09-24. This plan does
not reopen them.

## Backlog coverage

| # | Item | Scope | Design | Depends on |
|---|---|---|---|---|
| 1 | BI-298A7202 | Points and portfolio resolvers; read model with unallocated and unsized rows | §5.1–5.2 | — (merged #5668) |
| 2 | BI-A73A7DA3 | Epic-to-portfolio proposal per epic, confirmed by a person | §5.2 | 1 (merged #5674; its operator control moved to slice 5) |
| 3 | BI-9EC60FE0 | `PortfolioBudgetPeriod`, `set_portfolio_budget`, `propose_portfolio_budgets` | §5.3 | 1 |
| 4 | BI-EF265C9A | `BudgetReservation` written by `approve_demand_for_funding` | §5.4 | 1, 3 |
| 5 | BI-CBF5D708 | Throughput capacity range and the tie-out surface with traced share | §5.5, §5.7, §6 | 1, 3, 4 |
| 6 | BI-3430B3A4 | Admission by points in flight at every start, tee-up included | §5.6 | 1, 3 (5 for the Little's-Law default; 8-point floor until then) |
| 7 | BI-0CA5DA2B | AI tokens, spend and latency beside points | §5.7 | 5 |

### Traceability

Objectives and acceptance ids are the design's §9 baseline.

| Slice | Objective | Acceptance | Contract | Flow |
|---|---|---|---|---|
| 1 | OBJ-BUDGET-1 | AC-BUDGET-1 | design §5.1, design §5.2 | Slice 1 |
| 2 | OBJ-BUDGET-1 | AC-BUDGET-2 | design §5.2 | Slice 2 |
| 3 | OBJ-BUDGET-2 | AC-BUDGET-3 | design §5.3 | Slice 3 |
| 4 | OBJ-BUDGET-2 | AC-BUDGET-4 | design §5.4 | Slice 4 |
| 5 | OBJ-BUDGET-3 | AC-BUDGET-5 | design §5.5, design §5.7, design §6 | Slice 5 |
| 6 | OBJ-BUDGET-4 | AC-BUDGET-6 | design §5.6 | Slice 6 |
| 7 | OBJ-BUDGET-5 | AC-BUDGET-7 | design §5.7 | Slice 7 |

Every design section maps to a slice. Every slice is independently shippable and
ends at something observable on this install. The coverage receipt is recorded
against `BI-EA3859C9` with `record_plan_backlog_coverage` once this file is
committed, and its id is added here.

## Substrate this plan reuses

Grounded in the source on 2026-09-24. Paths are relative to `apps/web/` unless
they start with `packages/`.

| Need | Reuse | Where |
|---|---|---|
| Points scale | `EFFORT_SIZE_TO_JOB_SIZE`, `resolveJobSize` | `lib/demand/scoring.ts:20-25`, `:85` |
| Agreed estimate | `estimateAgreed`; the estimate write door mirrors `effectiveJobSize` into `jobSize` | `lib/demand/estimate-provenance.ts:15-16`, `:88` |
| Portfolio attribution | `resolveBacklogPortfolio`, `attributeBacklogPortfolio`, `getBacklogByPortfolio` (no callers today) | `packages/db/src/backlog-portfolio.ts:25`, `:65`, `:108` |
| Epic attribution table | `EpicPortfolio` (`epicId`, `portfolioId` only) | `packages/db/prisma/schema/work-coordination.prisma:566` |
| Annual $ figure | `Portfolio.budgetKUsd` and its provenance label | `product-portfolio.prisma:9`, `lib/portfolio/budget-provenance.ts` |
| Provenance labels ("no budget set", "estimated") | `ProvenancedMetric` | `lib/surface-data-provenance` |
| Funding decision | `approveDemandForFundingHandler` | `lib/mcp/packs/demand-scoring-administration.ts:253-438` |
| WIP rule today | `decideUnifiedWip`, `BUILD_WIP_CAP`, `WIP_POOL_CAPACITY` | `lib/build/wip-cap.ts:40`, `:110`, `:149` |
| Tee-up start | `runGovernedBacklogTeeUp`, start at `:697-719`, reasons in `BuildActivity` | `lib/governed-backlog-tee-up.ts:625` |
| Percentiles | `percentile` | `lib/queue/flow-metrics.ts:129` |
| AI spend | `BuildPhaseRun`, `AgentBudgetEvent`, `TokenUsage`; billing mode on `AiProviderFinanceProfile.valuationMethod` | `build-delivery.prisma:985`, `ai-coworker.prisma:718`, `ai-providers.prisma:208`, `:532` |
| Investment mix | `computeBucketMix`, `bucketBalance`, `BalanceView` on Ops > Demand | `lib/demand/buckets.ts:66`, `:102`; `components/ops/DemandBoard.tsx:653` |
| MCP tool registration | pack definitions + handlers + grants; `TOOL_TO_GRANTS` | `lib/mcp/packs/demand-scoring-pack.ts`, `lib/tak/agent-grants.ts:162` |

Two facts from the grounding change the slices slightly, without changing the design:

- **A portfolio resolver already exists.** Slice 1 extends `resolveBacklogPortfolio`
  to return the path it used. It does not add a second resolver. The existing
  precedence also has a coworker-need path (a capability need's agent portfolio)
  between taxonomy and epic; it stays, as path 3b. `BacklogItem.portfolioId` is
  both an explicit override (`update_backlog_item` with `portfolioSlug`) and a
  cache that the resolver writes back. The read model therefore reports it as
  path `stored`, and a test asserts that the stored value never disagrees with a
  link without saying so.
- **The 2026-09-15 allocation board has no code yet.** Slice 5's UX-Fit decision
  weighs Ops > Demand and the portfolio page as the built candidates, and the
  allocation board as a future host.

## Slice 1 — BI-298A7202 · resolvers and the read model

No new tables.

1. **Red.** Add `packages/db/src/backlog-portfolio.test.ts` cases for
   `resolveBacklogPortfolioWithPath(links)`. It returns `{ portfolioId, path }`,
   where `path` is one of `stored | digital-product | taxonomy-node |
   coworker-need | epic | unallocated`. Include one case for each path, and each
   precedence pair. `resolveBacklogPortfolio` keeps its signature and delegates to
   it, so its existing callers are unchanged.
2. **Red.** Add `lib/portfolio/investment-points.test.ts` for
   `resolveInvestmentPoints(item)`, which returns `{ points, source }`:
   - agreed estimate (`estimateAgreed` and `jobSize > 0`) → `agreed`;
   - otherwise `resolveJobSize` (`jobSize`, then `effortSize`) → `estimate` or
     `size-default`;
   - otherwise `unsized` with `points: null`. It is never guessed.
3. **Green.** Implement both. Points live in `apps/web/lib/portfolio/`, beside
   `budget-provenance.ts`.
4. **Read model.** `lib/portfolio/investment-read-model.ts` provides
   `loadPortfolioInvestment({ db, now })`. It reads live items (every status except
   `done` and `retired`) plus items done in the current quarter, with the link
   select from `backlog-portfolio.ts`. It returns:
   - one row per portfolio with points by class: `ready` (triaging, open,
     deferred, blocked), `inFlight` (in-progress, awaiting-acceptance, or an
     active build) and `deliveredThisQuarter`;
   - an `unallocated` row;
   - an `unsized` count per row (items with no points, never added as zero);
   - the path mix per row, so the epic-path share is visible before slice 2.

   The quarter bounds are a pure helper, `quarterBounds(now)`, in UTC, and they
   are shared by slices 3 and 5.
5. **Postgres test.** `lib/portfolio/investment-read-model.postgres.test.ts` runs
   read-only against `DPF_SQL_TEST_DATABASE_URL`, following
   `lib/attention/sources/workroom-stall.postgres.test.ts`. It is skipped with no
   URL. It asserts AC-2: the portfolio rows plus the unallocated row, counted by
   item, equal `count(*)` of live items, and every item is either sized or
   counted in `unsized`.
6. **Observable.** Run the read model against this install and record the totals
   and the path mix with `record_execution_evidence`.

Verification: the vitest files above; `pnpm --filter web typecheck`; the Postgres
test against local-CI Postgres; `pregate`.

## Slice 2 — BI-A73A7DA3 · epic attribution proposals

1. **Proposal (pure).** In `lib/portfolio/epic-portfolio-proposal.ts`, for each
   epic, tally its items' portfolios using slice 1's non-epic paths. Confidence is
   `high` when one portfolio holds at least 80% of the attributed items and at
   least 3 items. Otherwise it is `low`, and a text classification of the title
   and description against the four portfolio roots is added as evidence. The
   classification never decides alone.
2. **Governed write.** An MCP tool, `confirm_epic_portfolio`, takes epic ids and a
   portfolio per epic, a reason, and the actor from the tool context. A batch
   form is allowed only for `high` proposals. It writes `EpicPortfolio` and a
   `BacklogItemActivity`-equivalent audit row on the epic. `EpicPortfolio` has no
   actor columns, so the audit lives in the existing epic activity/decision log
   rather than in new columns. If no such log exists, add `confirmedById`,
   `reason` and `confirmedAt` to `EpicPortfolio` in a migration with a
   data-impact manifest. This choice is made on the slice branch after reading
   the epic write path.
3. **Re-attribution.** After a write, `attributeBacklogPortfolio` runs for the
   epic's items, so the cache follows.
4. **Operator control.** Moved to slice 5. The item places the control "on the
   tie-out surface", which slice 5 builds, so one UX-Fit decision and one
   `ux_verified` check cover both rather than a throwaway control on Ops > Demand.
   Until then, the governed write is reachable as `confirm_epic_portfolios`.
5. **Observable.** Confirm the high-confidence batch on this install, and report
   the unallocated share of live points before and after from slice 1's read
   model.

## Slice 3 — BI-9EC60FE0 · quarterly budgets

1. **Model.** `PortfolioBudgetPeriod` in `product-portfolio.prisma`, with an
   `/// @dpf lifecycle=… retention=…` tag and `changes/portfolio-budget-period.data-impact.json`:
   - `id`, `portfolioId` (relation), `periodStart`, `periodEnd`;
   - `allocatedPoints Int`, `usdPerPoint Decimal?`, `wipAllowancePoints Int?`;
   - `setById`, `setByAgentId?`, `reason`, `supersedesId?` (self-relation), `createdAt`.

   The current row for a portfolio and period is the one that nothing
   supersedes. A partial unique index enforces one current row per portfolio and
   period.
2. **Write.** The MCP tool `set_portfolio_budget` (grant `backlog_write`,
   registered in the demand-scoring pack, `TOOL_TO_GRANTS` updated) requires a
   reason and an attributable actor. A change inserts a new row that supersedes
   the old one; rows are never updated. A server action backs the operator
   control.
3. **Proposal.** `propose_portfolio_budgets` is read-only. It returns next
   period's allocations from last quarter's delivered points per portfolio (slice
   1 read model, with `quarterBounds` shifted one quarter), and the unallocated
   share it could not place. It writes nothing.
4. **Display rule.** A portfolio with no row shows "no budget set", through
   `ProvenancedMetric` with kind `not-connected`, never as 0. `budgetKUsd` stays
   as it is.
5. **Tests.** Pure proposal tests; a Postgres test for supersession and the
   one-current-row constraint (AC-1); a Postgres test that the proposal equals
   last quarter's delivered mix from the read model (AC-2).
6. **Observable.** Set this quarter's budgets from a proposal on this install,
   through the tool.

## Slice 4 — BI-EF265C9A · reservations

1. **Model.** `BudgetReservation`: `backlogItemId`, `portfolioId`, `periodId`,
   `points`, `state` (a Prisma enum: `reserved | consumed | released`), `reason?`,
   `overrideReason?`, `actorId?`, `actorAgentId?`, timestamps. It has a data-impact
   manifest and a `@dpf` tag. There is one open reservation per item.
2. **Reserve.** `approveDemandForFundingHandler` reserves the item's slice 1
   points in its portfolio's current period, after the WWWD gate funds it and in
   the same transaction as `transitionDemandItem`. It handles two cases:
   - **Over allocation, autonomous caller** (`context.agentId` set with no
     human-in-the-loop marker): refused with a readable reason, and nothing
     transitions.
   - **Over allocation, person:** it proceeds only with `overrideReason`, and the
     warning is in the response and in the `demand_funding_decision` payload.

   An unsized item cannot be reserved. The response says so, and funding still
   follows the existing gate.
3. **Lifecycle.** A single `settleBudgetReservation(itemId, event)` is called
   from the status write door:
   - done → `consumed`;
   - retired, deferred or discarded → `released`;
   - a re-size → the points are adjusted and an activity row records the change.
4. **Tests.** Postgres tests for each transition (AC-1), the autonomous refusal
   and the human override (AC-2), and the reconciliation invariant (AC-3).

## Slice 5 — BI-CBF5D708 · capacity and the tie-out

1. **Throughput.** `lib/portfolio/throughput.ts` sums points reaching `done` per
   ISO week, per portfolio and per delivery surface, from `completedAt` over a
   rolling 6-week window. The surface comes from the item's workroom
   `executorKind` or its build, and is otherwise `other`. The range is p15–p85
   through `percentile` from `flow-metrics.ts`. With fewer than 4 weeks of
   samples it is labelled `estimated`, otherwise `measured`.
2. **Traced share.** Traced share is the points delivered with a workroom or PR
   evidence, divided by all points delivered. Untraced changes are counted as
   workrooms with a PR and no backlog item, plus merged-PR bindings that found no
   room (`pull-request-merged-binding.ts:122`). Both are shown.
3. **Tie-out read model.** One row per portfolio per period plus the unallocated
   row, with these columns: allocated, reserved, in flight, delivered, forecast
   range, over- or under-commitment in points and in weeks, and traced share.
4. **Surface.** A UX-Fit propose-n-pick decision (`principle_decide` with a
   `features` map) between Ops > Demand and the portfolio page, with the
   allocation board noted as a future host. Manifest at
   `docs/ux-fit/<date>-portfolio-budget-tie-out.ux-fit.json`. Over-commitment is
   shown as numbers, never only as a colour, and uses `--dpf-*` tokens. The
   surface reports and never dispatches.
   It also carries slice 2's attribution control: the unconfirmed epics from
   `propose_epic_portfolios`, a one-step confirm for the high-confidence batch,
   and confirm/correct one at a time for the rest, all through
   `confirmEpicPortfolios` with a required reason.
5. **Docs.** A user-guide page for budgets and the tie-out, per the design
   commit's Docs-Impact-Decision.
6. **Observable.** A live check on this install, recorded as `ux_verified`
   (AC-4).

## Slice 6 — BI-3430B3A4 · admission by points in flight

1. **One rule.** `lib/build/investment-admission.ts`:
   `decideInvestmentAdmission({ inFlightPoints, itemPoints, allowance, startKind, shape })`
   returns `admit | warn | refuse` with a reason. Break-fix is always `admit` and
   counted. `startKind` is `autonomous | human`.
2. **Allowance.** The period's `wipAllowancePoints`, else throughput × 2 weeks
   (slice 5), else the 8-point floor. Unallocated items draw on an explicit
   unallocated allowance that has the same floor.
3. **In flight.** Items in progress, plus active builds and live workrooms bound
   to an item, each counted once.
4. **Callers.** The rule is enforced at:
   - `createFeatureBuild` (`lib/actions/build.ts:91-98`) and
     `promoteToBuildStudioHandler` (`build-ops-pack.ts:209-220`): human, warn with
     a recorded reason;
   - `dispatchConsolidationBet` (`dispatch-bet.ts:111-118`),
     `evaluateAndDrainCapacity` (`evaluate-drain.ts:89-145`) and
     `runGovernedBacklogTeeUp` (`governed-backlog-tee-up.ts:697`): autonomous,
     refuse;
   - claim and `adopt_worktree`: human, or autonomous when the executor is in
     the unattended set (`claim-backlog-item-handler.ts:28`).

   A tee-up refusal writes its reason as a `BuildActivity`-equivalent record.
   The tee-up has no build yet, so the reason goes on the item's activity, and
   the run summary returns refused counts.
5. **The physical limit stays separate.** The `bs-sandbox` pool capacity
   (`DPF_SANDBOX_POOL_SIZE`, `WIP_POOL_CAPACITY`) is still enforced, and reported
   as its own constraint. `BUILD_WIP_CAP` stops being read as a count limit
   anywhere (AC-4); a guard test greps for it.
6. **Tests.** Ten small items and two large items admit alike (AC-1); a tee-up
   refusal at the allowance (AC-2); a human over-allowance start with its reason
   recorded (AC-3).

## Slice 7 — BI-0CA5DA2B · AI resource class beside points

1. **Per item.** Tokens and `costUsd` from `BuildPhaseRun` through
   `FeatureBuild.originatingBacklogItemId`, and latency from `durationMs`.
   `AgentBudgetEvent.buildRunId` and `TokenUsage` join only where a link exists.
   Anything unlinked shows "not traced".
2. **Billing mode.** When the provider's `valuationMethod` is `commitment_first`,
   the label is "subscription: $0 recorded, N tokens", never $0.
3. **Tie-out columns.** Tokens, spend and latency, per portfolio and period, each
   in its own column. No figure converts into or out of points; a test asserts
   that the module exports no conversion.
4. **Tests.** A Postgres reconciliation of the per-item figures against the
   underlying rows (AC-1).

## Per-PR procedure

For each slice:

1. Create a governed worktree under `D:/DPF-source-root-worktrees/` on its own
   branch, then `claim_backlog_item_for_work`.
2. Test first.
3. Run `node scripts/pregate-preflight.mjs`, then `pnpm run pregate`. The verdict
   is `pnpm -s pregate:status`. Exit 75 means the gate is queued.
4. Sign off for DCO, with the Design-Grounding-Decision, Docs-Impact-Decision and
   Convergence-Impact-Decision trailers.
5. Put Local-CI-Evidence in the PR body, run `pnpm pr:health <n>`, then
   `gh pr merge <n> --squash --auto`.

Rebase with `git rebase --onto origin/main <old-base>`, and never `git stash`.
BI-29F61030, BI-16DF26D1, BI-7AE90091 and BI-05240C38 are peer-owned and
referenced only.

## Risks and rollback

- **Admission starves work (slice 6).** Break-fix is never blocked, human starts
  warn, and the floor guarantees one large item per portfolio. Rollback: revert
  slice 6. The count rule returns intact because the sandbox pool rule is never
  removed.
- **A stale `portfolioId` cache mis-attributes items.** The read model reports
  the path, and slice 1 tests the disagreement case.
- **Over-budget refusal blocks funding (slice 4).** Only autonomous callers are
  refused. Rollback: revert slice 4; reservations are additive rows.
- **Migrations (slices 2–4).** Additive only, and applied cleanly against live
  data. Rollback is a revert; no existing column changes meaning.
- **A second scheduler.** The tie-out and the budgets never dispatch. The drive,
  the tee-up and the drain remain the only starters.
