---
status: draft
---

# WWWD archetype initiation criteria — the entry gate that decides *which* decisions the business owns (BI-7728C3B7 Part 1)

Design author: Claude Opus 4.8, on a software-platform operate-organization install, 2026-09-18.
Epic: EP-DECISION-TIER-REBALANCE. Backlog item: BI-7728C3B7 (Part 1 — the elicitation half).
Prior art shipped: PR #5395 (BI-7728C3B7 Part 2 — the baseline stance corpus).

## 1. Problem

WWMD (platform doctrine) is mature and auto-resolves (~0 open reviews). WWWD (a customer's business
stance) over-escalates. The engine defect behind most of it is fixed and live (BI-9E1E1939, PR #5391:
an ambiguous parse no longer vetoes a valid directional verdict). **Part 2 of this BI then shipped the
baseline *answers*** — `seedOrgWwwdCorpus()` now seeds, at onboarding, a per-archetype stance corpus
(`archetype-business-context.ts` → `INDUSTRY_STANCE_VECTORS`, projected through `stance-dimension-map.ts`),
and `backfillOrgWwwdOnBoot()` converges existing installs.

**What Part 2 did not do — and what this spec covers — is establish the *entry criteria*.** Part 2
seeds a `decision-scope` vector at *platform-default altitude*: a generic starting stance that "states
which questions the business owns and which route to a craft or a supplier." It does not make that
scope judgment **archetype-specific**, and it does not run **before** the org-business gate asserts
authority. So today every authored question still *reaches* `evaluateOrgBusinessDecisionGate` and is
answered as a business-stance question — even when, for this archetype, it is really a craft call (WSID),
a supplier's obligation, a regulation/contract lookup, or a routine operation that should never have
been a decision at all. The operator's 2026-09-16 reframing put this first: **"elicit, per archetype,
the criteria for initiating WWWD at all"** — the more important half, because seeding good *answers* to
questions the business should not even be asked is the conflation hardening into doctrine (BI-13C38318,
BI-62C320EA).

## 2. Goal

A freshly installed (or backfilled) archetype carries an **initiation-criteria profile** that, for an
incoming decision, classifies its **scope** *before* WWWD asserts authority:

