---
title: Classify exposure at birth
pageKind: principle
status: published
abstract: Security review of reachability starts when an endpoint is created, not when a pass audits it — every new surface declares public, authenticated, or private-mesh, defaulting private, and an unauthenticated externally reachable endpoint is a sev-high finding regardless of what it serves.
principleTier: core
principleDirection: Require a declared reachability class on every new surface at creation, default private-mesh, and treat any unclassified or unauthenticated externally reachable endpoint as a high-severity finding.
principleDimensionVector: {"blast_radius": -0.9, "data_privacy": 0.8, "governance_compliance": 0.7, "evidence_confidence": 0.5, "speed_to_value": -0.1}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-4-sandbox-prod
  - external-coordination
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: false
principlePublicRationale: ""
sources:
  - owasp/asvs
  - owasp/top-ten
---

## Rule

Every surface — HTTP endpoint, MCP tool exposure, A2A route, webhook, edge control channel — carries a declared **reachability class** from the commit that creates it: `public` (unauthenticated by design, argued in writing), `authenticated`, or `private-mesh` (never beyond the install's own coordination plane). The default is `private-mesh`; public is earned by argument. An externally reachable surface with no auth and no declared `public` argument is a high-severity finding *by classification*, before any assessment of what it serves — because what it serves changes, and the classification is what survives the change.

## Why

Broken access control is the top web-application risk class, and its commonest platform form is not a broken check but a **missing** one — an endpoint that shipped before anyone decided who may reach it. This platform found `/api/a2a/tasks/[taskId]` — a surface on the boundary that federates AI coworkers *between installs* — reachable with no auth, discovered by an architecture pass rather than a guard. Verification standards frame access control as something to verify per surface; classification-at-birth is what makes that verification enumerable: you cannot audit the reachability of surfaces nobody listed, and at ~350 routes plus MCP and A2A planes, the unlisted surface is the attack surface.

## How to apply

In threat modeling and review, ask first: what is this surface's declared class, and does its auth match? Track the classification manifest as the security team's inventory — new unclassified endpoints are triage items, and class *widenings* (private→authenticated, authenticated→public) get security review as a matter of course. For the A2A cohort specifically: cross-install surfaces are `authenticated` at minimum, with the authentication layer (FederationLink + GAID + device trust) distinct from the authorization layer (TAK) — no layer may confer another's authority. Score decision options that widen exposure high on `security/exposure_surface`; an option that adds an unclassified surface should lose to one that doesn't, all else equal.

## Decision dimensions

- `blast_radius: -0.9` — negative: classification exists to bound what a single missing check exposes.
- `data_privacy: 0.8` — sovereign-install data crossing an undeclared public surface is the incident class this prevents.
- `evidence_confidence: 0.5` — a declared class is verifiable evidence; an implicit one is an assumption.
- `governance_compliance: 0.7` — the guard makes the security posture enforced, not aspirational.

## Related

- [[professions/security/least-privilege-deny-by-default]] — private-mesh-by-default is deny-by-default applied to reachability.
- [[professions/security/threat-modeling]] — the classification manifest is the enumerable attack surface the model starts from.
