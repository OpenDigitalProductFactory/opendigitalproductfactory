---
title: Customer zero and use case zero — what self-hosting proves, and what it doesn't
description: DPF's first install is both its first real business (customer zero) and the platform iterating on itself (use case zero). This document draws the line between the two, maps it onto the four-portfolio view, and names what n=1 can and cannot validate.
---

# Customer zero and use case zero

## Why this document exists

DPF's first install belongs to the **Customer 0 operator** — the entity responsible for support,
sales, marketing, and the legal relationship with real users. (That operator's legal identity lives
in the install's private configuration, not in this repository — see
[OSS Repo Identity Hygiene](../operations/oss-repo-identity-hygiene.md).) That single install is
doing two jobs at once, and they prove different things:

- **Use case zero** — DPF iterating on itself. Build Studio writing DPF's own code, the governed
  self-upgrade path deploying it, the decision gates governing the transitions.
- **Customer zero** — that same operator running as a real business: a market offer that is sold
  and supported, a workforce (human and AI) doing the work.

The trust argument for the platform runs through both: *if we can trust DPF to iterate on itself
well, we can begin to trust it for other jobs and companies.* That argument is sound, but it is
only sound for **one half of the platform**. This document says which half, and why the four
portfolios are exactly where the line falls.

## The distinction

| | What customer zero **does** validate | What customer zero **does not** validate |
|---|---|---|
| Object | The **mechanism** | The **content** |
| Claim it supports | Decisions get captured, proposals surface, humans rule, nothing auto-mutates, evidence is recorded, gates hold | That what the platform *learned* here generalizes to a dental clinic, an HVAC shop, or an HOA |
| Why | The mechanism is identical on every install — it is platform substrate, not tenant data | The content is a function of one company's offer, workforce, and preferences, at n=1 |
| What would strengthen it | More volume of real, consequential work through the governed path | Customer one, with a genuinely different operator and a different archetype |

Both halves are necessary. Neither substitutes for the other. The failure mode this document
exists to prevent is reading a validated **mechanism** as a validated **judgment** — "the platform
learned something and we ruled on it, therefore the platform knows how businesses should decide."

### The n=1 trap, stated precisely

At customer zero the founder is simultaneously the author of platform doctrine (WWMD) and the
operator of the organization whose stance is being learned (WWWD). The architecture enforces the
non-inherit boundary between those scopes — `decisions-belong-to-their-scope`, and
`resolveProfileMaterialForOrg()` resolving by `ownerOrganizationId` rather than falling back to the
platform profile (BI-230C9EF7). But at n=1-with-the-same-human the boundary is **architecturally
intact and epistemically collapsed**: revealed-preference inference will faithfully conclude that
this organization agrees with the kernel, because it is the same judgment wearing two hats.

This is the same pathology the decision-tier rebalance already measured in a different form:
~41% of kernel principles are one specialist's corpus sitting at doctrine altitude, and the
effective dimension rank is ≈6 of 19 because most principles load the same handful of axes
([`2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md`](../superpowers/specs/2026-07-23-decision-tier-rebalance-and-vector-epistemology-design.md) §1.1–1.2).
Single-source corpora concentrate; they do not generalize. The fix is not to stop learning at
customer zero — it is to **tag where the learning came from** so a later step can tell concentrated
signal from general signal.

## The four-portfolio view is the same line

DPF's canonical portfolio roots (`packages/db/data/portfolio_registry.json`, anchored to IT4IT
§6.1–6.4 and the Open Group DPPM paper G252) split cleanly along this boundary:

| Portfolio | Role | Side of the line |
|---|---|---|
| **Products & Services Sold** | The market offer — what the company sells to external consumers (DPPM "Provided Externally") | **Dividing line.** Radically different per company. Customer 0 sells the platform itself; a clinic sells appointments. n=1 proves nothing here. |
| **Workforce** (`for_employees`) | The workforce and the internal products it consumes — employees, contractors, AI coworkers, robots, any accountable actor (DPPM "Provided Internally") | **Dividing line.** Who does the work, and how, is company-specific. |
| **Foundational** | Infrastructure, platform services, architectural building blocks | **Embedded.** Identical substrate on every install. Validating it at customer zero validates it fleet-wide. |
| **Manufacturing & Delivery** | The internal manufacture and delivery pipeline — CI/CD, build tooling, release orchestration, deployment automation | **Embedded.** This *is* use case zero. Build Studio lives here. |

The two business-critical portfolios are the dividing line; **Foundational and Manufacturing &
Delivery are embedded beneath them where applicable**, which is precisely the DPPM dependency
direction (G252 §4, restated in
[`2026-06-07-business-operating-model-portfolio-wiring-design.md`](../superpowers/specs/2026-06-07-business-operating-model-portfolio-wiring-design.md) §2):

```text
Products & Services Sold  ─┐
                           ├── both depend on ──▶  Foundational
Workforce                 ─┘                             ▲
                                                          │ deployed and supported by
                                              Manufacturing & Delivery
```

So the mapping is exact:

- **Mechanism** (what customer zero validates) = Foundational + Manufacturing & Delivery. Shared
  substrate and shared factory. Exercising them hard at customer zero is genuine fleet-wide
  evidence, because there is only one of each.
- **Content** (what customer zero cannot validate) = Products & Services Sold + Workforce. These
  are populated *per company* from archetype and operator direction. One company's populated
  portfolios are a sample of one.

Every internal activity tracing *up* to a customer-facing offer is what gives the platform line of
sight to the customer — the traceability DPPM says most enterprises lack. That same traceability
is what makes the boundary legible here: anything that traces up into a business portfolio is
company-specific; anything below is substrate.

## This separation is already enforced for capability maturity

