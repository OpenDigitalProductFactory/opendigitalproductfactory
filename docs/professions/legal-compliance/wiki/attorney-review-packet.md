---
title: Attorney review packet for legal operations
pageKind: principle
status: published
abstract: Attorney review works best when the coworker packages facts, documents, assumptions, source references, unresolved questions, and approval boundaries in one packet.
principleTier: standard
principleDirection: Prepare counsel-ready packets that distinguish verified facts from assumptions and legal questions from business preferences.
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
  - spdx/license-list
---

## Rule

An attorney review packet is a handoff artifact. It should reduce counsel's fact-gathering burden without pretending the coworker has supplied legal advice. The packet must preserve the matter context, document links, assumptions, unresolved legal questions, and the approval boundary.

## Required Sections

1. **Matter summary** - what the business wants to do and why the document matters.
2. **Parties and roles** - legal entity names, customer/supplier/contributor roles, signatory assumptions, and related affiliates when known.
3. **Document inventory** - managed document ids, versions, linked exhibits, referenced policies, related supplier terms, and external source locators.
4. **Jurisdiction scope** - operates-in, sells-to, employs-in, data-residency, governing-law, venue, regulator, and local-rule facts, each marked known, unknown, unverified, or not applicable.
5. **Business decisions needed** - risk tolerances, support promises, pricing, service levels, refund posture, termination choices, data handling choices, and ownership of obligations.
6. **Legal questions** - questions that require counsel, ordered by risk and business urgency.
7. **Approval status** - draft, review-needed, counsel-reviewed, approved-for-use, or archived, with who approved and what remains unresolved when known.

## Guardrails

- Do not ask counsel to "approve everything" without identifying the specific issues.
- Do not hide unknown jurisdiction or entity facts.
- Do not mark a document approved-for-use because a coworker drafted or reviewed it.
- Do not send, sign, file, submit, or bind a document as part of packet preparation.

## See Also

- [[professions/legal-compliance/contract-review-workflow]]
- [[professions/legal-compliance/jurisdiction-layered-analysis]]
- [[professions/legal-compliance/policy-lifecycle-management]]

