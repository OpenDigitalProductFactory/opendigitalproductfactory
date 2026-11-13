---
status: proposed
---

# Delivery Flow is decision-first, and its demand has an owning room

**Date:** 2026-11-12
**Epic:** EP-659D288F
**Backlog:** BI-B4790C93, BI-5C457886, BI-DCFC6099, BI-15B6BDC6, BI-152C80A8, BI-E33D105A
**WWMD decision:** DI-A73763D78B7E (`derive-stage-and-decision-first`, composite 12.52, margin 5.44, confidence high, autonomy-eligible, no commandment conflict)
**Extends:** [Demand management](2026-07-10-demand-management-design.md), [Delivery Flow unification](2026-07-12-delivery-flow-demand-backlog-unification-design.md), [Portfolio budget and investment WIP](2026-09-24-portfolio-budget-and-investment-wip-design.md)

## 1. Problem

The founder, reviewing `/ops/demand` on 2026-11-12: *"I have never really used this page ... It's a major cognitive load and lacks a progressive disclosure design entirely ... I have no clue what to do with it."*

Measured on the development install the same day:

| Measure | Value |
|---|---|
| Document height | 942,841 px (about 875 screens at 1077 px) |
| Rendered text | 1,088,988 characters |
| Buttons | 19,524 |
| Cards rendered | about 4,230, plus "Show 7,248 more" |
| Cards offering "Classify as demand" | 4,130 |
| Open items with a `demandStage` | about 110 of 4,240 |
| Items that reached "the bet" | 3 |
| Route UX budget baseline | 288 visible words, 1 primary action |

Four causes, each already a filed item:

1. **The page renders everything.** `getDemandItems` reads every non-terminal item with its body, evidence and activity history. `DemandBoard` expands each card with its controls (BI-B4790C93).
2. **Nothing advances the funnel except a click.** The demand design (§4) defines `raw` as triaging, `screened` as triage-outcome build plus value and effort inputs, and `null` for bugs and chores. No code implements that mapping. Backlog triage moves `status`. The scoring steward (BI-00C68162) fills RICE inputs on about 590 items. Neither sets the stage. Finished items stay in `screened` and `shaped`. 2,333 of the unstaged items are bugs, which the design says never belong in the funnel (BI-5C457886).
3. **No room owns the processing.** The Portfolio Advisor carries `skills/product-management/demand-triage`, but nothing dispatches it. The work falls to whoever opens the page (BI-DCFC6099).
4. **The page accreted other jobs.** Five projects each added a panel:

   | Panel | Added by | Belongs |
   |---|---|---|
   | Funnel + value × effort | EP-DEMAND-MGMT, Jul 11 | here |
   | Flow lens + In-progress column | EP-DELIVERY-FLOW, Jul 16 | In-progress duplicates Work in progress |
   | Shared demand, founder portfolio | Federated demand, Jul 20–25 | installation / connections |
   | Backlog sync status | Work sync, Sep 2 | already on `/ops/installation` |
   | Budget, owners, investment | EP-PORTFOLIO-BUDGET-WIP, Sep 26 – Oct 16 | here |

   Layout and the duplicate column are BI-15B6BDC6; the federation panels are BI-152C80A8.

The route budget gate passed because its baseline was taken against a near-empty fixture. A gate that measures the wrong thing is worse than prose (BI-E33D105A).

## 2. What the page is for

One question per viewer: **what needs my funding decision, and is the portfolio within budget?** Everything upstream of the bet is coworker work. Everything downstream of it is shown on Work in progress. This keeps the two governance planes of the demand design (qualify is not fund) and moves the qualifying plane off the human.

## 3. Objectives

**OBJ-1:** The page opens on the viewer's decisions and stays within a bounded size whatever the backlog volume.

**OBJ-2:** Funnel stage is derived from signals the platform already records, and only investable work enters the funnel.

**OBJ-3:** A named room processes demand gaps without a human request; the funding decision is the only step that reaches a person.

**OBJ-4:** Federation and execution views live on their own surfaces, not on Delivery Flow.

**OBJ-5:** The route budget gate measures this page with realistic data volume.

## 4. Design

### 4.1 Page structure (BI-15B6BDC6, BI-B4790C93)

```
Delivery Flow
┌──────────────────────────────────────────────────────────┐
│ 3 bets await your decision                     [Review]  │  lead band
│  · BI-…  title   value ●●●○ size M  bucket Grow  [Fund] [Not now]
│  · …                                                     │
├──────────────────────────────────────────────────────────┤
│ Budget  Run 62% · Grow 30% · Transform 8%   within plan ›│  one line
├──────────────────────────────────────────────────────────┤
│ ▸ Funnel   (raw 50 · screened 12 · shaped 4 · ready 0)   │  collapsed
│ ▸ Value × effort                                         │  collapsed
│ ▸ Balance                                                │  collapsed
└──────────────────────────────────────────────────────────┘
```

- **Lead band.** The list is the owner ruling queue (`owner-ruling-queue.ts`) filtered to `approve_demand_for_funding` interactions for the viewer's organization profile. It adds no second queue. Each row carries the Portfolio Advisor's case (score, why, estimate provenance). Fund and Not now write through the existing governed funding action. The empty state reads "Nothing needs your decision" and names when the room last ran.
- **Budget line.** It is a projection of the existing tie-out (`loadPortfolioTieOutPanel`). It opens the panel that holds ownership and investment allocation, which keep their current components.
- **Lenses.** They are closed on first load. Open state is remembered per viewer in local storage. Funnel columns are capped at 25 cards, sorted by `demandScore`, with "show more" paging from the server. Cards show title and a value/size chip. Body, evidence, score breakdown and history load when a card opens.
- **Removed.** The In-progress column is removed (Work in progress owns execution). So are the per-card "Classify as demand" button and the always-visible estimate controls; estimate controls remain inside an opened card.

