# External Planning-Reference Boundary

**Status:** binding doctrine for how standards and competitor research attach to planning  
**Backlog:** BI-A72CE946 / EP-IT4IT-CONFORMANCE  
**Related:** [agent-standards-external-alignment](agent-standards-external-alignment.md), [design research runbook](design-research-runbook.md), AGENTS.md §10 (Research & Benchmarking)

## Purpose

DPF planning routinely consults **external** material: IT4IT / BIAN / TOGAF style reference architectures, Flexera / ServiceNow / ISO mappings, vendor docs, and competitor / archetype research packs (for example a local `DPF_References` tree outside the repo).

Those packs are **planning evidence**, not product documentation. This doctrine draws a hard boundary so:

1. Licensed or proprietary standard text never becomes a second public home inside the repo.
2. Vendor comparison tables do not leak into install docs, marketing, or user guides as if they were DPF claims.
3. Epics and backlog items can still **cite** research as internal planning evidence with a stable pointer shape.

## Non-goals

- This does not replace the design-research checklist (2–3 open-source leaders, adopt/reject).
- This does not authorize shipping product behavior based only on a competitor screenshot.
- This does not turn external standards into DPF kernel principles; kernel principles remain DPF-owned.
- This does not require every BI to attach a reference pack.

## Three layers (single vocabulary)

| Layer | What lives there | Public in the OSS repo? | May be cited from BIs/epics? |
| --- | --- | --- | --- |
| **A. Canonical DPF doctrine** | AGENTS.md, kernel principles, architecture runbooks, ratified specs | Yes | Yes — prefer this layer |
| **B. Planning reference packs (external)** | Competitor research, licensed standard excerpts, vendor PDFs, private scorecards | **No** — stay outside the git tree (or in a clearly non-published operator path) | Yes — by **pointer + digest**, never by paste |
| **C. Product claims** | Market vision, install docs, user guides, in-app copy | Yes | Only when Layer A (and code) support the claim |

**Rule:** Layer B informs Layer A decisions. Layer B never becomes Layer C by copy-paste.

## Allowed citation shapes

When a backlog item, epic, or design spec uses external planning material, record evidence with **all** of:

1. **Locator** — stable operator path or URI that is **not** committed as product docs (example shape: `external:DPF_References/archetype-competitive-research-2026-07-18/…` or a private vault id).
2. **Digest** — one-paragraph DPF-owned summary of what was learned (facts DPF may act on).
3. **Decision residue** — what DPF **adopts**, **rejects**, or **defers**, in DPF vocabulary.
4. **License / sensitivity tag** — one of: `public-open`, `vendor-public-docs`, `licensed-standard`, `private-competitive`, `customer-confidential`.

### Allowed in committed docs

- DPF-owned paraphrases and decision tables.
- Public URLs to standards body landing pages (not wholesale standard text).
- Named framework identifiers (e.g. "IT4IT value streams", "BIAN service domains") without pasting copyrighted body text.
- Short quotations only when the license clearly permits and the quote is necessary for a decision record (prefer paraphrase).

### Forbidden in committed public docs

- Bulk paste of licensed standards (ISO, Open Group paid publications, etc.).
- Competitor pricing matrices, scraped product UI inventories, or NDA research.
- "We match Vendor X module Y" claims that exist only in Layer B research and not in Layer A + code.
- Checking in the entire `DPF_References` tree (or equivalent) under `docs/`.

## How backlog and epics attach evidence

| Surface | How to cite Layer B |
| --- | --- |
| Backlog item body | Short digest + locator + sensitivity tag; link Layer A specs for the actual design home |
| Epic description | Same; do not treat the epic body as a research archive |
| Design spec (`docs/superpowers/specs/`) | "Research & Benchmarking" section uses digests + public links; raw packs stay external |
| Kernel / AGENTS.md | Never host Layer B content; only DPF rules derived from decisions |
| Marketing / user guides | Layer C only; no competitive scrapes |

Demand-activation evidence links (reviewed evidence sources) should point at **DPF-owned digests or public URLs**, not at private filesystem paths that other installs lack.

## IT4IT / BIAN / license boundary (planning)

| Intent | Practice |
| --- | --- |
| Conformance **thinking** | Allowed: map DPF capabilities to external value streams/domains in a DPF-authored matrix |
| Conformance **claim** | Only with an explicit evidence program and the license the standard requires |
| Training material from paid standards | Stays in Layer B; operators may keep private notes outside the repo |
| Open Group / ISO text | Do not republish; cite the official catalog entry |

## Competitor research packs

Typical path (illustrative, install-local): `D:\DPF_References\…` or a private object store.

| Use | Allowed |
| --- | --- |
| Prioritize roadmap slices | Yes — digest into epic/BI rationale |
| Shape parity scorecards (BI-COP-001 family) | Yes — DPF-owned scorecard rows only |
| Justify "when to integrate vs native" (BI-COP-005) | Yes — digest only |
| Paste vendor feature grids into public docs | **No** |
| Train customer-facing coworkers on competitor internals | **No** unless the content is public and attributed |

## Operator checklist (before a PR that "documents research")

- [ ] Is the new file Layer A (DPF doctrine) or a dump of Layer B?
- [ ] If Layer B material informed the change, is the digest DPF-owned and free of licensed bulk text?
- [ ] Does any public claim also hold against code and market vision?
- [ ] Could a clean clone without `DPF_References` still build and understand the doctrine?
- [ ] Sensitivity tag present on any external locator?

## Worked example (good)

> **BI rationale:** Competitive research pack `external:DPF_References/archetype-competitive-research-2026-07-18` (tag: `private-competitive`) shows three common dry-cleaning intake steps we omit. **Digest:** plants need claim-ticket → plant route → ready-promise as load-bearing stages. **Decision:** extend archetype value-stream map (Layer A); no vendor screenshots committed.

## Worked example (bad)

> Copy a 12-page vendor comparison spreadsheet into `docs/architecture/` and claim parity module-by-module.

## Related backlog

- BI-A72CE946 — this boundary (parent)
- BI-COP-001 / BI-COP-004 / BI-COP-005 — parity and absorption work that consumes digests, not dumps
- EP-IT4IT-CONFORMANCE — conformance projection stays DPF-owned

## Change control

Widening what may be committed from Layer B requires an explicit PR against this file and a license review note. Silent paste is a defect.
