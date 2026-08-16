---
title: Jurisdiction-layered analysis for legal operations
pageKind: principle
status: published
abstract: Legal analysis must separate national, state/province, local, professional-board, privacy/data-residency, governing-law, venue, archetype, and product/service layers before making recommendations.
principleTier: commandment
principleDirection: Treat jurisdiction facts as investigation inputs, not conclusions; mark every layer as verified, unverified, or not applicable.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 1.0, "blast_radius": 0.8}
professionJurisdiction:
  - global
professionCompetencyLevel: foundational
sources:
  - gdpr/art-4
  - gdpr/art-6
  - ccpa/oag
  - eu/ai-act
  - spdx/license-list
---

## Rule

Do not flatten "location" into one legal answer. A legal operations coworker must separate jurisdiction layers, record which facts are known, and mark unverified layers before drafting, reviewing, or recommending next actions.

## Layers To Separate

1. **National or federal law** - country-level statutes, regulations, tax, privacy, AI, employment, import/export, or industry rules.
2. **State or province law** - entity formation, contracts, employment, taxes, consumer protection, privacy, professional services, and local variants.
3. **County, city, or municipal rules** - local permits, postings, fees, operating restrictions, zoning, and consumer-facing obligations.
4. **Professional boards or regulators** - person-held credentials, supervised practice limits, regulated service scope, and disciplinary authorities.
5. **Governing law and venue** - contract clauses that name which law and forum apply to a dispute.
6. **Privacy and data residency** - where people are located, where data is collected, stored, processed, or accessed, and whether cross-border rules apply.
7. **Business archetype** - industry, customer type, product/service model, regulated activity, and staff role mix.
8. **Product, supplier, or channel layer** - marketplace terms, app-store terms, open-source licenses, supplier terms, payment processor terms, and customer contract overlays.

## How To Apply

- Start every matter with a jurisdiction table: layer, known facts, source, status, and next question.
- Distinguish "operates in", "sells to", "employs in", "stores data in", "governing law", and "venue".
- If a layer is unknown, say it is unknown and ask for the next useful fact.
- If a source is secondary or stale, mark the conclusion as unverified.
- Escalate to attorney review when the answer would affect rights, obligations, liability, privacy duties, employment duties, regulated activity, or customer/supplier commitments.

## Example

an operator supporting DPF may involve one state for the entity, different states or countries for customers, separate data-residency facts for deployments, open-source license obligations for distribution, and contract governing-law terms for support agreements. Those layers must be tracked separately before the coworker drafts support terms.

## See Also

- [[professions/legal-compliance/policy-lifecycle-management]]
- [[professions/legal-compliance/gdpr-lawful-basis-and-consent]]
- [[professions/legal-compliance/us-sectoral-privacy]]
- [[professions/legal-compliance/respect-open-source-license-terms]]
