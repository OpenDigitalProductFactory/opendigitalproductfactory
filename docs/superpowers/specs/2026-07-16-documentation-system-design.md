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

### 5.1 Canonical document identity, not one hardcoded URL

The source of truth is the **document identity**: the repo path of a markdown page plus its derived public and portal addresses. A single resolver owns the mapping from a source page + authored href to that identity, keyed on the **file's actual directory**, not the frontmatter `area`.

```ts
type DocLinkTarget = {
  sourcePath: string;       // docs/user-guide/getting-started/setup-and-first-login.md
  publicHref: string;       // /user-guide/getting-started/setup-and-first-login/
  portalHref: string;       // /docs/getting-started/setup-and-first-login
  anchor?: string;
};

resolveDocLink(sourcePath: string, authoredHref: string): DocLinkTarget;
```

The resolver normalizes `../`, rejects ambiguous `index` suffixes, handles anchors, and knows the published URL structure (`docs/user-guide/** → /user-guide/**`, `docs/dev/** → /dev/**`, etc.). The return shape deliberately carries **both** surface URLs; collapsing them into one string would recreate today's mismatch under a friendlier name.

- The **shared module** lives in source, with a pure core usable from Node scripts and server components. Suggested split: `apps/web/lib/docs/doc-link-resolver.ts` for the pure logic and `apps/web/lib/docs/doc-index.generated.json` for the generated corpus index.
- The **portal** renderer replaces `DocRenderer.tsx:resolveHref` with a call into this module. The app should pass the current page's `sourcePath`, not just `currentArea`, because `area` is metadata and has already proven too weak for path resolution.
- The **public site** is brought into line by a build-step generator that rewrites or validates links against `publicHref`, replacing reliance on `jekyll-relative-links`' `.md`-only behavior. Jekyll remains the public renderer in this epic; the generated index is the contract that keeps it honest.
- **Authoring convention**: authors link to markdown documents using resolver-supported document paths, not surface URLs. The preferred internal form is repo-relative from the current file, including the `.md` suffix when targeting a page (`../ai-workforce/index.md#model-routing`). Site-absolute `/user-guide/...` and portal-absolute `/docs/...` links are generated outputs, not hand-authored source, except for intentional external/self links documented by the checker.

### 5.2 The link checker (executable, CI-gated)

Add `scripts/check-doc-links.mjs` and `scripts/check-doc-links.test.mjs`. The checker walks `docs/user-guide/**/*.md` plus allowed cross-tree targets and, for every inline link/image/anchor, asserts:

- `resolveDocLink` resolves to an existing source page or allowed external URL.
- The derived `publicHref` and `portalHref` are both valid routes for that document.
- Anchors match generated heading ids on the target page.
- Authored links follow the convention: no `index` suffixes, no portal URLs in source markdown, no public-site URLs used as internal shortcuts.
- Relative image paths resolve to a served asset location on both surfaces.

The CI shape should be a dedicated `Docs Link Integrity` job, not a sub-step hidden in heavy CI. It runs on all PRs and push/merge-group events, including docs-only PRs where `changes.heavy=false`. That fixes the current inversion where docs-only changes skip the expensive checks and receive no replacement scrutiny.

### 5.3 Rich content

Add GFM, images, screenshots, and Mermaid as first-class content types.

- **GFM tables**: add `remark-gfm` to the portal renderer and test that existing pipe tables produce real `<table>` elements, not paragraphs of raw text.
- **Images and screenshots**: introduce one asset convention, lint it, and serve it on both surfaces. Recommended convention: page-local assets under `docs/user-guide/_assets/<page-slug>/...`, with markdown authored as relative links. The resolver maps them to public-site static paths and portal static paths.
- **Image quality bar**: screenshots must have descriptive alt text, stable dimensions, and no cropped evidence-critical UI. Portal rendering should use themed borders/captions that match DPF's design tokens, not ad hoc markdown defaults.
- **Mermaid**: prefer build-time rendering to static SVG/PNG assets over live client-side Mermaid execution. The root already carries `@mermaid-js/mermaid-cli`; using a generated asset avoids shipping a large diagram runtime into the portal and keeps the public site and portal visually identical. The source markdown remains fenced `mermaid`; the build/check step renders and validates it.
- **Security**: generated SVG must be sanitized or rendered to PNG if sanitization is not guaranteed. Markdown HTML passthrough remains disabled unless a later security-reviewed slice explicitly enables it.