### 4.2 Derived stage (BI-5C457886)

A pure function `deriveDemandStage(item)` over existing columns:

| Condition | Stage |
|---|---|
| `workType` not in funnel policy (default: feature, refactor, tool, skill) | `null` |
| `status` terminal (done, retired, deferred, superseded) | `null` |
| `status = triaging` | `raw` |
| `triageOutcome = build` and value and effort inputs present | `screened` |
| screened and `investmentBucket` set and a business case present | `shaped` |
| governed funding decision approved | `ready` |
| owner-set stage with override provenance | that stage |

It is recomputed by the events that change its inputs: triage disposition, score or estimate writes, funding decision, status change, and work-type change. A daily reconciliation runs as a safety net, per the founder's 2026-10-28 rule that event-driven beats scheduled. The stored `demandStage` column remains the read model, so the existing ranking, tee-up and MCP tools read it unchanged. A one-time backfill applies the function to every open item. A manual stage write records `demandInputSource = human` and is kept as an override until the owner clears it.

BI-1BA1F3CC (decomposition children re-enter as raw demand) is related. A child of a funded parent should inherit the parent's funding decision instead of re-entering at `raw`. That rule belongs to BI-1BA1F3CC and is read by this function once it lands.

### 4.3 Owning room (BI-DCFC6099)

The Portfolio Advisor (`AGT-WS-PORTFOLIO`) is the owner. Its demand-triage skill is dispatched when a funnel-eligible item arrives or changes and is missing a score input, evidence or a bucket. The room:

- proposes score inputs and a bucket (provenance `ai`) and links evidence,
- moves nothing to `ready` (partial scores stay out),
- raises the funding decision through `approve_demand_for_funding` once an item is shaped, which puts it in the owner ruling queue.

The deterministic scoring steward stays as the floor for items the room has not reached. An owner override always wins over a proposal.

### 4.4 Federation panels (BI-152C80A8)

`WorkSyncPanel`, `NetworkDemandPanel` and `FounderSharedPortfolioPanel` move to the installation/connections surface, with every action intact. Delivery Flow shows one line ("2 shared requests await adoption ›") only when that count is non-zero.

### 4.5 Gate (BI-E33D105A)

The route-sweep fixture gains a populated backlog (several thousand open items across work types and stages) for list and board shells. The route budget adds ceilings on interactive controls and document height. `/ops/demand` and `/ops` are re-baselined against it.

## 5. Acceptance

| Acceptance | Objectives | Statement |
|---|---|---|
| AC-1 | OBJ-1 | With more than 4,000 open items, the default render is at most 3 viewport heights at 1440×900 and no funnel column shows more than 25 cards before "show more". |
| AC-2 | OBJ-1 | The first screen shows the count of funding decisions awaiting the viewer, sourced from the owner ruling queue, or an explicit "nothing needs your decision" state. |
| AC-3 | OBJ-1 | Item body, evidence and decision history are not serialized into the page until a card is opened. |
| AC-4 | OBJ-2 | Bugs, chores and terminal items never appear in a funnel column or offer a classify action. |
| AC-5 | OBJ-2 | An item with triage outcome build and complete value and effort inputs shows as screened without a human action. |
| AC-6 | OBJ-2 | `ready` is reachable only through the governed funding decision, and an owner-set stage is kept as a marked override. |
| AC-7 | OBJ-3 | A newly triaged feature item receives proposed score inputs and a bucket from the Portfolio Advisor without a human request. |
| AC-8 | OBJ-4 | `/ops/demand` renders no federation panel and no execution-status item; every federation action remains reachable from the installation/connections surface. |
| AC-9 | OBJ-5 | Measuring `/ops/demand` against the populated fixture before AC-1 lands fails the route budget. |

## 6. Delivery order

1. BI-E33D105A (the gate) and BI-B4790C93 (bounded render). The page becomes usable and stays usable.
2. BI-5C457886 (derived stage). The 4,130 classify prompts disappear, and the funnel shows real counts.
3. BI-152C80A8 (federation panels) and BI-15B6BDC6 (decision-first layout).
4. BI-DCFC6099 (owning room). Staging and shaping happen without the owner.

Steps 1 and 3 are independent of each other. Step 4 depends on step 2.

## 7. Design grounding

Reviewed: the demand-management design (§4 funnel, §5.2a steward, §9 surface, §11 two governance planes), the Delivery Flow unification design, the portfolio budget design, the backlog-triage efficiency design (2026-10-04), `apps/web/app/(shell)/ops/demand/page.tsx`, `apps/web/lib/demand/demand-data.ts`, `apps/web/components/ops/DemandBoard.tsx`, `packages/db/src/demand-scoring-steward-config.ts`, `skills/product-management/demand-triage.skill.md`, `apps/web/lib/decision-perspective/owner-ruling-queue.ts`, `apps/web/lib/ux-budget/route-budget-baseline.json`, and live Postgres counts on the development install. No new model, table or queue. `demandStage` keeps its column and becomes a maintained projection.

## 8. Rejected options

- **Retire the funnel and keep only ranking and budget** (composite 7.08). It loses the qualify-versus-fund separation the demand design adopted from ServiceNow SPM, and leaves the funding decision with no upstream shape.
- **Paginate only** (composite 4.21). It makes the page render but leaves about 4,000 manual classify decisions on the owner. That contradicts the founder's direction that coworkers are steered by process and only decisions reach a person.
