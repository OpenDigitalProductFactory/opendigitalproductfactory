---
title: Disclose before you add a surface
slug: disclose-before-you-add-a-surface
pageKind: principle
status: published
abstract: When a surface outgrows its first viewport, disclose progressively inside the existing home using the canonical construct before adding a new route, tab, or dashboard band.
principleTier: core
principleDirection: When a surface outgrows its first viewport, disclose progressively inside the existing home using the canonical construct before adding a new route, tab, or dashboard band.
principleDimensionVector: {"operator_effort": -0.6, "human_cognitive_load": -0.7, "reusability": 0.5}
principleAppliesTo:
  - in_platform_coworker
  - external_coding_agent
  - human
principleConsumerArchetype: route-domain-specific
principleConsumerContexts:
  - ui
principleRingScope:
  - ring-2-workflow
principlePublic: false
authoredAt: 2026-07-23
authoredBy: mark-bodman
---

# Disclose before you add a surface

**When a surface has more to show than fits its first viewport, reveal the extra
progressively inside the same home — using the canonical disclosure construct for
the relationship — before you reach for a new route, tab, or dashboard band.**
The default answer to "there's more content" is a disclosure, not a new surface.

## Why

Growth pressure on a screen is constant, and the lazy release valve is always a
new tab or a new page. Each one enlarges the map the operator must hold and moves
the "more" further from its context. Progressive disclosure keeps the extra
content *where it belongs* — one click deep, in context — and keeps the top-level
map small. It is also what makes the wall-of-text budget honest: a page that
correctly defers its advanced content reads as calm, not as a page that dumped
everything into the first viewport.

The platform already prescribes *which* construct fits *which* relationship
(`CollapsibleList` to preview a long list, `ExpandableCard` for subordinate
detail among peers, native `<details>` for one short secondary aside, a drawer to
preserve a large detail workspace, a dedicated route only when linking/history/a
full workflow is needed). This principle says: choose from that set first, and
only escalate to a new surface when none of them fit.

## Applies To

In-platform coworkers and external coding agents building or extending portal
surfaces, and humans reviewing UI plans. It is the "what do I do when the home
gets full" companion to [[principles/one-home-per-capability]] ("keep it one
home"): that one says do not fork a second home; this one says grow the home
inward by disclosure before you grow the map outward by a surface.

## How To Apply

When a surface needs to show more, pick the canonical disclosure construct for
the summary→content relationship rather than hand-rolling an expand/collapse
dialect or adding a tab. Excise deferred subtrees from the arrival view so the
first viewport stays within budget; the deferred content lives one interaction
away, in context. Escalate to a genuinely new route only when the content needs
its own URL, history, or a full record workflow.

## Decision Dimensions

- `operator_effort: -0.6` — in-context disclosure keeps the extra content one
  click from where it is relevant; a new tab/page adds navigation operations to
  reach the same thing.
- `human_cognitive_load: -0.7` — a small top-level map with detail tucked in
  context is holdable; a map that grows a surface per "more" is not.
- `reusability: 0.5` — reusing the canonical disclosure constructs converges the
  portal on one expand/collapse vocabulary instead of a new dialect per feature.

## Overlap scan (§4.3)

Closest existing principle by the overlap scan: `substrate-cleanup-before-
substrate-addition` at 0.62, then `design-research-required` at 0.55 — both below
the 0.70 bar. Adjacent-but-distinct: substrate-cleanup is about consolidating
*backend* substrate before adding a layer; this is about disclosing *UI* content
inward before adding a surface. It is a means to lower
[[principles/one-home-per-capability]]'s `operator_effort`, so it deliberately
does not introduce a new dimension.
