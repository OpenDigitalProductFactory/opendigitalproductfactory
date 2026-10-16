---
title: Information hierarchy and content density
pageKind: heuristic
status: published
abstract: Hierarchy and density are the two axes on which generated interfaces fail most, and both are measurable. Hierarchy is read from the accessibility tree; density is counted on the default-visible DOM with deferred content excised, so progressive disclosure is rewarded rather than taxed.
professionCompetencyLevel: expert
sources:
  - nng/ten-heuristics
  - acm/computation-of-interface-aesthetics
  - arxiv/designer-feedback-ui-generation
---

## Why these two axes

Interfaces produced without a designer in the loop do not usually fail on syntax, colour, or copy. They fail on **layout composition and information hierarchy** — misaligned fields, overlapping text, everything shouting at once — and on **density**, because generation optimizes for completeness and nothing charges rent for text.

That is a measurement problem before it is a taste problem. Both axes have observable proxies, so the critique starts from evidence and reserves judgment for what evidence cannot settle.

## Hierarchy — read it from the accessibility tree

The accessibility tree is the browser's own projection of the page for assistive technology: roles, **heading levels**, nesting, accessible names, with presentational wrappers collapsed. It is the closest machine-readable thing to "what is this screen actually saying is important."

What to look for:

- **Heading spine.** Does the page have one `h1` naming the owner's job here, and do `h2`/`h3` descend without skipping? A run of sibling `div`s where headings should be means the page has no hierarchy — it has paint.
- **Landmark structure.** Is the lead band distinguishable from deferred detail, or is everything one undifferentiated region?
- **Accessible names that name things.** A control called "Submit" on a screen with four forms tells the reader nothing. `alt="image"` passes every automated check and communicates nothing — automated a11y green is necessary, never sufficient.
- **First-reachable content.** What the tree puts first is what the screen claims matters. If that is not the owner's next action, the hierarchy is wrong regardless of how it looks.

## Density — count the default-visible view

Density is counted on the served DOM **after excising deferred subtrees** (`details:not([open])` and marked disclosure regions). This is deliberate and it is the grain of the whole approach: a screen that correctly defers advanced content must score *better* than its wall-of-text twin, or the measurement would punish exactly the discipline it exists to encourage.

The counted quantities: words in the default-visible content, words in the lead band, primary actions, visible form fields, choices per control, tiny-text occurrences, presence of a next-action marker.

A complementary rule prevents gaming from the other direction: once total content passes a threshold, deferred structure must *exist*. Dumping everything into the default view is as much a violation as burying the lead.

### Keep useful detail on the surface

Owner direction, 2026-10-16: favor useful density and progressive disclosure. A
low word count does not establish a good interface. Large cards with little
content can make comparison harder and push the next useful fact out of view.

For an operational list, keep the recognizable subject, current state, relevant
reason or consequence, meaningful timing and next action together. Use aligned,
compact rows when people compare accounts or work items. Remove repeated labels
and explanatory filler before removing information needed for the decision.
Keep text readable, controls operable and the layout usable at narrow widths;
density does not justify tiny type or targets.

Progressive disclosure defers secondary configuration, full inventories, routing
rules and diagnostic history. It must not hide the reason work cannot run, an
important restriction, the next useful check or the action that resolves the
problem. Make expansion keyboard-operable and give its control a meaningful
accessible name.

Name subjects with labels people recognize: account and team names, work titles,
provider names and meaningful locations. A database identifier is not a useful
primary label merely because it is unique. Put opaque internal identifiers in
diagnostic detail with a copy action when support needs them. Show a reference
on the main surface only when people actually recognize and use it; preserve a
readable name alongside it.

Critique both what the default view exposes and what it forces people to open.
For example, an account row should expose its readiness, why it is waiting,
the next check and its permitted work, while deferring the complete model list
and connection identifiers. A sparse card that hides those facts is not an
improvement over a dense row just because it scores lower on text mass.

**Honesty about these numbers:** the text-mass thresholds are platform-owned calibration, not science. No study validates words-per-screen against user outcomes. They are defensible as a consistent yardstick and as a regression tripwire; they are not a finding about human cognition, and must never be presented as one.

**The visual metrics are different.** Computational measures of clutter, colour range, figure-ground contrast, contour congestion, symmetry, grid quality and white space have been validated against human aesthetic ratings, explaining up to 49% of variance for webpages. Those numbers carry evidence behind them, and — being deterministic — they can be ratcheted where a model's opinion cannot.

## The classical lenses, and what each is actually for

- **Hick** — decision time grows with the number of choices. Use it on control counts and menu breadth, not as a general "simplify" gesture.
- **Fitts** — acquisition time depends on target size and distance. Use it on tap targets and on actions placed far from where the eye lands.
- **Miller** — working memory limits how many grouped items a reader holds. Use it on list grouping and step counts, not as a hard "seven items" rule, which is a misreading.
- **Doherty** — attention holds when response stays under roughly 400ms. Use it on perceived latency and on whether the screen shows progress before it shows results.

These lenses name *why* something is wrong once measurement has shown *that* it is. Leading with the lens instead of the evidence is how design critique becomes unfalsifiable.

## How the critique is expected to read

Evidence first, then lens, then the change. "This route's default view is 380 words against a 160 budget, and the heading spine goes h1 → h3; Miller and the hierarchy lens both point at the same fix — group the six status lines under one h2 and defer the audit trail." Not: "this feels cluttered."

If there is no evidence and no corpus entry to cite, the honest output is that there is no grounded basis for a critique — not a plausible-sounding comment. See [[professions/ux-design/design-critique-corpus-method]] and [[professions/ux-design/critique-calibration-gate]].

## See Also

- [[professions/ux-design/design-critique-corpus-method]]
- [[professions/ux-design/critique-calibration-gate]]
- [[professions/ux-design/heuristic-evaluation-method]]
- [[professions/ux-design/ten-usability-heuristics-summary]]
