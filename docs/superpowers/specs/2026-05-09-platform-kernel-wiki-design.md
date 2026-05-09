# EP-WIKI-001: Platform Kernel Wiki + Per-Org Overlay

| Field | Value |
|-------|-------|
| **Epic** | EP-WIKI-001 |
| **IT4IT Alignment** | Cross-cutting; primarily Evaluate (capture decisions and stances), Explore (research synthesis), Consume (self-service judgment lookup) |
| **Depends On** | EP-KM-001 (Knowledge Management — implemented), EP-MEMORY-001 (Semantic Memory infrastructure — implemented) |
| **Predecessor Specs** | Shared Memory Vector DB (2026-03-17), Knowledge Management (2026-04-02), Discovery Fingerprint Contribution Pipeline (2026-04-25) |
| **Status** | Draft |
| **Created** | 2026-05-09 |
| **Author** | Mark Bodman (founder) + Claude (design partner) |
| **Inspiration** | Andrej Karpathy, *On LLM-maintained wikis* (<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>) |

---

## 1. Problem Statement

DPF runs old-style RAG over flat documents today. Two Qdrant collections (`agent-memory`, `platform-knowledge`) are searched per query and forgotten. There is no synthesis layer, no cross-referencing, no contradiction detection. Mark's research at The Open Group, his LinkedIn writing, and the specs that shaped DPF live in an external custom GPT with attached PDFs — outside the platform itself.

People who use DPF are already asking "what would Mark do?" The platform's heart should be a **judgment lens**, not a search index. Customers who adopt DPF should be able to start from "what would Mark do?" and evolve toward "what would *our founder* do?" as their own thinking compounds on top.

### 1.1 Specific Problems

| Problem | Impact |
|---------|--------|
| **No accumulating understanding** | Each chat starts cold; recurrent decisions get re-derived. Insight earned in one session is not available in the next. |
| **Source drift goes unnoticed** | A LinkedIn article and an Open Group paper that contradict each other both rank high in retrieval; no reconciliation. |
| **Founder voice is not the kernel** | DPF's reference materials are corpus items, not the schema. Agents treat Mark's framework alongside arbitrary text. |
| **No multi-tenant story for synthesized knowledge** | A customer organization has nowhere to layer its own reasoning on top of DPF's published thinking — it can either fork the kernel or start blank. |

### 1.2 The Karpathy Premise

Karpathy's gist proposes that LLMs incrementally build and maintain a **persistent wiki** instead of running stateless RAG. Three layers — raw sources (immutable), the wiki (LLM-maintained markdown with entity pages and cross-references), and a schema document (CLAUDE.md-equivalent) defining structure. Three operations — ingest, query, lint. The maintenance burden that kills human wikis is near-zero for an LLM running on a schedule.

This design applies that pattern to a multi-tenant SaaS: the kernel ships in the repository, each org overlays it.

### 1.3 What This Is NOT

- **Not a replacement for `KnowledgeArticle`** (EP-KM-001). That stays the org-authored, persona-anchored corpus. Wiki pages bridge to it via `linkedArticleId` so existing curated articles surface as wiki pages without duplication.
- **Not a replacement for conversation memory** (EP-MEMORY-001). Wiki content is declarative; memory is episodic.
- **Not a chat product.** The wiki is consumed by agents at prompt-assembly time and by humans through a browse/edit UI.

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| P1 | **Compounding artifact, not retrieval index** | The wiki is the artifact; raw sources are the receipts. Each ingest updates pages instead of re-deriving on every query. |
| P2 | **Judgment kernel** | `stance` ("Mark's view on X") and `heuristic` ("when to split a portfolio vs a product") are first-class page kinds, not buried inside summaries. This is the "what would Mark do?" surface. |
| P3 | **Two-layer overlay with explicit lineage** | Kernel pages and per-org overrides are physically separate rows joined by `kernelPageId` + `derivedFromKernelVersion`. Kernel upgrades cleanly; drift is a first-class lint signal. |
| P4 | **Source-cite enforcement** | Every published page cites at least one `RawSource`. Lint blocks publish if `WikiPageSource[]` is empty or if any `[[link]]` is dangling. |
| P5 | **Schema-grounded ingest** | The LLM slots claims into a canonical entity registry defined in `SCHEMA.md`. New entities require an explicit `propose_new` step. |
| P6 | **Reuse, don't duplicate** | Bridge `WikiPage.linkedArticleId → KnowledgeArticle`. Add `RawSource` as a standalone primitive rather than overload `EvidenceSource` (which is FK-bound to `EvidenceBundle` for deliberation). |

