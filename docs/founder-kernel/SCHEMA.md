# DPF Founder Kernel — Wiki Schema

This document is the contract for the platform kernel wiki. It defines how raw sources become pages, how pages cite each other, and how the linter detects drift. It is the wiki's CLAUDE.md.

This file is loaded into agent prompt assembly (excerpt) and into the daily lint job (full).

Read in full before authoring or editing kernel pages. Per-org overlays follow the same rules but live in DB only.

Spec: [`../superpowers/specs/2026-05-09-platform-kernel-wiki-design.md`](../superpowers/specs/2026-05-09-platform-kernel-wiki-design.md).

---

## 1. Page Kinds

Every wiki page has exactly one `pageKind`. Pick the one that best fits the page's role.

### `entity`

A first-class concept in DPF (e.g. Digital Product, Portfolio, Value Stream).

Required sections:
- **Definition** — one paragraph.
- **Properties** — bullet list of canonical fields and relations.
- **Relationships** — links to related entity pages via `[[entities/<slug>]]`.
- **Source-anchored claims** — every nontrivial claim cites `[[raw-sources/<path>]]`.
- **Examples** — at least one concrete instance.

### `stance`

A position the author has taken on a question. The "what would Mark do?" surface.

Required sections:
- **Stance** — one sentence: "X is better than Y because Z."
- **Reasoning** — the argument in 1–3 paragraphs.
- **When this applies / when it doesn't** — boundaries of the stance.
- **Sources** — `[[raw-sources/<path>]]` for the source(s) where the stance was articulated.

### `heuristic`

A rule of thumb. Smaller than a stance; usually quantitative or pattern-shaped.

Required sections:
- **Rule** — "When X, do Y."
- **Why** — the rationale.
- **Worked example** — a short concrete case.
- **Counterexamples** — where the heuristic fails.

### `decision`

A formal decision codified for posterity. Mirrors the format of `docs/superpowers/decisions/`.

Filename: `wiki/decisions/DEC-YYYY-<slug>.md`.

Required sections: Context, Decision, Consequences, Alternatives Considered.

### `summary`

A condensed distillation of one raw source.

Required sections:
- **Source** — link to `[[raw-sources/<path>]]`.
- **Key claims** — bullet list.
- **Stance & heuristics extracted** — links to any `[[stances/<slug>]]` or `[[heuristics/<slug>]]` pages produced from this source.

> If the "Stance & heuristics extracted" section is empty, lint will surface a `stance-extraction-needed` finding. Summary-only pages defeat the kernel's judgment-lens purpose.

### `runbook`

A how-to. Step-driven and operational.

Required sections: When to use, Prerequisites, Steps, Verification, Rollback.

### `index`

A navigation page (auto-regenerated). One entry per kind under `wiki/`. Do not edit manually.

---

## 2. Canonical Entity Registry

These slugs are the seed entity set for kernel v0.1.0. Ingest must slot claims against this list before proposing new entities.

| Slug | Concept |
|------|---------|
| `entities/digital-product` | DPF's atomic unit of value delivery. |
| `entities/portfolio` | Persona-anchored grouping of digital products. |
| `entities/value-stream` | End-to-end flow from idea to consumed value (IT4IT-aligned). |
| `entities/ea-reference-model` | Enterprise architecture reference ontology (TOGAF/ArchiMate-shaped). |
| `entities/capability` | Action a product or actor can perform. |
| `entities/skill` | Encapsulated capability instance assigned to a coworker/agent. |
| `entities/organization` | The canonical platform identity model. |
| `entities/knowledge-article` | Authored prose anchored to a product/portfolio. |
| `entities/backlog-item` | Unit of work; portfolio or product scope. |
| `entities/agent` | The runtime entity that executes tools. |
| `entities/coworker` | Identity layer over an agent — has skills, mode, persona. |
| `entities/founder-kernel` | This document and the layered wiki it describes. |

Add a new entity only via an explicit `propose_new` step during ingest, with rationale.

---

## 3. Cross-Link Rules

