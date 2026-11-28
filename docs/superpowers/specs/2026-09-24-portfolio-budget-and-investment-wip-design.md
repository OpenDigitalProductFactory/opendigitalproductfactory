---
status: active
---

# Portfolio budgets, investment-weighted WIP, and capacity tie-out

**Epic:** `EP-PORTFOLIO-BUDGET-WIP`. **Slices:** `BI-298A7202`, `BI-A73A7DA3`,
`BI-9EC60FE0`, `BI-EF265C9A`, `BI-CBF5D708`, `BI-3430B3A4`, `BI-0CA5DA2B` (§8).

**Relationship to other designs.** This design does not rebuild any of them:

- It is the **budget side** of the [proactivity and capacity allocation design](2026-09-15-proactivity-and-capacity-allocation-design.md), which is the capacity side (the weekly AI pool).
- It supplies the $/point rate that the [demand management design](2026-07-10-demand-management-design.md) deferred.
- It implements the funding envelopes of the [portfolio prioritization cascade](../plans/2026-06-22-portfolio-prioritization-cascade.md) (BI-PORTPRIO-3), which never landed.

## 1. Founder direction (2026-09-24)

Build Studio limits work in progress by counting items. The founder asked for
the limit to come from a budgeting perspective instead:

- Ten small items and two large items can be the same investment, and the limit
  should treat them the same.
- A budget is allocated per backlog item and rolls up per portfolio. That
  allocation is the mechanism for budgeting.
- Budgets must tie out with capacity.
- Much of the work happens outside the system, so the numbers will never be
  100% traceable. They must say so rather than present a partial total as
  complete.

This refines the founder's earlier direction of 2026-08-15 (BI-29F61030):
"work is budgeted and allocated from a time perspective … estimate resources
across AI coworker, human and non-digital". Two rules from that methodology hold
here unchanged. The three resource classes are **never flattened into one
number**. AI is estimated by spend and latency, not hours.

The founder accepted four decisions:

| Decision | Choice |
| --- | --- |
| Budget unit | Investment points first; an optional $ rate per point per portfolio |
| Period | Quarterly |
| Starting allocations | Proposed from last quarter's delivered mix, then adjusted by a person |
| Over budget | Hard stop for autonomous starts; a warning with a recorded reason for human starts |

## 2. What exists today

This was verified in code and against the live development install on
2026-09-24.

| Concept | State | Where |
| --- | --- | --- |
| WIP limit | A hardcoded count of 3 active builds, blind to size | `lib/build/wip-cap.ts:40` (`BUILD_WIP_CAP`) |
| Cap callers | Five callers | `createFeatureBuild`, `promote_to_build_studio`, `dispatch-bet`, `evaluate-capacity-drain`, `drain-policy` |
| Cap bypass | The governed daily tee-up never checks the cap | `governed-backlog-tee-up.ts:661-718` |
| Size scale | small 1, medium 3, large 8, xlarge 20, relative points with no unit | `lib/demand/scoring.ts:20-25`, `resolveJobSize` |
| Size coverage | 82% of live items carry an `effortSize`; 15 carry a `jobSize`; 3 carry an agreed estimate | `BacklogItem` |
| Portfolio budget | `Portfolio.budgetKUsd` (annual, in $k) is null on all 4 portfolios and has no write path | `product-portfolio.prisma:9` |
| Investment mix | Run, grow and transform as percentages, weighted by points | `bucketTargets`, `lib/demand/buckets.ts` |
| Funding approval | A yes/no gate; no amount is reserved | `approve_demand_for_funding` |
| "Delivery budget" | Items per day of intake, not money | `set_backlog_delivery_budget`, `backlogTeeUpDailyCap` |
| Attribution | 108 of 2,206 live items (5%) resolve to a portfolio; 1,201 only through an epic; 900 have no link. `EpicPortfolio` has 0 rows. | live query |
| Actual AI spend | Tokens and dollars per build phase, per agent and per call; subscription providers record $0 | `BuildPhaseRun`, `AgentBudgetEvent`, `TokenUsage` |
| Throughput | Not measured in points; `flow-metrics.ts` measures wait and cycle time | — |