---

## 3. Architecture

### 3.1 Three Layers (Karpathy → DPF mapping)

| Karpathy layer | DPF realization |
|----------------|-----------------|
| **Raw sources** (immutable) | New `RawSource` model. Markdown abstracts + locators under `docs/founder-kernel/raw-sources/` (kernel) or per-org uploads (overlay). |
| **The wiki** (LLM-maintained pages) | New `WikiPage` + `WikiPageRevision` + `WikiPageLink` + `WikiPageSource` models. Markdown source for kernel under `docs/founder-kernel/wiki/`; DB-only for org overlays. |
| **The schema** (CLAUDE.md-equivalent) | `docs/founder-kernel/SCHEMA.md` — page-kind contract, canonical entity registry, cross-link rules, edit policy, lint rules, versioning. Loaded into prompt assembly (excerpt) and lint job (full). |

### 3.2 Storage Layering

Follows the existing DPF pattern (Postgres authoritative + Neo4j as read-only projection). Do not invent a new pattern.

| Layer | Role | Why |
|-------|------|-----|
| **Markdown on disk** (`docs/founder-kernel/`) | Kernel source of truth. Git-tracked, human-editable, ships in repo, seeded into Postgres on install. | Karpathy's premise. Portable, reviewable on GitHub, version-controlled. Founder content stays auditable in plain text. |
| **Postgres** (`WikiPage` and friends) | Runtime model. Multi-tenant rows, revisions, overlays, kernel-vs-org separation, lint findings. | Multi-tenant overlay needs row-level scoping (`organizationId`, `kernelPageId`, `derivedFromKernelVersion`) that the filesystem cannot express. |
| **Qdrant** (`wiki-pages`) | Semantic index. Two-pass overlay-aware retrieval. | Already the DPF pattern for `KnowledgeArticle`. Per-tenant filtered by `organizationId` payload. |
| **Neo4j** (V2 follow-up) | Optional projection for graph-shaped queries: multi-hop traversals like "all stance pages two hops from this entity" or "all overrides of pages citing this paper." | DPF already projects `DigitalProduct`/`InfraCI` read-only into Neo4j. Same pattern. Defer to a follow-up spec; V1 retrieval works without it. When added, kernel and org become `:Kernel` / `:Org {orgId}` node-sets joined by `-[:OVERRIDES]->` edges. |

### 3.3 Two-Layer Overlay

- **Kernel rows**: `organizationId = NULL`, `isKernel = true`, `kernelVersion = <semver from manifest.json>`. Seeded from `docs/founder-kernel/` via `seed-wiki-kernel.ts` (mirrors `seed-skills.ts`/`seed-prompt-templates.ts`).
- **Org rows**: `organizationId = <orgId>`, optional `kernelPageId` and `derivedFromKernelVersion` for overrides; nullable `kernelPageId` for org-original pages.
- **Overlay key**: `(organizationId, slug)` unique. Retrieval: org-scoped first → kernel fallback → orphan signal.
- **Drift detection**: kernel paragraph-hash diff vs override's `derivedFromKernelVersion` produces `WikiLintFinding(kind="kernel-drift")`.

"Override" is represented as a revision chain on a separate org-scoped row, not as a flag on the kernel row. This mirrors `PromptTemplate.isOverridden` but goes further: kernel and override are physically separate rows joined by `kernelPageId`, so kernel upgrades reapply cleanly via re-seed without clobbering org work.

### 3.4 Ingest Methodology — Picking Salient Points

Schema-grounded, not free-form. The LLM does not invent structure; it slots claims into the canonical entity registry.

1. **Pass 1 — utility-tier abstract.** Reuse the `KnowledgeArticle.abstract` pipeline. Produces a 1–3 paragraph summary.
2. **Pass 2 — reasoning-tier claim extraction.** Prompt shows the LLM the `SCHEMA.md` + existing slugs. Output:
   ```
   { claim, target_slug, page_kind, confidence, supporting_excerpt }
   ```
   `target_slug` must resolve to an existing page or carry a `propose_new: true` flag with rationale.
