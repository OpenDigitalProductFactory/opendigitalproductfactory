---
title: Install Is the Tenant
pageKind: principle
status: published
abstract: The platform's tenancy unit is the sovereign install — one customer, one install, one database — with organizationId scoping reserved for the one real intra-install boundary, the MSP-managed customer estate. Ratified by the owner on 2026-11-24 (W18, DI-2DEB0D9B417F).
principleTier: core
principleDirection: Treat the install as the tenant — do not add SaaS-style tenancy columns platform-wide; harden the MSP estate boundary as the one real intra-install scope, and make the invariant explicit in writing.
principleDimensionVector: {"data_privacy": 0.8, "governance_compliance": 0.6, "blast_radius": -0.5, "operational_independence": 0.6, "long_term_maintainability": 0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-4-sandbox-prod
principleConsumerArchetype: universal
principlePublic: false
principlePublicRationale: ""
---

## Rule

The tenancy unit is the **install**: one customer business, one sovereign deployment, one database. Schema and code assume a single owning organization per install; SaaS-style multi-tenancy columns are **not** added platform-wide. The one legitimate intra-install boundary is the MSP shape — a managed service provider whose single install holds multiple **customer estates** (`CustomerAccount`/`CustomerSite` scoping, Topology A) — and that boundary is hardened deliberately (composite-FK `organizationId` patterns, scoped queries), not generalized into whole-schema tenancy.

**Status: ratified, core tier.** The owner ratified this posture on 2026-11-24 in answer to the W18 decision brief (BI-F238FBE4): "Yes ratify". The recorded anchor is WWMD decision DI-2DEB0D9B417F (platform-development, stakes high), which recommended install-is-the-tenant over platform-wide tenancy columns and over leaving the posture unwritten; its outcome is recorded as followed and resolved by a human. The earlier consult DI-2A0379CE01D1 (2026-08-16, architecture pass move #11) reached the same recommendation. The hardening work this rule calls for, the estate boundary and the unfiltered `organization.findFirst()` lint, is still open on BI-F238FBE4.

## Why

Sovereignty is the product (D1/D7): customers choose DPF to own their install outright, which makes install-per-customer the natural tenancy unit and makes SaaS tenancy machinery pure cost — every query filtered, every index widened, every test doubled, for a boundary no sovereign install has. But the pass found the schema half-committed in both directions: only 117/588 models carry `organizationId`, the CRM/commerce spine has no tenant column, ~150 call sites do unfiltered `organization.findFirst()` (correct only when exactly one org exists), while the newest verticals correctly use composite-FK org scoping — and the invariant is written nowhere. The MSP channel (D2, Topology A) is exactly where the ambiguity becomes a data-isolation incident.

## Applies To

Everyone touching schema, queries, or install topology: in-platform coworkers, external coding agents, humans. Especially decisions that would add or remove org scoping from a model.

## How To Apply

Do not add tenancy columns beyond the composite-FK estate pattern the new verticals use, and do not remove org scope where it exists. Treat a new unfiltered `organization.findFirst()` as a defect: it hardcodes the single-organization assumption where no one can see it. When designing MSP-facing features, scope by customer estate through the declared pattern. Isolation between customers is a boundary between installs; a second organization appearing where one is expected, for example in an install migration snapshot, is an anomaly to refuse and report, not a second tenant to filter. A proposal to move away from this posture is a change to ratified doctrine and goes back to the owner with new evidence.

## Decision Dimensions

- `data_privacy: 0.8` — estate isolation inside an MSP install is a privacy boundary, not a styling choice.
- `operational_independence: 0.6` — install-as-tenant is what keeps each customer's deployment fully theirs.
- `blast_radius: -0.5` — negative: a written invariant shrinks the isolation-incident surface the ambiguity creates.
- `long_term_maintainability: 0.4` — one declared posture beats two half-implemented ones.

## Related

- [[principles/fleet-safe-schema-evolution]] — whichever posture is ratified must roll out expand→contract across the fleet.
- [[principles/doc-cited-anchors-must-exist]] — the ratification decision lands as a recorded DI anchor, cited from this page.
