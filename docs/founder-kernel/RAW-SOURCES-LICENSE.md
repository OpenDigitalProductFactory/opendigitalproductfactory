# Founder Kernel — Raw Sources Licensing

This file enumerates the licensing approach for every raw source bundled in `docs/founder-kernel/raw-sources/`. It is a companion to [`/ACKNOWLEDGMENTS.md`](../../ACKNOWLEDGMENTS.md) (which credits ideas) and [`/NOTICE`](../../NOTICE) (which credits open-source software).

Spec: [`../superpowers/specs/2026-05-09-platform-kernel-wiki-design.md`](../superpowers/specs/2026-05-09-platform-kernel-wiki-design.md) §13.

---

## Policy

The DPF repository is licensed under Apache-2.0, but tracking a file does not relicense third-party
material. Every source note under `docs/founder-kernel/raw-sources/` must resolve to one of these
postures:

1. **Rights-cleared original/contributor source.** A complete SourceUseDecision establishes the
   exact source, ownership/authorization, and permission for AI processing, reproduction, repository
   distribution, and Apache-2.0 sublicensing. Authorship or contributor credit alone is insufficient.
2. **Metadata + original abstract.** Third-party title, authors, date, canonical locator, DOI, and a
   new DPF-authored abstract. The source text remains with the publisher. Any quotation or excerpt
   requires its own complete SourceUseDecision; there is no word-count or percentage safe harbor for
   fair use. The [U.S. Copyright Office](https://www.copyright.gov/fair-use/more-info.html) describes
   fair use as a fact-specific analysis.
3. **Pointer-only.** Restrictive or unknown-rights material, including compiled IT4IT Reference
   Architecture, DPPM, and ServiceNow publications, receives metadata, a canonical locator, and a
   rights-neutral reason for orientation. Protected expression is not an AI or normative input.

Material that fits none of the above does not belong in `raw-sources/`. Per-org uploads remain
subject to the organization's own authorization and the same source/use decision discipline.

### Contributor-origin boundary

Named contributor credit is provenance, not by itself permission to bundle or process the collective
publication. When Mark contributed to a third-party standard, guide, paper, figure, table, or other
collective work, the published artifact stays in category 2 or 3 unless a source- and use-specific
decision establishes the exact separable contribution, rights basis, permitted actions, excluded
coauthor/publisher/employer material, and required independent review. Direct clean-room statements
or source assets supplied by Mark are separate sources; their permission does not flow to the
compiled publication, and the publication's restrictions do not erase the provenance of Mark's
separately supplied concepts.

The normative decision contract is defined once in
[`DPF-PAAW` Section 13.1.1](../architecture/four-portfolio-archetype-ai-workforce-operating-standard.md#1311-source-use-decisions-and-contributor-origin-material).
Raw-source entries point to the applicable SourceUseDecision and ContributorAttestation rather than
duplicating the rights analysis here.

## Target Frontmatter Contract

Every new or substantively modified file under `raw-sources/` must declare:

```yaml
---
sourceKey: papers/<slug>
sourceType: paper | article | spec | doc | framework | external-url
authorshipModel: original-by-mark | abstract-only | pointer-only
license: Apache-2.0 | <publisher-license-name> | proprietary
redistributable: true | false
url: https://...
sourceUseDecision: SUD-...
sourceCitation: SCIT-... # pointer-only entries use this instead of a SUD
contributorAttestation: CA-... # optional
---
```

`sourceUseDecision` is required for content use; `pointer-only` entries instead reference a
`sourceCitation` and contain no protected expression. `redistributable: true` is allowed only
when the referenced complete SourceUseDecision expressly
permits reproduction, repository distribution, and the declared sublicense. `original-by-mark`
alone is not permission.

The current seed implementation requires only `sourceType` and `title` and derives a missing
`sourceKey`. It does **not** yet enforce this rights contract. Until the guard and migration land,
all legacy notes below are non-conformant and **MUST NOT** become new AI, normative, mapping, or
conformance evidence.

## Per-Source Index

Fifteen Markdown source notes are bundled. Three scope-critical notes are migrated to the
target rights contract; twelve retain legacy frontmatter. “Provisional posture” is
fail-closed and is not a completed SourceUseDecision.

| Legacy path | Provisional posture |
|---|---|
| `articles/ambient-findability.md` | metadata + original abstract; migration required |
| `articles/briefings-direct-it4it-2019.md` | metadata + original abstract; migration required |
| `articles/design-from-access-patterns.md` | metadata + original abstract; migration required |
| `articles/open-group-2017-managing-business-of-it.md` | metadata + original abstract; migration required |
| `articles/possible-futures-enterprise-architecture.md` | authorship/publication rights unresolved; migration required |
| `articles/sibling-portfolios.md` | joint/vendor publication; metadata + original abstract only pending decision |
| `articles/think-twice-ea-platform-servicenow.md` | claimed Mark-authored source; Apache/rightsholder grant must be verified |
| `articles/why-product-centric-approach-needed.md` | claimed Mark-authored source; Apache/rightsholder grant must be verified |
| `articles/why-product-centricity-critical.md` | claimed Mark-authored source; Apache/rightsholder grant must be verified |
| `articles/why-we-ended-up-proposing-two-standards-for-ai-agents.md` | claimed original draft; complete decision required |
| `frameworks/csdm.md` | migrated pointer-only entry under `SCIT-SNOW-CSDM-RESOURCES` |
| `frameworks/it4it-v3.md` | migrated pointer-only entry under `SCIT-TOG-C24A` |
| `frameworks/subsidiarity.md` | metadata + original abstract; migration required |
| `papers/knowledge-acquisition-bottleneck.md` | metadata + original abstract; migration required |
| `papers/shift-to-digital-product-w205.md` | migrated abstract-only entry under `SUD-W205-2026-08-01` |

Migration and seed enforcement are tracked as `GAP-SOURCE-004` in the PAAW source register.
