---
title: Design Research Required in Every Spec
pageKind: principle
status: published
abstract: Every new feature spec includes a Research & Benchmarking section comparing 2-3 OSS leaders and 2-3 commercial products.
principleTier: core
principleDirection: Anchor every design on research against real comparable systems; document adopted patterns, rejected patterns, anti-patterns, and gaps.
principleDimensionVector: {"schema_grounding": 0.6, "long_term_maintainability": 0.6, "evidence_density": 0.7, "reusability": 0.5, "evidence_confidence": 0.55}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: Adopters and contributors should see DPF's research discipline — every spec defends its design choices against the field, not against intuition.
sources:
  - frameworks/it4it-v3
---

## Rule

Every new feature spec includes a Research & Benchmarking section before finalization. Compare 2-3 open-source leaders (read their data models, not just feature lists) and 2-3 commercial products. Document patterns adopted, patterns rejected, anti-patterns identified, and gaps the design fills. Reference specific projects, not abstract "best practices."

## Why

A design that hasn't been compared to working systems is a design that's about to discover what other systems already learned the hard way. Research-anchored specs are cheaper to ship (reuse existing patterns), cheaper to maintain (align with conventions adopters already know), and cheaper to defend in review (the alternatives have been considered explicitly, not waved away). The cost of writing the research section is a few hours; the cost of skipping it shows up over years as the design accumulates patches for problems someone else solved a decade ago.

## Applies To

In-platform coworkers authoring specs, external coding agents drafting design docs, and humans setting product direction. Symmetric. Applies to feature specs, architecture decisions, schema designs, integration patterns. Does NOT apply to hot-fix specs where the design is constrained to the existing system — those reference the original spec's research section.

## How To Apply

For every new feature spec, find 2-3 OSS leaders in the problem space and 2-3 commercial products. Read their actual data models and APIs, not their marketing pages. For each, name what they got right (patterns DPF adopts), what they got wrong (patterns DPF rejects), and what they missed (gaps the new design fills). Cite specific names: not "industry best practices," but "MediaWiki's revision table" or "Notion's block model." The research section is part of the spec, not an appendix; it shows up in the spec doc and the spec PR description.

## Decision Dimensions

- `schema_grounding: 0.6` — research against real systems forces concrete schema decisions instead of abstract sketches.
- `long_term_maintainability: 0.6` — designs aligned with proven patterns age with the field; bespoke designs age with the original author.
- `evidence_density: 0.7` — citations are durable evidence; "this seems best" is not.

## Examples

- **Positive:** The EP-WIKI-001 spec includes a Research & Benchmarking section comparing MediaWiki, Docusaurus, Logseq, Notion, Confluence, Guru, and Obsidian — each with what DPF adopts (page/revision split from MediaWiki, static-from-markdown from Docusaurus) and what DPF rejects (block-level governance from Logseq, opaque block trees from Notion).
- **Counterexample:** A spec that says "we'll use a graph database because graph databases are good for this." No comparison, no rejection, no anti-pattern identified. Reviewer can't tell whether Neo4j or DGraph or NetworkX was considered; reviewer can't tell whether a relational alternative was considered; reviewer rejects the spec.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
