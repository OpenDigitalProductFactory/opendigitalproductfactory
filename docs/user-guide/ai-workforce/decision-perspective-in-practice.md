---
title: "Decision Perspective in Practice (WWMD / WWWD / WSID)"
area: ai-workforce
order: 6
---

## What this page adds

The [Decision Perspective & Persona Voice](decision-perspective.md) page describes *what* the
three decision scopes are. The platform [overview](../../architecture/platform-overview.md) and the
[architecture note](../../architecture/autonomy-and-wwmd.md) describe *how the machinery is wired*. This
page closes the gap they both leave: it walks a **real question end-to-end through the gate** for
each scope — the situation, the options the coworker framed, the **decision vectors that were
scored**, the outcome the gate returned, and the ledger row it wrote — and then shows how
**employee-in-the-loop** (recorded internally as the HITL tier) and the **immutable decision ledger** wrap every one of them.

The three scopes are the same engine pointed at three different bodies of doctrine:

| Scope | Shorthand | Answers | Backed by |
|-------|-----------|---------|-----------|
| **WWMD** | *What Would Mark Do?* | "What would the **founder / platform** do here?" | The founder-kernel wiki (tiered principles) |
| **WWWD** | *What Would We Do?* | "What would **this organization** do here?" | The org's governed knowledge corpus |
| **WSID** | *What Should I Do?* | "What would a **competent professional in this role** do here?" | A per-profession, source-traced corpus |