## 3. What this design adds

1. **One investment unit per item.** An item's investment is its points.
2. **Attribution.** Every item resolves to a portfolio, or visibly to *unallocated*.
3. **A budget per portfolio per quarter**, in points, optionally priced.
4. **Reservation.** Funding approval reserves points against the budget.
5. **Capacity as measured throughput** in the same unit, with a range rather than a single figure.
6. **Admission by points in flight** per portfolio. This replaces the count cap everywhere, including the tee-up.
7. **A tie-out per portfolio** that says what share of the work it can see.
8. **Resource classes reported beside points**, never converted into them.

## 4. Research and benchmarking

Six practices bear on the design. Each contributes one idea, and none is adopted
wholesale.

**SAFe Lean Portfolio Management: lean budgets and guardrails.** Budgets are
allocated to value streams rather than to projects, then steered by spending
guardrails and periodic participatory budgeting. *Adopted:* the budget belongs to
the **portfolio**, not to each item. Items reserve against it. A quarterly
cadence adjusts it. *Rejected:* the full participatory budgeting ceremony. A
proposal from last quarter's delivered mix, adjusted by one accountable person,
is proportionate for this organisation.

**Reinertsen, *The Principles of Product Development Flow*: WIP constraints and
cost of delay.** WIP is controlled to cut queueing delay, and weighted-shortest-
job-first ordering depends on job size. DPF's `jobSize` and demand scoring
already descend from this. *Adopted:* **weighted WIP**. The constraint is the
size of work in flight, not the number of jobs, because a count constraint lets
one large job and one small job consume equal capacity. *Rejected:* explicit
cost-of-delay pricing per item. The demand score already ranks items, and a
second economic model would compete with it.

**Kanban: WIP limits and classes of service.** An expedite class bypasses the
normal limit but stays visible and counted. *Adopted:* the **break-fix expedite
shape is counted in WIP but never blocked** (§5.6).

**Little's Law.** Average WIP equals throughput multiplied by lead time.
*Adopted:* as the **default WIP allowance**. A portfolio's allowance is its
measured weekly throughput multiplied by a target lead time, so the limit
follows real delivery rather than a guessed number.

**Throughput-based probabilistic forecasting** (Vacanti, *Actionable Agile
Metrics*; Magennis). Forecast delivery from sampled historical throughput, not
from summed estimates. *Adopted:* capacity is **measured throughput**, and the
forecast is a **range** (p15–p85 of weekly samples). *Rejected:* full Monte
Carlo simulation in the first version. The weekly sample range answers the
tie-out question with a fraction of the machinery, and a later slice can
replace it.

**FinOps showback and unit economics** (already adopted by the 2026-09-15
design). *Adopted:* spend is attributed to the item and portfolio that caused
it and shown next to what it bought. *Rejected:* chargeback between portfolios
of one organisation.

**What none of them supply** is honesty about untraced work. Every one of them
assumes the system sees all the work. Here the founder does a substantial share
of the delivery outside it. So each total carries a **traced share** (§5.7).
This part has no prior art to copy.

## 5. The model

### 5.1 Investment points

`resolveInvestmentPoints(item)` resolves an item's points in this order:

1. The **agreed estimate** (`estimateAgreed` with `jobSize`).
2. The **size default** on the existing scale (`resolveJobSize`): small 1,
   medium 3, large 8, xlarge 20.
3. Otherwise **`unsized`**. The item is shown and counted as unsized, never
   guessed.

Points are relative investment, with no unit of time or money. A portfolio may
set a **$ rate per point** for a period. The tie-out then shows points × rate as
a derived figure. The rate never changes what is stored.

### 5.2 Attribution

`resolveItemPortfolio(item)` takes the first path that resolves and returns
which path it used:

1. `BacklogItem.portfolioId`
2. The digital product's portfolio
3. The taxonomy node's portfolio (`taxonomyNodeId`)
4. The epic's portfolio (`EpicPortfolio`)
5. **`platform-default`**: an item whose `scopeKind` is `platform` or `common`
   counts as the Foundational portfolio (operator decision 2026-10-07,
   BI-291F7451). It is derived at read time, never written to the item, and the
   budget proposal reports the points it attributed as `attributedByRule`.
6. **`unallocated`**

The read model, the budget proposal, throughput, the tie-out and admission all
call one function for this, `resolveBudgetPortfolio`
(`apps/web/lib/portfolio/budget-attribution.ts`), so a budget and the work that
consumes it are attributed alike.

Path 4 carries the most weight: 1,201 live items reach a portfolio only through
their epic, and `EpicPortfolio` is empty. Slice 2 proposes a portfolio for each
epic from its items' existing links. It falls back to classifying the epic's
text only when those links disagree, and a person confirms each proposal. The
platform never writes an attribution without an actor.

### 5.3 Budgets

A new record, `PortfolioBudgetPeriod`, holds one budget per portfolio per
quarter. Its fields are the portfolio, the period start and end,
`allocatedPoints`, an optional `usdPerPoint`, an optional `wipAllowancePoints`,
`setBy`, `reason` and `supersedes`.

- **Writes are governed.** `set_portfolio_budget` requires an attributable actor
  and a reason. A change supersedes the prior row rather than editing it.
- **Proposals are separate.** `propose_portfolio_budgets` derives next quarter's
  allocations from last quarter's delivered points per portfolio, and states
  the unallocated share it could not place. A person accepts or edits the
  proposal. It never applies itself.
- **A missing budget stays missing.** A portfolio without a budget shows *no
  budget set*, never zero.
- **`budgetKUsd` stays** as the annual financial figure. When a rate is set, the
  tie-out shows the derived dollars beside it so the two can be compared.

### 5.4 Reservation

`approve_demand_for_funding` gains a side effect: it writes a
`BudgetReservation` for the item's points in its portfolio's current period.
The reservation moves through these states:

- **Approved:** *reserved*.
- **Done:** *consumed*.
- **Retired, deferred or discarded:** *released*.
- **Re-sized:** the reservation is adjusted and the change is recorded.

When an approval would exceed the allocation:

- An **autonomous** caller is refused, with the reason stated.
- A **person** may proceed with a warning and a recorded override reason.

### 5.5 Capacity

Capacity is **measured throughput**: points delivered per week, dated by
delivery (the move into awaiting-acceptance, else completion; BI-77313ADD). It is
measured per portfolio and per delivery surface (Build Studio, external Claude
Code / Codex / Grok, other), over a rolling six-week window.

The forecast to period end is a **range** (p15–p85 of weekly samples) multiplied
by the weeks remaining. With fewer than four weeks of samples, the figure is
labelled *estimated*, not *measured*.

This is the capacity side in the **same unit** as the budget. That is what lets
the two tie out. The 2026-09-15 design's weekly AI pool remains the capacity
side for AI spend (§5.7).

#### Amendment 2026-11-28 (BI-A59837E5): Quarterly planning estimates are advisory guidance, not author-stage execution stops

**Operator direction (2026-11-28, evidence `cmx091g8324zs0ekjjvy38g69`).**
Quarterly portfolio point allocations (`PortfolioBudgetPeriod.allocatedPoints`)
and planning-only attribution or sizing facts exist to measure delivery against
a planning threshold and forecast quarter-end delivery and spend. They are
**planning guidance**, never an execution stop on already-authorized Workroom
author stages.

**Observed defect (verified at `main` `89cd7b12d4fb7fa89d4a74ac7a7c188859b0ca31`,
originally filed against `34e2d13f723cc6d080ea4ad01f5c59b0261f1335`):**