> **WWMD ratification (2026-07-16, `principle_decide` DI-5C7B16CA4472).** The build-time-static-SVG approach was scored against the founder kernel vs. the client-side-CDN approach PR #3100 shipped on the public site. Verdict: **build-time static SVG, composite 7.64 vs 3.56, margin 4.08, high confidence, no commandment conflict.** The client-side-CDN option scored *negative* on several commandments; the decisive positive contributors were *least-privilege / deny-by-default*, *never adopt an unvetted external tool* (a per-reader `cdn.jsdelivr.net` import is exactly that), *never trust input — validate/encode* (sanitized SVG), and *every non-text element needs a text alternative*. **Consequence:** Phase 2 supersedes #3100's client-side Mermaid shim in `docs/_layouts/default.html` — no external CDN import survives.
>
> **Execution-environment constraint (blocking for a source-only worktree).** Producing the committed SVGs requires running `mmdc` (mermaid-cli + a headless Chromium), and GitHub Pages forbids custom Jekyll plugins — so the public site must reference **committed** SVG assets (it cannot render at build time). Therefore Phase 2's diagram generation MUST run in a **compile-ready environment** (the shared local-CI convergence sandbox lease, the canonical install, or a `DPF_WORKTREE_BOOTSTRAP=1` worktree with Chromium), never a source-only worktree. The renderer ships a `--check` freshness mode (like `gen-doc-index --check`) that CI enforces once assets are committed.

### 5.4 The documentation step (surface-agnostic gate + coworker)

All surfaces land via PR (§4 unified-delivery-surfaces), so **one CI gate** enforces the step for Claude, Codex, Grok, and Build Studio identically — the same evidence-not-provenance pattern as the UX-Fit Gate and Native Dialog Guard.

The new `Docs Impact Gate` should be narrower and more actionable than the existing Spec/Plan/Doc Gate:

- It triggers when a PR changes a user-facing route, a route-mapped component, user-visible workflow copy, or a documented MCP/tool capability.
- It requires either an update to the linked user-guide page(s) or a `Docs-Impact-Decision:` trailer explaining why no user-guide change is needed.
- It always runs after link/structure checks, so the required update cannot satisfy the gate while adding broken links.
- It reports the exact impacted pages and route prefixes in the CI output, so the author or coworker has a repair list rather than a vague failure.

The documentation-specialist remains the executor, not a second source of truth. Activation means: add routing from failed/needed docs-impact work to the existing coworker, give it the resolver/checker outputs as input, and schedule a standing sweep that files concrete repair BIs rather than silently editing broad docs.

### 5.5 The impact graph

The graph begins as a small, reviewable manifest and graduates to the existing graph substrate once the edges prove valuable.

- Add `relatedRoutes:` and `relatedCode:` frontmatter to user-guide pages.
- Invert `DOCS_ROUTE_MAP` into a generated `route → docs` manifest, then merge explicit frontmatter edges.
- Validate declared routes against real routes and declared code paths against files that exist.
- Reuse the wiki lint detector shape for orphans, stale pages, and dangling cross-references over the user guide.
- Project stable edges into the existing `DocumentReference`/Neo4j graph only after the filesystem manifest is green. That keeps Phase 4 from turning into a data-model migration before the simpler source-controlled contract is proven.

The gate consumes this graph in two directions: changed route/code → affected docs, and changed docs → affected routes for review context.

## 6. Implementation Contracts

These are the non-negotiable contracts the implementation plan should preserve.

