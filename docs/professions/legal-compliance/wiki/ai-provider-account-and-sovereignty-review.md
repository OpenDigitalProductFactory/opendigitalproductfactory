---
title: AI provider review — assess the connected account, not just the vendor
pageKind: principle
status: published
abstract: A working AI-provider credential proves connectivity, not business terms, retention, training treatment, processor contracts, or regional-processing entitlement. Review the exact account and execution channel before company data can egress.
principleTier: core
principleDirection: Keep non-public company data off personal, consumer, and unproven AI-provider connections until account-scoped contract, entitlement, retention, and region evidence is reviewed.
principleConsumerArchetype: specialist
principleAppliesTo:
  - in_platform_coworker
principleRingScope:
  - ring-1-coworker
principleDimensionVector: {"governance_compliance": 1.0, "data_privacy": 1.0, "evidence_confidence": 0.8}
professionJurisdiction:
  - global
  - eu
  - uk
professionCompetencyLevel: practitioner
sources:
  - ico/controller-processor-contracts
  - ico/international-transfers
  - openai/business-data-privacy
  - anthropic/commercial-training
  - anthropic/consumer-training
---

## Rule

Review the **connected account and execution channel**, not the provider name alone. Authentication or a successful model-list request establishes only that the credential works. It does not establish a business or enterprise plan, a controller-processor agreement, retention or no-training treatment, regional-processing enablement, or the identity of subprocessors.

Until those facts are evidenced, a personal, consumer, individual, or unknown hosted connection is suitable for public or synthetic material, including public source-code development. Public development does not require business-account, contract or no-training evidence merely because it is code. Non-public customer, employee, health, student, financial, privileged, source-code, security, and credential data stays on a governed non-egress path or is blocked. Classify the actual payload: public source does not make embedded secrets, protected records or explicitly confidential code public.

## How to apply

1. Identify the exact connection: direct API, consumer subscription, business/team subscription, enterprise tenant, hosted router, self-hosted endpoint, or local runtime.
2. Record the account class, commercial basis, authentication method, contract/DPA/BAA evidence, retention and training entitlements, enabled processing regions, review date, and source.
3. Treat provider privacy pages as **provider-published service facts**. They can guide review, but they do not prove what the organization's connected account has purchased or enabled.
4. For EEA or UK personal data, establish the processor contract and assess any restricted international transfer using the applicable mechanism. Data location alone is not a complete sovereignty assessment; ownership, control, support access, subprocessors, and compelled-access exposure may matter.
5. Local processing reduces external egress but is not automatically compliant. Verify capability, access control, retention, security, lawful basis, and sector requirements.
6. When evidence is missing or the question requires legal interpretation, abstain and route to qualified privacy, legal, security, or procurement review.

## Re-evaluation and continuity

Reassess the connected account when ownership, terms, subprocessors, processing regions, support access, or model distribution changes. An announced acquisition agreement is distinct from a completed transaction; record the evidenced status and review date. Preserve the organization's accepted dependency and exit decision in its owning scope.

Include analysis artifacts and derived evidence in the data-flow review. A locally executed analysis tool can still expose company information through hosted inference, telemetry, logs, or support channels. Verify export/restore, retention after session closure, key and update control, and permitted fallback behavior for the chosen deployment.

Treat CADA and similar jurisdiction developments according to their current legal status and applicability. A proposed framework is a planning input, not a blanket obligation across EMEA. Hardware ownership or open-source licensing does not independently establish compliance. See the [dated REA and inference strategy](../../../strategy/2026-10-11-rea-absorption-and-hardware-neutral-business-ai.md) for research evidence requiring deployment-specific qualification.

## Provider examples

OpenAI and Anthropic publish different data-treatment statements for commercial and consumer offerings. Use those statements only for the named service class and current terms. Never generalize a commercial-product statement to a personal subscription, or infer that a connected credential has enterprise options such as special retention or regional processing.

## See also

- [[professions/legal-compliance/gdpr-lawful-basis-and-consent]]
- [[professions/legal-compliance/eu-cada-cloud-sovereignty]]
- [[professions/legal-compliance/personal-data-definition]]
