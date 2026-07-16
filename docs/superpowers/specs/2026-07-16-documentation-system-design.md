---
title: Documentation System — one link-resolution source of truth, rich-content rendering, an enforced documentation step, an activated docs coworker, and a doc-impact graph
status: proposed
date: 2026-07-16
owner: platform
epic: EP-DOCS-SYSTEM
backlog:
  - BI-8605018E  # Phase 1 — shared link-resolver + CI link checker + fix current dead links
  - BI-E94AE869  # Phase 2 — remark-gfm + img + mermaid in portal; image/screenshot convention
  - BI-3F6BB8CC  # Phase 3 — enforce the documentation step surface-agnostically + activate docs coworker
  - BI-74BED65D  # Phase 4 — doc-impact graph
relates:
  - docs/superpowers/plans/2026-05-14-docs-public-site-current-state-refresh.md
  - docs/superpowers/specs/2026-05-30-development-process-spine-design.md
  - docs/superpowers/specs/2026-06-05-unified-delivery-surfaces-execution-alignment-design.md
  - docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md
  - docs/founder-kernel/wiki/principles/single-source-of-truth.md
  - docs/founder-kernel/wiki/principles/architecture-over-shortcuts.md
---

# Documentation System

> **Operator framing (2026-07-16).** "There is an issue with how documentation is managed on this platform — dead links, lack of diagrams and screenshots. We need to improve our documentation, and the documentation step across all surfaces (Claude, Codex, Build Studio) needs to be improved. I'm not sure if we even need an AI coworker dedicated to this. Investigate what's in place, why it's in such a poor state, and how we can automate it going forward. Do we need a graph to do impact analysis when a page changes, or functionality changes? This thread's goal is the *systematic* needs for solid docs." The flagged page — `/user-guide/getting-started/agent-dev-environments/` — is a symptom, not the scope.

## 1. Thesis

DPF's documentation problem is **not a shortage of machinery** — it is **divergence and non-enforcement**. The platform already owns a documentation-specialist coworker, a Diátaxis/Mermaid profession corpus, a full managed-document CMS, a wiki lint engine, and a route→doc map. None of them point at the user guide, and the one surface everyone reads (the `docs/user-guide/` corpus) is rendered by **two independent engines with opposite, mutually-incompatible link conventions and zero link validation**.

The fix is **convergence + enforcement**, in this order:

1. **One link-resolution source of truth** both renderers consume, plus a CI link checker that fails on any dead link (stop the bleeding).
2. **Make rich content renderable** — the portal renderer structurally cannot display GFM tables, images, or Mermaid today, which is *why* there are no diagrams.
3. **Enforce the documentation step surface-agnostically** — a CI gate + the *activated* docs coworker, uniform across Claude / Codex / Build Studio because all changes land via PR.
4. **A doc-impact graph** — so a functionality change flags the pages it invalidates.

This is deliberately the reverse of the historical pattern (author more doctrine, hope authors comply). We add **executable enforcement** to substrate that already exists.

## 2. Problem — evidence from the 2026-07-16 investigation

### 2.1 Two renderers, opposite link conventions, over one corpus

The identical files in `docs/user-guide/**/*.md` are consumed by two engines that disagree about what a link means:

| | Public site (`opendigitalproductfactory.com`) | In-portal help (`/docs` in the app) |
| --- | --- | --- |
| Engine | **Jekyll / GitHub Pages** (`docs/_config.yml`, `docs/CNAME`, `docs/_layouts/default.html`) | **react-markdown v10** (`apps/web/components/docs/DocRenderer.tsx`) |
| Markdown | kramdown (GFM input), rouge | react-markdown, **no `remark-gfm`** |
| Link rule | `jekyll-relative-links` rewrites only links ending in `.md` that point to an existing file; `permalink: pretty` → trailing-slash URLs | `resolveHref` prepends `/docs/{frontmatter.area}/{href}` (`DocRenderer.tsx:16-22`); **no `../` normalization**, no cross-area support |
| Wants | `.md` suffixes, site-absolute `/user-guide/...`, bare `foo/` dirs | extension-less same-area slugs, `/docs/...` absolutes, correct frontmatter `area` |

