# Authoring the Founder Kernel

This guide shows you how to add content to the founder kernel — the wisdom-layer that ships with DPF and answers &#34;what would Mark do?&#34; questions across every install.

Pair it with [`SCHEMA.md`](SCHEMA.md) (the page-kind contract) and the per-kind templates under [`_templates/`](_templates/).

---

## 1. The shape

```
docs/founder-kernel/
├── SCHEMA.md              # the page-kind contract (rules)
├── AUTHORING.md           # this file (how-to)
├── RAW-SOURCES-LICENSE.md # licensing policy for cited sources
├── manifest.json          # kernel version + embedding model
├── _templates/            # copy-paste templates (NOT seeded)
│   ├── entity.template.md
│   ├── stance.template.md
│   ├── heuristic.template.md
│   ├── principle.template.md
│   ├── decision.template.md
│   ├── summary.template.md
│   ├── runbook.template.md
│   ├── index.template.md
│   └── raw-source.template.md
├── raw-sources/           # immutable receipts (seeded)
│   ├── papers/
│   ├── articles/
│   ├── specs/
│   └── frameworks/
└── wiki/                  # the wiki proper (seeded)
    ├── index.md
    ├── entities/
    ├── stances/
    ├── heuristics/
    ├── principles/
    ├── decisions/
    ├── summaries/
    └── runbooks/
```

The seed walker (`packages/db/src/seed-wiki-kernel.ts`) only scans `raw-sources/` and `wiki/`. Anything outside — including `_templates/` — is invisible to seeding.

---

## 2. Add a new wiki page in 60 seconds

1. **Pick a kind.** Read [`SCHEMA.md` §2](SCHEMA.md) to choose between `entity`, `stance`, `heuristic`, `principle`, `decision`, `runbook`, `summary`, or `index`. Stance, heuristic, and principle are the founder-judgment kinds; the others are scaffolding. `principle` is the heaviest of the three — it carries tier, applies-to scope, and a decision vector that contribute to advisory aggregation across every matching context.
2. **Copy the template.** `cp _templates/<kind>.template.md wiki/<kind>s/<slug>.md`. The slug must match `[a-z0-9/_-]+` and is what `[[wikilinks]]` resolve against.
3. **Fill the frontmatter.** At minimum: `title`, `pageKind`, plus optional `abstract`, `status`, `sources:`.
4. **Write the body.** Markdown. Use `[[wiki/path]]` to link other pages. Cite a raw source by adding its slug to the frontmatter `sources:` array.
5. **Run the seed.** `pnpm --filter @dpf/db exec tsx packages/db/src/seed.ts`. The new page shows up at `/wiki/<kind>s/<slug>` immediately.

That&#39;s the loop.

---

## 3. Frontmatter shape

```yaml
---
title: Plain English Title          # required, shown in the viewer header
pageKind: stance                    # required — entity | stance | heuristic | decision | runbook | summary | index
status: published                   # optional, default published. Other values: draft | review-needed | archived
abstract: One paragraph summary.    # optional but recommended (shown under title in viewer)
sources:                            # optional list of raw-source slugs that back this page
  - papers/it4it-overview
  - articles/portfolio-as-anchor
---
```

Fields are parsed by the YAML subset shared with `seed-skills.ts` and `seed-prompt-templates.ts`. Scalars, inline arrays (`[a, b]`), and block-style lists (`- item`) all work. **No nested objects.** Quotes are optional; surrounding `"`/`'` are stripped.

The `slug` is derived from the file path relative to `wiki/` (e.g. `wiki/stances/portfolio-as-anchor.md` → slug `stances/portfolio-as-anchor`). To override, set `slug:` in the frontmatter.

---

## 4. Wikilinks

