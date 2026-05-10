# EP-WIKI-001: Platform Kernel Wiki + Per-Org Overlay

| Field | Value |
|-------|-------|
| **Epic** | EP-WIKI-001 |
| **IT4IT Alignment** | Cross-cutting; primarily Evaluate (capture decisions and stances), Explore (research synthesis), Consume (self-service judgment lookup) |
| **Depends On** | [EP-MEMORY-001 — Shared Memory Vector DB (2026-03-17, implemented)](2026-03-17-shared-memory-vector-db-design.md), [EP-TAK-3F9A21 — TAK/GAID Auth+Identity+Memory Refresh (2026-04-25, drafted; defines the five-class governed memory model and reviews open-brain/personal-wiki applicability)](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md) |
| **Absorbs** | [EP-KM-001 — Knowledge Management (2026-04-02, drafted but `KnowledgeArticle` was never populated; the wiki page model in §4 is the merged successor)](2026-04-02-knowledge-management-design.md) |
| **Predecessor Specs** | [Shared Memory Vector DB (2026-03-17)](2026-03-17-shared-memory-vector-db-design.md), [Knowledge-Driven Agent Capabilities (2026-03-18)](2026-03-18-knowledge-driven-agent-capabilities-design.md), [Knowledge Management (2026-04-02)](2026-04-02-knowledge-management-design.md), [TAK/GAID Auth+Identity+Memory Refresh (2026-04-25)](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md) |
| **Follow-up Specs** | [EP-WIKI-002 — Bi-Temporal Revisions and Edge Invalidation](2026-05-09-wiki-bi-temporal-revisions-design.md), [EP-WIKI-003 — Importance Scoring and Reflection-Triggered Derivation](2026-05-09-wiki-importance-and-reflection-design.md), [EP-WIKI-004 — Personalized PageRank Retrieval](2026-05-09-wiki-ppr-retrieval-design.md), [EP-WIKI-005 — Visual Navigation of the Kernel Wiki](2026-05-09-wiki-visual-navigation-design.md) |
| **Status** | Draft |
| **Created** | 2026-05-09 |
| **Author** | Mark Bodman (founder) + Claude (design partner) |
| **Inspiration** | Andrej Karpathy, *On LLM-maintained wikis* (<https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f>) |

---

## 0. Relationship to Existing Memory Infrastructure

This spec was first drafted without full reconciliation against four prior specs that govern memory in DPF. The sections that follow have been adjusted to fit them; this section names the constraints up front.

### 0.1 Five-class governed memory model (TAK/GAID 2026-04-25)

EP-TAK-3F9A21 defined a five-class taxonomy that all DPF memory now lives under:

| Class | Role |
|-------|------|
| `core` | Identity-spine memory; system / supervisor write only. **Agent-self-edit is prohibited at production tier (TAK §12.1).** |
| `user_fact` | Structured per-principal facts; supersession-driven; today populated via `UserFact`. |
| `semantic_recall` | Episodic conversation memory; today the `agent-memory` Qdrant collection via `recallRelevantContext()`. Always advisory. |
| `archival_knowledge` | Curated organizational knowledge with freshness gates. The wiki proposed here **classifies as `archival_knowledge`** and inherits its policy posture. |
| `audit_evidence` | Decision logs, receipts, fingerprints. Never used for prompt injection. |

The five-class model also reviewed Letta, mem0/OpenMemory, Anthropic memory blocks, and Logseq/Obsidian/SiliconBrain-style "open brain" personal wikis, and decided: **personal-wiki is an optional knowledge layer, not the runtime control plane** (TAK rules, immutable directives, and `AgentGovernanceProfile` remain the authoritative control plane). EP-WIKI-001 lives inside that frame — it is a knowledge layer, not a policy layer.

### 0.2 Vector storage is Qdrant, not pgvector

