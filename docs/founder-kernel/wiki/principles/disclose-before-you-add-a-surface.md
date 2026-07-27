---
title: Preserve the model; disclose complexity progressively
slug: disclose-before-you-add-a-surface
pageKind: principle
status: published
abstract: Treat necessary architectural complexity as a real cost: preserve sound semantic boundaries, including provider and consumer, while compensating users with defaults, guided creation, contextual navigation, and progressive disclosure.
principleTier: core
principleDirection: Treat necessary architectural complexity as a real cost: preserve sound semantic boundaries, including provider and consumer, while compensating users with defaults, guided creation, contextual navigation, and progressive disclosure.
principleDimensionVector: {"operator_effort": -0.7, "human_cognitive_load": -0.9, "reusability": 0.5, "schema_grounding": 0.5, "long_term_maintainability": 0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleConsumerArchetype: universal
principleConsumerContexts:
  - ui
  - data-model
principleRingScope:
  - ring-2-workflow
  - ring-3-archetype
principlePublic: false
authoredAt: 2026-07-23
authoredBy: mark-bodman
sources:
  - frameworks/csdm
  - frameworks/it4it-v3
---

# Preserve the model; disclose complexity progressively

## Rule

**Treat necessary architectural complexity as a real cost. Preserve the sound,
internally consistent model when its traceability, lifecycle, reuse, or control
benefits justify that cost; then compensate users with derived defaults, guided
creation, contextual navigation, and progressive disclosure.**

Architectural completeness is not permission to make every user maintain or even
see every entity and relationship. Conversely, simplifying the experience is not
permission to discard traceability or merge concepts that have different
lifecycles. The more complexity a sound design introduces, the stronger its
obligation to help users create, understand, and navigate it.

Scale changes exposure, not semantics. A provider–consumer boundary that protects
accountability and product reporting in a large digital enterprise remains
meaningful for a salon, restaurant, builder, or hotel. In the smaller business,
the organization can default as provider and ordinary customer activity can
resolve the consuming party. The platform retains the boundary without requiring
the operator to configure product teams, business units, subscriber types,
entitlements, or governance layers that do not exist.

## Why

Complete architecture protects consistency, auditability, reuse, and future
growth. Exposing that architecture literally transfers its maintenance cost to
operators who may have a simple business and a simple task. A salon with one
fixed-price haircut should not have to understand Product, Offering, Catalog
Item, and SKU as four separate setup steps. A configurable home, a vehicle sold
off the lot, or a seasonal bundle may genuinely require those distinctions.

The decision is therefore a tradeoff, not an automatic preference for either a
flat model or maximal normalization. First establish that each distinct concept
earns its complexity through different lifecycle, ownership, traceability, reuse,
or control needs. When it does, keep the sound model and present the smallest
truthful projection. Derived defaults and auto-provisioned one-to-one
relationships make the common case feel simple; guided flows and contextual
navigation help with necessary complexity; explicit controls appear when
channels, prices, configurations, bundles, contracts, or other evidence create a
real divergence.

Growth pressure on a screen follows the same rule. Each unnecessary tab, page,
or dashboard band enlarges the map the operator must hold and moves the "more"
further from its context. Progressive disclosure keeps extra content where it
belongs and keeps the top-level map small.

The platform already prescribes *which* construct fits *which* relationship
(`CollapsibleList` to preview a long list, `ExpandableCard` for subordinate
detail among peers, native `<details>` for one short secondary aside, a drawer to
preserve a large detail workspace, a dedicated route only when linking/history/a
full workflow is needed). This principle says: choose from that set first, and
only escalate to a new surface when none of them fit.

## Applies To

In-platform coworkers, external coding agents, and humans designing or reviewing
domain models, setup workflows, and portal surfaces. It is the "what must exist
versus what must be exposed now" companion to
[[principles/one-home-per-capability]].

## How To Apply

1. Demonstrate why each added concept is architecturally necessary: distinct
   lifecycle, ownership, traceability, reuse, or control.
2. Weigh those benefits against operator effort and cognitive load; reject
   complexity whose value does not justify its cost.
3. Preserve the justified model, invariants, and traceability.
4. Identify the user's current task and the simplest truthful business case.
5. Derive or auto-provision one-to-one relationships instead of asking the user
   to maintain them separately.
6. Add guided creation, sensible defaults, contextual labels, and navigation
   between related records wherever users must interact with the complex model.
7. Reveal an advanced layer only when actual variation, capability, evidence, or
   the selected task requires it.
8. Keep authorized drill-down and audit access available without making it part
   of the default workflow.
9. Preserve provider and consuming-party identity for reporting, but derive it
   from canonical organization and real customer evidence; do not fabricate
   enterprise structure or placeholder consumers to make the model look complete.
10. Do not delete traceability, overload one concept with multiple lifecycles, or
   grow uncontrolled records merely to make the first screen look simpler.

When a surface itself needs to show more, pick the canonical disclosure construct
for the summary-to-content relationship rather than hand-rolling a dialect or
adding a tab. Escalate to a new route only when the content needs its own URL,
history, or full record workflow.

## Decision Dimensions

- `operator_effort: -0.7` — complexity has an operating cost; justified designs
  must repay it through defaults, guided creation, and contextual navigation.
- `human_cognitive_load: -0.9` — the visible conceptual map stays proportionate
  to the task even when the underlying architecture is complete.
- `reusability: 0.5` — reusing the canonical disclosure constructs converges the
  portal on one vocabulary and lets one complete model serve simple and advanced
  archetypes.
- `schema_grounding: 0.5` — concepts that earn their complexity retain canonical
  boundaries and traceability rather than being flattened around one screen.
- `long_term_maintainability: 0.4` — one complete model with task-specific
  projections is safer than maintaining separate simple and advanced models.

## Examples

- **Positive:** A salon defines “haircut” once. The platform derives its default
  Offering and CatalogItem, so setup feels like one record. When the owner adds a
  holiday haircut-and-shave package, Catalog Builder reveals bundle and validity
  controls and provides contextual links back to the two managed services. The
  salon is the default provider; bookings and purchases establish the consumers,
  with no fictional product team or subscriber taxonomy.
- **Positive:** A large enterprise exposes business-unit and product-team
  accountability, subscriber populations, entitlements, and service commitments
  because those distinctions affect funding, access, and reporting. It uses the
  same provider–consumer contract as the salon, with a richer projection.
- **Positive:** A home builder keeps Product, Offering, reusable configurations,
  and sale-specific configuration snapshots distinct because they have different
  lifecycles. A guided flow starts from a standard model, explains each required
  choice, and stores one-off changes on the quote/order without creating a new
  reusable SKU.
- **Counterexample:** Flatten Product, CatalogItem, SKU, and purchased instance
  into one record to make setup look short. Later price, channel, configuration,
  and customer-state changes collide and destroy traceability.
- **Counterexample:** Expose every normalized entity as a required setup step for
  a fixed-price haircut even though all relationships are one-to-one.

## Sources

Rendered from the frontmatter source records. CSDM supports a connected canonical
model; IT4IT supports lifecycle separation and traceability. The compensating UX
obligation is the operator's durable judgment recorded by this principle.

## Overlap scan (§4.3)

The original overlap scan found `substrate-cleanup-before-substrate-addition` at
0.62 and `design-research-required` at 0.55, both below the 0.70 bar. The
2026-07-27 extension broadens this existing principle instead of creating a
duplicate: substrate cleanup governs whether a new backend layer is justified;
this principle governs how much of a justified, complete model a user must
encounter for the task at hand.
