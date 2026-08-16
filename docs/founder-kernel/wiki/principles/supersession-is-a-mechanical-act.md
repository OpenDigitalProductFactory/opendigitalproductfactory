---
title: Supersession Is a Mechanical Act
pageKind: principle
status: published
abstract: When a new pattern, module, spec, or model replaces an old one, retiring the old one is part of the same change — delete or redirect in the same PR for code, a linted status marker for docs. A supersession that lives only in prose or memory is drift waiting to happen.
principleTier: core
principleDirection: Retire the superseded generation in the same motion that lands its replacement — delete/redirect in code, machine-checkable status markers in docs — never leave generations coexisting by default.
principleDimensionVector: {"long_term_maintainability": 0.9, "human_cognitive_load": -0.7, "governance_compliance": 0.5, "legibility_of_consequence": 0.6, "speed_to_value": -0.2}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleRingScope:
  - ring-2-workflow
principleConsumerArchetype: universal
principlePublic: false
principlePublicRationale: ""
---

## Rule

Landing a replacement and retiring what it replaces are **one act, not two**. In code: the superseded module is deleted, or reduced to a redirect/alias with a stated expiry, in the same PR that lands its successor — and the tests move with it. In docs: the superseded spec gets a machine-checkable status marker (`superseded-by: <path>`) that a linter verifies, in the same change that publishes the successor. "We'll clean it up later" is not a supersession; it is a second generation.

## Why

The 2026-08-16 architecture pass found the cost of treating supersession as optional follow-up: three coexisting MCP handler generations; two living architecture overviews contradicting each other; two connector registries; nine local `ActionResult` aliases; six conventions for "not active"; ~30 orphaned tests at addresses their subjects had left; free-text supersession in four formats across 654 unindexed specs. None of these was a decision — each was a replacement whose retirement half never landed. Every coexisting generation taxes every reader with "which one applies here?", and at agent velocity new readers arrive constantly.

## Applies To

Everyone who lands a replacement: in-platform coworkers, external coding agents, humans. Applies to code patterns, modules, registries, schema models, MCP tools (alias window with expiry — the Workroom rename set the precedent), specs, and living docs.

## How To Apply

When a PR introduces something that overlaps an existing thing, the PR answers one of: (a) the old thing is deleted here; (b) the old thing is now a redirect/alias with a recorded expiry and a follow-up anchor that exists; (c) a written statement of why both must coexist, in the surviving thing's header. Reviewers treat a new pattern beside an old one with none of the three as incomplete. For docs, use the status/supersession frontmatter convention and let the linter hold it. Deliberate coexistence is legitimate when argued — the TS/Go edge-node pair is ADR-backed — but it is *declared*, never accidental.

## Decision Dimensions

- `long_term_maintainability: 0.9` — generations that coexist silently are compounding debt.
- `human_cognitive_load: -0.7` — negative: the principle removes the "which generation applies?" tax from every future reader.
- `legibility_of_consequence: 0.6` — a recorded supersession makes the system's current shape knowable from its artifacts.
- `speed_to_value: -0.2` — the retirement half costs the landing PR some scope.

## Examples

- **Positive:** the Workroom canonical rename — legacy `*_capsule_*` MCP names kept callable but unadvertised for a stated alias window, with identical grants, recorded in the vocabulary-boundary doc.
- **Negative:** `lib/mcp-tools.ts` (1,952-line legacy monolith) and `lib/mcp-handlers/` (an abandoned third pattern with exactly one file) coexisting with `lib/mcp/packs/` — with ~30 orphaned root-level tests still pointing at the old addresses.

## Related

- [[principles/primitive-done-means-ratchet-on]] — the ratchet blocks new competitors; supersession retires the old ones.
- [[principles/single-source-of-truth]] — coexisting generations are the multi-source failure mode in time rather than space.
