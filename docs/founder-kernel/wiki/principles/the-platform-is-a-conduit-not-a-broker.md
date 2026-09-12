---
title: The Platform Is a Conduit, Not a Broker
pageKind: principle
status: published
abstract: For third-party enterprise integrations the customer holds their own agreement, account and credentials with the vendor. The platform supplies connector code, never the business relationship.
principleDirection: Build bring-your-own-credential integrations and reject architectures that place the platform as a vendor partner or customer of record.
principleTier: core
principleDimensionVector: {"governance_compliance": 0.8, "data_sovereignty": 0.9, "vendor_lock_in": -0.6, "speed_to_value": -0.2}
principleWeight: 0.6
principleWeightRationale: Governs integration architecture and compliance posture; weighted to decide integration design without overriding safety commandments.
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters must know that their vendor agreements, compliance scope and data stay theirs — the platform never becomes an intermediary for payroll, financial or personal data.
---

## Rule

For any integration with an enterprise vendor that requires a partner programme, a mutual NDA, a paid API tier, or a customer-of-record relationship, the platform is **a conduit, never a broker**.

Each install's customer maintains their own agreement, account and credentials with the vendor. The platform provides the connector, the encrypted credential store and the interface to supply them.

## Why

Founder direction, 2026-04-21: *"Users of this platform will have their own auth and agreement with the vendor. We are merely a conduit to help users interface with them as needed per company management practices."*

Four reasons, each sufficient on its own.

- It fits a single-organization-per-install, open-source model. The project cannot sign agreements on behalf of thousands of installs.
- It keeps the customer of record where compliance expects it. Audit and privacy scope stays with the customer, not with the platform.
- It matches the sovereignty stance that the customer owns their tools and their data. The platform orchestrates; it does not intermediate.
- It avoids the platform becoming a regulated data processor for payroll, financial or personal data flows.

## How to apply

- Reject architectures that enrol the platform in a vendor partner programme.
- Build a bring-your-own-credential surface: the customer supplies their own client id, secret, certificates and tokens.
- Store those credentials encrypted in the customer's own install. Never phone home.
- The connector itself is shareable as open source. Credentials never are.
- This does not apply to model providers or general developer tooling, where a per-developer key is already the norm.

## Related

`data-sovereignty-follows-control` · `install-is-the-tenant` · `prefer-self-hosted-infrastructure` · `no-provider-pinning`