3. **Pass 3 — stance/heuristic extraction (judgment kernel).** Separate prompt: "Where does the author take a position? Recommend a tradeoff? Formalize a rule of thumb?" These become `stance` and `heuristic` pages — never buried inside `summary` pages. Lint flags summary pages with no extracted stance and asks the agent to extract one.
4. **Diff proposal per target page.** Markdown patch (≤30% of page; larger requires human approval) plus new-page proposals plus cross-link additions.
5. **Proposal → review → commit.** Agent invocations write through `executionMode: "proposal"` (existing DPF pattern). Lint blocks publish if `WikiPageSource[]` is empty or if any `[[...]]` is dangling. Kernel pages are PR-only — never written by the runtime.

### 3.5 How the Graph Forms and Evolves

Each ingest reads existing pages first, so new content is structured against what already exists; cross-references emerge naturally instead of being retrofitted. New entity pages appear only via an explicit propose-new step against `SCHEMA.md`. Lint is the steady-state evolution loop — contradictions, stale claims, orphans, missing cross-refs, kernel-drift, and stance-extraction-needed findings each propose a structural change for human approval. The compounding works because the bookkeeping that kills human wikis is near-zero for an LLM running on a schedule.

### 3.6 Three Operations

**Ingest** (`apps/web/lib/wiki/ingest.ts`) — CLI (`pnpm --filter web wiki:ingest`), admin UI (`/admin/wiki/ingest`), agent skill (`skills/platform/wiki-ingest.skill.md`), MCP tool `wiki_ingest`. Flow per §3.4.

**Query** — two paths:

- *Passive context injection (the main path)*: `recallWikiContext({ query, organizationId, routeContext, limit })` runs at message time; output passed into a new `wikiContext: string | null` field on `PromptInput`; renders in Block 5 (Domain context) of `assembleSystemPrompt()` in `apps/web/lib/tak/prompt-assembler.ts`.
- *Explicit synthesis*: MCP tool `wiki_query` returns top-K pages + synthesized answer, optionally files the answer back as a draft `WikiPage` (`fileBackAs: { slug, pageKind }`) — Karpathy's "every query optionally becomes a new page."

**Lint** (`apps/web/lib/queue/functions/wiki-lint.ts`, Inngest scheduled daily, mirrors `infra-prune.ts`). Checkers per §6.

---

## 4. Data Model

### 4.1 New Prisma Models

