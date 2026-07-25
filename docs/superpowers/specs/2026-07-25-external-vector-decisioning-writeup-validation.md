---
status: research-capture
backlogItem: PENDING-MCP-FILING
epic: EP-DECISION-TIER-REBALANCE
date: 2026-07-25
relatedDocs:
  - docs/architecture/vector-decisioning-and-jsi.md
  - docs/superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md
  - docs/superpowers/specs/2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md
  - docs/superpowers/plans/2026-07-24-weight-inference-from-rulings.md
  - docs/design/golden-triangle-design.md
  - docs/architecture/trusted-ai-kernel.md
---

# External Vector-Decisioning Write-Up — Validation, Corrections, and Gaps

## Origin

Operator shared an external AI-generated write-up (produced via Gemini, source:
`share.gemini.google.com`, fetched and transcribed manually into this conversation on 2026-07-25)
titled *"System Architecture, Job Specific Intelligence (JSI), and Vector Decisioning Framework for
Governed AI Operations in the Open Digital Product Factory."* It presented a formal
Multi-Attribute Utility Theory (MAUT) / Analytic Hierarchy Process (AHP) mathematical apparatus,
per-coworker numeric stance vectors, and a "Golden Triangle" cost/quality/speed provider-selection
formula, claiming these were "derived and refined based on our work and external sources."

Per AGENTS.md's `never-fabricate` commandment, every claim was checked against the live codebase
before being taken as input to platform design. This document is that validation, followed by
the corrected mapping onto what DPF actually has, and the gaps worth pursuing.

## Verdict

The write-up performed genuine reconnaissance of DPF's *public* marketing site
(opendigitalproductfactory.com) — real file paths, real terminology (WWMD/WWWD/WSID, Golden
Triangle, GAID, TAK), real persona names (Dale, Linda, Marisol), and real figures (21 market
categories, 95 archetypes) all check out. But the **mathematical formalism it presented does not
exist in the codebase**, and in the one place a design *decision* could be checked directly, the
write-up's proposed formula **contradicts an explicit, already-ratified DPF design decision**. This
is not "directionally right but rough" — it is confident invention layered over accurate scaffolding,
and the scaffolding is what makes it dangerous to accept uncritically: real paths and real
vocabulary lend borrowed credibility to invented math.

The good news, discovered during validation: DPF already has a **more rigorous, more carefully
externally-grounded** real decisioning architecture than what the write-up proposed — including a
same-week internal design (JSI, authored 2026-07-24) that independently arrived at some of the same
concerns (objective weighting, "add more vectors where there is more criteria") the operator raised,
with real citations to contextual bandits, concept-drift detection, and revealed-preference theory
already in place. The corrected document (`docs/architecture/vector-decisioning-and-jsi.md`) states
that real architecture properly, with accurate external prior art, rather than the invented one.

## What checked out

| Claim | Verdict | Evidence |
|---|---|---|
| WWMD / WWWD / WSID as named decision scopes | Real | `docs/design/golden-triangle-design.md` §5; `docs/founder-kernel/SCHEMA.md` |
| 21 market categories / 95 archetypes | Real, accurate | `docs/index.html`: "Twenty-one market categories and 95 leaf archetype templates ship with the platform." |
| `evaluator.ts`, `agent-grants.ts`, `agent_registry.json`, `trusted-ai-kernel.md`, Edge Node spec paths | Real | All exist as described |
| "Golden Triangle" as a named DPF concept | Real | `docs/design/golden-triangle-design.md`, actively shipping (v0.3.5) |
| GAID | Real | `docs/architecture/GAID.md`, "Global AI Agent Identification and Governance" |
| Dale, Linda, Marisol | Real names | `docs/personas/` — **but these are human customer dogfood/marketing personas** (an HVAC shop owner, a clinic scheduler, a retail-shop owner), not AI coworkers |
| "JSI" (Job Specific Intelligence) | Real, very recent | `docs/superpowers/specs/2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md`, authored 2026-07-24 — the write-up happened to reuse a name that exists, though it redefines what it means (see below) |

## What was fabricated

1. **MAUT/AHP/Saaty formalism.** No pairwise comparison matrix, no eigenvector weight derivation, no
   Consistency Ratio check exists anywhere in the repo. The real `evaluator.ts` computes an
   evidence-coverage confidence score (freshness × evidence-grade × review × promotion discount
   factors), not a multi-attribute utility function over a 5D stance vector.
2. **Citation integrity.** The MAUT/AHP claims were footnoted `[1][2]`, but the reference list shows
   `[1]`/`[2]` are DPF's own homepage and market-vision page — not Keeney & Raiffa, not Saaty 1980,
   not any actual MCDA source. The citations do not support the math attached to them.