The four-portfolio maturity model does not treat all installs alike. `CapabilityMaturityAssessment`
carries an explicit `installScope` of `canonical` / `dpf_dogfood` / `customer_overlay`
(`packages/db/src/capability-maturity.ts`), and the reader **refuses to aggregate across scopes** —
`getCapabilityMaturityForPortfolioNode` rejects a call with a missing scope rather than silently
mixing.

The maturity spec also names this exact risk and its mitigation
([`2026-05-21-four-portfolio-agent-control-plane-maturity-design.md`](../superpowers/specs/2026-05-21-four-portfolio-agent-control-plane-maturity-design.md) §10.2 and the risk table):

> **Score rot in `dpf_dogfood` masking customer reality** — DPF's own install scores carry the
> dashboard while a fresh customer install would score far lower. Mitigation: `installScope`
> separation; any "ready to sell" or `productizationStatus = eligible` claim requires
> `installScope = canonical` and validation against at least one non-dogfood install.

That is customer zero's boundary, already made mechanical, for *capability scores*.

## Living Playbooks carry the same boundary

Governed work-pattern promotion applies the same rule to learned methods. Every active
`work-pattern` authority binding records its evidence scope: installation, organization, task
corpus, model profile, activity, and risk class. Customer-zero evidence can therefore activate a
method autonomously for DPF's own installation while remaining explicitly blocked from broader
use. A verified portable corpus or materially different, egress-approved customer corroboration
can raise that ceiling; provenance alone cannot.

Activation re-reads the evidence inside a serializable, advisory-locked transaction, retains one
active binding per lane, and records supersession or rollback in the existing
`DecisionShadowLedger`. The generic authority editor excludes these bindings so it cannot widen
their scope or mutate their lifecycle outside that governed transaction. Rejected candidate
identities also remain effective negative knowledge until the corpus, model, oracle, or promotion
policy materially changes.

## The gap: no equivalent separation for learned decision weights

The same discipline does **not** exist on the JSI weight-inference path.
`WeightInferenceObservation` (`apps/web/lib/decision-perspective/weight-inference.ts`) carries
exactly four fields — `domainClass`, `profileId`, `chosenVector`, `recommendedVector`. There is no
`installScope`, no dogfood marker, no provenance tag of any kind.

Two things follow, and they are different:

1. **Runtime contamination is already prevented.** Proposals are grouped by
   `(domainClass, profileId)`, and an organization's profile is resolved by `ownerOrganizationId`.
   A weight learned at the Customer 0 install cannot leak into another organization's live
   decisions. That part is sound.
2. **Provenance is not recorded, so generalization cannot be governed.** When a future step asks
   *"should this ruled weight be promoted to an archetype default, or contributed to the hive?"*,
   there is nothing on the proposal that says it was derived from the dogfood install operated by
   the doctrine's own author. The maturity path can answer that question; the weight path cannot.

This is not urgent today — the medium-timescale layer has no live callers at all
([`2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md`](../superpowers/specs/2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md) §2),
so no proposal has ever been produced from real history. It becomes urgent the moment the adapter
lands (`BI-D88DFEEA`), because the first real proposals will come from the Customer 0 install, and
they will look exactly like general evidence unless something says otherwise.

**The cheap fix, recorded here rather than built:** carry an install-scope (or equivalent
provenance) field on `WeightInferenceObservation` and `WeightAdjustmentProposal`, mirroring
`CAPABILITY_INSTALL_SCOPES` rather than inventing a second vocabulary, and apply the maturity
spec's rule — a dogfood-derived weight may govern its own install, but may not be promoted to a
fleet or archetype default without corroboration from at least one non-dogfood install. This is
additive and proposal-only; it changes no live decision.

## What to claim, and when

| Milestone | Legitimate claim |
|---|---|
| Build Studio ships real DPF changes through the governed path, repeatedly | The **mechanism** works end-to-end under real load. Foundational + Manufacturing & Delivery are exercised evidence, not aspiration. |
| Weight-inference produces its first proposals from Customer 0 history, and a human rules on them | The **learning loop closes**. Not: "the platform has learned how businesses decide." |
| A second install, different operator, different archetype, produces proposals that agree | The beginning of a **generalization** claim — and the first time the WWMD/WWWD boundary is doing epistemic work, not just architectural work. |
| A capability scores well in `dpf_dogfood` | Nothing about sellability until it is validated at `installScope = canonical` against a non-dogfood install (existing rule, §10.2). |

The discipline is the same one the platform already applies to itself everywhere else: *governance
approves evidence, not provenance* — and the scope of the evidence bounds the scope of the claim.

## See also

- [`docs/architecture/vector-decisioning-and-jsi.md`](vector-decisioning-and-jsi.md) — the decision mathematics whose learned weights this boundary governs.
- [`docs/superpowers/specs/2026-05-21-four-portfolio-agent-control-plane-maturity-design.md`](../superpowers/specs/2026-05-21-four-portfolio-agent-control-plane-maturity-design.md) — `installScope` separation for capability maturity.
- [`docs/superpowers/specs/2026-06-07-business-operating-model-portfolio-wiring-design.md`](../superpowers/specs/2026-06-07-business-operating-model-portfolio-wiring-design.md) — populating the two business portfolios per company; the DPPM dependency chain.
- [`docs/superpowers/specs/2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md`](../superpowers/specs/2026-07-24-job-specific-intelligence-fluid-weight-layer-design.md) — the three-timescale weight model and the unwired medium layer.
- [`docs/superpowers/plans/2026-07-24-weight-inference-from-rulings.md`](../superpowers/plans/2026-07-24-weight-inference-from-rulings.md) — `BI-D88DFEEA`, the adapter whose landing makes the gap above live.
