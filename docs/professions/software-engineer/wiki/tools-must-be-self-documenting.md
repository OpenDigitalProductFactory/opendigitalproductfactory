---
title: Tools Must Be Self-Documenting
pageKind: principle
status: published
abstract: If the model can't understand a tool from its schema, the schema is wrong.
principleTier: core
principleDirection: Make every tool schema self-explanatory; do not rely on the surrounding prompt to fix bad descriptions.
principleDimensionVector: {"long_term_maintainability": 0.5, "human_cognitive_load": -0.4, "schema_grounding": 0.7}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-1-coworker
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: Adopters building MCP tools or coworker skills need this rule front and center — the tool schema is the contract.
sources:
  - articles/why-we-ended-up-proposing-two-standards-for-ai-agents
---

## Rule

Every tool definition includes a description that explains what it does and when to use it, parameter descriptions with types and examples, and clearly marked required parameters. The build-phase system prompt may include a tool usage guide that maps common tasks to specific tools — but the tools themselves must stand alone. If you find yourself adding a prompt section to compensate for a confusing schema, fix the schema instead.

## Why

Smaller models (Haiku-tier) lean heavily on description quality for tool selection — a model that sees `write_sandbox_file(path, content: "The full file content to write")` knows to pass the entire file; a model that sees `write_sandbox_file(path, content: string)` may omit content or pass a description instead. The difference is success vs. retry loop. Even frontier models benefit: a well-described tool reduces the model's reasoning load and frees that capacity for the actual task. Documentation that lives next to the tool also ages with it — prompt-side instructions drift out of sync the moment the tool changes.

## Applies To

In-platform coworkers consuming `PLATFORM_TOOLS`, external coding agents calling DPF's MCP surface, and any tool registered for agent use. Applies to MCP tool authors, skill authors, and coworker-prompt authors equally.

## How To Apply

When adding a tool, write the description as if the user knows nothing about the surrounding system. Include: what the tool does, when to use it (and when NOT to), example inputs, what success looks like, what failure means. For parameters, types alone are insufficient — add a one-line example for non-obvious shapes (`features: { "schema_grounding": 0.8 }`). After writing the schema, read it back with no other context and ask: would I call this tool correctly?

## Decision Dimensions

- `long_term_maintainability: 0.5` — schema-resident documentation survives prompt rewrites and refactors; prompt-resident documentation rots.
- `human_cognitive_load: -0.4` — well-described tools reduce review burden for both human reviewers and downstream agents.
- `schema_grounding: 0.7` — explicit, typed, exemplified schemas are the contract; everything else is implementation detail.

## Examples

- **Positive:** `wiki_query(query, pageKind?, tier?, appliesTo?, publicOnly?, limit?)` with every parameter described, enum values listed, and the description explaining when to filter by tier vs. just by kind. Smaller models pick the right combination on the first call.
- **Counterexample:** A tool whose description reads "search wiki" with parameters `q: string, k?: string`. Even a frontier model will need 2–3 retries to figure out the right argument shape.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations` — do not duplicate citation prose here.)