- Live instance: in S5 compatibility (`BI-5EF67818` / `WC-75CCF40B`), the spec
  stage stalled at 2,993 committed points against a 2,863-point Foundational
  plan with no machine shortage and no exhausted monetary cap.
- Exact enforcement path: `buildAuthorStageFunding`
  (`apps/web/lib/work-management/author-stage-autonomy.ts:43-75`) sums
  `committed = deliveredPoints + inFlightPoints` from
  `summarizePortfolioInvestment`
  (`apps/web/lib/portfolio/investment-read-model.ts`) and returns
  `{ funded: false, because }` solely when `committed > allocated` (lines 70–72)
  or when planning-only metadata is absent (`!status?.budget`, `points === null`,
  or `!resolution.portfolioId`, lines 56–66).
- `decideAuthorStageAutonomy` (`author-stage-autonomy.ts:78-92`) passes that
  flag into `decideFundedAuthor`
  (`packages/validators/src/workroom-policy/funded-author.ts:27-33`), which
  withholds `{ author: "agent:build-specialist" }` and populates
  `withheldBecause`.
- `runWorkroomDriveJob` (`apps/web/lib/queue/functions/workroom-drive.ts:470, 482, 524-525`)
  feeds `author.roleBindings` and `authorStageWithheldBecause` into
  `resolveDrivePlan` → `planStage`
  (`apps/web/lib/work-management/drive-plan-stage.ts:189-205`), projecting the
  planning overrun as `action: "attention", reason: "role_stage"` instead of
  `action: "dispatch_agent", reason: "agent_stage"`.
- `resolveScheduledRoomMandate`
  (`apps/web/lib/work-management/room-stage-mandate.ts:319-332`) re-evaluates
  `loadAuthorStageAutonomy` before admitting `record_workroom_evidence`, so the
  same planning-only withholding also blocks scheduled stage writeback.

**Amended continuation rule (narrow follow-up to BI-8A32EBFF and BI-77313ADD):**

1. **Advisory separation.** For an already-authorized Workroom on an eligible
   non-`delivery-xlarge` delivery shape whose backlog item is live and whose
   operator pre-authorisation (`workroom-drive.author-stage-preauthorisation`,
   active principal holding `manage_platform`) is `in-force`, crossing the
   quarterly planning estimate (`committed > allocated`) — or lacking
   planning-only attribution, size, or quarterly plan rows (`unallocated`,
   `unsized`, `no budget set`) — **changes only the recorded advisory warning
   and forecast telemetry, never the `role:author` dispatch or stage-mandate
   decision**. Below, at, and above the quarterly planning threshold all bind
   `agent:build-specialist` and dispatch (`action: "dispatch_agent", reason: "agent_stage"`).
2. **Planning warning and forecast content.** Keep all existing attribution
   (`resolveBudgetPortfolio`), accounting (`summarizePortfolioInvestment` and
   the BI-77313ADD spend rule), and tie-out/throughput forecasting primitives
   (`measureThroughput`, `assembleTieOut`). Surface on existing reporting and
   Workroom Drive diagnostics:
   - planned points (`allocatedPoints`, or explicit `no budget set` — never `0`),
     committed points (`deliveredPoints + inFlightPoints`), and overage points
     (`max(0, committed - allocated)` when a quarterly plan exists);
   - overrun drivers split between **`deliveredPoints`** and
     **`inFlightPoints`**;
   - projected quarter-end delivery range (`p15–p85` from weekly throughput ×
     weeks remaining) and projected quarter-end spend where supported (§5.7).
