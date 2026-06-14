# HTML Living Standard Reference

Last checked: 2026-06-14 (spec "Last Updated" snapshot: **12 June 2026**)

This reference pins the DPF baseline for the **latest HTML specification** that
grounds the [HTML-artifacts convention](../superpowers/html-artifacts-guide.md)
(specs, plans, PR write-ups, reports, and design explainers shipped as
self-contained `.html`). It records the authoritative source and the sections we
lean on; it deliberately does **not** vendor the full spec text — see "Why this
is a pointer, not a copy" below.

## What "the latest HTML specification" is

There is no longer a versioned "HTML 5.x" at the leading edge. The current,
authoritative specification is the **WHATWG HTML Living Standard** — a single
continuously-updated document. The W3C retired its separate HTML5.x
Recommendation track and now defers to the WHATWG Living Standard under the
2019 WHATWG/W3C Memorandum of Understanding. So "the latest HTML spec" = the
WHATWG Living Standard, as of its most recent daily snapshot.

| Property | Value |
| --- | --- |
| Standard | [WHATWG HTML Living Standard](https://html.spec.whatwg.org/multipage/) |
| Maintainer | WHATWG (Web Hypertext Application Technology Working Group) |
| Versioning | Living Standard — no version numbers; cite by "Last Updated" date / commit |
| Snapshot at last check | Last Updated **12 June 2026** |
| Single-page edition | <https://html.spec.whatwg.org/> (~13 MB; the multipage edition above is easier to navigate) |
| Developer edition | <https://html.spec.whatwg.org/dev/> (authoring-focused, omits implementer-only detail) |
| Text license | Creative Commons Attribution 4.0 International (CC BY 4.0) |
| Code / IDL snippet license | BSD 3-Clause (per [WHATWG IPR policy](https://whatwg.org/ipr-policy) §7.1.1) |

## Top-level table of contents

Snapshot of the section structure (cite the live document for normative text):

| # | Section | # | Section |
| --- | --- | --- | --- |
| 1 | Introduction | 12 | Web storage |
| 2 | Common infrastructure | 13 | The HTML syntax |
| 3 | Semantics, structure, and APIs of HTML documents | 14 | The XML syntax |
| 4 | The elements of HTML | 15 | Rendering |
| 5 | Microdata | 16 | Obsolete features |
| 6 | User interaction | 17 | IANA considerations |
| 7 | Loading web pages | 18 | Index |
| 8 | Web application APIs | 19 | References |
| 9 | Communication | 20 | Acknowledgments |
| 10 | Web workers | 21 | Intellectual property rights |
| 11 | Worklets | | |

## Sections most relevant to DPF HTML artifacts

The HTML-artifacts convention produces *documents*, not web applications, so the
load-bearing sections are the document-semantics and content ones — not the
scripting/networking APIs:

| Section | Why it matters for our artifacts |
| --- | --- |
| §3 Semantics, structure, and APIs of HTML documents | Document skeleton, metadata, the content model that makes structure machine-readable. |
| §4 The elements of HTML | The element catalogue — sectioning (`section`, `nav`, `article`), grouping, **tables** (`table`/`thead`/`tbody`/`th` with row/column context), **embedded content** including inline **SVG**, and text-level semantics. This is the core of the "explicit structure both humans and agents parse precisely" argument in the guide. |
| §13 The HTML syntax | Well-formedness rules that keep a self-contained artifact valid and portable. |
| §15 Rendering | The default rendering model — relevant because artifacts must render correctly standalone in any browser with no external CSS. |
| §16 Obsolete features | What to avoid so artifacts don't depend on deprecated constructs. |

## DPF stance

- **Authoring standard, not a tool endorsement.** This pins the spec DPF HTML
  artifacts conform to. It does not approve any external renderer, validator,
  MCP server, or hosted service — those still go through the DPF Tool
  Evaluation Pipeline.
- **Artifacts target the document subset.** Self-contained HTML artifacts use
  the semantic/content elements (§3–§4), inline SVG (§4 embedded content), and
  inline CSS. They avoid external assets, CDN scripts, and the
  application/networking APIs (§7–§12) — those belong in the product, not in a
  spec or PR explainer.
- **Validity is part of the bar.** "Self-contained and renders in any browser"
  (the guide's requirement) means valid per §13 and correct default rendering
  per §15 — not just "opens without error in one browser."

## Local offline corpus (for local / function-specialized LLMs)

A local, offline-readable snapshot of the **authoring subset** lives in
[`html-spec/`](html-spec/). This exists so a model can read the actual spec
rather than rely on training memory.

The rationale is how the platform scales: **expertise per function**, not one
model overloaded with everything. A function-specialized or **local LLM whose
training may not have included HTML cannot follow an `https://` link** — for it
to author HTML correctly, the spec text must be present locally. It reads the
snapshot, internalizes the rules for the task at hand, and implements from the
standard instead of guessing. See [`html-spec/README.md`](html-spec/README.md)
for the file manifest, what's included/excluded, and the reproducible refresh
(`node scripts/refresh-html-spec-snapshot.mjs`).

## Pointer vs. local copy — when each applies

The full HTML Living Standard is a single ~13 MB document **revised daily**, so
mirroring the *whole* thing would bloat the repo and be stale within a day. The
balance DPF strikes:

- **This file is the curated pointer** — authoritative URLs, version/date,
  license, and the DPF-relevant sections — same pattern as
  [`sysml-v2.md`](sysml-v2.md). It defers to the live document for normative
  wording.
- **`html-spec/` is a deliberate, bounded local copy** — only the authoring
  subset, only for the offline-retrieval use case above. It is a point-in-time
  snapshot, not a mirror of the living standard; the source URL stays
  authoritative for anything beyond it.

## Attribution

Portions describing the standard are drawn from the WHATWG HTML Standard, used
under CC BY 4.0. © WHATWG. Source: <https://html.spec.whatwg.org/>.

## See also

- [HTML-artifacts guide](../superpowers/html-artifacts-guide.md) — the DPF
  convention this standard grounds.
- [`sysml-v2.md`](sysml-v2.md) — sibling external-standard reference (house format).
