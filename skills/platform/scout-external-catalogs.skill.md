---
name: scout-external-catalogs
description: "Scan external open-source agent catalogs and file backlog items for archetype gaps"
category: platform
assignTo: ["portfolio-advisor"]
capability: "scout_external_catalogs"
taskType: "analysis"
triggerPattern: "scout|catalog|external agents|archetypes"
userInvocable: true
agentInvocable: true
allowedTools: []
composesFrom: []
contextRequirements: []
riskBand: low
---

# Scout External Agent Catalogs

Discover agent archetypes that exist outside the platform by scanning curated
open-source catalogs (v1 source: the MIT-licensed 500-AI-Agents-Projects list).
Parse each catalog entry, diff against our existing coworker and skill
inventory, and file one `BacklogItem` per gap for human review.

This skill is read-only scouting. It never forks, clones, or vendors any linked
repository. The source catalog is reference material, not code to import.

## Steps

1. Fetch the upstream catalog README from its raw URL.
2. Parse the industry table and each framework-specific table into a typed list
   of `{ name, industry, description, sourceUrl, framework? }` entries.
3. For each entry, attempt to map its `industry` string to one of the seeded
   IT4IT value streams. When no confident mapping exists, mark the eventual
   `BacklogItem` as `status: "deferred"` and note that a value-stream mapping
   is needed.
4. Diff the parsed entries against `SkillDefinition` + coworker archetypes.
   A "gap" is an entry whose use case is not already covered by an existing
   skill or coworker for the same value stream.
5. Create one `BacklogItem` per gap with `type: "portfolio"`. Dedupe by a
   stable hash of the source URL so re-runs do not create duplicates.
6. Emit an in-app notification to every admin user summarising the run
   (entries parsed, gaps identified, backlog items created) with a deep link
   to the filtered backlog view.

## Guidelines

- Fail loud if the upstream README format has changed — never write partial
  results.
- Always include the source URL and the phrase "Reference only — not vendored"
  in every backlog item description, so the MIT license attribution travels
  with the suggestion.
- Do not auto-create skills or coworkers from catalog entries. Humans review
  backlog items first.
- Default cadence is weekly; do not lower it without a clear justification.
- Single source for v1 (the 500-agents list). Generalise to other awesome-agent
  catalogs only after humans have curated at least one full run.