```prisma
model RawSource {
  id              String   @id @default(cuid())
  sourceKey       String   @unique
  sourceType      String   // paper | article | spec | doc | framework | external-url
  title           String
  authors         String[] @default([])
  publishedAt     DateTime?
  url             String?
  doi             String?
  locator         Json?
  abstract        String?  @db.Text
  excerpt         String?  @db.Text
  fullTextPath    String?
  license         String?
  retrievedAt     DateTime?
  isKernel        Boolean  @default(false)
  organizationId  String?
  organization    Organization? @relation(fields: [organizationId], references: [id])
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
  pageSources     WikiPageSource[]

  @@index([sourceType])
  @@index([isKernel])
  @@index([organizationId])
}

model WikiPage {
  id                       String   @id @default(cuid())
  slug                     String
  title                    String
  body                     String   @db.Text
  pageKind                 String   // entity | summary | decision | runbook | index | stance | heuristic
  status                   String   @default("draft") // draft | published | review-needed | archived
  isKernel                 Boolean  @default(false)
  kernelVersion            String?
  organizationId           String?
  organization             Organization? @relation(fields: [organizationId], references: [id])
  kernelPageId             String?
  kernelPage               WikiPage? @relation("WikiPageOverride", fields: [kernelPageId], references: [id])
  overrides                WikiPage[] @relation("WikiPageOverride")
  derivedFromKernelVersion String?
  linkedArticleId          String?
  linkedArticle            KnowledgeArticle? @relation(fields: [linkedArticleId], references: [id])
  abstract                 String?
  lastReviewedAt           DateTime?
  createdAt                DateTime @default(now())
  updatedAt                DateTime @updatedAt
  revisions                WikiPageRevision[]
  outLinks                 WikiPageLink[] @relation("WikiOutLinks")
  inLinks                  WikiPageLink[] @relation("WikiInLinks")
  sources                  WikiPageSource[]

  @@unique([organizationId, slug])
  @@index([slug])
  @@index([pageKind])
  @@index([status])
  @@index([kernelPageId])
}

model WikiPageRevision {
  id               String   @id @default(cuid())
  pageId           String
  version          Int
  title            String
  body             String   @db.Text
  changeSummary    String?
  changeKind       String   // ingest | manual | lint-fix | kernel-merge
  createdAt        DateTime @default(now())
  createdById      String?
  createdByAgentId String?
  page             WikiPage @relation(fields: [pageId], references: [id], onDelete: Cascade)

  @@unique([pageId, version])
  @@index([pageId])
}

model WikiPageLink {
  fromPageId String
  toPageId   String
  fromPage   WikiPage @relation("WikiOutLinks", fields: [fromPageId], references: [id], onDelete: Cascade)
  toPage     WikiPage @relation("WikiInLinks",  fields: [toPageId],   references: [id], onDelete: Cascade)

  @@id([fromPageId, toPageId])
  @@index([toPageId])
}

model WikiPageSource {
  pageId   String
  sourceId String
  page     WikiPage  @relation(fields: [pageId],   references: [id], onDelete: Cascade)
  source   RawSource @relation(fields: [sourceId], references: [id], onDelete: Cascade)

  @@id([pageId, sourceId])
}

model WikiIngestEvent {
  id             String   @id @default(cuid())
  organizationId String?
  sourceId       String
  touchedPageIds String[]
  agentId        String?
  userId         String?
  kernelVersion  String?
  createdAt      DateTime @default(now())

  @@index([sourceId])
  @@index([organizationId])
}

model WikiLintFinding {
  id             String   @id @default(cuid())
  organizationId String?
  pageId         String
  findingKind    String   // contradiction | stale | orphan | missing-xref | dangling-xref | kernel-drift | stance-extraction-needed
  detail         Json
  severity       String   @default("info") // info | warn | error
  status         String   @default("open") // open | resolved | ignored
  resolvedAt     DateTime?
  createdAt      DateTime @default(now())

  @@index([organizationId])
  @@index([status])
  @@index([findingKind])
}
```

### 4.2 Relations Added to Existing Models

- `Organization`: `wikiPages WikiPage[]`, `wikiRawSources RawSource[]`.
- `KnowledgeArticle`: `wikiPages WikiPage[]` (bridge via `linkedArticleId`).

### 4.3 Why Not Extend Existing Models

- **Not `KnowledgeArticle`.** Product/portfolio-anchored with persona/audience semantics. Wiki pages are entity- or topic-anchored, follow the SCHEMA contract, and need `kernelPageId` ancestry plus stricter lint. Bridge via `linkedArticleId` instead.
- **Not `EvidenceSource`.** FK-bound to `EvidenceBundle` (deliberation runs). Forcing every kernel paper into a deliberation bundle is semantically wrong. `RawSource` is the standalone primitive.

---

## 5. Embedding Strategy

- New Qdrant collection `wiki-pages` (768-dim cosine; siblings to `agent-memory` and `platform-knowledge`).
- Payload indexes (keyword): `entityType`, `slug`, `pageKind`, `status`, `isKernel`, `organizationId`, `kernelVersion`, `kernelPageId`. The `organizationId` index is load-bearing for per-tenant filtering.
- Embed `abstract + "\n\n" + body`, truncated at 8000 chars. Mirrors `storeKnowledgeArticle()`.
- Two-pass overlay-aware retrieval (`searchWikiPages`): org-scoped first, kernel fallback excluding any `kernelPageId` already returned by pass A.
- Ship precomputed kernel embeddings as `docs/founder-kernel/embeddings.jsonl` so installs don't re-embed. `manifest.json` carries `embeddingModel` for compatibility check; falls back to live embed on mismatch.

---

## 6. Lint Contract

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

The `stance-extraction-needed` check exists because the kernel's purpose is judgment, not summarization. Summary-only pages defeat the "what would Mark do?" goal.

---

## 7. Prompt Assembly Integration

