---
title: Organization as Canonical Platform Identity
pageKind: principle
status: published
abstract: Any feature needing org name, slug, logo, address, or contact info reads from Organization, not from bespoke fields elsewhere.
principleTier: core
principleDirection: Read org identity from Organization; never bypass it with BrandingConfig or env-vars or bespoke fields.
principleDimensionVector: {"schema_grounding": 0.9, "long_term_maintainability": 0.7, "reusability": 0.6}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-3-archetype
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: Adopters configure the organization once and expect every feature to honor that configuration — this is the data-architecture commitment behind that contract.
sources:
  - frameworks/csdm
---

## Rule

`Organization` is the canonical platform identity model. Any feature needing org name, slug, logo, address, or contact info reads from `Organization` — not from `BrandingConfig`, environment variables, or bespoke fields elsewhere. Derivations (industry from `archetype.category`, vocabulary from `resolveVocabularyKey`) read from `Organization` and its archetype, not from parallel sources.

## Why

Org identity is the most cross-cutting data in the platform — it shows up on every page, every email, every external integration. Letting features stash copies of "org name" or "logo URL" in their own tables is how the platform ends up with three different spellings of the company name visible to the same customer. The canonical-model rule eliminates that whole class of inconsistency: there is one place that owns "org identity," everything else reads from there. When the customer renames the org, one update propagates everywhere.

## Applies To

In-platform coworkers reading or writing org identity, external coding agents authoring features that touch org-level data. Symmetric. Applies to UI components, notification senders, document generators, external API callouts, and analytics. Does NOT apply to historical snapshots (audit records, immutable evidence bundles) — those legitimately capture the org identity at the time of the event, not the current value.

## How To Apply

When a feature needs the org name, address, logo, or any other identity field, import the relation from `Organization` rather than declaring a parallel field. When the same data shows up in `BrandingConfig` or an env var, treat that as a candidate refactor — converge the source. Industry is derived from `archetype.category`; do not store it on `Organization` or `BusinessContext` as a parallel column.

## Decision Dimensions

- `schema_grounding: 0.9` — `Organization` IS the canonical identity schema; the principle locks it in place.
- `long_term_maintainability: 0.7` — parallel identity columns are a leading cause of inconsistency bugs; canonicalizing prevents them.
- `reusability: 0.6` — components reading from `Organization` compose across features; components reading parallel sources don't.

## Examples

- **Positive:** A new email template needs the org's display name and address. The template reads `organization.name` and `organization.address` via the existing relation; the customer renames the org once in the admin UI; every email going forward uses the new name.
- **Counterexample:** A new feature ships with its own `OrgSettings` table holding name + address "for performance." The customer renames the org via admin; emails sent through the new feature still use the old name because the parallel table didn't update. The fix is to remove the parallel table and read from `Organization` — at the cost of every consumer of `OrgSettings` being updated in the same PR.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