3. **The Golden Triangle formula contradicts the real design.** The write-up proposed a literal
   per-provider cost/quality/speed utility scalar product. The real design explicitly rejects this:
   *"Soft preference weighting. Do not claim literal zero-sum optimization... the UI must not assert
   a fixed budget being divided"* (Decision 2). The real Golden Triangle is a 4-preset compiler
   (Fast/Frugal/Assured/Balanced), not a continuous per-task weight vector.
4. **Continuous proactivity score.** Real `ProactivityLevel = "quiet" | "balanced" | "assertive"`
   (three categorical values). The write-up invented a continuous `p_act ∈ [0,1]` with specific
   decimals per coworker — not real.
5. **Numbered HITL tiers ("Tier 0/1/2").** Not a real DPF taxonomy. Real tiering is named
   (`minimumTier: basic/adequate/strong` for model floors; `preview/single-file-edit/multi-file-refactor`
   for Build Studio capability).
6. **`EP-FINANCE-ACCOUNTING-CORE` / `EP-QUICKBOOKS-ACCOUNTING-BRIDGE`.** Not found as real epic IDs.
7. **Named AI-coworker taxonomy with per-coworker decimal stance/Golden-Triangle vectors** (the full
   "Taxonomy 1" and "Taxonomy 2" tables). No evidence any of these numeric assignments exist;
   Dale/Linda/Marisol in particular are customer personas, not coworkers, recast with invented
   vectors.

## Where the write-up's redefinition of JSI diverges from the real one

The write-up used "JSI" as shorthand for WSID ("craft-level professional grounding... audited,
domain-specific corpus"). The real, freshly-authored JSI spec (2026-07-24) is a **broader and more
precise claim**: not a rename of WSID, but the thesis that a coworker's competence should be a
designed, continuously-recalibrated property across three timescales (slow/doctrinal,
medium/revealed-preference, fast/contextual-situational) — WSID supplies only the slow-timescale
corpus and axes; JSI names the currently-missing medium and fast layers. This is a materially
better and more actionable framing than the write-up's, and is what the corrected document builds
on rather than the write-up's WSID-is-JSI conflation.

## Gaps identified worth pursuing

1. **AHP-style pairwise elicitation as a cold-start technique.** Sound decision theory, and a
   legitimate technique DPF does not currently implement — but it should enter the *existing*
   `WeightAdjustmentProposal` ladder (`weight-inference.ts` / `weight-proposal-store.ts`) as a
   cold-start input, not a parallel authority model. See
   `docs/architecture/vector-decisioning-and-jsi.md` §4. Not yet scoped as a BI.
2. **The medium-timescale weight-inference engine has zero live callers.** Already tracked as
   `BI-D88DFEEA` under `EP-DECISION-TIER-REBALANCE` — this validation surfaces no new gap here, it
   confirms the JSI spec's own finding is the higher-leverage piece of unfinished work, ahead of
   pursuing AHP cold-start elicitation.
3. **No durable, externally-cited reference document existed for DPF's real vector-decisioning
   mathematics** before this session — the mechanism was correct but scattered across four specs
   with inconsistent citation discipline (the Golden Triangle spec cites rigorously; the tier-rebalance
   and JSI specs cite well; nothing tied them together against the literature in one place, and
   nothing existed at the reference-doc altitude of `trusted-ai-kernel.md`). Closed by
   `docs/architecture/vector-decisioning-and-jsi.md`, added this session.

## Backlog note

This session has no reachable `dpf` MCP connector and no reachable live Postgres (remote session;
see the equivalent note in `docs/superpowers/specs/2026-07-25-ornith-1-local-coding-model-design.md`
for the full diagnostic). No `BacklogItem` was fabricated. If the operator wants the AHP
cold-start-elicitation gap (above) tracked as live work, file it from a session with `dpf` MCP/DB
access, linked to `EP-DECISION-TIER-REBALANCE` — draft payload:

```
type: product
workType: feature
source: user-request
epicLink: EP-DECISION-TIER-REBALANCE
title: AHP-style pairwise elicitation as cold-start input to the weight-adjustment-proposal ladder
description: >
  For a brand-new org profile or archetype with no decision history, weight-inference.ts's sample
  floor (>=8 observations) blocks any revealed-preference signal. Saaty's AHP pairwise-comparison
  method (1-9 intensity scale, eigenvector-derived weights, Consistency Ratio check) is a
  well-validated way to extract an initial weight vector from a non-technical operator without
  requiring raw numbers. Scope: enters the existing WeightAdjustmentProposal ladder
  (weight-proposal-store.ts) at the same sub-"unconfirmed" confidence tier as any other proposal;
  does not create a new authority model; cannot declare new spine axes. Sequenced behind
  BI-D88DFEEA (the medium-timescale adapter is the higher-leverage, already-designed gap). See
  docs/architecture/vector-decisioning-and-jsi.md §4.
```