- Extend `PromptInput` (in `apps/web/lib/tak/prompt-assembler.ts`) with `wikiContext: string | null`.
- Render in Block 5 (Domain context), below the dynamic boundary marker, above `Available domain tools`.
- Caller (the assembler invoker) calls `recallWikiContext({ query, organizationId, routeContext, limit: 4 })` at message time, mirrors how `recallRelevantContext()` is called today.
- New `prompts/platform-identity/wiki-preamble.prompt.md` (DB-overridable) provides a 1–2 line preamble: "This platform maintains a structured wiki. When a user asks about a DPF concept, prefer the wiki excerpt below to web speculation."
- Cache implications: dynamic block; no impact on static prefix caching.

---

## 8. MCP Tool Surface

Added in `apps/web/lib/mcp-tools.ts` with `TOOL_TO_GRANTS` entries in `apps/web/lib/tak/agent-grants.ts`.

| Tool | Mode | Grants |
|------|------|--------|
| `wiki_query` | immediate (read) / proposal (with `fileBackAs`) | `registry_read` / `+registry_write` |
| `wiki_ingest` | proposal | `registry_write` |
| `wiki_lint` | immediate, read-only | `registry_read` |
| `wiki_propose_edit` | proposal | `registry_write` |

Add `wiki_query` to every route's `domainTools` in `apps/web/lib/tak/route-context-map.ts`, ranked above `search_knowledge_base`. Update `skills/portfolio/find-knowledge.skill.md` to call `wiki_query` first → `search_knowledge_base` → `search_knowledge`.

Why split into four tools rather than one: each operation has different latency, side-effects, and approval semantics. Conflating produces an opaque tool the agent reaches for at the wrong times.

---

## 9. Per-Org Isolation

