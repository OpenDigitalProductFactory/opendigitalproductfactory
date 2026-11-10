---
status: active
---

# Plan: the platform delivers its backlog continuously, by value, within budget

- Date: 2026-10-07
- Decisions: made by the operator in chat on 2026-10-07
- Trigger: "Why isn't the platform self-aware and proactive, delivering on the business model and BIs continuously based on budget allocation?" followed by "scope and implement all recommended changes".

> **For agentic workers:** this is a programme of existing epics, not a new substrate. Execute one backlog item per branch and PR. Use `dpf-tdd`, the local-CI gate, and `dpf-pr-with-dco`. Extend the named epics; do not open parallel ones.

## Diagnosis (measured 2026-10-07)

The chain from business model to measured outcome, link by link:

| Link | State | Evidence |
| --- | --- | --- |
| Budgets | Missing | 0 portfolio budget periods, 0 reservations; budget admission runs in shadow mode (`apps/web/lib/governed-backlog-tee-up.ts:719-724`). |
| Prioritised demand | Barely used | 1,941 open items; 83 scored, 1,770 with no demand stage. |
| Choosing what to start | On, ignores value | Daily tee-up starts 3/day, oldest first (`governed-backlog-tee-up.ts:679-689, 728-750`). |
| Capacity drain | Off | `capacityDrainEnabled=false`; reuses the oldest-first tee-up (`apps/web/lib/capacity/evaluate-capacity-drain.ts:105, 126`). |
| Workroom drive | Stalls | Every delivery-shape stage is owned by `role:author` (`apps/web/lib/work-management/delivery-shapes.ts`); the drive raises attention for role-owned stages and never runs them (`drive-plan-stage.ts:143-171`). 379 of 836 live rooms parked; 4 dispatching. |
| Build Studio | Stalls | 30 days: 126 parked in plan, 115 abandoned, 1 completed; 59 parked last stopped on "waiting for the platform upgrade". |
| Upgrades | Too frequent | 56 self-upgrades in 7 days, all manual, each pausing builds and the shared local-CI gate. |
| Acceptance | Stalls | 681 items awaiting acceptance, 445 untouched for 14+ days. |
| Outcome measured | Missing | 0 product outcome observations. |

## Operator decisions

1. **Budgets:** derive each portfolio's first-quarter budget from the last 90 days of delivered effort, recorded as a provisional, revisable decision.
2. **Autonomy bound:** agents may run any stage of any delivery shape, up to the work's funded budget, escalating only on damaging actions or missing authority (`escalation-is-a-gate-not-a-trust-tier`). xlarge still never enters implementation. Recorded on BI-8A32EBFF.
3. **Upgrades:** nightly maintenance window only. Agent-initiated upgrade requests defer to the window (BI-2128872C).

## Waves

Each wave unblocks the next. Items already awaiting acceptance (BI-A835D300, BI-3430B3A4, BI-F9EE05E5, BI-7AE90091) are built; they need acceptance, not new code.

### Wave 1: unstick flow

| Item | What |
| --- | --- |
| BI-E9DAA23F | Builds resume when an upgrade pause clears, and are not aged out for the platform's pauses. |
| BI-2128872C | Agent-initiated upgrades defer to the maintenance window. |
| BI-78540D2C | Tee-up and capacity drain rank by demand score (then budget), age only as tie-break; one shared ranking. |
| BI-B04A0203 | A change merged through CI and the merge queue counts as delivery and acceptance for direct-merge rooms. |
| BI-04140C98, BI-5F3D6A37 | Awaiting-acceptance items get an owner and an age. |

Added 2026-10-07 (gate audit against the operator's rule, below):

| Item | What |
| --- | --- |
| BI-E0FEB8E9 | Guards run with git's automatic maintenance off; Janitor Tests stop failing builds for an unrelated race (PR #6017, merged). |
| BI-F521E322 | A word is not evidence: the shape is raised only on the files a change touches, including a build plan's files; frees builds raised to large on a keyword (PR #6045). |
| BI-C2158DA7 | Builds inherit their item's portfolio; 306 of 306 recent builds carry none, so budgets cannot bound them. Prerequisite for wave 2. |

### Wave 2: budgets (EP-PORTFOLIO-BUDGET-WIP)

BI-9EC60FE0 (quarterly budgets in points) → BI-EF265C9A (funding reserves points) → BI-911840CB (one budget model). Then set budgets per decision 1, and move admission from shadow to enforcing.

### Wave 3: autonomy (EP-4614F35E, EP-AUTONOMOUS-DECIDE)

BI-2C8750FC (review gates become drive stages), BI-88341B5D (the room drives its PR to merge), BI-C1781121 (aged acceptance routed to a coworker), BI-3A462B04 (design reviews independent of the author's client), then BI-8A32EBFF (agents run author-owned stages under decision 2).

Prerequisite added 2026-10-07: BI-E30C0F4F, autonomy policies from their sources (spec `docs/superpowers/specs/2026-10-07-autonomy-policy-sources-design.md`). The policy table had 0 rows and no writer, so every build defaulted to human control and no work-pattern binding could ever activate. Install setup derives WWWD policies from the business context, a WWMD baseline covers platform development at `autopilot`, and a business-policy gap runs `supervised` under an AI reviewer.

### Wave 4: outcome loop (EP-DECISION-OUTCOME-LOOP)

BI-6082C235, BI-7D1E43DE: decisions and delivered work are measured against their intended outcome.

### Operator switches, after the code they depend on

- Turn capacity drain on after BI-78540D2C ships.
- Enforce budget admission after wave 2 ships and budgets are set.

## Gate rule (operator, 2026-10-07)

Every gate has an autonomous way to be satisfied. A gate may route work to a person only when its criterion is traceable to a named regulation or written policy, and the refusal names it. A gate that hands work to a person on a score, a sensitivity label or a default violates this rule and is a defect.

## Constraint

Every PR passes the shared local-CI gate, which runs one change at a time and is blocked by every self-upgrade. Throughput is a few PRs a day until BI-2128872C and BI-E9DAA23F land.

## Done when

- The tee-up and drain start funded, highest-value work without a person choosing it.
- Rooms advance through author stages without waiting for a person, within budget.
- The awaiting-acceptance queue drains and stays bounded.
- Product outcome observations are recorded for delivered work.