- **business-owned** → proceed to the WWWD stance corpus (Part 2's substrate).
- **craft** → route to the owning WSID profession surface, not the owner.
- **supplier / external-obligation** → this is a vendor or partner's obligation under an existing
  contract; surface the obligation, do not escalate a business ruling.
- **research-required** → the answer is determined by regulation or an existing contract; research and
  cite before (if ever) escalating (pairs with BI-4E6BEC99 / BI-19B350FD).
- **routine / pre-authorised** → a normal operational action; run under an operational pre-auth posture,
  never the owner gate (BI-88D51B8F).

The owner's queue then holds only genuinely novel, business-owned, high-stakes calls — the WWMD-baseline
end state, per archetype, from day one.

## 3. Non-goals

- Not re-opening the engine defects (fixed: BI-9E1E1939; sibling BI-7E1F128A, BI-F5F2869D).
- Not the retract-stance tool (BI-BD9DEC45) — a separate, related capability.
- Not re-homing the six mis-filed field-service stances (owner governance action; tracked on BI-62C320EA
  and already archived out of this software-platform install's overlay in this program).
- Not authoring the elicited *content* for every archetype in one change — this spec establishes the
  **mechanism and the seed shape**; per-archetype criteria accrete like `INDUSTRY_STANCE_VECTORS` did.

## 4. Design

### 4.1 The initiation-criteria model (extends, does not fork, Part 2)

Add an `initiationCriteria` block to the existing per-archetype context in
`apps/web/lib/onboarding/archetype-business-context.ts`, resolved by the same
`resolveBusinessProfile(categoryOrSlug)` merge (industry profile ← archetype override) that already
governs stance vectors — single source of truth, no parallel store (AGENTS.md §1, §8).

```
type DecisionScopeClass =
  | "business-owned" | "craft" | "supplier" | "research-required" | "routine-preauth";

type InitiationCriterion = {
  /** A decision class this archetype recognises, e.g. "employee location capture". */
  decisionClass: string;
  /** Where it belongs for THIS archetype. */
  scope: DecisionScopeClass;
  /** For craft: which WSID profession owns it. For supplier: the obligation surface. */
  owner?: string;
  /** What must be established before the question is answerable (context / research pointer). */
  entryContext?: string;
  /** Confidence this is a settled routing vs. an editable starter. Seeds land UNCONFIRMED. */
};
```

Seeds land **unconfirmed** and carry **no decisive weight**, exactly as Part 2's stance vectors do
(`unconfirmed B/0.6`, effective 0.45 < every band). Nothing is minted at `ruled` tier; the platform never
fabricates an owner ruling. The "How you decide" onboarding step (existing) gains an initiation-criteria
confirmation surface where the owner upgrades a routing to confirmed A/0.9 or edits it.

### 4.2 The scope pre-classifier (runs before the gate)

A pure `classifyDecisionScope({ question, archetype, criteria })` that the org-business decision path
calls **before** `evaluateOrgBusinessDecisionGate`. It reuses the semantic-relevance layer already proven
healthy on the WWWD path (the same embedding retrieval `alignment-criteria` uses post-#5391) to match an
incoming question to the archetype's `initiationCriteria`, returning the `DecisionScopeClass` + routing.
Only `business-owned` continues into WWWD. Everything else returns a typed routing outcome the queue
renders as "not a business decision — here is where it belongs / what it needs," never an escalate card.
When scope cannot be established with confidence, it **abstains** to `business-owned` (fail-safe: a real
business question is never silently dropped) but flags low routing confidence for the owner to teach —
mirroring the abstention discipline BI-9E1E1939 established for the alignment layer.

### 4.3 Install-time + backfill wiring

- `seedOrgWwwdCorpus()` seeds the archetype's initiation-criteria pages alongside the Part 2 stance
  vectors (same idempotent upsert-by-(orgId, slug) path).
- `backfillOrgWwwdOnBoot()` extends its `STANCE_VECTOR_KEYS`-style completeness count to include the new
  criteria keys, so an install that has Part 2 but not Part 1 re-runs the idempotent chain once on next
  boot — the exact convergence pattern Part 2 shipped.
- **UX budget constraint (learned in #5395):** every added seed costs arrival words on
  `/coworker-decisions/stance` (budget 450; the route was already tight). The initiation-criteria
  confirmation surface must arrive with its progressive-disclosure shape already designed
  (lead sentence visible, rest behind disclosure), not discovered by the UX route sweep. This is a
  first-class acceptance criterion, not a follow-up.

## 5. Research & Benchmarking

- **Open Policy Agent (OPA/Rego)** — decision *classification and routing* as policy-as-code. Adopt the
  separation of "which policy applies" (our scope pre-classifier) from "what the policy says" (Part 2's
  stance corpus). Reject its per-request query model as the authoring surface: our owners are
  non-technical, so criteria are elicited as editable natural-language starters, not Rego.
- **RACI / decision-rights frameworks (Bain RAPID, classic RACI)** — the discipline of naming, *per
  decision class*, who is Accountable vs merely Consulted. Adopt: `scope` + `owner` on each criterion is
  a decision-rights assignment. Reject the static matrix; ours is archetype-seeded and owner-refinable.
- **ServiceNow decision tables / Salesforce approval processes** — industry pattern of routing a record
  to an approval path *by attributes evaluated before the approver sees it*. Adopt the "classify before
  route" ordering (our pre-classifier before the gate). Reject their per-tenant hand-configuration as the
  default: DPF seeds a working baseline per archetype so day-one behaviour is correct without setup.
- **DPF-internal precedent (reuse, do not reinvent):** the WWMD kernel's own gate-key routing and the
  `consequenceScope` classifier (BI-63B14D4B) already separate platform-scope from business-scope for
  *tools*. This spec is the same move for *authored questions*, at archetype altitude.

## 6. Success criteria (from BI-7728C3B7)

- WWWD open-review rate for covered decision classes drops toward the WWMD baseline (~0).
- A freshly installed archetype auto-routes its non-business decision classes away from the owner and
  auto-resolves business-owned ones from the seeded corpus.
- No authored question reaches the org-business gate without a recorded scope classification (closes the
  BI-13C38318 gap-2 guard).
- Regression: a genuine business decision for the archetype still reaches WWWD unchanged.

## 7. Phased delivery (backlog coverage)

- **Phase A** — `initiationCriteria` model + `resolveInitiationCriteria()` merge, generic + software-platform
  + field-dispatch seeds, unit tests. (This BI-7728C3B7.)
- **Phase B** — `classifyDecisionScope()` pre-classifier + gate wiring so only business-owned continues;
  typed non-business routing outcomes. (Depends on BI-88D51B8F operational pre-auth posture; coordinate.)
- **Phase C** — onboarding confirmation surface with designed progressive disclosure; backfill completeness
  extension; per-archetype criteria accretion. (Shares the UX route-sweep baseline discipline of #5395.)

## 8. Open questions for the owner / independent review

- The **elicited content** per archetype is genuinely owner/domain input — this spec seeds *defaults* and
  the *mechanism*; the field-dispatch and software-platform criteria still want an owner/domain pass
  before confirmed-tier. That elicitation is the "research first" work the operator named and is where
  this hands to owner + domain review, not to code.
- Coordination with BI-88D51B8F (routine pre-auth) and BI-4E6BEC99 (research-required) so the four
  non-business scopes each have a real downstream handler, not just a label.
