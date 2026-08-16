---
title: Endpoint Classification at Birth
pageKind: principle
status: published
abstract: Every new HTTP endpoint declares its reachability class — public, authenticated, or private-mesh — when it is created, and a guard enforces the declaration. Classifying after the fact is how an externally reachable surface ships with no auth.
principleTier: core
principleDirection: Declare a public/authenticated/private-mesh reachability class on every new endpoint at creation time, guard-enforced; never leave classification to a later hardening pass.
principleDimensionVector: {"governance_compliance": 0.8, "blast_radius": -0.9, "data_privacy": 0.7, "public_safety": 0.3, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-4-sandbox-prod
  - external-coordination
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Customers running sovereign installs behind CGNAT need to know reachability is a declared, enforced property of every surface, not an accident of deployment.
---

## Rule

An HTTP endpoint's reachability class is part of its **definition, not its deployment**. Every new `route.ts` (or equivalent handler) declares one of: **public** (unauthenticated, internet-reachable by design), **authenticated** (reachable with credentials), or **private-mesh** (never exposed beyond the install's own coordination plane — MCP, A2A internals, edge control). The declaration is machine-readable and a guard fails any endpoint that lacks one. Changing class is a reviewed change, not a side effect of a proxy rule.

## Why

The per-install topology (D5) demands that some surfaces cross CGNAT to stable public HTTPS while MCP and A2A stay private — which is only safe if every endpoint's class is known. The 2026-08-16 pass found what the absence of this rule produces: `proxy.ts` fail-open for `/api/*`, bearer credentials without transport binding, and `/api/a2a/tasks/[taskId]` reachable with **no auth at all** — on an externally reachable boundary that federates coworkers between installs. A reachability plan can state the segmentation rule, but only classification-at-birth makes it durable: the plan covers endpoints that exist; the guard covers endpoints that don't exist yet.

## Applies To

Everyone who creates or reviews an endpoint: in-platform coworkers, external coding agents, humans. First governed cohort: the A2A surfaces (`/api/a2a/*`), because they are already externally reachable and carry cross-install authority.

## How To Apply

When creating an endpoint, add its classification manifest entry in the same commit — the class, and for public endpoints the reason a lesser class cannot serve. When the guard flags an unclassified endpoint you touched, classify it rather than exempting it. Treat "private-mesh" as the default posture: an endpoint earns public exposure by argument, never by omission. Auth middleware, proxy path-segmentation, and edge exposure config all *derive from* the declared class; none of them may widen it.

## Decision Dimensions

- `blast_radius: -0.9` — negative: the principle exists to shrink what an unclassified surface can expose.
- `governance_compliance: 0.8` — turns the reachability plan's rule into an enforced gate.
- `data_privacy: 0.7` — sovereign installs' data stays private by declared class, not by luck.
- `speed_to_value: -0.2` — one manifest entry per endpoint.

## Examples

- **Negative:** `/api/a2a/tasks/[taskId]` — shipped without auth on an externally reachable boundary; found by an architecture pass rather than a guard, and promoted ahead of all other reachability work as a result.
- **Positive:** an endpoint born `private-mesh` whose later public exposure requires flipping a reviewed declaration — making the widening visible in diff review instead of silent in a proxy rule.

## Related

- [[principles/primitive-done-means-ratchet-on]] — the classification guard is the ratchet form of the reachability plan.
- [[principles/architecture-over-shortcuts]] — "expose it now, classify later" is the quick fix this forbids.