Inside the body, write `[[stances/portfolio-as-anchor]]` to link to another wiki page. The viewer renders these as internal `<Link>`s; the lint pipeline (PR #436) flags `[[link]]` targets that don&#39;t resolve as **dangling-xref** errors.

Optional label: `[[stances/portfolio-as-anchor|the portfolio stance]]` renders the label text but resolves the slug.

Sources are cited via the `sources:` frontmatter list, **not** inline `[[...]]` links. The viewer renders them in a separate &#34;Sources&#34; section per page.

---

## 5. Add a raw source

Raw sources are immutable receipts that pages cite. Add one before citing it.

1. `cp _templates/raw-source.template.md raw-sources/<type>s/<slug>.md` where `<type>` is `paper`, `article`, `spec`, or `framework` (matches the four subdirs).
2. Fill the frontmatter — minimum `sourceType` and `title`. Add `authors`, `publishedAt`, `url`, `doi` where applicable.
3. Body holds the abstract or fair-use excerpt. Per [`RAW-SOURCES-LICENSE.md`](RAW-SOURCES-LICENSE.md), Mark&#39;s own work bundles fully under Apache-2.0; third-party material is **abstract + locator only**, never full text.
4. Cite from a wiki page by adding the source&#39;s slug (e.g. `papers/it4it-overview`) to that page&#39;s `sources:` frontmatter array.

---

## 6. Publish flow

```bash
# 1. Drop the file under wiki/ or raw-sources/
vim wiki/stances/portfolio-as-anchor.md

# 2. Run the seed (idempotent — re-runs are safe)
pnpm --filter @dpf/db exec tsx packages/db/src/seed.ts

# 3. (Optional) Build the embeddings sidecar for the new content
tsx scripts/build-kernel-embeddings.ts

# 4. View at /wiki/stances/portfolio-as-anchor
open http://localhost:3000/wiki/stances/portfolio-as-anchor

# 5. Run lint to surface any orphans, dangling refs, missing stances, etc.
#    (or wait for the daily Inngest job)
#    Triggers can also be done via the wiki_lint MCP tool.
```

The seed advances the revision chain **only when body content changes**, so re-running on unchanged files is a no-op. Same for link / source / Qdrant upserts — all idempotent.

---

## 7. Check your work

After seed:

- **Viewer** — `/wiki` shows the page in the list under the right kind grouping; `/wiki/<slug>` renders the body with metadata header and source citations.
- **Lint** — `/admin/wiki/lint` shows any findings. The five live detectors (PR #419) flag:
  - `orphan` — published page with no inbound link or no sources
  - `dangling-xref` — `[[link]]` whose target page doesn&#39;t exist (this **blocks publish**)
  - `stance-extraction-needed` — `summary` page with no `[[stances/…]]` or `[[heuristics/…]]` link
  - `stale` — citation older than 180 days
  - `kernel-drift` — overlay derived from an older kernel version (not relevant for kernel pages themselves)
- **Agent** — open any coworker chat and ask a question that touches your new page. The wiki block in Block 5 of the system prompt (PR #449) should surface it.

---

## 8. Conventions

These aren&#39;t hard rules but they keep the kernel coherent:

- **Use stance pages for judgment.** &#34;Mark&#39;s view on X.&#34; First-person voice. Cite sources. Link to related entities and heuristics.
- **Use entity pages for definitions.** Neutral voice. Refer to canonical concepts (Digital Product, Portfolio, Value Stream, EA Reference Model, etc.). Cross-link other entities liberally.
- **Don&#39;t write summary-only pages.** Summary pages without a `[[stances/…]]` or `[[heuristics/…]]` link trip the `stance-extraction-needed` lint. The kernel exists to surface judgment, not summarise.
- **Cite the source even when paraphrasing.** Every published page should have at least one source. The publish gate enforces this — pages with empty `sources:` and no inbound links get flagged as `orphan`.
- **Keep slugs lowercase-kebab, namespaced by kind**: `entities/digital-product`, `stances/portfolio-as-anchor`, `heuristics/split-portfolio-when`. Mirror the file path.
- **Update `manifest.json`** when you ship a new batch of content. Bump `kernelVersion` (semver), update `pageCount` / `sourceCount`. The embedding builder script (`scripts/build-kernel-embeddings.ts`) sets `embeddingModel` and `builtAt` automatically.

---

## 8A. Authoring a principle

Principle pages have stricter rules than the other kinds because their content drives retrieval injection and (eventually) `principle_decide` scoring. The full required-frontmatter list, the dimension registry, and the coherence matrix live in [`SCHEMA.md` §2 `principle`](SCHEMA.md). This section is the operating-procedure summary.

1. **Copy the template.** `cp _templates/principle.template.md wiki/principles/<slug>.md`. The slug should be a short kebab-case noun phrase (e.g., `architecture-over-shortcuts`, `evidence-before-diagnosis`).
2. **Set the tier consciously.**
   - `commandment` — non-negotiable. The kernel hard-caps published commandments at 10 (lint detector `principle-commandment-cap-exceeded` blocks publish above the cap). Reserve for rules that should shape *every* relevant decision. Requires `principleDirection` AND `principleDimensionVector` AND ≥1 source.
   - `core` — strong default. Soft cap ~30. Requires `principleDirection`; vector recommended.
   - `contextual` — narrow rules that only matter in a bounded situation. Uncapped.
3. **Write a signed `principleDimensionVector`.** Inline JSON, keys from [`packages/db/src/wiki-taxonomy.ts`](../../packages/db/src/wiki-taxonomy.ts) `PRINCIPLE_DIMENSIONS`. Positive values mean "this principle pulls *for* this axis"; negative values mean "this principle pulls *against* this axis" (e.g., `speed_to_value: -0.4` is correct for `architecture-over-shortcuts`). The seed walker rejects unknown dimensions with a clear error.
4. **Pick a consumer archetype + populations carefully.** The two axes (`principleConsumerArchetype` and `principleAppliesTo`) are independent, but the coherence matrix in [`SCHEMA.md`](SCHEMA.md) constrains valid combinations. The seed walker throws on incoherent pairings (e.g., `ai-coworker-universal` + `human`, or `route-domain-specific` without ≥1 context). When in doubt:
   - Rule governs humans AND agents anywhere → `universal` (must include ≥2 populations in `principleAppliesTo`).
   - Rule governs all in-platform AI coworkers → `ai-coworker-universal`.
   - Rule governs orchestrator/COO-style coworkers → `generalist`.
   - Rule governs specialist coworkers as a class → `specialist`.
   - Rule is bound to a specific route or product surface (Build Studio, Marketing, Compliance, Discovery, Finance, Storefront, Portfolio, etc.) → `route-domain-specific` + list the slug(s) in `principleConsumerContexts`.
5. **Set `principlePublic` deliberately.** Default is `false`. Set to `true` only when the rule is product-facing and safe for the public docs site (`/principles/`). Always pair with `principlePublicRationale`. The public-safety lint detector blocks publish on local paths, secret patterns, and internal-only agent-instruction phrases.
6. **Cite at least one source.** Required for `commandment` tier; strongly recommended for `core`. Add raw-source slugs to the `sources:` frontmatter array, NOT inline citations in the body.
7. **Run seed and lint.** `pnpm --filter @dpf/db seed`, then check `/admin/wiki/lint`. Fix any blocking principle finding before opening a PR.

Common back-fill mistakes to avoid:
- Pairing `ai-coworker-universal` / `generalist` / `specialist` with `human` in `principleAppliesTo` (seed throws — these archetypes describe agent classes).
- Marking a principle `universal` while listing only one population in `principleAppliesTo` (seed throws — a single-population rule is by definition not universal).
- Setting `principleConsumerArchetype: route-domain-specific` without listing at least one slug in `principleConsumerContexts` (seed throws).
- Using underscores, uppercase letters, or whitespace in a context slug (seed throws — slugs are governed lowercase kebab-case).

---

## 9. Org overlay (later phase)

Customers will be able to override kernel pages with their own takes via the `kernelPageId` foreign key on `WikiPage`. That UX (Phase 6b — propose-edit form) is not yet shipped. For now, all content authored under `docs/founder-kernel/wiki/` becomes part of the kernel; customers see it everywhere.

---

## 10. Common mistakes

| Symptom | Cause | Fix |
|---|---|---|
| `Missing YAML frontmatter delimiters (---)` | File doesn&#39;t open with `---\n…\n---\n` | Add the frontmatter block at the top. |
| `pageKind: summary` page flagged `stance-extraction-needed` | Summary lacks a `[[stances/…]]` or `[[heuristics/…]]` wikilink | Extract a stance or heuristic as its own page and link to it from the summary body. |
| `dangling-xref` error blocks publish | A `[[wikilink]]` target doesn&#39;t exist | Create the target page first, or remove/fix the link. |
| Page doesn&#39;t appear at `/wiki/<slug>` after seed | Slug mismatch | Check the file path. Slug is `<path-under-wiki-without-ext>` unless overridden. |
| Same page seeds with `version=1` every time | Body actually unchanged between runs | Expected behaviour — revision chain only advances on body change. |
| Qdrant upsert returns `qdrant=no-sidecar` | `embeddings.jsonl` missing | Run `tsx scripts/build-kernel-embeddings.ts` to generate it. The seed still writes Postgres rows even without it. |
| Wiki block doesn&#39;t show up in agent prompts | Qdrant index empty for this query, score below threshold (0.55), or the embedding model is down | Verify Qdrant has points (`/admin/wiki/lint` page count > 0), check the embedding endpoint, broaden the query. |

---

## 11. What&#39;s the minimum to start?

You can ship a usable kernel with **3–5 pages** if they&#39;re the right kind:

1. One `index` page — the table of contents (already seeded by this PR).
2. One `entity` page — the most-cited concept in DPF, e.g. Digital Product or Portfolio.
3. Two-to-three `stance` pages — the founder positions people actually want to know.
4. One `heuristic` page — a concrete rule of thumb derived from one of the stances.
5. Two-to-three raw-source pages backing the stances.

Anything more is bonus. Once these land, the agent has real content to ground in and the rest of the kernel grows by use.