3. **Hard gates preserved unchanged (advisory warnings never bypass them):**
   - **Operator pre-authorisation:** absent, malformed, revoked, out-of-scope,
     unreadable config/DB state, or demoted authorising principal still fails
     closed to `attention` (`role_stage`) in `author-stage-preauthorisation.ts`
     and `author-stage-autonomy-live.ts`.
   - **Shape and governed-stage boundaries:** `delivery-xlarge` never enters
     autonomous implementation; governed-decision stages (`merge`, `acceptance`,
     `post-implementation-review`) still require their governed approval path
     (`governed_decision`); unbound or non-live/done/delivered rooms remain
     gated by `gateDrivePlanOnWorkItem`.
   - **Action authority and TAK tool grants:** missing room membership,
     disabled hands-on mode, missing/expired/superseded dispatch checkpoint, or
     missing TAK tool grants (`room-turn-authority.server.ts`, `agent-grants.ts`,
     `room-stage-mandate.ts`) still refuse independently with their own reasons.
   - **Real funding, spend, and provider controls:** unresolved funding where
     paid work requires it, explicit monetary spend caps, and purchase or
     provider credential/authorization gates keep their independent decisions
     and reasons. Optional inference investment context (`ai-inference.ts`) and
     demand activation `fundingReady` scoring/evidence projections remain
     distinct from Workroom author continuation.
   - **Real execution capacity:** Workroom Drive dispatch capacity
     (`loadDispatchCapacity` / `createDispatchAdmission` in `workroom-drive.ts`)
     and the physical sandbox pool (`DPF_SANDBOX_POOL_SIZE`) remain independent
     execution limits.

### 5.6 Admission: points in flight

This rule replaces every use of `BUILD_WIP_CAP` as a count limit:

```
admit(item) ⇔ inFlightPoints(portfolio) + points(item) ≤ allowance(portfolio)
```

- **In flight** means items in progress, plus active builds and Workrooms bound
  to an item that have something running (the drive dispatched an agent, or a
  principal holds an unexpired lease). Each item is counted once. Amended
  2026-10-13 (BI-77313ADD, WWMD DI-A54504784480): a room parked on attention
  counts its item as ready, and delivered work awaiting acceptance is
  delivered, dated by its move into awaiting-acceptance, never in flight. A
  period is charged for work delivered in it plus work actively in progress.
- **The default allowance** follows Little's Law: measured weekly throughput ×
  a target lead time of 2 weeks. Its floor is one large item (8 points), so a
  new portfolio can always start one large piece of work.
  `wipAllowancePoints` overrides the default for a period.
- **Unallocated items** draw on an explicit unallocated allowance. Missing
  attribution is never a way around the limit.
- **Autonomous starts** are refused when the rule fails. These are the tee-up,
  the capacity drain, `dispatch-bet` and Build Studio auto-promotion. The
  reason is recorded on the run.
- **Human starts** proceed with a warning and a recorded reason. These are an
  operator promote, and an external `adopt_worktree` or claim.
- **Break-fix expedite** work is counted but never blocked.
- **The sandbox limit** (`DPF_SANDBOX_POOL_SIZE`) stays as the separate physical
  constraint and is reported separately. It limits how many builds the machine
  can run, not how much the organisation has chosen to invest.
- **Boundary with §5.5 author-stage continuation (BI-A59837E5).** Points-in-flight
  admission (`apps/web/lib/build/investment-admission.ts`, BI-3430B3A4,
  `PlatformDevConfig.wipAdmissionMode` `shadow`/`enforce`) governs **new-work
  starts** and stays unchanged. An unapproved autonomous start past the
  portfolio's WIP allowance is not equivalent to continuing an already-authorized
  Workroom author stage; BI-A59837E5 neither alters `wipAdmissionMode`, nor
  modifies live portfolio allocations or funding bindings, nor relaxes
  `blocksStart()` enforcement for new starts.

### 5.7 Traced share and resource classes

**Traced share** is the points delivered with Workroom or pull-request evidence,
divided by all points delivered. Merged pull requests that cite no item
(`lookup_change_origin`) are reported alongside as *untraced changes*. Every
tie-out row carries both figures.

**Resource classes** are reported **beside** points and never converted into
them, per the 2026-08-15 methodology:

- **AI** is reported as tokens, recorded spend and latency, per item and per
  portfolio (`apps/web/lib/portfolio/ai-resource.ts`). Subscription usage is
  labelled as *subscription: $0 recorded, N tokens*, never as zero cost.
- **Monetary forecast honesty (BI-A59837E5).** When reporting projected
  quarter-end spend alongside a quarterly point overrun (§5.5), the projection
  must state its explicit basis — either the portfolio's configured
  `PortfolioBudgetPeriod.usdPerPoint` rate or observed recorded AI spend
  (`BuildPhaseRun.costUsd` over traced delivered points). When neither basis is
  present (including subscription-only usage with no configured rate), the
  monetary forecast must read **`unknown`** — never a fabricated dollar
  estimate and never `$0`.
- **Human and non-digital** classes follow BI-29F61030's own slices when they
  land.

#### Verification and ordered delivery contract (BI-A59837E5)

Implementation bound to `BI-A59837E5` follows this ordered sequence (test-first;
no implementation or live settings mutation is authorized by this design
amendment alone):

1. **Pin first Red through the real Workroom Drive path.** Wire real
   `buildAuthorStageFunding` → `decideAuthorStageAutonomy` → `resolveDrivePlan` /
   `runWorkroomDriveJob` (not a stubbed `FUNDED` constant) in
   `apps/web/lib/work-management/author-stage-autonomy.test.ts`,
   `apps/web/lib/work-management/drive-author-stage.test.ts`, and
   `apps/web/lib/queue/functions/workroom-drive-author-stage.test.ts`:
   - **Below threshold** (`committed < allocated`, e.g., 4 of 8 points):
     `dispatch_agent` / `agent_stage` (`agent:build-specialist`), no overrun warning.
   - **At threshold** (`committed === allocated`, e.g., 8 of 8 points):
     `dispatch_agent` / `agent_stage`, zero overage.
   - **Above threshold — first Red** (`committed > allocated`, e.g., 11 of 8
     points with 8 delivered + 3 in-flight, reproducing the live 2,993/2,863
     failure mode): currently FAILS with `funded: false` → `action: "attention", reason: "role_stage"` and zero `upsertAgentTask` calls; expected Green is `dispatch_agent` / `agent_stage` with a recorded advisory warning carrying planned, committed, overage, delivered-vs-in-flight drivers, and forecast basis (configured rate, observed cost, or `unknown`).
   - **Missing planning-only facts — companion Red** (`no budget set`,
     `unsized`, or `unallocated` portfolio on an otherwise pre-authorized live
     item): currently FAILS with `funded: false` → `action: "attention", reason: "role_stage"`; expected Green is `dispatch_agent` / `agent_stage` with an advisory planning warning and `unknown` spend forecast.
2. **Independent hard-negative regressions (advisory warning must never bypass):**
   - Revoked, absent, out-of-scope, unreadable, or demoted-operator
     pre-authorisation still withholds author binding (`attention` / `role_stage`).
   - `delivery-xlarge` and governed-decision stages (`merge`, `acceptance`,
     `post-implementation-review`) retain `role_stage` / `governed_decision`
     with `agentId: null`.
   - Missing TAK tool grants, room membership, hands-on toggle, or valid
     dispatch checkpoint in `room-stage-mandate.ts` still refuses
     `record_workroom_evidence` with its exact authority reason.
   - Real Workroom Drive dispatch capacity (`createDispatchAdmission`) and
     `DPF_SANDBOX_POOL_SIZE` still hold/refuse when exhausted.
   - Explicit monetary caps, unresolved paid-work funding, and provider/purchase
     authorization denials keep their independent refusal decisions.
   - Separate new-work WIP admission (`apps/web/lib/build/investment-admission.ts`,
     `BI-3430B3A4`) in `enforce` mode still refuses autonomous starts past
     `wipAllowancePoints`.