- All retrieval helpers take `organizationId` (resolved from the requesting user's `Organization` per AGENTS.md §11).
- Qdrant `organizationId` payload filter is the enforcement point in vector retrieval.
- Postgres queries on `WikiPage` are gated by `WHERE organizationId IN (NULL, <orgId>)`.
- Lint findings carry `organizationId`; admin UI filters accordingly.
- Governance fingerprint applies to conversation memory only (consequential actions); wiki pages are declarative and not user-scoped.

---

## 10. Founder Kernel Layout

```
docs/founder-kernel/
  SCHEMA.md                      # the wiki's CLAUDE.md
  RAW-SOURCES-LICENSE.md         # per-source licensing rationale
  manifest.json                  # { kernelVersion, schemaVersion, pageCount, sourceCount, embeddingModel, builtAt }
  embeddings.jsonl               # precomputed kernel embeddings (added in Phase 5)
  changelog.md                   # kernel version log; consumed by drift check
  raw-sources/
    papers/      *.md            # abstract + URL + DOI + short fair-use excerpts only
    articles/    *.md            # LinkedIn articles (Mark's own work) — abstract + canonical URL
    specs/       *.md            # pointers to OpenGroup IT4IT, CSDM where redistribution is restricted
    frameworks/  *.md            # diversity-of-thought etc.
  wiki/
    index.md                     # auto-regenerated
    entities/    *.md            # Digital Product, Portfolio, Value Stream, EA Reference Model, etc.
    stances/     *.md            # "Mark's view on X" — judgment-kernel pages
    heuristics/  *.md            # "When to split a portfolio vs a product" etc.
    decisions/   DEC-*.md
    summaries/   *.md
    runbooks/    *.md
```

Choice of `docs/founder-kernel/` (not `data/`): it is documentation-shaped (markdown a maintainer reads on GitHub), parallels the existing `docs/Reference/` area where founder source material already lives, and benefits from the existing GitHub Pages config under `docs/`.

---

## 11. Migration & Coexistence with `KnowledgeArticle`

- `KnowledgeArticle` stays the org-authored corpus searched via `search_knowledge_base`.
- One-time admin-triggered backfill scans `KnowledgeArticle` and offers to create matching `WikiPage` rows with `linkedArticleId` set, slug derived from `KA-001` → `summaries/<slug>`, `pageKind = "summary"`.
- Agent skill `find-knowledge.skill.md` waterfall updated: `wiki_query` → `search_knowledge_base` → `search_knowledge`.
- Knowledge UI (`/portfolio/product/[id]/knowledge`) gets a "Wiki" sub-tab listing wiki pages where `linkedArticleId` matches the product's KAs or where `WikiPageSource → KnowledgeArticleProduct` chain matches.

---

## 12. Research & Benchmarking (per AGENTS.md §10)

| Project | Type | Pattern adopted | Pattern rejected |
|---------|------|-----------------|------------------|
| **Obsidian + Dataview/Templater** | OSS | `[[wikilink]]` syntax; file-as-page primitive; plugin-driven derived views. | Plugin-as-extension model — DPF runs server-side; we represent extensibility as Prisma rows. |
| **Quartz** (static-site generator for Obsidian) | OSS | "Kernel ships as static markdown plus an embeddings sidecar." | Static-site-only output — DPF needs live retrieval and overlay merging. |
| **Letta / MemGPT** | OSS | Hierarchical memory tiers; "the agent runs the lint/ingest, not just retrieves." | Single-tenant memory blocks — DPF needs per-org overlay isolation. |
| **LangChain agentic flows / LlamaIndex Property Graphs** | OSS | Entity-extraction + entity-page idea; citation-anchored answers. | Property-graph node/edge primitive — we already have Postgres + Neo4j; entities stay as wiki pages, not graph nodes. |
| **Glean** | Commercial | Per-tenant knowledge graph with org-scoped retrieval; RBAC-aware search. | Closed-source connector zoo. |
| **Mem (Mem.ai)** | Commercial | "Self-organizing notes" auto-link and cluster. We adopt the auto-linking but constrain it through `SCHEMA.md`. | Free-form linking — produces drift the linter then has to chase. |
| **Notion AI / Confluence + AI** | Commercial | Inline LLM Q&A over wiki content (Block 5 injection). | "Answer in chat, never write back" — the file-back loop is Karpathy's whole point. |

**Anti-patterns explicitly avoided:**

- Stateless RAG over PDFs at every query (today's `/docs/Reference/*.pdf` story).
- Auto-summary-only artifacts no human can edit (Mem-style).
- Implicit overlay (Confluence "spaces" without kernel inheritance lineage).

**Gap this design fills:** no prior art combines (a) a bundled "founder kernel" shipped with the platform, (b) per-tenant overlay with explicit drift detection, and (c) agent-driven ingest/query/lint as MCP tools wired into a multi-tenant SaaS schema. That triple is the contribution of EP-WIKI-001.

---

## 13. Risks & Mitigations

**IP / licensing for bundled content.** Repo is Apache-2.0. OpenGroup specs and LinkedIn ToS restrict redistribution.

- Bundle abstracts + locators only. No full third-party text.
- Short fair-use excerpts (≤200 words, attributed) only where the source is essential.
- Mark's own original work (LinkedIn articles, papers he holds copyright on, DPF specs) bundles fully under Apache-2.0 with explicit license affirmation in `docs/founder-kernel/RAW-SOURCES-LICENSE.md` and `ACKNOWLEDGMENTS.md`.
- Non-redistributable sources are fetched at install time (admin opt-in) via existing `fetch_public_website` and stored as per-org `RawSource` (`isKernel = false`) at the customer's licensing risk.

**LLM rewriting drift / hallucinated cross-refs.**

- `WikiPageSource` rows required for `status="published"` (lint blocks publish if empty).
- `detectDanglingXrefs` blocks revisions with unresolved `[[...]]`.
- Ingest revisions can replace ≤30% of a page; larger rewrites require human approval.
- Kernel pages are PR-only, never written by the runtime.

**Kernel ↔ overlay drift.** Paragraph-hash diff produces `kernel-drift` findings; `KernelDriftBadge` surfaces on the page; future `wiki_resolve_drift` tool drafts a 3-way merge.

**Embedding cost / nondeterminism.** Ship `embeddings.jsonl` sidecar; seed loads directly when `embeddingModel` matches install config; falls back to live embed otherwise.

---

## 14. Out of Scope (follow-up specs)

- `wiki_resolve_drift` 3-way merge tool.
- Neo4j projection of `WikiPage` / `RawSource` for graph traversal — same pattern as today's `DigitalProduct` projection. Add when a query pattern emerges that Postgres + Qdrant cannot answer cleanly.
- Promotion of `wiki_query` answers into `KnowledgeArticle` rows.
- Search-rank tuning across `wiki-pages` + `platform-knowledge` + `agent-memory`.