EP-MEMORY-001 (implemented) defines two Qdrant collections — `agent-memory` and `platform-knowledge` — embedded with `nomic-embed-text` (768-dim, Ollama). The `wiki-pages` collection introduced in §5 is a **third sibling** in the same Qdrant deployment, not a new substrate. Where this spec previously could be read to imply pgvector or a parallel index, treat it as Qdrant throughout.

The `platform-knowledge` collection already carries `entityType: "knowledge-article"` points from EP-KM-001's design. After the merge described in §11, those points re-emerge as `entityType: "wiki-page"` in the new `wiki-pages` collection.

### 0.3 KnowledgeArticle is being absorbed, not bridged

EP-KM-001 specified a `KnowledgeArticle` Prisma model with revisions, product/portfolio anchoring, IT4IT value-stream tags, and Qdrant indexing. The model was never populated in production — its IT4IT framing was too narrow for general-purpose use. This spec **absorbs `KnowledgeArticle`** rather than coexisting with it. §4 documents the merged shape; §11 documents the migration. The previous draft's `linkedArticleId` bridge field is removed accordingly.

### 0.4 Self-edit prohibition shapes the ingest design

TAK §12.1 prohibits agent-self-edited `core` memory at production tier. EP-WIKI-001's ingest pipeline already routes every wiki write through `executionMode: "proposal"` with HITL approval (§3.4 step 5; §13 risks), and kernel pages are PR-only. That posture is what makes this spec compliant with TAK §12.1 by construction. Any future change that lets the agent commit wiki writes without human approval would have to clear that bar explicitly.

### 0.5 Freshness gates are first-class, not lint-only

TAK §12.5 introduced `validation_state ∈ {current, stale, advisory, advisory_until_revalidated}` for retrieval-time freshness checks, and a deny-with-reason `archival_overdue_for_consequential_action`. The lint contract in §6 detects staleness; the **runtime freshness gate is enforced at retrieval time** (TAK §12.5 path), not at lint time. EP-WIKI-002 (bi-temporal revisions) generalizes the system-time projection that drives these gates.

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

- **Not a replacement for conversation memory** ([EP-MEMORY-001](2026-03-17-shared-memory-vector-db-design.md)). Wiki content is declarative `archival_knowledge`; conversation memory is episodic `semantic_recall` (per the five-class model in §0.1). Both remain.
- **Not the runtime control plane.** TAK rules, immutable directives, and `AgentGovernanceProfile` stay authoritative. The wiki is a knowledge layer, not a policy layer.
- **Not a chat product.** The wiki is consumed by agents at prompt-assembly time and by humans through a browse/edit UI.

(The previous draft listed "not a replacement for `KnowledgeArticle`." After review of [EP-KM-001](2026-04-02-knowledge-management-design.md) and confirmation that the `KnowledgeArticle` table was never populated, this spec **does** absorb that model — see §0.3 and §11.)

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
| **The wiki** (LLM-maintained pages) | `WikiPage` + `WikiPageRevision` + `WikiPageLink` + `WikiPageSource` models. `WikiPage` is the merged successor of `KnowledgeArticle` (see §0.3 and §11) — table rename + additive columns, not a parallel model. Markdown source for kernel under `docs/founder-kernel/wiki/`; DB-only for org overlays. |
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
5. **Proposal → review → commit.** Agent invocations write through `executionMode: "proposal"` (existing DPF pattern). Lint blocks publish if `WikiPageSource[]` is empty or if any `[[...]]` is dangling. Kernel pages are PR-only — never written by the runtime. This proposal-only posture is what keeps EP-WIKI-001 compliant with [TAK §12.1](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md)'s prohibition on agent-self-edited `core` memory; see §0.4.

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

### 4.1 Prisma Models