3. **Implementation and diagnostics reconciliation.** Separate hard author
   eligibility from advisory planning status across `funded-author.ts`,
   `author-stage-autonomy.ts`, `author-stage-autonomy-live.ts`,
   `drive-plan-stage.ts`, `workroom-drive.ts`, and `room-stage-mandate.ts`;
   ensure `tie-out.ts` / `tie-out-view.ts`, Workroom diagnostics, and operator
   guides (`docs/user-guide/investment-allocation.md`) reflect planned,
   committed, overage, delivered-vs-in-flight drivers, and explicit-basis or
   `unknown` spend forecasts without mutating current portfolio allocations,
   funding bindings, provider/purchase authorizations, or approval gates.

### 5.8 Accountable owner (amendment 2026-09-29, BI-67B27832)

**Founder direction (2026-09-29).** Ownership of automatic work aligns to the
portfolios, where budgets and priorities are set. There is one actual human
accountable identity per portfolio, managed simply from an owner perspective.

**The gap.** Scheduled and proactive work (the tee-up, the capacity drain, the
skill curator, review and ship jobs) was owned by the oldest active superuser.
On a standard install that is the seeded `admin@dpf.local`. It created every
Build Studio build (126 of 126 on the live install), coordinated the rooms those
builds opened (187), and received the approvals they raised. Nobody reads that
inbox.

**The model.**

- `Portfolio.accountablePrincipalId` names the one person accountable for the
  portfolio. It is nullable on purpose and mirrors
  `Organization.topAccountablePrincipalId`: unset reads as unset, never as a
  guessed owner. Only an active person with an active account qualifies, never
  a coworker.
- Owner **roles** (`PORTFOLIO_OWNER_ROLES`) remain the capability layer: who
  *may* act. The accountable person is who *answers*.
- It is written only by `setPortfolioOwner`: the MCP tool `set_portfolio_owner`
  (grant `backlog_write`, capability `manage_platform`, consequence
  `authority`) and the operator control beside the budget tie-out on
  Ops > Delivery Flow (`/ops/demand`), where budgets are set (WWMD
  DI-2CB02C52095B). The setting person,
  the time and the reason are recorded on the row.

**Resolution of automatic work's owner** (`resolveWorkOwner`), in order:

1. the accountable person of the work's own portfolio;
2. the accountable person of **Foundational**, which holds the platform's own
   work, for jobs with no single portfolio;
3. the organization's top accountable person;
4. only then the oldest active superuser, returned as `fallback`; the owner
   view names that account so someone chooses.

The scheduled tee-up (daily and capacity drain) resolves the owner **per
item**, from the item's portfolio. The build's owner, and so its room's
coordinator, is that portfolio's accountable person. A manual promotion keeps
the person who clicked.

**Relationship to BI-0ACB97B5.** The "accountable budget owner" that design
assigns allocation authority to is this same field. It has one home.

**Rejected.**

- Reusing the owner roles as the owner: a role holds zero or many people and
  is not one accountable identity.
- Organization top accountable for everything: it ignores the portfolio
  alignment the founder asked for, so it is kept as a fallback.
- Removing the superuser fallback outright: it would stop every scheduled job
  on installs that have not chosen owners yet. The fallback stays, but it is
  labelled and visible.

## 6. The tie-out

The tie-out has one row per portfolio per period, plus an **unallocated** row.
It has these columns:

- allocated
- reserved
- in flight
- delivered
- forecast capacity (range)
- over- or under-commitment, in points and in weeks
- traced share

Beside the points columns, it shows AI tokens, spend and latency.

The UX-Fit decision chooses where the tie-out lives, with a propose-n-pick
record. The candidates are Ops > Demand, which already shows the investment
mix; the portfolio page; and the portfolio rows of the 2026-09-15 allocation
board. The tie-out **reports and steers**. It never dispatches, which is the
same rule the allocation board follows.

## 7. Risks

- **Sizes inflate to game the limit.** Agreed estimates override the size
  default, and delivered-versus-estimated carry-over is visible per portfolio.
  A portfolio that consistently delivers fewer points than it reserved shows
  it.
