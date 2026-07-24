---
title: Strongly-Typed String Enums
pageKind: principle
status: published
abstract: DB string columns with fixed valid values are canonical enums. Update the enum source and the MCP tool definition in the same commit.
principleTier: core
principleDirection: Treat fixed-value string columns as canonical enums; update enum source + MCP schema + UI types together.
principleDimensionVector: {"schema_grounding": 0.9, "long_term_maintainability": 0.6, "reusability": 0.4}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
principleRingScope:
  - ring-2-workflow
  - ring-3-archetype
principleConsumerArchetype: specialist
professionCompetencyLevel: practitioner
principlePublic: true
principlePublicRationale: Documents DPF's enum convention so adopters' agent code and MCP integrations align with the platform's typed contracts.
sources:
  - frameworks/csdm
---

## Rule

Database string columns with a fixed set of valid values are canonical enums. Source of truth lives in one TypeScript module (e.g., `apps/web/lib/backlog.ts` for `EPIC_STATUSES`); MCP tool definitions reference the same array. Adding a new value requires updating both the enum source and every consumer (MCP tool schema, UI types, validation) in the same commit, before any data uses the new value.

## Why

Without typed enums, string columns drift: someone inserts `"in_progress"` (underscore) into a column that the rest of the code reads as `"in-progress"` (hyphen). The mismatch is invisible until a query returns the wrong rows. With typed enums, both the producer and every consumer are checked against the same source — drift becomes a compile error or a failing test, not a silent production bug. The hyphen-vs-underscore convention exists because both are otherwise legal in JSON / SQL / TypeScript; pick one and lint for it.

## Applies To

In-platform coworkers managing DB writes, external coding agents calling MCP tools that accept enum-typed parameters. Symmetric. Applies to status, type, tier, kind, and any other fixed-value categorical column.

## How To Apply

When adding a new fixed-value column, declare the value array in one module and import everywhere else. Reference the array from the MCP tool's `enum: [...]` field rather than re-typing the values. Adding a new value: update the enum source first, update every consumer in the same commit, ship the data that uses the new value last. Hyphens, not underscores. Renames are migrations, not edits.

## Decision Dimensions

- `schema_grounding: 0.9` — typed enums are the data-layer schema for categorical columns; the principle locks the schema in place.
- `long_term_maintainability: 0.6` — drift between producer and consumer is a leading cause of silent bugs; preventing drift compounds in value over time.
- `reusability: 0.4` — agent code that imports the same enum module composes correctly; agent code that hardcodes the strings doesn't.

## Examples

- **Positive:** `EPIC_STATUSES` lives in `apps/web/lib/backlog.ts` as `["open", "in-progress", "done"]`. The `list_epics` MCP tool's `status` parameter references the same array. Both the producer (any code that writes `Epic.status`) and every consumer (UI filters, agent prompts) check against this one source. Adding `"deferred"` requires one commit touching all consumers atomically.
- **Counterexample:** The MCP tool's enum has `["open", "in-progress", "done"]` but the UI filter dropdown is hardcoded with `["open", "in_progress", "done"]`. A user filters by `in_progress`; nothing matches; the bug looks like an empty DB.

## Sources

(Rendered from the `sources:` frontmatter by `WikiSourceCitations`.)