The block below shows the wiki-shaped fields. Per §0.3 and §11, `WikiPage` is the **merged successor of `KnowledgeArticle`** — the existing fields on `KnowledgeArticle` (`category`, `valueStreams`, `tags`, `reviewIntervalDays`, `lastReviewedAt`, plus the `KnowledgeArticleProduct` / `KnowledgeArticlePortfolio` join tables) are preserved as **optional** fields on the merged model and not re-shown here. Migration is a `RENAME TABLE` plus additive columns; full merged Prisma schema is documented in the Phase 1 implementation spec.

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
- The previous draft added a `wikiPages` reverse relation to `KnowledgeArticle`. After the merge described in §0.3 and §11, that relation is dropped — `WikiPage` *is* the merged model.

### 4.3 Why This Shape

- **`WikiPage` absorbs `KnowledgeArticle`** rather than running parallel to it. The product/portfolio/persona/IT4IT-value-stream fields from [EP-KM-001](2026-04-02-knowledge-management-design.md) are preserved as optional on the merged model — they're useful for tagging but not required, since the founder kernel is general-purpose, not ITIL-shaped. Migration is in §11.
- **Not `EvidenceSource`.** That model is FK-bound to `EvidenceBundle` (deliberation runs). Forcing every kernel paper into a deliberation bundle is semantically wrong. `RawSource` is the standalone primitive.

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

**Lint vs runtime freshness gate.** The lint job *detects* and surfaces findings; the **runtime freshness gate** (per [TAK §12.5](2026-04-25-tak-gaid-auth-identity-memory-refresh-design.md), see §0.5) is enforced at retrieval time, not at lint time. A wiki page used to back a consequential action evaluates `validation_state ∈ {current, stale, advisory, advisory_until_revalidated}` per the TAK contract and may trigger the deny-with-reason `archival_overdue_for_consequential_action`. Lint produces the underlying signals (`stale`, `kernel-drift`, etc.); the gate is the policy that consumes them.

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

## 11. Migration: `KnowledgeArticle` → `WikiPage`

Per §0.3, [EP-KM-001](2026-04-02-knowledge-management-design.md) was drafted but the `KnowledgeArticle` table was never populated in production. This spec absorbs it. The migration is therefore additive in shape, not destructive:

1. **Rename** `KnowledgeArticle` to `WikiPage` (and `KnowledgeArticleRevision` to `WikiPageRevision`). The IT4IT-flavored join tables `KnowledgeArticleProduct` / `KnowledgeArticlePortfolio` are renamed to `WikiPageProduct` / `WikiPagePortfolio` and remain **optional** anchoring — they tag a wiki page to a product or portfolio when useful but are not required by the wiki contract.
2. **Add** the wiki-shaped columns from §4.1 (`slug`, `pageKind`, `isKernel`, `kernelVersion`, `kernelPageId`, `derivedFromKernelVersion`, `abstract`).
3. **Add** the join tables `WikiPageLink`, `WikiPageSource`, plus `RawSource`, `WikiIngestEvent`, `WikiLintFinding`.
4. **Re-key** the existing Qdrant points from `entityType: "knowledge-article"` in `platform-knowledge` to `entityType: "wiki-page"` in the new `wiki-pages` collection. With zero production rows today, this is a no-op against live data; it's documented so the index pipeline lands cleanly on first install.
5. **Retire** the EP-KM-001-era `search_knowledge_base` MCP tool in favor of `wiki_query` (§8). Existing route-context references are updated in the same PR. The previous "waterfall through three search tools" plan is gone; there is one wiki search tool.
6. **Repoint** the planned `/portfolio/product/[id]/knowledge` UI tab at the merged `WikiPage` model. The persona-banner / value-stream / staleness machinery from EP-KM-001 §6 carries over for products that opt into anchoring.

Implementation note: because `KnowledgeArticle` carries zero production rows, the migration can be a clean rename in one PR rather than a coexistence period. If a deployment is found that did populate the table, the rename becomes additive (add `WikiPage` columns and backfill `slug = lowerKebab(title)`, `pageKind = "summary"`, `isKernel = false`).

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
