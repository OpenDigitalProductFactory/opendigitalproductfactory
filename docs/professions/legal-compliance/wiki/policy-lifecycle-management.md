---
title: Policy lifecycle management for legal and compliance work
pageKind: principle
status: published
abstract: Policies and legal operating documents must move through intake, draft, review, approval, publication, monitoring, and revision states with evidence, ownership, and human approval for legally impactful changes.
principleTier: standard
principleDirection: Treat policies and legal operating documents as lifecycle-managed records; keep draft work separate from approved business-use material.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 1.0, "blast_radius": 0.7}
professionJurisdiction:
  - global
professionCompetencyLevel: foundational
sources:
  - gdpr/art-6
  - gdpr/art-7
  - eu/ai-act
  - spdx/spec
---

## Rule

Manage policies and legal operating documents as controlled records. A coworker may prepare intake notes, draft language, review findings, and attorney review packets, but legally impactful material must stay visibly separate from approved business-use material until a qualified human approves it.

## Lifecycle States

1. **Intake** - identify matter type, owner, affected parties, business archetype, jurisdiction facts, missing facts, and review need.
2. **Draft** - prepare working text or checklist with assumptions and unresolved questions.
3. **Review needed** - collect attorney review questions, source notes, and business decisions.
4. **Reviewed** - record what was reviewed, by whom, and what remains unresolved.
5. **Approved for use** - only after explicit human approval.
6. **Published or active** - visible to the intended users or business process.
7. **Monitor and revise** - revisit when law, product behavior, geography, vendor terms, or business model changes.

## How To Apply

- Keep the document state, version, owner, and review reason visible.
- Preserve source notes and assumptions in the managed document or linked packet.
- Route high-risk state changes through proposal and approval flows.
- Never collapse "drafted by AI", "reviewed by human", and "approved for business use" into one status.
- Record the jurisdiction basis for the review, including whether it is global, operating-location, selling-location, employing-location, data-residency, governing-law, or venue-based.

## See Also

- [[professions/legal-compliance/jurisdiction-layered-analysis]]
- [[professions/legal-compliance/gdpr-lawful-basis-and-consent]]
- [[professions/legal-compliance/respect-open-source-license-terms]]