Because the two conventions are opposites and the corpus mixes both styles, **a link that works on one surface is frequently dead on the other**, and three classes are dead on *both*:

- **`index`-suffixed links** — `[Build Studio](build-studio/index)`. Jekyll pretty-permalinks collapse `index.md` into the directory URL so `.../index` never matches; the portal resolves it to `/docs/{area}/build-studio/index` (404).
- **`../` cross-tree links** — the flagged page's `[install](../../operations/install)` and `[Collision-Free Dev Workflow](../../dev/collision-free-dev-workflow)`. The **target files exist and are published**; the links are dead purely from pretty-permalink math — from `/user-guide/getting-started/agent-dev-environments/`, `../../` climbs to `/user-guide/` and yields `/user-guide/dev/...`, but the real page is `/dev/...`. Off by one directory, every time.
- **Cross-area links in the portal** — `resolveHref` can only ever prepend the *one* current `area`, and `area` is a frontmatter label, **not** the file's directory (`docs/user-guide/development-workspace.md` has `area: getting-started` but lives at the user-guide root), so its `[Build Studio](build-studio/index)` → `/docs/getting-started/build-studio/index` (404), and `[…](getting-started/agent-dev-environments)` → `/docs/getting-started/getting-started/…` (double-segment 404).

### 2.2 Zero link validation — and docs get *less* CI scrutiny, not more

- The **only** docs-related check (`apps/web/lib/docs-route-map.test.ts`) validates the contextual-help route map (`route → doc file exists`). It never parses inline links.
- `scripts/check-spec-plan-doc.mjs` is a **presence gate**: a PR adding substantial code must touch *some* durable artifact (any `docs/**.md`, `AGENTS.md`, a `SKILL.md`, a kernel principle) **or** carry a `Process-Spine-Decision:` trailer. It never singles out the user guide and never checks quality.
- `.github/workflows/ci.yml` has a **docs fast-path that skips heavy jobs** when every changed file is `docs/`/`*.md`. Docs changes are scrutinized *less*.
- No markdown-lint, no link-checker, no broken-anchor check exists anywhere. Jekyll/GitHub Pages does not fail the build on dead relative links either.

### 2.3 The renderer structurally cannot show rich content

The "lack of diagrams and screenshots" is not authorial laziness — the pipeline **cannot display them**, so no one authored any:

- **0 images** across all 70 user-guide pages; **1** Mermaid block total.
- Portal `DocRenderer.tsx` component map overrides `a/h2/h3/p/ul/table/…` but has **no `img`**, and `resolveHref` is applied only to `<a>`. Relative image `src` would resolve to an unserved URL.
- **No `remark-gfm`** → react-markdown does not parse pipe tables; the table-heavy user guide renders tables as **raw text in-app**.
- **Mermaid is unsupported on both surfaces** — Jekyll shows it as a rouge code block; the portal as `<pre><code>`. The lone diagram (`development-workspace.md:137`) is dead on both.

### 2.4 No ownership, no gate — docs are an afterthought

47 commits have touched `docs/user-guide/`, by many different feature-PR authors, with no owner and no quality bar. Dead links accumulate silently because nothing checks them, and the process gate is satisfied by editing an unrelated spec.

## 3. What already exists (extend, do not rebuild)

The investigation's most important finding: the substrate for a real documentation system is **already built and largely dormant**.

| Concern | Exists? | Where |
| --- | --- | --- |
| **Documentation coworker** | **Yes — dormant** | `documentation-specialist` (AGT-904, `agent_registry.json`); `doc-specialist` (`workforce-seed.ts`). Only referenced in the routing table — nothing dispatches it, no gate invokes it. |
| **Documentation profession corpus** | Yes | `documentation-content` family (`docs/professions/registry.json`), Diátaxis + Mermaid + cross-reference-integrity + IT4IT-alignment corpus pages. |
| **Authoring skills** | Yes — minimal | `skills/docs/generate-diagram.skill.md`, `skills/docs/review-structure.skill.md` (both `assignTo: documentation-specialist`). Recipes, not automation. |
| **Managed-document CMS** | Yes — full | `Document*` models (versioning, content-addressed blobs, FT + semantic search, lifecycle, ACL, audit), `DocumentReference` graph synced to Neo4j; 7 `doc_*` MCP tools. Scoped to coworker artifacts, not the user guide. |
| **Docs-quality lint detectors** | Yes — wiki-scoped | `apps/web/lib/wiki/lint-detectors.ts`: dangling xrefs, orphans, staleness, unsourced pages. Pure-function shape (snapshot → findings) is reusable; fetchers are `WikiPage`-DB-specific. |
| **Route → doc map** | Yes | `DOCS_ROUTE_MAP` (`apps/web/lib/docs-route-map.ts`) — the **unrecognized seed of an impact graph**. |
| **Code graph** | Yes | `trace_code_surface` / `search_code_graph` — the other half of an impact graph. |

