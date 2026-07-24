---
title: Principal Convergence
pageKind: principle
status: published
abstract: New identity-bearing entities model as PrincipalAlias linked to a single Principal, not as parallel identity tables.
principleTier: core
principleDirection: Model every new identity surface as a PrincipalAlias linked to Principal; never ship a parallel identity table.
principleDimensionVector: {"schema_grounding": 0.9, "long_term_maintainability": 0.7, "governance_compliance": 0.6}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-3-archetype
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: Documents DPF's identity-convergence stance — adopters need this guidance before adding any new actor type to the platform.
sources:
  - frameworks/csdm
---

## Rule

Per the addendum on `docs/superpowers/specs/2026-04-22-enterprise-auth-directory-federation-design.md`, any new identity-bearing entity introduced after 2026-05-09 models as a `PrincipalAlias` linked to a single `Principal`, not as a parallel identity table. The convergence target covers `User`, `CustomerContact`, `Agent`, `EdgeNode`, `MobileDevice`, and `ServiceAccount`. Authorization decisions resolve on the `Principal`; the alias kind tells the platform which surface authenticated the request.

## Why

Identity, like org identity, is cross-cutting. Without convergence, every new actor type (a mobile device, a service account, an edge node) ships its own identity table with its own auth chain, its own session model, its own audit trail — and the authorization layer has to special-case all of them. Convergence to `Principal + PrincipalAlias` means there is exactly one place authorization decisions resolve, exactly one place the audit trail aggregates, and exactly one identity record per actor regardless of how many surfaces they authenticate through. The 2026-05-09 cutoff exists because the convergence work was ongoing — pre-cutoff identity tables stayed as-is; post-cutoff ones must converge from the start.

## Applies To

In-platform coworkers proposing new actor types, external coding agents authoring identity-related code. Applies to mobile clients, service accounts, edge nodes, AI agents, customer contacts, and any future actor surface. Does NOT apply to non-identity entities (orders, products, events) — those don't authenticate, so they don't need to converge.

## How To Apply

When designing a feature that introduces a new actor, model it as `PrincipalAlias` from day one. The `aliasType` field carries the surface ("user", "edge_node", "mobile_device", etc.); the `principalId` links to the canonical `Principal` row that owns identity, permissions, and audit. Authorization resolves on `Principal`; aliases are the entry points. Existing parallel identity tables (pre-2026-05-09) are being converged via retrofit migrations; new ones must not be created.

## Decision Dimensions

- `schema_grounding: 0.9` — Principal + PrincipalAlias IS the identity schema for DPF; the principle locks it in.
- `long_term_maintainability: 0.7` — parallel identity tables compound auth complexity; convergence keeps it linear.
- `governance_compliance: 0.6` — auth + audit + permission decisions need a single source of truth; convergence provides it.

## Examples

- **Positive:** The Edge Node phase 0 schema initially shipped EdgeNode as a parallel identity table with `displayName` directly on it. The post-2026-05-09 retrofit converged EdgeNode to `Principal + PrincipalAlias` so the authorization layer resolves edge-node identity through the same path as user identity.
- **Counterexample:** A new mobile-client feature ships with `MobileDevice.deviceUserId` as its own identity column. Three sprints later the auth layer needs to handle mobile device sessions; every middleware that resolves `Principal` has to be patched to also resolve `MobileDevice`. The fix is the convergent retrofit — done after the parallel table shipped, at twice the cost of doing it right initially.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