| Contract | Requirement |
| --- | --- |
| Source identity | Every indexed page has exactly one `sourcePath`, derived from the repo path. |
| Surface URLs | `publicHref` and `portalHref` are generated from the same identity; neither is hand-maintained in frontmatter. |
| Authoring style | Internal markdown links target markdown source paths; generated surface URLs are outputs. |
| Assets | User-guide images live under the approved `_assets` convention and are resolved by the same index. |
| CI | Docs link integrity runs on docs-only PRs, regular PRs, pushes to `main`, and merge queue events. |
| Enforcement | Docs-impact failures name the impacted page(s), route(s), and acceptable remediation. |
| Coworker | The existing documentation-specialist receives structured repair tasks; no new docs coworker is created. |
| Graph | Phase 4 starts filesystem-first and projects to Neo4j only after edge validation passes. |

## 7. Research & Benchmarking (per AGENTS.md §10)

- **Diátaxis** (already the profession corpus): tutorials / how-to / reference / explanation as distinct modes. *Adopt* — the docs coworker already carries it; the gate should check a page declares its mode. *Gap it fills*: the user guide is undifferentiated prose.
- **Docs-as-code link checkers — `lychee` (Rust), `markdown-link-check`, `htmltest`.** *Pattern adopted*: link-check as a required CI job. *Rejected*: adopting one wholesale — none understands DPF's dual-renderer resolution (`area` frontmatter, `/docs/` vs `/user-guide/` roots), so an off-the-shelf checker validates one surface and misses the divergence that is the actual bug. We build a thin checker over our own `resolveDocLink` and MAY use `lychee` as a second pass for external URLs. (Tool adoption itself follows AGENTS.md §9 Tool Evaluation Pipeline before any dependency is pinned.)
- **Vale** (prose linter): *deferred* — style linting is lower-value than link/structure integrity; revisit in a later slice.
- **Docusaurus / Nextra / Starlight** (React doc SSGs with broken-link failure built in): *studied, not adopted now* — migrating off Jekyll is a larger bet than this epic; §5.1 instead makes the existing two renderers agree. Migration remains a possible future consolidation (would collapse the divergence at the source) and is noted as an explicit non-goal here.
- **Anti-pattern identified**: "author more doctrine and hope for compliance" — the exact failure the process-spine spec (`2026-05-30`) diagnosed. This spec adds executable enforcement, not a fourteenth rule.

## 8. Phasing

| Phase | BI | Outcome | Gate to next |
| --- | --- | --- | --- |
| 1 — Stop the bleeding | BI-8605018E | `DocLinkTarget` resolver; generated doc index; `check-doc-links.mjs` + tests; current dead links fixed | Link checker green on the whole indexed corpus and seeded failure test proves CI blocks regressions |
| 2 — Rich content | BI-E94AE869 | `remark-gfm`; image/screenshot convention; build-time Mermaid render; portal + public-site styling | Tables, images, screenshots, and Mermaid render on both surfaces from the same source markdown |
| 3 — Enforce the step | BI-3F6BB8CC | `Docs Impact Gate`; documentation-specialist repair hand-off; standing sweep creates actionable work | Gate blocks a route/capability change with no linked doc update or explicit docs-impact decision |
| 4 — Impact graph | BI-74BED65D | `relatedRoutes`/`relatedCode` frontmatter; generated route-doc manifest; optional graph projection | A functionality change flags affected pages and a doc change reports affected route/code context |

Phases 1–2 are engine-light and unblock everything. Phase 3 is where the *systematic* change lands. Phase 4 is the intelligence layer on top.

### Implementation status