- Every entity reference becomes `[[entities/<slug>]]`.
- Every source citation becomes `[[raw-sources/<path-without-extension>]]` placed at the end of the claim it supports.
- Every stance or heuristic mentioned becomes `[[stances/<slug>]]` or `[[heuristics/<slug>]]`.
- Decisions are linked as `[[decisions/DEC-YYYY-<slug>]]`.
- A `[[link]]` whose target does not exist is a **dangling link** and blocks publish (lint check `dangling-xref`, severity `error`).
- An entity mention in prose that is not wrapped in `[[...]]` is a **missing cross-ref** and surfaces a lint finding (severity `info`).

---

## 4. Edit Policy

- **Kernel pages are PR-only.** The runtime (ingest, agent edits) cannot write to `isKernel = true` pages. Maintainers edit kernel content through Git, then bump `manifest.json kernelVersion` and re-seed.
- **Org overlays extend by adding sections, override by replacing them.** When an overlay overrides a kernel page, place a `> **Override note:** <reason>` block at the top.
- **Never delete kernel content silently in an override.** If an overlay removes a kernel section, replace it with `> **Removed in this overlay:** <reason>` so the kernel-drift lint can still align paragraphs.
- **Revisions are immutable.** Each save creates a `WikiPageRevision`. Never rewrite history.
- **Stance and heuristic pages may be authored by the runtime** (via ingest pass 3), then promoted from `draft` to `published` after human review.

---

## 5. Lint Contract

Findings produced daily by `apps/web/lib/queue/functions/wiki-lint.ts` (mirrors `infra-prune.ts`). Each finding carries `organizationId` (NULL for kernel) and surfaces in `/admin/wiki/lint`.

| `findingKind` | Trigger | Severity |
|---|---|---|
| `contradiction` | Two pages with cosine ≥ 0.85 contain claims an LLM detector judges incompatible. | warn |
| `stale` | Oldest `RawSource.retrievedAt` among `sourceIds[]` exceeds `staleThresholdDays` (default 180). | info |
| `orphan` | Published page with no inbound `WikiPageLink` or empty `WikiPageSource[]`. | warn |
| `missing-xref` | Entity mention in prose not wrapped in `[[entities/<slug>]]`. | info |
| `dangling-xref` | `[[...]]` token whose target page does not exist. | error (blocks publish) |
| `kernel-drift` | Org overlay's `derivedFromKernelVersion` < current `kernelVersion` and the kernel diff touched a paragraph the override also modifies. | warn |
| `stance-extraction-needed` | `summary` page whose body has no extracted stance/heuristic links. | info |

---

## 6. Versioning Rules

- Kernel uses semver in `manifest.json`. Bump on every batch of kernel content changes.
- `manifest.json` carries `schemaVersion` separately from `kernelVersion` so the schema can evolve without forcing a kernel content bump.
- `WikiPage` rows carry `kernelVersion` (when `isKernel = true`) and `derivedFromKernelVersion` (when an org overrides a kernel page).
- Kernel-drift lint compares paragraph hashes between current kernel HEAD and override's `derivedFromKernelVersion`.
- Archival, not deletion: archived pages keep their `id` and revisions; `status = "archived"` removes them from retrieval.

---

## 7. The "What Would Mark Do?" Surface

The kernel exists because people are asking judgment questions, not factual ones. To stay useful, the kernel must keep `stance` and `heuristic` pages first-class:

- During ingest, **always** run pass 3 (stance/heuristic extraction) on every source. If nothing is extracted, lint emits `stance-extraction-needed`.
- During query, the `wiki_query` synthesizer is prompted to surface stance and heuristic pages in addition to entity definitions and summaries. An agent reaching for "what would Mark do here?" should land on a stance page first, not a summary.
- Per-org overlays may override stances or add their own. Over time, an org evolves from "what would Mark do?" toward "what would *we* do?" — the overlay is where that judgment compounds.

---

## 8. Schema Versioning

This document is itself versioned with the kernel via `manifest.json schemaVersion`. The current value is `0.1.0`. Bump it when:

- A page kind is added, removed, or renamed.
- A required section in any page kind changes.
- A lint check is added, removed, or its severity changes.
- The cross-link syntax changes.

Do not bump `schemaVersion` for content-only changes — those bump `kernelVersion` instead.
