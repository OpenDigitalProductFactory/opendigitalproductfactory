---
title: Single Source of Truth
pageKind: principle
status: published
abstract: Each rule, fact, or decision lives in exactly one place. Pointers, not copies.
principleTier: commandment
principleDirection: Author each rule, fact, or decision in exactly one place; reference everywhere else via pointer.
principleDimensionVector: {"long_term_maintainability": 1.0, "schema_grounding": 0.7, "blast_radius": -0.5, "reusability": 0.55, "governance_compliance": 0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters consuming DPF need to know that every rule has exactly one canonical home — duplication is the failure mode the platform actively prevents.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Each rule, fact, or decision lives in exactly one canonical location. Every other reference is a pointer. No copy-paste of governance text into other docs, no duplication of enum values across modules, no parallel taxonomy of the same concept. When the rule changes, the change happens in one place and propagates everywhere via the existing pointer graph.

## Why

Duplication is how rules drift. The instant the same rule lives in two places, the two copies will be edited at different times by different people and will disagree within months. The disagreement is invisible until someone asks "which is correct?" — at which point one of them has been wrong for months and a downstream consumer has built on the wrong version. The cure is harder than prevention: track down every duplicated copy, reconcile, then enforce the single-source rule going forward. The principle exists because that cleanup is expensive every time.

## Applies To

In-platform coworkers managing platform documentation, external coding agents authoring specs and code, and humans operating the platform's knowledge base. Symmetric across rules, configuration values, taxonomy entries, governance text, and decision records.

## How To Apply

When you find yourself about to write the same rule in a second location, stop. Convert the destination into a pointer to the source. Concrete patterns: `AGENTS.md` points to founder-kernel wiki principles for durable governance; tool-specific files (`CLAUDE.md`, `.cursor/rules/`, etc.) point to `AGENTS.md`; enum values live in one module and re-export everywhere; spec docs reference earlier specs by link, not by quoting them. When you must duplicate (e.g., copying a code snippet into a how-to guide), mark the copy as "mirrored from <source>" so future maintenance knows which is canonical.

## Decision Dimensions

- `long_term_maintainability: 1.0` — duplication-prevention is the single biggest lever on long-term maintainability. Maximum weight.
- `schema_grounding: 0.7` — canonical sources can be linted, versioned, and migrated; scattered duplicates cannot.
- `blast_radius: -0.5` — when rules drift across duplicates, every downstream consumer is at risk; the principle keeps the blast radius bounded.

## Examples

- **Positive:** `WikiPageKind` is defined once in `packages/db/src/wiki-taxonomy.ts` and re-exported everywhere — seed, lint, MCP schemas, UI badges, and admin filters all import from the same module. When the kind list changes, one edit propagates.
- **Counterexample:** A hypothetical world where `WikiPageKind` is duplicated as a string union in `seed-wiki-kernel.ts`, as an enum in `lint-detectors.ts`, and as another string union in `WikiPageList.tsx`. Adding `principle` would require three edits, and any one of them being missed produces a silent inconsistency.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