Un-built: (a) a shared/validated link layer for the user guide; (b) rich-content rendering in the portal; (c) enforcement that ties the user guide to code changes; (d) doc↔code edges.

## 4. Two operator questions, answered

### 4.1 "Do we need a dedicated docs AI coworker?" — No. Activate the one that exists.

A `documentation-specialist` coworker with a Diátaxis/Mermaid corpus and two skills already exists and is **dormant**. Creating a second would violate check-for-overlap and single-source-of-truth. The real deficiency is that **no process hands work to it and no gate requires its output**. Phase 3 activates it (standing sweep + lifecycle hand-off) and, critically, adds the *gate* — because a coworker without enforcement changes nothing. **Enforcement is the product; the coworker is the executor.**

### 4.2 "Do we need a graph for impact analysis?" — Yes, and most of it already exists.

The substrate is three-quarters built: the **code graph** (`trace_code_surface`), the **`DocumentReference`/Neo4j** graph, `WikiPageLink`, and **`DOCS_ROUTE_MAP`**. The missing edge type is **route/feature → user-guide page**. User-guide frontmatter today is only `title/area/order` — no code linkage. Phase 4 adds `relatedRoutes:`/`relatedCode:` frontmatter, inverts `DOCS_ROUTE_MAP` into a bidirectional edge set, and — when a PR changes those routes/source files — flags the linked pages "docs need review" and routes them to the coworker. Sequenced **last**: it is worthless until links resolve (Phase 1), content renders (Phase 2), and a gate can act on its output (Phase 3).

## 5. Target architecture — converge to one source of truth

Per the operator decision (2026-07-16), **eliminate the divergence** rather than paper over it with a two-sided validator.

### 5.1 One link-resolution module

A single canonical resolver — `resolveDocLink(sourceFilePath, href) → canonicalUrl` — owns the mapping from a repo path + an authored href to the correct URL, keyed on the **file's actual directory**, not the frontmatter `area`. It normalizes `../`, handles cross-tree and absolute links, and knows the published URL structure (`docs/user-guide/** → /user-guide/**`, `docs/dev/** → /dev/**`, etc.).

- The **portal** renderer replaces `DocRenderer.tsx:resolveHref` with a call into this module (via a small build-time index of the corpus, since the browser lacks the file tree).
- The **Jekyll** side is brought into line by (a) normalizing authored links to the one convention the resolver expects and (b) a build-step generator that emits correct hrefs, replacing reliance on `jekyll-relative-links`' `.md`-only rewriting. Where feasible, prefer **site-absolute links** authored once and validated, over fragile relative math.
- **Authoring convention** (documented, linted): one link style for the whole corpus. The link checker is the enforcer; authors stop juggling two conventions.

### 5.2 The link checker (executable, CI-gated)

A `scripts/check-doc-links.mjs` that walks `docs/user-guide/**` (and cross-tree targets), and for every inline link asserts `resolveDocLink` produces a URL that **exists on both surfaces**. Fails CI on any dead link. The docs fast-path is amended so this check always runs on docs PRs.

### 5.3 Rich content

Add `remark-gfm`, an `img` component (with `src` resolved through the same module to a served asset root), and Mermaid rendering to the portal; add Mermaid + image support to the Jekyll layout. One user-guide image/screenshot convention that resolves on both surfaces.

### 5.4 The documentation step (surface-agnostic gate + coworker)