- **The numbers look low because work is outside the system.** The traced
  share and the untraced-changes count are on every row. A low traced share is
  a finding in its own right.
- **The limit starves urgent work.** Break-fix expedite is never blocked, and
  human starts warn rather than refuse.
- **A second scheduler appears.** The budget sets allowances. The drive, the
  tee-up and the drain still dispatch. Any slice that makes the tie-out
  dispatch is wrong.
- **The throughput sample is too small.** Below four weeks, the figure is
  labelled estimated and the allowance falls back to its floor.

## 8. Slices

Every slice ends at something observable on this install.

| # | Item | Delivers | Observable |
| --- | --- | --- | --- |
| 1 | BI-298A7202 | Points and portfolio resolvers; read model with unallocated and unsized rows | Totals reconcile to the live-item count |
| 2 | BI-A73A7DA3 | An epic-to-portfolio proposal per epic; a person confirms | The unallocated share drops, reported before and after |
| 3 | BI-9EC60FE0 | `PortfolioBudgetPeriod`, `set_portfolio_budget`, `propose_portfolio_budgets` | This quarter's budgets are set from a proposal |
| 4 | BI-EF265C9A | Reservations on funding approval | Reserved + consumed reconciles per portfolio |
| 5 | BI-CBF5D708 | Throughput capacity and the tie-out surface | Over- or under-commitment per portfolio, with traced share, verified live |
| 6 | BI-3430B3A4 | Admission by points in flight, tee-up included | The count cap is gone; ten smalls and two larges admit alike |
| 7 | BI-0CA5DA2B | AI tokens, spend and latency beside points | Subscription use is never shown as zero cost |

Order: 1 → 2 → 3 → 4 → 5 → 6 → 7. Slice 6 may start after slices 1 and 3,
because its default allowance needs throughput. Until slice 5 lands, the floor
applies. The implementation plan is
[2026-09-24-portfolio-budget-and-investment-wip.md](../plans/2026-09-24-portfolio-budget-and-investment-wip.md).

## 9. Objectives and acceptance

- **OBJ-BUDGET-1:** Every live item resolves to investment points or visibly to unsized, and to a portfolio or visibly to unallocated.
- **OBJ-BUDGET-2:** Each portfolio holds a quarterly budget in points, set only by an attributable person, and funding approval reserves against it.
- **OBJ-BUDGET-3:** Budget ties out with measured throughput per portfolio, and every total states its traced share.
- **OBJ-BUDGET-4:** Work in progress is admitted by points in flight, not by a count, at every start including the tee-up.
- **OBJ-BUDGET-5:** AI tokens, spend and latency are reported beside points and never converted into them.

| AC | Objectives | Acceptance |
| --- | --- | --- |
| AC-BUDGET-1 | OBJ-BUDGET-1 | The read model's portfolio, unallocated and unsized rows reconcile to the live-item count on this install (slice 1). |
| AC-BUDGET-2 | OBJ-BUDGET-1 | After the high-confidence epic proposals are confirmed, the unallocated share is reported before and after (slice 2). |
| AC-BUDGET-3 | OBJ-BUDGET-2 | This quarter's budgets are set from a proposal, and a missing budget reads "no budget set", never zero (slice 3). |
| AC-BUDGET-4 | OBJ-BUDGET-2 | Reserved plus consumed points reconcile per portfolio, and an autonomous over-budget approval is refused (slice 4). |
| AC-BUDGET-5 | OBJ-BUDGET-3 | The tie-out shows over- or under-commitment in points and weeks with traced share, verified live (slice 5). |
| AC-BUDGET-6 | OBJ-BUDGET-4 | No caller reads the count cap; ten small and two large items admit alike; the tee-up is refused at the allowance (slice 6). |
| AC-BUDGET-7 | OBJ-BUDGET-5 | Subscription use is never shown as zero cost, and no figure converts to or from points (slice 7). |
