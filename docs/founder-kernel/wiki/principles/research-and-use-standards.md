---
title: Research and Use Standards
pageKind: principle
status: published
abstract: Before designing, find the existing standard. Cite sources. Recommend the standard unless you have a project-specific reason to deviate.
principleTier: commandment
principleDirection: Prefer existing standards with citations over bespoke designs invented for this task.
principleDimensionVector: {"schema_grounding": 0.9, "long_term_maintainability": 0.7, "reusability": 0.6, "evidence_density": 0.75, "governance_compliance": 0.45}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - universal-ring
principleConsumerArchetype: universal
principlePublic: true
principlePublicRationale: DPF's identity as a standards-anchored platform (IT4IT, CSDM, TOGAF, MCP) makes this commandment product-facing — adopters should expect every design choice to defend itself against published standards.
sources:
  - frameworks/it4it-v3
---

## Rule

Before designing file layouts, conventions, integrations, or schemas, find the existing standard. Cite sources in the design doc. Recommend the standard unless you have a project-specific reason to deviate — and if you deviate, name the reason.

## Why

Standards encode hard-won decisions that the field has already made and stress-tested. Reinventing them is expensive (the work itself), wasteful (every adopter has to learn the bespoke version), and risky (the standard usually handles edge cases the bespoke version misses). DPF's strategy is to compose standards: IT4IT for value streams, CSDM for service models, TOGAF for enterprise architecture, MCP for agent tools, DCO for commit attribution. The platform's leverage comes from being the substrate that wires those standards together, not from inventing parallel tracks.

## Applies To

In-platform coworkers designing new features, external coding agents writing specs, and humans setting platform direction. Symmetric. Applies to data models, APIs, file formats, agent topologies, governance models, and integration patterns. Does NOT apply when the standards literature does not yet exist for the problem (early-stage research) — but the obligation then becomes to publish the bespoke design as a candidate standard, not to keep it bespoke.

## How To Apply

For every new design surface, do the literature check before sketching code: find 2-3 OSS leaders and 2-3 commercial products, read their actual data models, document what they got right and where they got it wrong, name the patterns DPF adopts and the patterns it rejects. The "Research & Benchmarking" section is mandatory in every feature spec for exactly this reason. When deviating, the spec's "Patterns rejected" section names the deviation explicitly.

## Decision Dimensions

- `schema_grounding: 0.9` — standards ARE the schema. Aligning with them keeps DPF's models composable.
- `long_term_maintainability: 0.7` — standards-aligned code ages with the standard; bespoke code ages with the original author.
- `reusability: 0.6` — standards-aligned components compose into others' workflows; bespoke ones don't.

## Examples

- **Positive:** When designing the wiki kernel (EP-WIKI-001), the spec includes a Research & Benchmarking section comparing MediaWiki, Docusaurus, Logseq, Notion, Confluence, Guru, and Obsidian. DPF adopts MediaWiki's page/revision split, Docusaurus's static-from-markdown pattern, and Guru's verification posture; rejects Notion's opaque block trees and Logseq's block-level governance.
- **Counterexample:** Inventing a new YAML dialect for principle frontmatter without checking how Obsidian / Logseq / Hugo handle the same problem. The bespoke version diverges from every adopter's existing tooling and locks DPF into custom parsing forever.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