All three share the inner scoring engine
([`apps/web/lib/decision/option-scoring.ts`](https://github.com/OpenDigitalProductFactory/opendigitalproductfactory/blob/main/apps/web/lib/decision/option-scoring.ts)),
the four-outcome contract (`recommend` / `arbitrate` / `escalate` / `defer`), and the same audit
ledger (`DecisionInteraction`). The worked numbers below are **representative illustrations of the
real math**, not transcripts of a single captured run — they show how the contribution ledger adds
up, so you can read a real one.

## Anatomy of one interaction

Every gate call, regardless of scope, runs the same six steps. Keep this picture in mind while
reading the examples — each example is just this loop with different doctrine loaded.

1. **Retrieve** — `wiki_query` pulls the principles and prior decisions in scope (founder-kernel for
   WWMD, the org corpus for WWWD, the profession corpus for WSID), by vector search with optional
   PageRank re-ranking over the wiki link graph.
2. **Frame options** — the coworker turns the ambiguity into 2–4 concrete options, each with a
   plain-language description and explicit feature scores on the principle dimension registry
   (`reusability`, `blast_radius`, `schema_grounding`, `speed_to_value`, …).
3. **Score** — `principle_decide` computes, for every option × principle pair, an `alignment` in
   `[-1, 1]`, then a **contribution** = `principle.weight × alignment`. An option's **composite** is
   the sum of its contributions. Tier sets the weight: **commandment 1.0, core 0.4, contextual 0.1**.
4. **Guardrails** — the engine flags a close `margin` (→ `confidence: low`), weak structured coverage
   (too many semantic fallbacks), and `commandmentConflict` (a commandment contributing strongly
   negatively to the winner). The autonomy policy and risk tier then map the scored result onto one
   of the four outcomes.
5. **Outcome** — `recommend` / `arbitrate` / `escalate` / `defer`, with the winning option,
   composite scores, margin, confidence, and the per-principle contribution ledger.
6. **Ledger** — a `DecisionInteraction` row records the profile + version, domain class, outcome,
   confidence before/after, cited sources, rationale, the resolved profile chain, and whether an employee
   escalation or deferral follow-up was captured.

---

## Example 1 — WWMD: generalize for the hive, or keep it local?

**Situation.** During the Dale HVAC dogfood install, the `build-specialist` coworker has just built an
"overdue jobs" widget for the dispatcher board. Before it ships, it hits an open product question
that code can't answer deterministically.

**Question (`domainClass: architecture-tradeoff`, `riskTier: medium`).**
> Should the overdue-jobs widget be generalized into the reusable workspace-home primitive library
> (parameterized for any archetype) and offered to the Hive Mind, or kept local to this HVAC install?

**Options framed.**

- **A — Keep local.** Hard-code HVAC vocabulary and ship today. Fast, but the next install rebuilds it.
- **B — Parameterize for the hive.** Lift it into the primitive library behind the projection service
  so trades, clinics, and retail all inherit it. Slower now, compounding later.

**Decision vectors scored.** Three principles were in scope. Each cell is a *contribution*
(`weight × alignment`); the composite is the column sum.

| Principle (tier · weight) | What it pulls on | Option A contribution | Option B contribution |
|---|---|---:|---:|
| Learnings belong in the shared commons (**commandment · 1.0**) | `reusability`, `operational_independence` | +0.10 | **+0.85** |
| Architecture over shortcuts (**core · 0.4**) | `long_term_maintainability`, `blast_radius` | +0.12 | **+0.32** |
| Speed to value (**contextual · 0.1**) | `speed_to_value` | **+0.09** | +0.05 |
| **Composite** | | **0.31** | **1.22** |

**Result.** Winner **B**, `margin = 0.91` (well above the `0.2` tie threshold → `confidence: high`),
`structuredCoverage: strong`, `commandmentConflict: false`. The contextual "ship faster" pull is real
but, at weight `0.1`, never overcomes a commandment-tier reusability pull at weight `1.0` — which is
exactly the point of tier weighting.

> **Outcome: `recommend` Option B.** Rationale: *"Parameterizing for the hive is favored by the
> commandment-tier commons principle and the core maintainability principle; the only pull toward
> keeping it local is contextual speed-to-value, which is outweighed."* The coworker still owns
> execution and approval — `recommend` advises, it does not act.

This is the **autonomy flywheel** in one frame: the answer is not a vibe, it is a column sum you can
audit, and the reusability win is what feeds the next install for free.

---

## Example 2 — WWWD: a customer asks for terms the org hasn't decided yet

**Situation.** On a customer install, the `customer-advisor` coworker is handling a commercial account.
WWWD here is the **organization's** scope, not the platform's — and the non-inherit boundary is
load-bearing: the org may not have encoded a policy yet, and the platform must **not** invent one for
it.

**Question (`domainClass: risk-assessment`, `riskTier: high`).**
> A repeat commercial customer wants net-60 payment terms instead of our standard net-15 on a $12k
> job. Approve, counter, or decline?

**Options framed.** A — Approve net-60. B — Counter at net-30 with a deposit. C — Decline, hold net-15.

**Decision vectors scored.** The gate retrieves against the org's WWWD corpus and finds it thin: the
organization has onboarding context and a storefront, but **no approved credit-terms or
accounts-receivable-risk material**. The only doctrine that *would* match is DPF platform product
guidance — which, by the non-inherit boundary, is **advisory only and cannot be authoritative for a
customer's business decision**.

| Signal | Value | Effect |
|---|---|---|
| Applicable org (WWWD) materials | 0 promoted, 0 approved | `coverageGap: true` |
| Resolved profile chain | `[WWWD-ORG → DPF-doctrine(advisory) → defer]` | platform judgment not borrowed as authority |
| Confidence | low | below the autonomy policy's recommendation floor |
| Risk tier | high | high risk forces an employee resolver regardless |

**Result.** The gate will not fabricate a credit policy from the founder kernel, and it will not let a
high-risk financial commitment ride on low confidence.

> **Outcome: `escalate`** to the business owner via the **owner/operator review queue**, with
> `gapReason: no-applicable-material`. The work pauses; an approval surface is raised showing the
> three framed options and the empty-coverage explanation. If the org never wants the coworker to
> decide this class at all, the same surface is where they say so.

**The learning loop closes the gap.** When the owner resolves it ("net-30 with a 25% deposit for
accounts over 12 months old"), that resolution is captured as **draft** WWWD material. Once an owner
reviews and promotes it, the *next* time this question arises the gate retrieves real org doctrine,
scores it, and can return `recommend` with the org's own policy as the cited source — and the ledger
shows the profile version that made each decision, so the two interactions never look identical.

This example is the whole reason WWMD and WWWD are separate scopes: **a customer's business judgment
is the customer's to author**, and until they author it the honest answer is "escalate," not a guess
dressed up as confidence.

---

## Example 3 — WSID: what a competent data architect would do

**Situation.** Inside a Build Studio build, the `build-data-architect` coworker is adding an `Invoice`
table. It hits a craft question with a well-established professional answer — the kind of thing the
underlying LLM might get right *or* might improvise. WSID makes the answer **source-traced** instead.

**Question (`domainClass: professional-practice`, `riskTier: medium`).**
> The invoices table needs a monetary `amount` column. Store it as `FLOAT`, `DECIMAL(12,2)`, or
> integer cents?

**Options framed.** A — `FLOAT`. B — `DECIMAL(12,2)`. C — integer cents (`BIGINT`).

**Decision vectors scored.** The gate resolves against the **`WSID-DATA-ARCHITECT`** profession profile
*first*, whose corpus is distilled from fetched, verifiable sources (DAMA-DMBOK2 on data quality,
ISO/IEC 9075 / ANSI SQL on exact numeric types). Contributions (`weight × alignment`):

| Profession principle (tier · weight) | Source | A `FLOAT` | B `DECIMAL` | C cents |
|---|---|---:|---:|---:|
| Use exact numeric types for money (**commandment · 1.0**) | ISO/IEC 9075 §exact numeric | **−0.90** | +0.95 | +0.90 |
| Preserve precision across arithmetic (**core · 0.4**) | DAMA-DMBOK data quality | −0.32 | +0.36 | +0.34 |
| Minimize application-layer conversion (**contextual · 0.1**) | corpus heuristic | +0.05 | +0.09 | −0.06 |
| **Composite** | | **−1.17** | **1.40** | **1.18** |

**Result.** Winner **B** (`DECIMAL(12,2)`), with **C** a close second (`margin = 0.22`, just over the
threshold → `confidence: high` but narrow). Critically, **`FLOAT` triggers `commandmentConflict`**: a
commandment-tier principle contributes strongly negatively (`−0.90`) to it, so even if a prompt nudged
the model toward `FLOAT` "for performance," the gate flags it as violating professional doctrine.

> **Outcome: `recommend` Option B**, with the cited corpus pages attached so a reviewer sees *why*:
> "exact numeric type for currency (ANSI SQL); integer cents is an acceptable alternative." The
> rationale is grounded in fetched sources, **not** model memory — which is the entire WSID value
> proposition.

If the profession corpus had **no** material on the question, the gate would fall back through
`role → org WWWD → DPF doctrine (advisory) → defer-with-gap-capture` — the same auditable chain you
saw escalate in Example 2.

---

## Human-in-the-loop: where a person enters each path

The four outcomes are not a fixed automation level; they are inputs to the **autonomy policy** and the
**oversight level** for the calling coworker. The two work together:

| Outcome | Default employee involvement | Governed by |
|---|---|---|
| `recommend` | Coworker proceeds; the recommendation is logged and remains reversible. The caller still owns approval of any *action* the recommendation implies. | Tool grants + action approval envelope |
| `arbitrate` | Allowed **only** for low-risk decisions above the policy's confidence floor; otherwise treated as `escalate`. | `DecisionAutonomyPolicy.maxRiskForArbitration` + confidence floors |
| `escalate` | Work pauses; an approval surface is raised to the right resolver (founder review for WWMD, owner/operator review for WWWD). | Oversight level + resolver rule |
| `defer` | No guess is made; the unanswered question is captured as a **profile gap** for curation. | Review queue + enrichment pipeline |

Two rules make this trustworthy rather than theatrical:

- **High risk overrides confidence.** A `high` or `critical` risk tier raises an employee surface even when
  the math looks strong — Example 2 escalated partly for this reason. Autonomy is earned per risk tier,
  not granted globally.
- **Oversight levels bound autonomy independently of the gate.** Tier 0 (executive oversight) through Tier 3
  (informational) gate *whether the coworker may act at all*; the Decision Perspective outcome only
  decides *what the coworker recommends doing*. A Tier-1 coworker with a `recommend` outcome still
  routes its resulting action through manager approval. See
  [authority and audit](../platform/authority-and-audit.md) and the AI Workforce
  [Authority tab](index.md).

The **confidence model** is what lets the employee surface appear less often over time without lowering the
bar: *confidence is earned in drops and lost in buckets.* A recommendation that is made, observed, and
employee-confirmed nudges the profile's confidence for that domain up slowly; one contradicted or stale
rationale pulls it back fast.

## The immutable decision ledger

None of the above is trustworthy unless it is **reconstructable after the fact**. Every gate call —
`recommend`, `arbitrate`, `escalate`, *and* `defer` — writes an append-only `DecisionInteraction` row.
Nothing is edited in place: a profile change snapshots a **new version**, so an old interaction always
resolves against the doctrine that was actually live when it ran.

A single ledger row carries enough to answer "what perspective governed this decision, and on what
evidence?":

| Field | Example 1 (WWMD) | Example 2 (WWWD) | Example 3 (WSID) |
|---|---|---|---|
| `profileId` + `profileVersionId` | Mark / DPF Platform · v-N | Customer org · v-N | `WSID-DATA-ARCHITECT` · v-N |
| `domainClass` | architecture-tradeoff | risk-assessment | professional-practice |
| `outcomeType` | recommend | escalate | recommend |
| `confidenceScore` | high (margin 0.91) | low | high (margin 0.22) |
| `resolvedProfileChain` | platform | org → doctrine → defer | profession → … |
| `sources` | commons + architecture principles | (empty — coverage gap) | ANSI SQL + DMBOK pages |
| `rationale` | top-contributor summary | empty-coverage explanation | source-cited summary |
| `escalationCaptured` / `deferralCaptured` | — | escalation captured | — |

This ledger is one strand of the platform's broader **append-only authorization decision log and
chain-of-custody traces**, which link principal → agent → tool call → approval → outcome for *any*
governed action, not just gate calls (see the
[Observability & evidence](../../architecture/platform-overview.md) section of the overview and
[authority and audit](../platform/authority-and-audit.md)). The operator-facing projections of a
gate decision are:

- **Decision Canvas** — a read view of one `DecisionInteraction`: the question, options, recommendation
  or deferral, confidence, which materials pulled the result, and the next action — without leaking
  internal tool names.
- **Material Backlinks** — the bounded neighborhood of a cited principle: related stances, heuristics,
  citations, and prior decisions (approved/promoted material only).
- **Review queues** — unresolved `escalate`/`defer` decisions grouped by gap reason; founder-review
  wording for WWMD, owner/operator wording for WWWD.
- **Operations Map** — decision-pressure overlays, so a rising escalation rate on one profile is visible
  next to cost pressure.

## How the three examples relate

Read together, the trio shows the same engine producing the *right kind* of answer for the *kind of
doubt* it faces:

- **WWMD** had strong, tiered platform doctrine → confident `recommend`, and the reusability win feeds
  the hive.
- **WWWD** had a genuine coverage gap and a high-risk business call → honest `escalate`, because a
  customer's business judgment is the customer's to author and the platform refuses to borrow its own
  doctrine as authority.
- **WSID** had crisp professional doctrine with a commandment that actively *blocked* the tempting-wrong
  option → source-traced `recommend` with a `commandmentConflict` flag on `FLOAT`.

In all three, an employee is in the loop at exactly the point where judgment is genuinely required, and
the ledger makes every path — including the ones where the platform chose *not* to decide —
reconstructable.

## Related reading

- [Decision Perspective & Persona Voice](decision-perspective.md) — the capability reference (profile
  kinds, inheritance chain, voice layer)
- [Autonomy, WWMD, and trusted coworker decisions](../../architecture/autonomy-and-wwmd.md) — the architecture
  note and code references
- [Authority and audit](../platform/authority-and-audit.md) — oversight levels, tool grants, and the
  authorization decision log
- Specs: `docs/superpowers/specs/2026-05-17-wwmd-decision-perspective-kernel-design.md`,
  `docs/superpowers/specs/2026-06-09-wsid-coworker-professional-corpus-design.md`
