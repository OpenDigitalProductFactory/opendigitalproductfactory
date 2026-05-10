# EP-WIKI-001: Platform Kernel Wiki — Implementation Plan

| Field | Value |
|-------|-------|
| **Epic** | EP-WIKI-001 |
| **Spec** | [2026-05-09-platform-kernel-wiki-design.md](../specs/2026-05-09-platform-kernel-wiki-design.md) |
| **Follow-up specs** | [EP-WIKI-002 — Bi-Temporal Revisions](../specs/2026-05-09-wiki-bi-temporal-revisions-design.md), [EP-WIKI-003 — Importance + Reflection](../specs/2026-05-09-wiki-importance-and-reflection-design.md), [EP-WIKI-004 — PPR Retrieval](../specs/2026-05-09-wiki-ppr-retrieval-design.md), [EP-WIKI-005 — Visual Navigation](../specs/2026-05-09-wiki-visual-navigation-design.md) |
| **Status** | Phase 0 complete (PR #399 in review); Phases 1–7 not started |
| **Created** | 2026-05-09 |

---

## Build Gate (per AGENTS.md §5)

Each phase ends with all four passing:

1. Unit tests — `pnpm --filter <pkg> exec vitest run` for affected files.
2. Production build — `cd apps/web && npx next build` with zero errors.
3. UX verification — exercise the affected path against the running app.
4. Migration applies cleanly — if a migration was added.

---

## Phase 0 — Spec, plan, schema, licensing (no code)

**Branch:** `claude/review-rag-implementation-3qLkr`

**Files created:**
- `docs/superpowers/specs/2026-05-09-platform-kernel-wiki-design.md`
- `docs/superpowers/plans/2026-05-09-platform-kernel-wiki.md` (this file)
- `docs/founder-kernel/SCHEMA.md`
- `docs/founder-kernel/manifest.json`
- `docs/founder-kernel/RAW-SOURCES-LICENSE.md`

**Files modified:**
- `ACKNOWLEDGMENTS.md` — add a Founder Kernel section pointing at the new licensing rationale.

**Backlog action (post-merge, requires DPF MCP or DB access):**
- Create `EP-WIKI-001` epic in the live backlog (query existing epics for overlap first per AGENTS.md §6).

**Acceptance:** spec + plan + schema reviewed by founder; epic open in DB; PR merged.

---

## Phase 1 — Data model + migration

**Implementation note (added 2026-05-10 after on-the-ground discovery).** The original plan called for renaming `KnowledgeArticle` → `WikiPage` in a single PR, citing the spec's "zero production rows" justification (spec §11). On-the-ground inspection showed that **substantial code already references `KnowledgeArticle`**:

- UI components: `apps/web/components/knowledge/KnowledgeArticleList.tsx`, `KnowledgeArticleCard.tsx`, `KnowledgeArticleForm.tsx`, `KnowledgeArticleActions.tsx`
- Routes: `/knowledge`, `/knowledge/new`, `/knowledge/[articleId]`, `/portfolio/product/[id]/knowledge`
- Server actions: `apps/web/lib/actions/knowledge.ts` (263 lines)
- MCP tools: entries in `apps/web/lib/mcp-tools.ts`, grants in `apps/web/lib/tak/agent-grants.ts`
- Inference helpers: `apps/web/lib/inference/semantic-memory.ts`
- Catalogs: `packages/db/data/grant_catalog.json`, `packages/db/src/platform-tools-snapshot.json`

The user's "we never used the knowledge articles" feedback was about **production data**, not about whether code was written. Renaming the model in one PR would force rewrites of all the above in the same change — high blast radius, hard to review.

Phase 1 is therefore split:

### Phase 1a — Additive: new wiki schema alongside `KnowledgeArticle` (this PR)

**Branch:** `feat/wiki-kernel-schema`

Adds the new wiki models and Qdrant collection without touching `KnowledgeArticle` or any of its call sites. Pure additive change; safe to merge before kernel content lands.

**Files modified:**
- `packages/db/prisma/schema.prisma`:
  - Add new models: `RawSource`, `WikiPage`, `WikiPageRevision`, `WikiPageLink`, `WikiPageSource`, `WikiIngestEvent`, `WikiLintFinding`.
  - Add reverse relations: `Organization.wikiPages`, `Organization.wikiRawSources`, `Organization.wikiIngestEvents`, `Organization.wikiLintFindings`; `User.wikiRevisions @relation("WikiRevisionCreator")`; `Agent.wikiRevisions @relation("WikiRevisionAgentCreator")`.
  - **No changes** to `KnowledgeArticle`, `KnowledgeArticleRevision`, `KnowledgeArticleProduct`, `KnowledgeArticlePortfolio`. They stay live for now.
- `packages/db/src/qdrant.ts` — add `WIKI_PAGES` collection constant; create the new collection in `ensureCollections()`; add wiki-specific payload indexes (`pageKind`, `isKernel`, `organizationId`, `kernelVersion`, `kernelPageId`, `slug`).

**Files created:**
- `packages/db/prisma/migrations/<timestamp>_add_wiki_kernel_schema/migration.sql` — additive only (CREATE TABLE for the seven new models + new FKs; no ALTER on `KnowledgeArticle`).
- `packages/db/src/wiki-store.ts` — typed CRUD helpers (`upsertWikiPage`, `appendRevision`, `linkPages`, `attachSource`, `getWikiPage`).
- `packages/db/src/wiki-store.test.ts`

**Run:** `pnpm --filter @dpf/db exec prisma migrate dev --name add-wiki-kernel-schema`.

**Acceptance (Phase 1a):**
- Migration applies on a fresh DB and on a DB with `KnowledgeArticle` data without touching `KnowledgeArticle`.
- Qdrant collection `wiki-pages` exists with the documented payload indexes after `ensureCollections()` + `ensurePayloadIndexes()` run.
- Helpers round-trip a kernel page and an org override; uniqueness on `(organizationId, slug)` is enforced.
- `KnowledgeArticle` UI / routes / actions / MCP tools continue to function (touched by no changes).
- Build gate green: `pnpm typecheck`, `cd apps/web && npx next build`, vitest on the new test file.

### Phase 1b — Deprecate `KnowledgeArticle` once kernel content validates the new models (later PR)

**Branch:** `feat/wiki-deprecate-knowledge-article`

After Phase 5 (kernel seed content) lands and we've validated `WikiPage` in real use, deprecate `KnowledgeArticle`:

1. Migrate any rows that exist (none expected) into `WikiPage` with sensible defaults (`pageKind = "summary"`, `isKernel = false`, `slug = lowerKebab(title)`).
2. Update UI: `apps/web/components/knowledge/*` either delete or rename to `apps/web/components/wiki/*` reusing what makes sense.
3. Update routes: `/knowledge` → redirect to `/wiki` (or remove); same for sub-routes.
4. Update server actions: `apps/web/lib/actions/knowledge.ts` → `apps/web/lib/actions/wiki.ts`.
5. Update MCP tools: `search_knowledge_base` retired in favor of `wiki_query` (already specced in EP-WIKI-001 §8).
6. Update inference helpers: `searchKnowledgeArticles()` retired in favor of `searchWikiPages()`.
7. Drop the `KnowledgeArticle*` Prisma models and their migrations consolidate.

**Acceptance (Phase 1b):** all `KnowledgeArticle` references removed; build gate green; UI tests updated.

---

## Phase 2 — Ingest pipeline (CLI + admin route + agent skill)

**Branch:** `feat/wiki-ingest`

**Files created:**
- `apps/web/lib/wiki/ingest.ts` — `ingestRawSource()`, `proposeWikiDiff()`, `commitIngestProposal()`.
- `apps/web/lib/wiki/embeddings.ts` — `storeWikiPage()` (Qdrant upsert into `wiki-pages`), `searchWikiPages()` (overlay-aware two-pass retrieval).
- `apps/web/lib/wiki/embeddings.test.ts`
- `apps/web/lib/wiki/ingest.test.ts`
- `scripts/wiki-ingest.ts` — CLI entrypoint (`pnpm --filter web wiki:ingest -- --source <path|url> --org <orgId|kernel>`).
- `apps/web/app/api/v1/wiki/ingest/route.ts` — POST endpoint.
- `skills/platform/wiki-ingest.skill.md` — frontmatter + body matching `find-knowledge.skill.md` shape.
- `apps/web/app/(shell)/admin/wiki/ingest/page.tsx` — minimal admin form.

**Files modified:**
- `apps/web/lib/mcp-tools.ts` — add `wiki_ingest` definition + executor.
- `apps/web/lib/tak/agent-grants.ts` — add `wiki_ingest: ["registry_write"]`.
- `apps/web/lib/tak/route-context-map.ts` — add `wiki_ingest` to admin route domainTools.

**Acceptance:**
- Ingesting the same source twice is idempotent (revision chain advances by one only when content changes).
- Org overlay ingest cannot write to `organizationId = NULL` pages (DB constraint + executor guard).
- Sample source ingest produces `RawSource` + `WikiPage` revision + Qdrant point + `WikiIngestEvent`.

---

## Phase 3 — Query integration into prompt assembly + MCP tools

**Branch:** `feat/wiki-query`

**Files modified:**
- `apps/web/lib/tak/prompt-assembler.ts` — add `wikiContext: string | null` to `PromptInput`; render in Block 5 above `Available domain tools`.
- The assembler caller (verify path: `apps/web/lib/tak/agent-context.ts` or equivalent) — call `recallWikiContext({ query, organizationId, routeContext, limit })` and pass through.
- `apps/web/lib/mcp-tools.ts` — add `wiki_query` and `wiki_propose_edit` definitions + executors.
- `apps/web/lib/tak/agent-grants.ts` — `wiki_query: ["registry_read"]`, `wiki_propose_edit: ["registry_write"]`.
- `apps/web/lib/tak/route-context-map.ts` — add `wiki_query` to **every** route's `domainTools`, above `search_knowledge_base`.
- `skills/portfolio/find-knowledge.skill.md` — update body + `allowedTools` to call `wiki_query` first.

**Files created:**
- `apps/web/lib/wiki/recall.ts` — `recallWikiContext()` helper.
- `apps/web/lib/wiki/recall.test.ts`
- `skills/platform/wiki-query.skill.md`
- `prompts/platform-identity/wiki-preamble.prompt.md` — DB-overridable preamble string.

**Acceptance:**
- `prompt-assembler.test.ts` extended: when `wikiContext` is non-null it appears in Block 5 below `domainContext` and above `Available domain tools`. Cache boundary still positioned correctly.
- Overlay-aware recall: org-scoped first; missing-org returns kernel only; `pageKind` filter narrows results.
- `wiki_query` execution returns top-K + synthesized answer; with `fileBackAs` set, returns a proposal payload, not a write.
- Coworker chat on `/portfolio/product/[id]` mentions a Digital Product term; the wiki entity page excerpt appears in the agent's grounded answer (verify in Network tab the system prompt now contains the wiki block).

---

## Phase 4 — Lint loop (scheduled job)

**Branch:** `feat/wiki-lint`

**Implementation note (added 2026-05-10).** Phase 4 is split into 4a (pure detectors only) and 4b (orchestrator + scheduled job + admin UI + MCP tool) so the detectors can land independently of Inngest + UI plumbing. The detectors are testable in isolation against synthetic fixtures, so they are usable from any caller (manual run, on-demand admin trigger, scheduled job) once 4b's orchestrator wires them up.

### Phase 4a — Pure detectors

**Branch:** `feat/wiki-lint-detectors`

**Files created:**
- `apps/web/lib/wiki/lint-detectors.ts` — five of the seven §6 detectors as pure functions (no DB, no LLM, no network):
  - `detectOrphans` — published page with no inbound link or empty source list (warn). Index/runbook pages exempt.
  - `detectDanglingXrefs` — `[[slug]]` token with no resolvable target in the page's visibility scope (error). Org overlays resolve against own-org slugs ∪ kernel slugs (kernel fallback).
  - `detectStanceExtractionNeeded` — published `summary` page with no `[[stances/...]]` or `[[heuristics/...]]` link (info).
  - `detectStaleClaims` — page whose oldest `RawSource.retrievedAt` exceeds `staleThresholdDays` (default 180) (info).
  - `detectKernelDrift` — overlay's `derivedFromKernelVersion ≠ currentKernelVersion` (warn). Phase 4a ships the simple version-mismatch check; Phase 4b adds the paragraph-hash diff per spec §3.3.
  - Plus a `runDetectors()` aggregator that returns the union.
- `apps/web/lib/wiki/lint-detectors.test.ts` — vitest coverage for each detector (positive case, negative case, edge cases like draft/archived pages, kernel fallback, missing data).

**Deferred to Phase 4b:**
- `detectContradictions` — needs cosine search over `wiki-pages` Qdrant collection plus an LLM judge. Belongs alongside the orchestrator that has DB + Qdrant + LLM access.
- `detectMissingXrefs` — needs entity recognition over the body. Belongs alongside the orchestrator (or shipped as its own follow-up if the NLP work is large).

**Acceptance (Phase 4a):**
- Each shipped detector produces findings on its fixture and emits no findings on its negative-case fixture.
- `runDetectors()` returns the union without crosstalk.
- `pnpm typecheck` and `pnpm --filter web test --run lint-detectors.test.ts` clean.

### Phase 4b — Orchestrator + scheduled job + admin UI + MCP tool

**Branch:** `feat/wiki-lint-runtime`

**Files created:**
- `apps/web/lib/wiki/lint.ts` — `runWikiLint({ organizationId | null })`: fetches wiki snapshot from Prisma, calls `runDetectors()`, plus implements `detectContradictions` (Qdrant cosine + LLM judge) and `detectMissingXrefs` (entity recognition). Persists findings as `WikiLintFinding` rows; idempotent against existing open findings (re-runs update, don't duplicate).
- `apps/web/lib/wiki/lint.test.ts` — integration tests against a mocked Prisma client.
- `apps/web/lib/queue/functions/wiki-lint.ts` — Inngest scheduled function (daily 03:30 local; mirror `infra-prune.ts`).
- `apps/web/app/(shell)/admin/wiki/lint/page.tsx` — list of `WikiLintFinding` filtered by org/kernel + status.
- `apps/web/components/wiki/LintFindingCard.tsx`

**Files modified:**
- `apps/web/lib/queue/functions/index.ts` — register the new function.
- `apps/web/lib/mcp-tools.ts` — add `wiki_lint` (read-only on-demand trigger).
- `apps/web/lib/tak/agent-grants.ts` — `wiki_lint: ["registry_read"]`.

**Acceptance (Phase 4b):**
- Each detector (including the two added in 4b) produces a finding on its fixture.
- Daily run completes within 5 minutes for a 1k-page wiki on a single org.
- Findings carry `organizationId` correctly; kernel findings are visible only to platform admins.
- Re-runs are idempotent (no duplicate findings — existing open findings are updated, not re-inserted).
- `/admin/wiki/lint` renders findings with theme-aware tokens per AGENTS.md §12.

---

## Phase 5 — Founder kernel seed content

> User-driven phase. Mark migrates curated content into `docs/founder-kernel/`. Platform side ships scripting to load it.

**Branch:** `feat/wiki-kernel-seed`

**Files created (machinery):**
- `packages/db/src/seed-wiki-kernel.ts` — reads `docs/founder-kernel/`, parses frontmatter on each markdown, upserts `RawSource` + `WikiPage` (kernel rows, `organizationId = NULL`), reads `embeddings.jsonl` and seeds Qdrant points directly. Mirrors `seed-skills.ts:140`.
- `packages/db/src/seed-wiki-kernel.test.ts`
- `scripts/build-kernel-embeddings.ts` — offline maintainer script that produces `docs/founder-kernel/embeddings.jsonl`.

**Files modified:**
- `packages/db/src/seed.ts` — call `seedWikiKernel()` after `seed-skills` and `seed-prompt-templates`.
- `docs/founder-kernel/manifest.json` — bump `kernelVersion`, `pageCount`, `sourceCount` whenever Mark publishes a batch.

**Content (Mark drives):**
- 4–8 raw-source abstract pages under `raw-sources/papers/` and `raw-sources/articles/`.
- 7–12 entity pages under `wiki/entities/` covering the canonical concepts in `SCHEMA.md`.
- **3–5 stance pages and 2–4 heuristic pages** — the "what would Mark do?" core. Without these the kernel is just summaries.
- 3–5 summary pages under `wiki/summaries/`.
- 2–3 decision pages under `wiki/decisions/` (e.g. `DEC-2024-portfolio-as-the-anchor`, `DEC-2024-it4it-as-substrate`).

**Acceptance:**
- `pnpm --filter @dpf/db exec tsx packages/db/src/seed.ts` is idempotent on fresh + populated DBs.
- After seed, `wiki_query` from a coworker chat returns kernel content with non-zero scores.
- Each kernel page cites at least one `RawSource`.
- Founder kernel renders at `/admin/wiki/browse?scope=kernel` with all entity, stance, heuristic, summary, and decision pages reachable by cross-link.

---

## Phase 6 — Per-org overlay UI

**Branch:** `feat/wiki-overlay-ui`

**Files created:**
- `apps/web/app/(shell)/wiki/page.tsx` — global wiki browse for the current org (kernel + overrides).
- `apps/web/app/(shell)/wiki/[...slug]/page.tsx` — wiki page viewer with overlay indicator ("kernel" / "your override of kernel v1.4" / "org-original").
- `apps/web/app/(shell)/wiki/[...slug]/edit/page.tsx` — propose-edit form (creates `WikiPage` override draft via `wiki_propose_edit`).
- `apps/web/components/wiki/WikiPageViewer.tsx`
- `apps/web/components/wiki/WikiPageEditor.tsx`
- `apps/web/components/wiki/WikiCrossRefList.tsx`
- `apps/web/components/wiki/KernelDriftBadge.tsx`
- `apps/web/components/wiki/SourceCitationList.tsx`
- `apps/web/app/api/v1/wiki/route.ts` — GET (list with overlay merge), POST (create override).
- `apps/web/app/api/v1/wiki/[id]/route.ts` — GET (page + revisions), PATCH (new revision).

**Files modified:**
- Header navigation: add `Wiki` link.
- `apps/web/components/product/ProductTabNav.tsx` — add a `Wiki` sub-tab on product pages showing pages anchored via `WikiPageProduct` (renamed from `KnowledgeArticleProduct`) or with product-scoped `WikiPageSource`.

**Acceptance:**
- Two different `Organization`s see distinct wiki content for the same slug after both have proposed edits.
- The kernel-drift badge appears on overrides when the kernel ships a new version that touches the same paragraph.
- API: PATCH cannot mutate `isKernel = true` pages; instead creates an override row.
- Theme-aware styling audit clean per AGENTS.md §12.

---

## Phase 7 — Visual navigation surfaces (per [EP-WIKI-005](../specs/2026-05-09-wiki-visual-navigation-design.md))

**Branch:** `feat/wiki-visual-nav`

Reuses the existing `@xyflow/react` v12 + `elkjs` v0.11.1 toolchain from Phase EA-2 ([2026-03-12-phase-ea2-canvas-design.md](../specs/2026-03-12-phase-ea2-canvas-design.md)). No new viz dependency.

**Files created:**
- `apps/web/components/wiki/WikiContextSidebar.tsx` — Tier 1 in-context sidebar (ranked list, no graph).
- `apps/web/components/wiki/WikiLocalGraph.tsx` — Tier 2 page-local mini-graph (≤30 nodes).
- `apps/web/components/wiki/WikiPageNode.tsx` — custom React Flow node, variant per `pageKind` (`stance ★`, `heuristic ⬤`, `entity ▢`, `decision ◆`, `summary ▭`, `runbook ▬`, `index ◇`).
- `apps/web/components/wiki/WikiCitationBadge.tsx` — source-citation chip on the page-local graph.
- `apps/web/components/wiki/WikiLinkEdge.tsx`, `WikiOverrideEdge.tsx`, `WikiReflectionEdge.tsx` — custom edges (solid / dashed / curly).
- `apps/web/components/wiki/WikiAtlas.tsx` — Tier 3 kernel atlas at `/wiki`, three modes (cluster / table / time-travel).
- `apps/web/components/wiki/WikiAtlasClusterView.tsx`, `WikiAtlasTableView.tsx`, `WikiAtlasTimeTravel.tsx`.
- `apps/web/lib/wiki/subgraph.ts` — `getWikiSubgraph({ organizationId, asOf? })`, shared with the EP-WIKI-004 PPR cache.
- `apps/web/components/wiki/WikiContextSidebar.test.tsx`, `WikiLocalGraph.test.tsx`, `WikiAtlas.test.tsx`.

**Files modified:**
- The right-hand sidebar shell on `/portfolio/product/[id]/*`, `/portfolio/[...slug]/*`, and the agent conversation thread — mount `<WikiContextSidebar />`.
- `apps/web/app/(shell)/wiki/page.tsx` (created in Phase 6 as a wiki list) — replace with the atlas surface; the old list becomes Mode B (table) inside the atlas.
- `apps/web/app/(shell)/wiki/[...slug]/page.tsx` — embed `<WikiLocalGraph />` above-the-fold.

**Acceptance:**
- Tier 1 returns top 5–7 PPR-weighted pages with stance/heuristic chips elevated; mounted on the three target route shells.
- Tier 2 renders ≤30 nodes regardless of true neighbor count; "+N more" links into Tier 3 search.
- Tier 3 cluster mode groups by `pageKind`; table mode is sortable; time-travel slider re-queries with the EP-WIKI-002 `asOf` parameter once that epic ships (until then, slider is hidden).
- Search highlights matched nodes with the PPR halo; non-matched dim to 30%.
- Tenant-size progressive disclosure: < 50 pages = full graph; 50–500 = collapsed clusters; 500–2000 = table default; > 2000 = `mrtree` layout.
- Mobile: Tier 1 collapses to footer tab; Tier 2 collapses to in/out-link lists; Tier 3 desktop-only with notice.
- Theme-aware tokens per AGENTS.md §12; color-blind-safe encoding (kernel/overlay never distinguished by color alone).
- Build gate green per §Build Gate above; React Flow + elkjs added to no new package — confirm `pnpm install` no-op.

**Depends on:** Phase 1 (data model), Phase 6 (basic wiki UI). Optional dependencies: EP-WIKI-002 (time-travel slider becomes useful), EP-WIKI-004 (PPR-weighted seeding for Tier 1 and search halo). Phase 7 ships behind feature flags `wiki.contextSidebar`, `wiki.localGraph`, `wiki.atlas` so each tier can roll out independently.

---

## End-to-End Verification (after Phase 7)

1. **Migration apply**: `pnpm --filter @dpf/db exec prisma migrate dev` against fresh + existing DBs; both clean.
2. **Seed**: `pnpm --filter @dpf/db exec tsx packages/db/src/seed.ts` produces kernel rows + Qdrant points; `manifest.json` counts match DB.
3. **Build gate**: `pnpm --filter web typecheck` and `cd apps/web && npx next build` clean.
4. **Tests**: per-phase test suites green.
5. **MCP tool exercise**: from a coworker chat, call `wiki_query` for a kernel concept and verify a kernel page returns; call `wiki_propose_edit` against the same slug, approve the override, re-query and verify the override masks the kernel; call `wiki_ingest` on a sample source and verify the draft revision + `WikiIngestEvent`.
6. **Lint**: trigger the scheduled job manually; verify each detector produces its expected finding on the seeded fixture; verify findings page renders with theme tokens.
7. **Per-tenant isolation**: simulate two `Organization`s; verify `/wiki/<slug>` returns each org's overlay or kernel fallback correctly; verify Qdrant `organizationId` filter prevents cross-tenant leak.
8. **Prompt assembly**: in Network tab, capture a coworker chat system prompt and confirm the Block 5 wiki context is present below the dynamic boundary.

---

## Critical Files (referenced by multiple phases)

- `packages/db/prisma/schema.prisma`
- `packages/db/src/qdrant.ts`
- `packages/db/src/seed.ts`, `seed-skills.ts` (template)
- `apps/web/lib/inference/semantic-memory.ts` (pattern reference for `recallRelevantContext`)
- `apps/web/lib/tak/prompt-assembler.ts`
- `apps/web/lib/tak/route-context-map.ts`
- `apps/web/lib/mcp-tools.ts`
- `apps/web/lib/tak/agent-grants.ts`
- `apps/web/lib/queue/functions/infra-prune.ts` (template for `wiki-lint.ts`)
- `skills/portfolio/find-knowledge.skill.md` (skill pattern + update target)
