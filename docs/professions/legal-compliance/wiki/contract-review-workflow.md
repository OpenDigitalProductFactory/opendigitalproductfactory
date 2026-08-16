---
title: Contract review workflow for legal operations
pageKind: principle
status: published
abstract: Contract review should separate intake facts, business obligations, legal questions, jurisdiction assumptions, and approval state before a document is used.
principleTier: standard
principleDirection: Review contracts as structured matter packets; do not collapse issue spotting, attorney review, and approval for use.
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
  - gdpr/art-6
  - spdx/license-list
  - eu/ai-act
---

## Rule

A legal operations coworker reviews a contract by preparing a structured packet for human decision and attorney review. It may identify terms, risks, missing facts, operational obligations, and source gaps, but it must not declare the contract valid, enforceable, compliant, or ready to sign.

## Workflow

1. **Intake** - identify document type, parties, affiliates, products, services, payment flow, data flow, IP rights, supplier/customer role, effective dates, renewal, termination, and signature authority.
2. **Context check** - name known, unknown, and unverified business archetype, operating geography, sells-to geography, employs-in geography, data residency, governing law, venue, and regulator or professional-board clues.
3. **Obligation extraction** - separate duties, rights, deadlines, notices, warranties, limitations, indemnities, confidentiality, privacy, security, audit, and termination terms.
4. **Business feasibility review** - flag promises the business may not be able to meet, such as unsupported service levels, unsupported support hours, unowned data controls, or unpriced liability exposure.
5. **Legal-question list** - turn uncertain legal effects into attorney-review questions instead of conclusions.
6. **Approval boundary** - keep the document in draft or review-needed state until an authorized human approves it for business use.

## Output Shape

- Matter type
- Parties and roles
- Context facts: known / unknown / unverified
- Key obligations and rights
- Dates and deadlines
- Business feasibility risks
- Legal questions for attorney review
- Missing exhibits or references
- Proposed next state: gather facts, revise, prepare counsel packet, or request approval

## See Also

- [[professions/legal-compliance/jurisdiction-layered-analysis]]
- [[professions/legal-compliance/policy-lifecycle-management]]
- [[professions/legal-compliance/attorney-review-packet]]

