---
title: Data Sovereignty Follows Control, Not Location
pageKind: principle
status: published
abstract: For regulated and sovereign workloads, protection from foreign legal reach follows the corporate control and jurisdiction of the operating entity — not where the data physically sits. Design for ownership and control; let the deployment substrate, not a SaaS dependency, set the achievable sovereignty tier.
principleTier: core
principleDirection: Treat the operating entity's ownership and governing law as the sovereignty gate. Prefer self-hosted, open-source, locally-inferenced deployment on customer-controlled (or EU-owned) infrastructure over any foreign-controlled managed service for sovereign workloads.
principleDimensionVector: {"governance_compliance": 0.9, "blast_radius": -0.7, "long_term_maintainability": 0.6, "data_privacy": 0.9, "operational_independence": 0.75, "vendor_lock_in": -0.8}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: DPF positions itself as a sovereign AI-native platform. Operators and prospects evaluating DPF for EU public-sector, financial, healthcare, or critical-infrastructure use need to understand that the platform's sovereignty posture is structural — it follows from self-hosting, local inference, and open source — and that the achievable assurance tier is a function of where and by whom the deployment is operated.
sources: []
---

## Rule

When a workload is subject to data-sovereignty obligations (EU public-sector procurement, regulated industries, or any data that must be shielded from foreign-government access), the assurance that the data is protected does **not** follow the physical location of the bytes. It follows the **corporate control and governing law of the entity that operates the service**. Design for ownership and control, capture the affected jurisdictions explicitly, and let the deployment substrate — not a managed-SaaS dependency — determine the achievable sovereignty tier. Never claim a sovereignty tier that a foreign-controlled dependency in the chain structurally caps.

## Why

Extraterritorial law reaches the operator, not the datacenter. The US CLOUD Act (18 U.S.C. § 2713) compels a US-controlled provider to disclose data in its worldwide "possession, custody, or control"; an EU subsidiary 100%-owned by a US parent does not break that chain, and FISA 702 authorises bulk surveillance of non-US persons. So data residency in Frankfurt is "legally irrelevant when the provider is subject to US jurisdiction." The EU's Cloud and AI Development Act (CADA, proposed 3 June 2026) codifies exactly this: its top assurance levels (3 and 4) gate on **EU ownership and the absence of third-country interference**, not on where the data is stored. The same logic generalises to any sovereignty regime.

This is why DPF's defaults are load-bearing, not cosmetic. A self-hosted, single-tenant install keeps data on infrastructure the customer controls; local-only inference keeps AI processing in-jurisdiction and fails loudly rather than reaching a foreign cloud; and an open-source codebase the customer can run, audit, and fork removes the "third-country entity controls the software" objection. Together they let a DPF deployment **inherit the sovereignty tier of the infrastructure it runs on** — and reach the top of the ladder where a foreign-owned SaaS structurally cannot. This is the capability-layer consequence of [[principles/prefer-self-hosted-infrastructure]] and the sovereignty reading of [[principles/native-cohesion-over-interfacing]] and [[principles/one-data-model]].

## Applies To

- Any platform feature or deployment decision that touches regulated data, EU public-sector customers, or critical-infrastructure / financial / healthcare operators.
- Any external-facing claim (marketing, sales, RFP responses) that uses the word "sovereign" — the claim must be true at the operating-entity level, not just the data-location level.
- Estate and compliance assessments: scoring an asset, an external application, or the platform itself against a sovereignty tier.

Does NOT apply when: the data carries no sovereignty obligation and no regulated-customer context (ordinary commercial data may sit on any compliant infrastructure); or when the customer has explicitly accepted a lower tier for a specific workload.

## How To Apply

1. Ask the one question that decides the tier: **who ultimately owns and operates the entity, and what law reaches them?** Data location is a necessary baseline (Level 1), never sufficient for the higher tiers.
2. Prefer the structural answers: self-host on customer-controlled or EU-owned infrastructure; keep inference local (`residencyPolicy: "local_only"`, no silent cloud fallback); keep the software open-source and forkable; keep encryption keys under EU/customer control.
3. Capture the affected jurisdictions as data, not prose: an install's `operatesIn` / `sellsTo` / `employsIn` / `dataResidency` (and, for sovereign deployments, a target assurance level) drive which obligations apply. Use the EU/EEA member-state reference for "countries affected."
4. Stop and flag the residual gap honestly: for the strictest tier, a foreign-domiciled software maintainer is a control concern even with open source — close it with an EU steward/support posture, reproducible builds, and a signed SBOM rather than overclaiming.

## Reference Implementations

- **Local-only inference** — `apps/web/lib/inference/local-only.ts` + `apps/web/lib/routing/pipeline-v2.ts` (the `residencyPolicy === "local_only"` hard-filter): keeps AI processing in-jurisdiction and fails loudly, the implementation of the "no AI-inference-data egress" sovereignty test.
- **Self-hosted, single-tenant deployment** — `docker-compose.yml` + `docs/superpowers/specs/2026-05-09-deployment-contracts.md`: customer data lives on infrastructure the customer controls.
- **Jurisdiction model** — `BusinessContext.{operatesIn, sellsTo, employsIn, dataResidency}` (`packages/db/prisma/schema.prisma`): where data subjects are, captured at setup.
- **Architecture note** — `docs/architecture/2026-06-19-cada-cloud-sovereignty-architecture-note.md`: the CADA requirements traced to the substrate that satisfies them.

## Decision Dimensions

- `governance_compliance: 0.9` — this is the principle that makes sovereignty claims defensible under audit and procurement. Getting the ownership/control axis right is the difference between passing and failing a CADA-style assessment.
- `blast_radius: -0.7` — reduces exposure to foreign-government compulsion, vendor exit, and extraterritorial legal orders by keeping control with the operator.
- `long_term_maintainability: 0.6` — a structural sovereignty posture (self-host + open source + local AI) does not need re-engineering per regulation or per customer; it generalises across GDPR, DORA, the AI Act, and CADA.

## Examples

- **Positive:** A DPF install for an EU public body runs on OVHcloud's EU-controlled infrastructure with local-only inference and EU-held keys; the sovereignty claim is "Level 3 capable" and is backed by the operating entity's EU ownership plus the route-decision log proving inference stayed local.
- **Counterexample:** Marketing a deployment as "sovereign" because the data sits in an EU region, while the AI calls a US-owned model API and the platform is operated by a US-controlled entity. The data location is satisfied; the sovereignty claim is false at the tier that matters.
