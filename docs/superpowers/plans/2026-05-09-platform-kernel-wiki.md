# EP-WIKI-001: Platform Kernel Wiki — Implementation Plan

| Field | Value |
|-------|-------|
| **Epic** | EP-WIKI-001 |
| **Spec** | [2026-05-09-platform-kernel-wiki-design.md](../specs/2026-05-09-platform-kernel-wiki-design.md) |
| **Status** | Phase 0 in progress on `claude/review-rag-implementation-3qLkr` |
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

**Branch:** `feat/wiki-kernel-schema`

**Files modified:**
- `packages/db/prisma/schema.prisma` — add 7 new models (`RawSource`, `WikiPage`, `WikiPageRevision`, `WikiPageLink`, `WikiPageSource`, `WikiIngestEvent`, `WikiLintFinding`); add `wikiPages` / `wikiRawSources` relations on `Organization`; add `wikiPages` relation on `KnowledgeArticle`.
- `packages/db/src/qdrant.ts` — add `WIKI_PAGES` collection constant; ensure new payload indexes (`organizationId`, `slug`, `pageKind`, `kernelPageId`, `kernelVersion`, `isKernel`).
- `packages/db/src/index.ts` — re-export new types/utilities.

**Files created:**
- `packages/db/prisma/migrations/<timestamp>_add_wiki_kernel/migration.sql`
- `packages/db/src/wiki-store.ts` — typed CRUD helpers (`upsertWikiPage`, `appendRevision`, `linkPages`, `attachSource`).
- `packages/db/src/wiki-store.test.ts`

**Run:** `pnpm --filter @dpf/db exec prisma migrate dev --name add-wiki-kernel`.

**Acceptance:**
- Migration applies on a fresh DB and on a DB with prior `KnowledgeArticle` data without data loss.
- Qdrant collection `wiki-pages` exists with the documented payload indexes after `ensureCollections()` + `ensurePayloadIndexes()` run.
- Helpers can round-trip a kernel page and an org override; uniqueness on `(organizationId, slug)` is enforced.

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

**Files created:**
- `apps/web/lib/wiki/lint.ts` — `runWikiLint({ organizationId | null })`, individual checkers (`detectContradictions`, `detectStaleClaims`, `detectOrphans`, `detectMissingXrefs`, `detectDanglingXrefs`, `detectKernelDrift`, `detectStanceExtractionNeeded`).
- `apps/web/lib/wiki/lint.test.ts`
- `apps/web/lib/queue/functions/wiki-lint.ts` — Inngest scheduled function (daily 03:30 local; mirror `infra-prune.ts`).
- `apps/web/app/(shell)/admin/wiki/lint/page.tsx` — list of `WikiLintFinding` filtered by org/kernel + status.
- `apps/web/components/wiki/LintFindingCard.tsx`

**Files modified:**
- `apps/web/lib/queue/functions/index.ts` — register the new function.
- `apps/web/lib/mcp-tools.ts` — add `wiki_lint` (read-only on-demand trigger).
- `apps/web/lib/tak/agent-grants.ts` — `wiki_lint: ["registry_read"]`.

**Acceptance:**
- Each detector produces a finding on its fixture: contradiction between two pages → finding; stale page → finding; orphan → finding; missing-xref → finding; dangling-xref → blocks publish; kernel-drift → finding; summary without stance → finding.
- Daily run completes within 5 minutes for a 1k-page wiki on a single org.
- Findings carry `organizationId` correctly; kernel findings are visible only to platform admins.
- Re-runs are idempotent (no duplicate findings).
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
- `apps/web/components/product/ProductTabNav.tsx` — add a `Wiki` sub-tab on product pages showing pages with `linkedArticleId` matching the product's KAs or with product-scoped `WikiPageSource`.

**Acceptance:**
- Two different `Organization`s see distinct wiki content for the same slug after both have proposed edits.
- The kernel-drift badge appears on overrides when the kernel ships a new version that touches the same paragraph.
- API: PATCH cannot mutate `isKernel = true` pages; instead creates an override row.
- Theme-aware styling audit clean per AGENTS.md §12.

---

## End-to-End Verification (after Phase 6)

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
