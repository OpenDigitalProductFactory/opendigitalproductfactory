# HTML Artifacts Guide — when a spec, plan, report, or PR write-up should ship as `.html`

- **Status:** opt-in convention (additive). Markdown remains fully supported.
- **Date:** 2026-06-14
- **Source thesis:** Derrick (Claude Code team, Anthropic), summarized in
  ["Markdown vs HTML: Why Anthropic's Claude Code Team Chose Wrong First? Or Not?"](https://youtu.be/-iSLQe_imrE)
  (DIY Smart Code, 2026-05-09).

## TL;DR

For **agent-authored artifacts a human is meant to actually read and steer** —
specs, plans, design explorations, reports, and PR write-ups — an HTML document
is often a better deliverable than Markdown. HTML carries real tables, SVG flow
diagrams, syntax-styled code, jump-link navigation, and a layout that invites
clicking instead of skimming. The format failure that pushes a model toward
ASCII boxes and Unicode "charts" disappears: when you give the agent HTML, it
draws the chart instead of faking it.

This is **opt-in and additive**. Do not bulk-convert the existing
`docs/superpowers/specs/*.md` or `plans/*.md` corpus. Reach for HTML when the
extra expressiveness earns its keep; stay in Markdown when it doesn't.

## Why this is worth adopting here

The thesis lands harder in DPF than in a generic repo, because the artifacts we
generate are exactly the ones it targets:

- **Specs** in `docs/superpowers/specs/` routinely describe state machines,
  classification logic, routing flows, and data contracts — content that is much
  clearer as an SVG diagram + table than as nested prose bullets.
- **Plans** in `docs/superpowers/plans/` are phased and dependency-ordered — a
  natural fit for a numbered, jump-linked layout.
- **PR write-ups** are the single most-read agent artifact on the team, and the
  default GitHub diff view is the weakest place to explain *why* a change is
  shaped the way it is.

The deciding argument from the source isn't density or polish — it's that the
author **stopped reading his Markdown plans** (a wall of text he'd offload and
not check, leaving the agent to make every call) and **started reading the HTML
ones**. The operator staying in the loop is the whole point. In a codebase where
the standing rule is "the agent runs the system, the human makes decisions,"
keeping the human reading the decision artifact is load-bearing.

## When to use HTML vs Markdown

Use **HTML** when the artifact has any of:

- A flow, state machine, sequence, or architecture that wants a real **diagram**
  (inline SVG) instead of an ASCII box.
- **Tabular data** with more than ~3 columns or where alignment matters.
- **Code snippets** that benefit from syntax styling and copy buttons.
- Enough length that **jump-link navigation** (a sticky table of contents) makes
  it navigable rather than a scroll.
- Side-by-side **option comparison** (e.g. "fan out 6 approaches, each labeled
  with its trade-off, pick one").
- An interactive aid — a throwaway editor, a tunable prototype, a drag-to-sort
  triage surface — where typing into a text box can't describe what you want.

Stay in **Markdown** when:

- The artifact is short, mostly prose, and has no diagram/table/interaction.
- It must be **diffable and greppable** as a first-class concern — e.g. content
  that `search_specs_and_plans` indexes, or doctrine that reviewers read in the
  PR diff line-by-line. (HTML diffs are noisier; weigh this.)
- It's a kernel principle, an AGENTS.md rule, or a `.skill.md` — these are
  canonical text under tight single-source-of-truth discipline and stay
  Markdown.

When in doubt, write the Markdown and **link to an HTML companion** for the parts
that need it (a diagram, a comparison). You don't have to pick one globally.

## The cost, honestly

- HTML takes roughly **2–4× longer to generate** than the equivalent Markdown.
  With Opus's large context window this barely registers against the budget a
  spec/plan already spends, but it is a real cost — don't pay it for a
  three-paragraph note.
- HTML **diffs are noisier** than Markdown diffs. For artifacts whose review
  *is* the line-by-line diff, that's a genuine downside (see "stay in Markdown"
  above).
- Keep every artifact a **single self-contained `.html` file** — inline CSS,
  inline SVG, no external assets or CDN `<script>` tags — so it opens in any
  browser, survives being moved, and reviews as one file. The templates in
  `docs/superpowers/_templates/` already do this.

## What ships with this guide

- **Spec template** — [`_templates/spec.template.html`](_templates/spec.template.html).
  Self-contained, themed, with a sticky jump-link TOC, a frontmatter card
  (BI / Epic / Status / Date), a placeholder SVG diagram, styled tables, and
  syntax-styled code blocks. Copy it next to the `.md` (or instead of it) for a
  new design.
- **PR-explainer template** —
  [`_templates/pr-explainer.template.html`](_templates/pr-explainer.template.html).
  A "code explainer" to attach to a PR or paste into the description: what
  changed and why, a change-map table, an annotated diagram of the touched flow,
  key snippets, and a reviewer-gotchas section. The source thesis reports this
  reads better than the default GitHub diff view.
- **Worked pilot** —
  [`specs/2026-06-09-release-verification-health-surfacing-design.html`](specs/2026-06-09-release-verification-health-surfacing-design.html),
  a faithful HTML conversion of an existing shipped spec
  (the [`.md` original](specs/2026-06-09-release-verification-health-surfacing-design.md)
  kept alongside, unchanged). It renders the reader's classification logic as a
  real SVG state machine and the status tones as a styled table — the parts that
  were hardest to follow as prose. Open both and compare.

## Patterns (copy these)

These are the high-leverage moves the templates encode. All are plain,
dependency-free HTML/CSS/SVG.

### Jump-link table of contents

A sticky `<nav>` of in-page anchors turns a long artifact into something a
reader navigates instead of scrolls. Every `<h2 id="...">` gets a matching
`<a href="#...">` in the TOC.

### SVG flow / state diagrams

Hand the model the five numbers or the five states and let it draw an `<svg>`
with `<rect>` nodes, `<text>` labels, and `<path>`/`<line>` arrows — instead of
an ASCII box that drifts the moment the font changes. Use `currentColor` and a
small CSS variable palette so the diagram inherits theme colors. The pilot's
classification state machine is a complete worked example.

### Real tables

`<table>` with a styled `<thead>` for anything tabular — status→tone maps,
file→change maps, option→trade-off matrices. Right-align numbers, keep a zebra
or hairline-row style for scanability.

### Syntax-styled code blocks

`<pre><code>` with a monospace stack, a tinted background, and a few `<span>`
classes for keyword/string/comment coloring. Add a small "copy" affordance if
the snippet is meant to be lifted.

### Option fan-out

When exploring approaches, render them as side-by-side `<section>` cards, each
headed by the trade-off it makes. The reader picks; the pick becomes the plan.

## Theming

Define a small `:root` palette of CSS variables (`--bg`, `--fg`, `--muted`,
`--accent`, `--border`, severity tones) at the top of every artifact and a
`@media (prefers-color-scheme: dark)` override. Never hard-code hex values in
the body — same no-hardcoded-colors discipline the portal UI follows. The
templates ship with a palette already wired; reuse it so artifacts look like one
family.

## Relationship to existing conventions

- **Locations are unchanged.** HTML specs live in `docs/superpowers/specs/`
  next to the `.md` files; HTML plans live in `docs/superpowers/plans/`. Keep
  the same `YYYY-MM-DD-<topic>-design.html` / `YYYY-MM-DD-<feature>.html`
  naming (AGENTS.md §16).
- **`search_specs_and_plans` indexes Markdown.** If a spec ships HTML-only and
  needs to be discoverable via that tool, leave a short Markdown stub (title,
  BI, one-line abstract, link to the `.html`) so the index still finds it. The
  pilot keeps its full `.md`, so this isn't a concern there.
- **This guide is itself Markdown on purpose** — it's reference doctrine that
  should diff and grep cleanly. The artifacts it describes are where the HTML
  goes. (Yes, that's the guide following its own "stay in Markdown" rule.)