- **Phase 1 — landed (2026-07-16).** Shared zero-dependency resolver `apps/web/lib/docs/doc-link-resolver.mjs` (+ `.d.mts`) derives both surface URLs from one `sourcePath`; `scripts/gen-doc-index.mjs` writes the committed `apps/web/lib/docs/doc-index.generated.json` (499 pages, with heading anchors); `scripts/check-doc-links.mjs` (+ `scripts/check-doc-links.test.mjs`, 16 tests) validates every user-guide link/image/anchor on both surfaces; `scripts/fix-doc-links.mjs` normalized the corpus (65 links across 15 files) and the remaining judgment cases were fixed by hand. The portal renderer (`DocRenderer.tsx`) now resolves through the shared module using the page's real `sourcePath` (no longer the frontmatter `area`) and ids h2–h4. Image and Mermaid rendering are deliberately deferred to Phase 2. CI job **Docs Link Integrity** runs on every PR incl. docs-only. Checker is **green on the whole corpus**. Runtime-bound gates (portal `next build`, live UX) are unrun in the source-only worktree and route through the sandbox/canonical install per §5.
- **Phase 2 — Mermaid slice in progress (2026-07-16).** Build-time static SVG per the WWMD verdict above. `scripts/render-doc-diagrams.mjs` renders each user-guide `` ```mermaid `` fence to a committed sanitized SVG under `docs/user-guide/assets/diagrams/<slug>/<n>.svg` (keyed by ordinal; a manifest powers `--check` freshness, wired into the **Docs Link Integrity** CI job — `--check` needs no Chromium). `apps/web/lib/docs/diagram-assets.mjs` is the shared path/URL helper. The portal `DocRenderer` renders `language-mermaid` blocks as the committed SVG via a new asset route `apps/web/app/api/docs-asset/[...path]/route.ts` (path-traversal-guarded); the Jekyll layout swaps fences for the committed SVG by ordinal, **superseding #3100's `cdn.jsdelivr.net` shim** (no external CDN, no client Mermaid runtime). **Deviation from §5.3:** assets live under `assets/` not `_assets/` because Jekyll ignores underscore-prefixed paths. **Execution:** rendering runs in the convergence sandbox; the sandbox is Alpine/musl so Google's glibc Chrome cannot run — `apk add chromium` + `PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser` is the working config (recorded so the next session/CI doesn't re-derive it). **Screenshots/images landed:** the portal `DocRenderer` now has an `img` handler (typed `src?: string | Blob` to satisfy react-markdown's `Components` — the Phase-1 typecheck failure was this exact `Blob` widening) that serves user-guide images via `/api/docs-asset`; the convention is `docs/user-guide/assets/<page-slug>/` (AGENTS.md), validated by the link checker. **GFM tables landed:** `remark-gfm@^4` added to `apps/web` and passed to the portal `ReactMarkdown` (`remarkPlugins`), so the table-heavy user guide renders real `<table>` elements in-portal instead of raw text. The New Dependency Gate is satisfied by a recorded acknowledgement in `sbom/dependency-allowlist.json` (the kernel-chosen automated front door for a direct npm dep — same `unifiedjs/remark` ecosystem as the already-acknowledged react-markdown; MIT; no network/native surface). **Phase 2 is complete.**
- **Phase 3 — Docs Impact Gate landed (2026-07-16).** `scripts/check-docs-impact.mjs` (+ `.test.mjs`, 9 tests) is the surface-agnostic gate: when a PR changes a user-facing `page.tsx` whose route is documented (longest-prefix match against `DOCS_ROUTE_MAP`, parsed from `apps/web/lib/docs-route-map.ts`), it requires either the linked `docs/user-guide/**` page to be updated in the same PR or a `Docs-Impact-Decision:` trailer. Modeled on the UX-Fit gate (same `BASE_SHA`/`PR_BODY` diff + command-injection hygiene). CI job **Docs Impact Gate** runs on PRs, separate from Docs Link Integrity (both required) so a satisfying doc update can't ship broken links. AGENTS.md documents the trailer convention. **Coworker activation** (the executor half of §5.4 — routing flagged pages to the dormant `documentation-specialist` AGT-904 + a standing sweep that files repair BIs) is the remaining Phase 3 slice; it is runtime/dispatch work deferred to a follow-up. Enforcement (the gate) is the product and is live.
- **Phase 4 — Doc-impact graph landed (2026-07-16).** `scripts/gen-doc-impact.mjs` (+ `.test.mjs`) generates `apps/web/lib/docs/doc-impact.generated.json` — a bidirectional manifest of route→doc (inverted `DOCS_ROUTE_MAP`) and code→doc / doc→code edges from `relatedCode:` / `relatedRoutes:` page frontmatter (85 route edges + seeded code edges on ai-workforce/connecting-providers, build-studio, agent-dev-environments). `--check` enforces freshness and that every `relatedCode` path exists (CI, no runtime). The **Docs Impact Gate** now consumes `codeToDocs`, so a change to a page's related source file — a *functionality* change, not just a route-file edit — flags the page (update it or attest `Docs-Impact-Decision:`). Filesystem-first per §5.5; the `DocumentReference`/Neo4j projection is deferred until this contract is proven. This directly answers the operator's "impact analysis when functionality changes" question. Remaining across the epic: Phase 2 `remark-gfm` (governed dep), the screenshot convention, and the Phase 3 coworker-activation slice (runtime/dispatch).

- **Phase 5 — Contextual quick help lands (2026-07-22, BI-2DD18122).** Contextual docs previously kept `sourceRoute` + "Back to page" but then dropped the operator into the generic docs catalog, competing with the immediate need. This slice adds a route-keyed quick-help registry (`apps/web/lib/docs-quick-help.ts`) resolved by longest-prefix match on `sourceRoute`, so shared docs (one doc, many routes) can still answer *for the specific screen*: what this page is, what to do now, what happens if nothing is done, what is reversible, and where recovery lives. The `apps/web/components/docs/ContextualQuickHelp.tsx` component renders that panel above the full doc body, and the docs page (`apps/web/app/(shell)/docs/[[...slug]]/page.tsx`) demotes the full catalog — sidebar area list and the home grid collapse into a disclosure — when arrival is contextual, so the immediate explanation is not fighting the manual. `/ops/self-upgrade` gets a dedicated `docs/user-guide/operations/self-upgrade.md` and a `DOCS_ROUTE_MAP` entry instead of falling through to the generic operations backlog page. Tests cover `buildContextualDocsHref`, `resolveQuickHelp`, and `ContextualQuickHelp` rendering for `/storefront/inbox`, `/storefront/settings/business`, `/ops/self-upgrade`, and `/customer/marketing`.

## 9. Acceptance

- **P1**: `check-doc-links.mjs` runs in CI on docs-only and mixed PRs, fails on a seeded dead link, and validates anchors; the flagged `agent-dev-environments` page and the §2.1 examples resolve on both surfaces; the portal renderer no longer uses frontmatter `area` as the path authority.
- **P2**: a GFM table, an image/screenshot, and a Mermaid diagram render correctly in **both** the portal and the public site from the same source markdown; generated diagram assets are deterministic and reviewed like source artifacts.
- **P3**: a PR that changes a user-facing route/capability without updating its linked user-guide page or adding a `Docs-Impact-Decision:` fails the docs gate; the documentation-specialist coworker receives structured repair work; the step is enforced identically for Claude/Codex/Grok/Build Studio (evidence-not-provenance).
- **P4**: `relatedRoutes` are validated against real routes; `relatedCode` paths are validated against real files; changing a linked route/code file flags affected pages "docs need review" and reports them in CI/coworker input.

## 10. Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Link checker becomes noisy and authors bypass it | Keep failures concrete: source file, authored href, attempted resolution, suggested replacement. |
| Generated site rewrites create unreadable diffs | Keep source markdown unchanged where possible; generate an index/asset outputs and only normalize links in explicit repair PRs. |
| Mermaid rendering adds flaky browser/runtime work | Use build-time CLI rendering with deterministic outputs and a small fixture test. |
| Docs-impact gate blocks legitimate internal refactors | Allow a `Docs-Impact-Decision:` trailer, but require it to name why no user-facing documentation changed. |
| Phase 4 turns into a graph-platform rewrite | Start with a source-controlled manifest; project to Neo4j only after the manifest contract is stable. |

## 11. Non-goals

- Migrating off Jekyll to a React SSG (Docusaurus/Starlight) — a larger consolidation, noted but out of scope; §5.1 converges the two existing renderers instead.
- Folding the user guide into the managed-Document CMS — the user guide stays filesystem-authored, git-owned markdown.
- Prose/style linting (Vale) — deferred to a later slice.
- Enabling arbitrary raw HTML in markdown — rich content means supported markdown, generated diagrams, and governed assets, not unreviewed HTML passthrough.
