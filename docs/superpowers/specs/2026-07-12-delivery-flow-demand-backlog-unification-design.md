# Delivery Flow — unify Demand + Backlog into one pipeline

**Date:** 2026-07-12
**Epic:** EP-DELIVERY-FLOW
**Status:** Design accepted (kernel-ratified) → phased build
**Kernel:** `principle_decide` (in_platform_coworker) → **unify-flow-ai-led**, composite **7.28**, margin **2.36**, confidence **high**, no commandment conflict. Beat `seam-only` (lighter) and `greenfield`.
**Operator stance:** the platform is **AI-built and AI-led on execution** — coworkers volunteer forward; humans lead and decide.

## Problem
`/ops` (Backlog) and `/ops/demand` (Demand) are **two lenses on the exact same `BacklogItem` rows**, rendered under one "Delivery" nav tab group, with **no visible handoff** between them — so ~600 rows appear twice as confusingly-similar boards.

- **Backlog** board columns = `BacklogItem.status` (`triaging→open→in-progress→done→deferred`) — the **execution / burn-down** lens.
- **Demand** funnel columns = `BacklogItem.demandStage` (`raw→screened→shaped→ready`) — the **investment / value÷effort** lens, ordered by `demandScore` (RICE default), gated into "Ready" by the governed `approve_demand_for_funding` (WWWD stance → decision ledger).
- Schema comment (schema.prisma ~1325): *"demandStage is an additive funnel facet orthogonal to status."* Nothing syncs the two axes; the score is invisible on the Backlog board.

## The design — one river, two halves, joined by the bet
```
── DEMAND (invest) ──────────────┊── BACKLOG (execute) ──────
Raw → Screened → Shaped → Ready  ┊  In Progress → Done
     value÷effort · RICE        the bet     who · burn-down
```
1. **One left-to-right Delivery Flow**, two *deliberately different* visual languages: a narrowing, score-tinted **funnel** upstream; a WIP-limited **status board** downstream. Kills the "two look-alike boards" confusion.
2. **The bet is the seam** — the one crossing where a `Ready`, funded item becomes committed work. It's the existing `approve_demand_for_funding` governed gate made *visible*.
3. **One item, two faces** — upstream a card shows its **score + estimate**; once it crosses the bet it shows its **owner + burn-down**. Same `BI-…`, no copy, one flow. A lens switch (Flow / Prioritize / Execute) zooms into either half over the same dataset.

## Collaborative estimation (the "÷ effort")
Estimation *is* the score's denominator — today invisible and single-source. Make it a **visible, attributed, collaborative act**:
- **AI-first, forward:** a coworker proposes a first-pass estimate the moment an item lands.
- **Human confirm/overrule:** a person can set or change it.
- **Divergence surfaces:** when AI and human disagree, the card shows it (`⇄ 8 ↔ 3 · reconcile`) and the score is provisional until reconciled.
- **Agreed** estimate feeds `demandScore`. Prioritisation is only as trustworthy as the estimate behind it — and everyone sees whose number it is.

## AI-led execution (the synced bet)
Not "assign to a coworker" — **coworkers volunteer**. Crossing the bet triggers a **proactive coworker to self-task and claim** the funded item, advancing `status` on its own (the *synced* bet). This reuses existing substrate — **proactivity levels** (per-user-per-agent) + **self-tasks** + advise/act — so it is **governed per coworker**: a quiet coworker asks first, a forward one auto-claims. Humans stay at the lead altitude (shape, estimate, approve the bet, decide at the `🙋 needs-you` gates a coworker raises).

## Substrate (all additive — no green-field)
Same `BacklogItem`; `demandStage`/`status`/scoring inputs/`demandScore`/`investmentBucket` already exist. Surfaces: `apps/web/app/(shell)/ops/page.tsx` (OpsClient), `apps/web/app/(shell)/ops/demand/page.tsx` (DemandBoard), nav `apps/web/components/ops/ops-nav.ts`. Volunteering wires the demand→ready seam to the proactivity/self-task engine.

## Phased build (EP-DELIVERY-FLOW)
1. **BI-E731A6C1** — estimate **provenance + agreement** facets on `BacklogItem` (human/AI/agreed/divergent), additive nullable, feeds `demandScore`. *(write-model first)*
2. **BI-1DE21746** — the **Delivery Flow surface**: funnel→bet→board, two visual languages, one-item-two-faces, nav collapse to one Flow with lens sub-views.
3. **BI-A6648529** — **AI-led volunteering**: funding the bet triggers a proactive coworker to self-task/claim → advance status; governed per proactivity.
4. **BI-AA1763CD** — **collaborative estimation UX**: AI proposes on arrival, human confirm/overrule, reconcile divergence.

Mockup (private): the Delivery Flow board with the funnel, the amber "bet · a coworker volunteers" gate, estimate chips (AI/human/agreed/diverge), and the AI-led-execution callout.

## Success criterion
Demand and Backlog no longer read as two duplicate boards — they read as **one continuous investment-funnel → execution-board flow**, where funding a bet visibly pulls a coworker forward to build it, and every estimate shows whose judgment it carries.
