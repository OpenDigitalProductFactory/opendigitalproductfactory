---
title: Founder Kernel
pageKind: index
status: published
abstract: Top-level index for the founder kernel — stances, heuristics, entities, and the raw sources that back them.
---

## What this is

The founder kernel is the wisdom layer that ships with DPF. It answers the question every user eventually asks: **&#34;what would Mark do?&#34;** Pages here are not summaries of external material; they are the platform&#39;s stance, organised by kind.

This first cut was researched and drafted from Mark&#39;s public corpus (LinkedIn long-form articles, Open Group publications including the W205 *Shift to Digital Product* white paper, BriefingsDirect interviews, Architecture &amp; Governance Magazine, ServiceNow community blogs, IT4IT v3 contributions, DPROM, and CSDM v5 materials). Every page is **`status: draft`** — Mark reviews, edits, and flips to `published` what survives.

## Stances — Mark&#39;s positions

The judgment kernel. Cite these when grounding an answer in his thinking.

- `[[stances/digital-product-is-the-unit-of-organization]]` — Digital Product is the right primitive for portfolio, team, funding, lifecycle, governance.
- `[[stances/persistent-product-teams-over-projects]]` — Replace project teams with persistent teams; annual budgets with rolling investment.
- `[[stances/it4it-is-substrate]]` — IT4IT integrates ITIL, COBIT, TOGAF, DevOps, SAFe at the operating-model layer. It does not compete.
- `[[stances/dont-integrate-ea-platform]]` — Consolidate on one data model (CSDM); don&#39;t integrate a third-party EA tool with ServiceNow. The integration goes through Independent → Honeymoon → Ugly Reckoning.
- `[[stances/trust-the-cmdb-or-rebuild-it]]` — Most organisations have a CMDB; very few trust it. Trust requires three pillars: Ingestion, Insight, Governance.
- `[[stances/ea-is-meteorology]]` — Architects produce forecasts and guidance, not raw model exhibits.
- `[[stances/contextualize-dont-transform]]` — When introducing a standard, map first. Adoption follows mapping; transformation follows adoption.

## Heuristics — operational rules

Smaller and more specific than stances. Useful when an agent needs to act, not just reason.

- `[[heuristics/contextualize-before-transforming]]` — map existing operations onto the standard first.
- `[[heuristics/find-at-least-one-champion]]` — adoption without an internal evangelist stalls.
- `[[heuristics/pitch-simple-adjust-per-audience]]` — lead with the simplest framing; adjust language per audience.
- `[[heuristics/model-what-naturally-happens]]` — connect relationships that already exist; don&#39;t build a data lake.
- `[[heuristics/auto-populate-or-its-wrong]]` — manually-maintained inventory data is already lying to you.
- `[[heuristics/reuse-the-camera-in-your-pocket]]` — platform-native usually wins over specialist best-of-breed.
- `[[heuristics/be-a-meteorologist]]` — produce the forecast, not the radar image.

## Entities — canonical concepts

Neutral definitions the rest of the kernel cross-references.

- `[[entities/digital-product]]` — anything that runs code, one party responsible, delivers outcomes for a consumer party.
- `[[entities/portfolio]]` — a curated set of Digital Products grouped for a shared management purpose.
- `[[entities/it4it]]` — The Open Group reference architecture; substrate that integrates ITIL/COBIT/TOGAF/DevOps/SAFe.
- `[[entities/csdm]]` — Common Service Data Model; the canonical data spine.
- `[[entities/value-stream]]` — one of the seven IT4IT v3 flows.

## Raw sources

Cited by the stances and heuristics above. See [`RAW-SOURCES-LICENSE.md`](../RAW-SOURCES-LICENSE.md) for the licensing policy — Mark&#39;s own LinkedIn articles bundle fully under Apache-2.0; third-party material is abstract + locator only.

- `raw-sources/articles/why-product-centric-approach-needed` — May 2025 LinkedIn Pulse.
- `raw-sources/articles/why-product-centricity-critical` — Dec 2024 LinkedIn Pulse.
- `raw-sources/articles/think-twice-ea-platform-servicenow` — LinkedIn Pulse on EA-platform consolidation.
- `raw-sources/articles/possible-futures-enterprise-architecture` — Architecture &amp; Governance Magazine.
- `raw-sources/articles/open-group-2017-managing-business-of-it` — Open Group blog interview, Jan 2017.
- `raw-sources/articles/briefings-direct-it4it-2019` — BriefingsDirect podcast transcript, March 2019.
- `raw-sources/articles/sibling-portfolios` — ServiceNow community blog (with David Thigpen).
- `raw-sources/papers/shift-to-digital-product-w205` — The Open Group white paper W205, Dec 2020.
- `raw-sources/frameworks/it4it-v3` — The Open Group IT4IT standard v3.
- `raw-sources/frameworks/csdm` — ServiceNow Common Service Data Model (currently v5).

## What&#39;s still missing

This is a first cut. Pages that the research digest surfaced but haven&#39;t been drafted yet:

- **Stance: agentic AI without governance is the 36-vendors scenario** — referenced repeatedly in Mark&#39;s 2024–2025 LinkedIn posts; the canonical satirical post needs a verified URL before drafting.
- **Entity: DPROM** — co-authored 2025; deserves its own entity page once the source paper is bundled.
- **Decision pages** — none yet. As Mark records explicit DEC-* style decisions (e.g., DEC-2020-shift-to-digital-product, DEC-2022-it4it-v3-refactor) these will land under `wiki/decisions/`.
- **Apple-to-orange comparison pages** — explicit "framework vs framework" pages where his nuance lives (IT4IT vs ITIL, IT4IT vs COBIT, CSDM vs ArchiMate).

## How to navigate

- **Browse**: `/wiki` lists every published page grouped by kind. Until pages flip from `draft` to `published`, they won&#39;t appear in the default published view.
- **Search via the agent**: ask any coworker a question that touches a kernel concept. The wiki retrieval layer injects relevant pages into the system prompt automatically once they&#39;re published.
- **Author / edit**: copy a template from [`../_templates/`](../_templates/), or edit any page on this branch directly. See [`../AUTHORING.md`](../AUTHORING.md) for the 60-second loop.
- **Audit**: `/admin/wiki/lint` shows findings. The five live detectors will flag orphans, dangling refs, stale citations, etc.

## Status of this index page

Drafted by Claude from research on Mark&#39;s public writing. Marked `status: draft` like the rest. Mark reviews and either edits in place or replaces with a version in his own voice.
