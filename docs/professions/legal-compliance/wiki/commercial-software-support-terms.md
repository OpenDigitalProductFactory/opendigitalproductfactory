---
title: Commercial software support terms checklist
pageKind: principle
status: published
abstract: Software support terms should separate license posture, support scope, customer responsibilities, service levels, data handling, IP boundaries, warranty posture, liability allocation, and jurisdiction assumptions.
principleTier: standard
principleDirection: Treat commercial support terms as attorney-review material; keep operational promises, license boundaries, privacy roles, and open-source obligations explicit.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 1.0, "blast_radius": 0.9}
professionJurisdiction:
  - global
professionCompetencyLevel: foundational
sources:
  - spdx/license-list
  - spdx/spec
  - gdpr/art-4
  - gdpr/art-6
---

## Rule

Commercial software support terms must not blur product licensing, professional support, hosting or data-processing duties, and operational service promises. A coworker may draft a checklist or working packet, but attorney review is required before business use.

## Checklist

1. **Commercial posture** - identify whether the business is licensing software, selling support, hosting a service, distributing binaries, providing implementation, or combining several offers.
2. **Support scope** - define included and excluded support, channels, response expectations, customer prerequisites, version support, and out-of-scope customization.
3. **Customer responsibilities** - access, backups, credentials, test environments, data accuracy, cooperation, third-party accounts, and timely decisions.
4. **Service levels** - separate aspirational support goals from binding service-level commitments, credits, remedies, and exclusions.
5. **Data handling** - identify whether personal data, customer confidential data, telemetry, logs, backups, or production access are involved.
6. **IP and open-source boundary** - preserve ownership, contribution treatment, third-party license obligations, and whether support changes become product code.
7. **Warranty and liability posture** - flag any warranty, disclaimer, indemnity, limitation of liability, consequential damages, and security commitment language for counsel.
8. **Jurisdiction and venue** - record governing-law and venue placeholders separately from where customers, employees, and data are located.

## Operator / DPF Application

For an operator supporting DPF, the working packet should keep these questions visible:

- Is the operator only providing support, or also licensing, hosting, implementation, customization, or managed services?
- What DPF license or source-use terms apply to business customers?
- What support promises can the operator operationally meet?
- Will the operator access customer systems, customer data, logs, or credentials?
- Which entity signs customer terms, supplier terms, and contributor/IP documents?
- Which governing law, venue, privacy role, and data residency facts are verified?

## See Also

- [[professions/legal-compliance/contract-review-workflow]]
- [[professions/legal-compliance/attorney-review-packet]]
- [[professions/legal-compliance/respect-open-source-license-terms]]
- [[professions/legal-compliance/spdx-license-identifier]]

