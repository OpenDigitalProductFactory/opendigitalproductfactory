# HTML Living Standard — local snapshot (authoring subset)

Last checked: 2026-06-14 · Spec "Last Updated": **12 June 2026** · Source: WHATWG HTML Standard, **Developer Edition** (<https://html.spec.whatwg.org/dev/>)

This folder is a **local, offline-readable snapshot** of the authoring-relevant
sections of the [HTML Living Standard](../html-living-standard.md). It exists so
that a model can read the actual specification instead of relying on training
memory.

## Why this is vendored (not just linked)

The platform scales by **creating expertise per function** rather than
overloading one model with everything. A function-specialized or **local LLM —
one whose training may not have included HTML — cannot follow an `https://`
link**. For it to author HTML correctly, the spec text must be present locally:
the model reads it, internalizes the rules for the task at hand, and implements
from the standard rather than from guesswork. That is the whole point of keeping
this snapshot in-repo.

This is the deliberate exception to the usual "pointer, not copy" rule for
external standards (see [`../html-living-standard.md`](../html-living-standard.md)):
the offline-retrieval use case requires the bytes to be here. The live source
remains authoritative for anything beyond this snapshot.

## What's included

The **authoring subset** — document semantics, the elements you actually write
in a document, and the syntax rules — not the application-platform chapters
(scripting, networking, workers, storage, web APIs §7–§12), which are
irrelevant to authoring HTML documents and artifacts.

| File | Spec section | Bytes |
| --- | --- | ---: |
| `dom.html` | §3 Semantics, structure, and APIs of HTML documents | 222,564 |
| `sections.html` | §4.3 Sections | 143,960 |
| `grouping-content.html` | §4.4 Grouping content | 150,924 |
| `text-level-semantics.html` | §4.5 Text-level semantics | 231,068 |
| `embedded-content.html` | §4.8 Embedded content | 65,707 |
| `tables.html` | §4.9 Tabular data | 105,358 |
| `syntax.html` | §13 The HTML syntax | 83,327 |
| | **Total** | **~0.96 MB** |

These map directly to the elements DPF HTML artifacts use: document structure,
sectioning (`section`/`nav`/`article`/`aside`), grouping (`p`/lists/`figure`/`pre`),
text-level semantics, **tables** (with row/column context), **embedded content**
(including how inline SVG embeds), and well-formedness.

## What was stripped (and what was preserved)

Each file is the spec page with **site chrome removed only**:

- Removed: the document `<head>`, page `<script>`s, the `<header id=head>` site
  banner, the `<ol class=toc>` sidebar, and (best-effort) the injected MDN
  browser-support annotation widgets (`<div class="mdn-anno …">`).
- **Preserved unchanged:** all spec prose, element definitions, and **every
  example** — including live `<nav>`/`<header>`/`<section>` demos that a naive
  tag-based strip would destroy.

A handful of MDN annotation widgets whose nested markup defeats simple tag
balancing may remain; they are inert (a disabled toggle button + a browser-
support note) and do not affect the normative text. Each file carries a
provenance comment with its source URL, the spec date, and the cleaning notes.

## License / attribution

The snapshot text is from the WHATWG HTML Standard, used under **Creative
Commons Attribution 4.0 International (CC BY 4.0)**; code/IDL snippets are under
the **BSD 3-Clause License** (per the [WHATWG IPR policy](https://whatwg.org/ipr-policy)).
© WHATWG. Source: <https://html.spec.whatwg.org/dev/>.

## Refreshing the snapshot

Reproducible — re-fetches and re-cleans with identical logic (no manual steps,
no guesswork):

```
node scripts/refresh-html-spec-snapshot.mjs
```

## See also

- [`../html-living-standard.md`](../html-living-standard.md) — the reference
  entry (canonical URLs, versioning, license, DPF stance).
- [HTML-artifacts guide](../../superpowers/html-artifacts-guide.md) — the DPF
  convention this standard grounds.
