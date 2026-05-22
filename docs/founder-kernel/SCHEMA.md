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

### `principle`

A durable, tiered governance rule that contributes to decision aggregation across every matching context. More universal than a `stance` (which is a position on one topic) and more weight-bearing than a `heuristic` (which is situational). Spec: [`../superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md`](../superpowers/specs/2026-05-12-principles-as-wiki-kind-design.md).

Required frontmatter (in addition to `title` and `pageKind: principle`):
- `principleTier` — `commandment` | `core` | `contextual` (see tier semantics below).
- `principleDirection` — one declarative sentence naming what the principle favors. Used as the canonical retrieval text. Required for `commandment` and `core`.
- `principleDimensionVector` — inline JSON map keyed by dimensions from the registry in [`packages/db/src/wiki-taxonomy.ts`](../../packages/db/src/wiki-taxonomy.ts), values signed in `[-1, 1]`. Required for `commandment`; recommended for `core`.
- `principleAppliesTo` — array; one or more of `in_platform_coworker`, `external_coding_agent`, `human`.
- `principleConsumerArchetype` — one of `universal`, `ai-coworker-universal`, `generalist`, `specialist`, `route-domain-specific` (spec §8A). Independent axis from `principleAppliesTo`; the coherence rules are in the table below.
- `principleConsumerContexts` — array of governed kebab-case slugs (e.g., `build-studio`, `marketing`, `compliance`, `discovery`, `finance`, `storefront`, `portfolio`). **Required (≥1 entry) when `principleConsumerArchetype` is `route-domain-specific`**; empty array (or omitted) otherwise.
- `principlePublic` — `true` if safe to surface on the public docs site, `false` otherwise. Defaults to `false`.
- `principlePublicRationale` — short justification when `principlePublic: true`.

Optional:
- `principleWeight` — explicit override of the tier default (`1.0` / `0.4` / `0.1`). Requires `principleWeightRationale`.
- `principleWeightRationale`.
- `principleDimensions` — array of dimension keys. Auto-derived from `principleDimensionVector` keys when omitted.

**Coherence matrix (spec §8A.1).** Enforced at seed time by `extractPrinciplePayload` and at lint time by `principle-incoherent-archetype-applies-to`:

| Consumer archetype \ `principleAppliesTo` | `in_platform_coworker` | `external_coding_agent` | `human` |
|---|---|---|---|
| `universal` | ✅ valid when paired with at least one other population | ✅ valid when paired with at least one other population | ✅ valid when paired with at least one other population |
| `ai-coworker-universal` | ✅ valid | ✅ valid | ❌ incoherent |
| `generalist` | ✅ valid | ✅ valid (broad agents such as Claude Code, Codex CLI) | ❌ incoherent |
| `specialist` | ✅ valid | ⚠️ rare — requires `principleWeightRationale` (warn at lint, error if missing rationale) | ❌ incoherent |
| `route-domain-specific` | ✅ valid | ✅ valid | ✅ valid |

Notes:
- `universal` requires `principleAppliesTo` to contain at least two populations. A single-population principle is by definition not universal.
- The three agent archetypes (`ai-coworker-universal`, `generalist`, `specialist`) describe agent classes and must not include `human`.
- `route-domain-specific` is the only archetype that legitimately scopes a `human` policy to a route (e.g., a Storefront-operator rule).

Required body sections (per spec §7.2):
- **Rule** — one declarative sentence.
- **Why** — strategic rationale.
- **Applies To** — population and context boundaries (mirrors `principleAppliesTo` with prose).
- **How To Apply** — concrete operating guidance.
- **Decision Dimensions** — human-readable explanation of the signed dimension vector.
- **Examples** — at least one positive example and one non-example.
- **Sources** — frontmatter-driven; the viewer renders citations from `WikiPageSource`.

**Tier semantics** (weights in [`packages/db/src/wiki-taxonomy.ts`](../../packages/db/src/wiki-taxonomy.ts)):
- `commandment` — default weight `1.0`; non-negotiable doctrine that wins in conflict resolution; **uncapped** as of 2026-05-22 (the prior cap of 10 was an inflation guard but commandments are about priority, not scarcity — see plan `docs/superpowers/plans/2026-05-22-principle-scope-refactor.md`).
- `core` — default weight `0.4`; strong defaults; soft cap ~30 enforced by `warn`-severity lint.
- `contextual` — default weight `0.1`; narrow operational rules; uncapped.

**Commandments in context.** A `route-domain-specific` principle may carry `principleTier: commandment` to mean "non-negotiable within its declared contexts." The strict consumer-context filter in retrieval ensures it never applies outside those contexts. So a Build Studio commandment overrides BS core principles inside BS work, and is invisible to a finance coworker prompt. The math is unchanged — weight 1.0 wins in conflict — but the scope is narrower than a kernel-wide commandment.

Situational notes — operational reminders, project-specific quirks, dated decisions — do **not** belong here. They live in local memory, backlog comments, execution evidence, or dated specs. Promotion to the wiki principle layer requires that the rule be durable enough to retrieve across many sessions and product-safe enough for at least the in-platform coworkers to read.

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
