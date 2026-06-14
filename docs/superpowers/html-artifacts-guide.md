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

## The three-tier format model: JSON / HTML / Markdown

Before choosing a format, decide which of three jobs the artifact does. They are
not interchangeable:

| Tier | Job | Reader | Use for | Don't use for |
|------|-----|--------|---------|---------------|
| **JSON** | Machine-to-machine **interface / data contract** | Parsers, orchestrators | Build-phase evidence (`buildPlan`, `designDoc`), structured tool outputs, config | Anything a human is meant to read as a document |
| **HTML** | **Human-AND-AI-readable** artifact | People *and* agents | Specs, plans, PR write-ups, status reports, design explainers, option fan-outs | Canonical rule text; pure data contracts |
| **Markdown** | Canonical **rule text / doctrine** | People (line-by-line in diffs) | AGENTS.md, kernel principles, skill bodies, READMEs, this guide | Diagram/table/interaction-heavy deliverables |

The common mistake is conflating the **JSON tier** with the **HTML tier**.
**Structured JSON evidence is an interface spec, not documentation** — it stays
JSON no matter how diagram-rich the underlying feature is. If a process emits
both a JSON contract *and* a human-readable companion (e.g. a Build Studio
build-phase prompt that saves `buildPlan` JSON *and* shows the operator a plan
write-up), only the companion is in HTML scope; the JSON stays JSON. This is the
doctrine behind the Build Studio carve-out — see
[Relationship to existing conventions](#relationship-to-existing-conventions).

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

### Why HTML beats Markdown for human-AND-AI artifacts

The core reason is that HTML is **human and AI readable**, and it wins on *both*
halves — not just the human one:

- **Humans read it more.** (The anecdote above: the author stopped reading his
  Markdown plans and started reading the HTML ones.) Layout, jump-links, and real
  diagrams turn a doc you skim into a doc you open and click around.
- **Agents parse it more precisely.** HTML has **better layout and formatting
  specificity** than Markdown's loose conventions: semantic tags, classes and
  attributes, explicit table cells with row/column context, and SVG geometry are
  unambiguous structure the model can read back exactly. Markdown's "a table if
  you squint, a bullet that might be a heading" is lossy by comparison. That
  specificity pays off on **every subsequent round-trip** — when the agent
  re-reads its own artifact to extend a plan, verify a spec, or answer a
  question, it reconstructs the structure instead of re-inferring it.

So the format choice is **not** a human-convenience tax paid against agent
efficiency. The explicit structure serves the agent too; both readers come away
more accurate. That dual benefit is why HTML — not JSON, not Markdown — is the
right tier for any artifact a person *and* an agent both consume.

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

## Side benefit: artifacts can double as public-site content

The public site at [opendigitalproductfactory.com](https://opendigitalproductfactory.com)
is a Jekyll site served from `docs/`. It already ships **one bespoke,
self-contained HTML page** — the landing page `docs/index.html`, which is opted
*out* of the Jekyll layout (`layout: null`) and carries its own embedded styles.

The artifacts this guide produces are built the same way: **self-contained**
(inline CSS, inline SVG, no external assets or CDN). That means a *curated*
HTML artifact can be published to the public domain **as-is** — no Jekyll chrome,
no template wiring, exactly the pattern `index.html` already uses. Over time,
surfacing select design explainers, architecture overviews, or worked specs on
the public site deepens its content and **veracity** as a long-term side effect
of writing artifacts in this format — the same file serves the internal reader,
the agent, and (when cleared) the public.

Two honest caveats so this stays a *deliberate* act, never an automatic leak:

- **`superpowers/` is currently Jekyll-excluded** (see `docs/_config.yml`
  `exclude:`) — it holds internal specs/plans and Liquid markers that must not
  hit the public build. Nothing under it publishes today, and that default is
  correct.
- **Publishing is curated and outward-facing.** Internal specs stay internal;
  only an artifact explicitly cleared for public consumption gets surfaced
  (e.g. copied to a public-cleared path outside the `exclude` list).
  Self-containment makes publishing *cheap when you choose to*; it does not make
  it the default. Treat any move that puts an artifact on the public domain as a
  publish decision requiring review.

## Relationship to existing conventions

- **Grounded in the HTML standard.** This convention conforms to the WHATWG HTML
  Living Standard. The reference entry — canonical URLs, version, license, the
  document-semantics sections artifacts rely on — is
  [`docs/Reference/html-living-standard.md`](../Reference/html-living-standard.md),
  with a local offline snapshot of the authoring subset under
  [`docs/Reference/html-spec/`](../Reference/html-spec/) so a function-specialized
  or local LLM can read the spec directly instead of relying on training memory
  (per "research and use standards"). Don't guess at HTML semantics — consult it.
- **Locations are unchanged.** HTML specs live in `docs/superpowers/specs/`
  next to the `.md` files; HTML plans live in `docs/superpowers/plans/`. Keep
  the same `YYYY-MM-DD-<topic>-design.html` / `YYYY-MM-DD-<feature>.html`
  naming (AGENTS.md §16).
- **`search_specs_and_plans` indexes Markdown.** If a spec ships HTML-only and
  needs to be discoverable via that tool, leave a short Markdown stub (title,
  BI, one-line abstract, link to the `.html`) so the index still finds it. The
  pilot keeps its full `.md`, so this isn't a concern there.
- **Build Studio carve-out — JSON evidence stays JSON.** Build Studio's
  build-phase prompts (`ideate`, `plan`, `ship`) save **structured JSON
  evidence** (`designDoc`, `buildPlan`) that the build orchestrator parses to
  dispatch agents. Per the [three-tier model](#the-three-tier-format-model-json--html--markdown)
  that evidence is the **JSON tier** — an interface contract, not documentation —
  so it stays JSON regardless of how diagram-heavy the feature is. Only the
  **human-readable companion** those prompts also produce (the design doc an
  operator opens, a plan write-up, ship notes / a PR explainer) is in HTML scope.
  This is why the build-phase prompts point only their *human-readable* paths at
  this convention while leaving the evidence JSON untouched.
- **This guide is itself Markdown on purpose** — it's reference doctrine that
  should diff and grep cleanly. The artifacts it describes are where the HTML
  goes. (Yes, that's the guide following its own "stay in Markdown" rule.)