All surfaces land via PR (§4 unified-delivery-surfaces), so **one CI gate** enforces the step for Claude, Codex, and Build Studio identically — the same evidence-not-provenance pattern as the UX-Fit Gate and Native Dialog Guard. The gate: a PR touching a user-facing route/capability must update the corresponding user-guide page (via the Phase-4 edges) and pass link + structure checks. The activated coworker executes the authoring/repair work the gate demands and runs a standing sweep.

### 5.5 The impact graph

`relatedRoutes:`/`relatedCode:` frontmatter + inverted `DOCS_ROUTE_MAP`, validated (declared routes must exist), reusing the wiki lint detector shape for staleness/orphans over the user guide.

## 6. Research & Benchmarking (per AGENTS.md §10)

- **Diátaxis** (already the profession corpus): tutorials / how-to / reference / explanation as distinct modes. *Adopt* — the docs coworker already carries it; the gate should check a page declares its mode. *Gap it fills*: the user guide is undifferentiated prose.
- **Docs-as-code link checkers — `lychee` (Rust), `markdown-link-check`, `htmltest`.** *Pattern adopted*: link-check as a required CI job. *Rejected*: adopting one wholesale — none understands DPF's dual-renderer resolution (`area` frontmatter, `/docs/` vs `/user-guide/` roots), so an off-the-shelf checker validates one surface and misses the divergence that is the actual bug. We build a thin checker over our own `resolveDocLink` and MAY use `lychee` as a second pass for external URLs. (Tool adoption itself follows §9 Tool Evaluation Pipeline before any dependency is pinned.)
- **Vale** (prose linter): *deferred* — style linting is lower-value than link/structure integrity; revisit in a later slice.
- **Docusaurus / Nextra / Starlight** (React doc SSGs with broken-link failure built in): *studied, not adopted now* — migrating off Jekyll is a larger bet than this epic; §5.1 instead makes the existing two renderers agree. Migration remains a possible future consolidation (would collapse the divergence at the source) and is noted as an explicit non-goal here.
- **Anti-pattern identified**: "author more doctrine and hope for compliance" — the exact failure the process-spine spec (`2026-05-30`) diagnosed. This spec adds executable enforcement, not a fourteenth rule.

## 7. Phasing

| Phase | BI | Outcome | Gate to next |
| --- | --- | --- | --- |
| 1 — Stop the bleeding | BI-8605018E | `resolveDocLink` module; `check-doc-links.mjs` in CI; current dead links fixed | Link checker green on the whole corpus |
| 2 — Rich content | BI-E94AE869 | remark-gfm + img + mermaid on both surfaces; image convention | Tables/images/diagrams render on both surfaces |
| 3 — Enforce the step | BI-3F6BB8CC | Surface-agnostic docs CI gate; documentation-specialist activated (sweep + hand-off) | Gate blocks a route change with no doc update |
| 4 — Impact graph | BI-74BED65D | `relatedRoutes`/`relatedCode` edges; inverted route map; "needs review" flagging | A functionality change flags affected pages |

Phases 1–2 are engine-light and unblock everything. Phase 3 is where the *systematic* change lands. Phase 4 is the intelligence layer on top.

## 8. Acceptance

- **P1**: `check-doc-links.mjs` runs in CI on docs PRs and fails on a seeded dead link; the flagged `agent-dev-environments` page and the §2.1 examples resolve on both surfaces; both renderers call one `resolveDocLink`.
- **P2**: a GFM table, an image, and a Mermaid diagram render correctly in **both** the portal and the public site; the image convention is documented.
- **P3**: a PR that changes a user-facing route without updating its linked user-guide page fails the docs gate; the documentation-specialist coworker runs a standing sweep and is the lifecycle hand-off target; the step is enforced identically for Claude/Codex/Build Studio (evidence-not-provenance).
- **P4**: `relatedRoutes` are validated against real routes; changing a linked route flags its pages "docs need review" and routes them to the coworker.

## 9. Non-goals

- Migrating off Jekyll to a React SSG (Docusaurus/Starlight) — a larger consolidation, noted but out of scope; §5.1 converges the two existing renderers instead.
- Folding the user guide into the managed-Document CMS — the user guide stays filesystem-authored, git-owned markdown.
- Prose/style linting (Vale) — deferred to a later slice.
