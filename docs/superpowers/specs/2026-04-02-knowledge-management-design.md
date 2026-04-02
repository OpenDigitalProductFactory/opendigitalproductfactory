# EP-KM-001: Knowledge Management for Digital Products

| Field | Value |
|-------|-------|
| **Epic** | EP-KM-001 |
| **IT4IT Alignment** | Cross-cutting: Evaluate (capture decisions), Explore (research articles), Integrate/Deploy (runbooks), Operate (troubleshooting), Consume (self-service KB) |
| **Depends On** | Product-Centric Navigation Refactoring (2026-04-02, in design), Knowledge-Driven Agent Capabilities (EP-AGENT-CAP-001, partially implemented), Semantic Memory infrastructure (implemented) |
| **Predecessor Specs** | Portfolio Route Design (2026-03-10, implemented), CSDM 6 Meta-Model (2026-03-21, implemented), Platform Documentation System (EP-DOCS-001, draft), Agentic Architecture Patterns (2026-04-02) |
| **Status** | Draft |
| **Created** | 2026-04-02 |
| **Author** | Mark Bodman (CEO) + Claude (design partner) |

---

## 1. Problem Statement

Organizations accumulate knowledge across HR, finance, technology, and operations domains. This knowledge exists in emails, chat threads, documents, and people's heads. When an employee or AI coworker needs to understand "how do we handle vendor onboarding?" or "what's the approval policy for cloud spend over $10k?", there is no structured place to look.

### 1.1 Specific Problems

| Problem | Impact |
|---------|--------|
| **Knowledge is orphaned** | Articles float in wikis disconnected from the products and processes they describe. Finding the right article requires knowing it exists. |
| **No lifecycle management** | Articles are written once and rot. Nobody knows which are current, which are outdated, which contradict each other. |
| **AI coworkers are knowledge-blind** | The agent can search backlog items and specs but has no access to organizational knowledge (policies, processes, decisions, runbooks). |
| **Discovery requires intent** | Users must actively search. Knowledge should surface contextually — when viewing a product, relevant articles appear. |
| **No authorship accountability** | Both humans and AI should author articles, but there is no model for tracking who wrote what, when, or why. |
| **No audience alignment** | Knowledge written for engineers is served to sales teams; knowledge for finance is lost in technical wikis. The audience context is missing. |

### 1.2 The Portfolio Persona Insight

Each of the four portfolios defines a **consumer persona** — the audience that reads and uses the knowledge:

| Portfolio | Persona | Knowledge Tone & Depth |
|-----------|---------|----------------------|
| **Foundational** | Engineers, architects, platform operators | Technical depth, architecture decisions, runbooks, API references |
| **Manufacturing & Delivery** | Operations managers, production engineers | Process-focused, SLAs, delivery procedures, operational policies |
| **For Employees** | HR managers, people ops, department heads | Policy-focused, employee processes, compliance requirements, onboarding guides |
| **Products & Services Sold** | Product managers, sales, customer success | Business-focused, pricing decisions, market positioning, customer-facing procedures |

Anchoring knowledge to portfolios makes discovery natural and ensures the tone matches the audience. A deployment runbook lives under Foundational; an employee onboarding policy lives under For Employees. The portfolio context shapes how knowledge is written, found, and consumed.

### 1.3 What This Is NOT

- **Not user documentation** — EP-DOCS-001 covers platform how-to guides (`docs/user-guide/`). This is organizational knowledge: policies, processes, decisions, runbooks, reference material about the business and its products.
- **Not a wiki replacement** — No collaborative real-time editing. Articles are authored individually with version history.
- **Not a document management system** — No file attachments in V1. Articles are markdown text anchored to products/portfolios.
- **Not specs** — Specs describe design intent and implementation details. Knowledge articles describe how things work, why decisions were made, and what to do in specific situations.

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| P1 | **Product-anchored, not floating** | Every article links to at least one product or portfolio. This makes discovery natural via the product lifecycle home. |
| P2 | **Portfolio defines the persona** | The portfolio context shapes article tone, depth, and relevance. Foundational knowledge reads differently from Products Sold knowledge. |
| P3 | **AI-first indexing** | Every article is immediately indexed into Qdrant for semantic search. AI coworkers find articles by meaning, not keywords. |
| P4 | **Lifecycle is first-class** | Articles have explicit status (draft/published/review-needed/archived) and staleness detection. The platform nags when articles need review. |
| P5 | **Version everything** | Every edit creates a revision. Diffs are traceable. Rollback is possible. |
| P6 | **Useful at 10 articles** | The system works with a handful of articles for a small org. Faceted search and complex taxonomy navigation emerge as volume grows. Aligned to US Patent 8,635,592 — progressive disclosure of complexity. |
| P7 | **Dual audience** | Every feature serves both human UI users and AI coworker tool users. No feature exists for only one audience. |

---

## 3. Data Model

### 3.1 New Prisma Models

```prisma
model KnowledgeArticle {
  id                 String                      @id @default(cuid())
  articleId          String                      @unique  // Human-readable: KA-001, KA-002...
  title              String
  body               String                      @db.Text  // Markdown content
  category           String                      // process | policy | decision | how-to | reference | troubleshooting | runbook
  status             String                      @default("draft")  // draft | published | review-needed | archived
  visibility         String                      @default("internal")  // internal | team | public
  authorId           String?                     // User who authored (null if AI-authored)
  authorAgentId      String?                     // Agent who authored (null if human-authored)
  reviewIntervalDays Int                         @default(90)  // Days before article is flagged for review
  lastReviewedAt     DateTime?                   // When last reviewed/confirmed current
  valueStreams       String[]                    @default([])  // IT4IT: evaluate, explore, integrate, deploy, release, operate, consume
  tags               String[]                    @default([])  // Free-form tags for additional filtering
  createdAt          DateTime                    @default(now())
  updatedAt          DateTime                    @updatedAt
  author             User?                       @relation("KnowledgeArticleAuthor", fields: [authorId], references: [id])
  authorAgent        Agent?                      @relation("KnowledgeArticleAgentAuthor", fields: [authorAgentId], references: [id])
  revisions          KnowledgeArticleRevision[]
  products           KnowledgeArticleProduct[]
  portfolios         KnowledgeArticlePortfolio[]

  @@index([status])
  @@index([category])
  @@index([authorId])
}

model KnowledgeArticleRevision {
  id               String            @id @default(cuid())
  articleId        String
  version          Int               // 1, 2, 3... auto-incremented per article
  title            String
  body             String            @db.Text
  changeSummary    String?           // What changed in this revision
  createdAt        DateTime          @default(now())
  createdById      String?           // User who made this revision
  createdByAgentId String?           // Agent who made this revision
  article          KnowledgeArticle  @relation(fields: [articleId], references: [id], onDelete: Cascade)
  createdBy        User?             @relation("KnowledgeRevisionCreator", fields: [createdById], references: [id])

  @@unique([articleId, version])
  @@index([articleId])
}

model KnowledgeArticleProduct {
  articleId        String
  digitalProductId String
  article          KnowledgeArticle @relation(fields: [articleId], references: [id], onDelete: Cascade)
  digitalProduct   DigitalProduct   @relation(fields: [digitalProductId], references: [id], onDelete: Cascade)

  @@id([articleId, digitalProductId])
}

model KnowledgeArticlePortfolio {
  articleId   String
  portfolioId String
  article     KnowledgeArticle @relation(fields: [articleId], references: [id], onDelete: Cascade)
  portfolio   Portfolio        @relation(fields: [portfolioId], references: [id], onDelete: Cascade)

  @@id([articleId, portfolioId])
}
```

### 3.2 Canonical String Enums

Following the mandatory compliance rules from CLAUDE.md:

| Model | Field | Valid Values |
|-------|-------|-------------|
| `KnowledgeArticle` | `category` | `"process"` `"policy"` `"decision"` `"how-to"` `"reference"` `"troubleshooting"` `"runbook"` |
| `KnowledgeArticle` | `status` | `"draft"` `"published"` `"review-needed"` `"archived"` |
| `KnowledgeArticle` | `visibility` | `"internal"` `"team"` `"public"` |

These values must be added to the TypeScript constants in `backlog.ts` (or a new `knowledge.ts` constants file) and to the `enum:` arrays in relevant MCP tool definitions in `mcp-tools.ts`.

### 3.3 Required Relation Additions to Existing Models

On `DigitalProduct`:

```prisma
knowledgeArticles  KnowledgeArticleProduct[]
```

On `Portfolio`:

```prisma
knowledgeArticles  KnowledgeArticlePortfolio[]
```

On `User`:

```prisma
knowledgeArticles          KnowledgeArticle[]         @relation("KnowledgeArticleAuthor")
knowledgeRevisions         KnowledgeArticleRevision[] @relation("KnowledgeRevisionCreator")
```

On `Agent`:

```prisma
knowledgeArticles          KnowledgeArticle[]         @relation("KnowledgeArticleAgentAuthor")
```

### 3.4 Design Rationale

- **Many-to-many via join tables** (not `@relation` with arrays) matches the existing pattern used by `EpicPortfolio` for epic-to-portfolio linking.
- **Separate revisions table** rather than JSON blob allows querying revision history, computing diffs, and supporting rollback without parsing unstructured data.
- **`articleId` as human-readable ID** follows the pattern of `productId`, `epicId`, `itemId` throughout the schema.
- **`valueStreams` as `String[]`** (PostgreSQL array) rather than a join table — the set of 7 IT4IT value streams is fixed and small, making a join table over-engineering.
- **`authorId` vs `authorAgentId`** — one is always null, the other populated. This avoids a polymorphic `authorType` field and keeps foreign keys type-safe.

---

## 4. Qdrant Integration

### 4.1 Storage

Articles are indexed into the existing `PLATFORM_KNOWLEDGE` collection with `entityType: "knowledge-article"`. This reuses the existing collection and search infrastructure.

New function in `apps/web/lib/inference/semantic-memory.ts`:

```typescript
export async function storeKnowledgeArticle(params: {
  articleId: string;
  title: string;
  body: string;
  category: string;
  status: string;
  productIds: string[];
  portfolioIds: string[];
  valueStreams: string[];
  tags: string[];
}): Promise<void> {
  const text = `${params.title}\n${params.body}`;
  // Truncate to 8000 chars for embedding if body is very long
  const embeddingText = text.length > 8000 ? text.slice(0, 8000) : text;
  const embedding = await generateEmbedding(embeddingText);
  if (!embedding) return;

  await upsertVectors(QDRANT_COLLECTIONS.PLATFORM_KNOWLEDGE, [
    {
      id: `knowledge-article-${params.articleId}`,
      vector: embedding,
      payload: {
        entityId: params.articleId,
        entityType: "knowledge-article",
        title: params.title,
        contentPreview: params.body.slice(0, 500),
        category: params.category,
        status: params.status,
        product_ids: params.productIds,
        portfolio_ids: params.portfolioIds,
        value_streams: params.valueStreams,
        tags: params.tags,
        timestamp: new Date().toISOString(),
      },
    },
  ]);
}
```

### 4.2 Required Payload Indexes

Add to `ensurePayloadIndexes()` in `packages/db/src/qdrant.ts`:

| Index | Type | Purpose |
|-------|------|---------|
| `category` | keyword | Filter articles by category |
| `status` | keyword | Filter by draft/published/archived |
| `product_ids` | keyword | Filter articles for a specific product |
| `portfolio_ids` | keyword | Filter articles for a specific portfolio |
| `value_streams` | keyword | Filter by IT4IT value stream |
| `tags` | keyword | Filter by free-form tags |

These use Qdrant's multi-value keyword index — arrays of strings are supported natively.

### 4.3 Search Function

```typescript
export async function searchKnowledgeArticles(params: {
  query: string;
  productId?: string;
  portfolioId?: string;
  category?: string;
  valueStream?: string;
  limit?: number;
}): Promise<Array<{
  articleId: string;
  title: string;
  category: string;
  contentPreview: string;
  score: number;
}>> {
  const embedding = await generateEmbedding(params.query);
  if (!embedding) return [];

  const must: Array<Record<string, unknown>> = [
    { key: "entityType", match: { value: "knowledge-article" } },
    { key: "status", match: { value: "published" } },
  ];
  if (params.productId) must.push({ key: "product_ids", match: { value: params.productId } });
  if (params.portfolioId) must.push({ key: "portfolio_ids", match: { value: params.portfolioId } });
  if (params.category) must.push({ key: "category", match: { value: params.category } });
  if (params.valueStream) must.push({ key: "value_streams", match: { value: params.valueStream } });

  const results = await searchSimilar(
    QDRANT_COLLECTIONS.PLATFORM_KNOWLEDGE,
    embedding,
    { must },
    params.limit ?? 5,
    0.55,
  );

  return results.map((r) => ({
    articleId: String(r.payload["entityId"] ?? ""),
    title: String(r.payload["title"] ?? ""),
    category: String(r.payload["category"] ?? ""),
    contentPreview: String(r.payload["contentPreview"] ?? ""),
    score: r.score,
  }));
}
```

Only articles with `status: "published"` are returned by default. Drafts and archived articles are excluded from AI search.

### 4.4 Sync Lifecycle

| Event | Action |
|-------|--------|
| Article created (draft) | Index into Qdrant with `status: "draft"` |
| Article published | Re-embed and upsert with `status: "published"` |
| Article edited | Re-embed and upsert the Qdrant point |
| Article archived | Update Qdrant point with `status: "archived"` |
| Article deleted | Delete Qdrant point |

Every Prisma write that changes title, body, status, or linkages triggers a corresponding Qdrant upsert. The server action that performs the Prisma write is responsible for calling the Qdrant indexing function — no separate sync job.

---

## 5. MCP Tool Definitions

### 5.1 `search_knowledge_base` (read-only)

```typescript
{
  name: "search_knowledge_base",
  description: "Search organizational knowledge articles (policies, processes, decisions, runbooks, reference material). Returns articles ranked by semantic relevance. Use this when the user asks about how things work, what the policy is, or needs procedural guidance.",
  inputSchema: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to search for" },
      productId: { type: "string", description: "Filter to articles linked to this product (optional)" },
      portfolioId: { type: "string", description: "Filter to articles linked to this portfolio (optional)" },
      category: {
        type: "string",
        enum: ["process", "policy", "decision", "how-to", "reference", "troubleshooting", "runbook"],
        description: "Filter by category (optional)",
      },
      valueStream: {
        type: "string",
        enum: ["evaluate", "explore", "integrate", "deploy", "release", "operate", "consume"],
        description: "Filter by IT4IT value stream (optional)",
      },
      limit: { type: "number", description: "Max results (default 5)" },
    },
    required: ["query"],
  },
  requiredCapability: null,
  executionMode: "immediate",
  sideEffect: false,
}
```

### 5.2 `create_knowledge_article` (write)

```typescript
{
  name: "create_knowledge_article",
  description: "Draft a new knowledge article. The article is created in 'draft' status and must be published separately. Use when the user asks to document a process, record a decision, or create a runbook.",
  inputSchema: {
    type: "object",
    properties: {
      title: { type: "string", description: "Article title" },
      body: { type: "string", description: "Article content in markdown" },
      category: {
        type: "string",
        enum: ["process", "policy", "decision", "how-to", "reference", "troubleshooting", "runbook"],
      },
      productIds: { type: "array", items: { type: "string" }, description: "Product IDs to link (optional)" },
      portfolioIds: { type: "array", items: { type: "string" }, description: "Portfolio IDs to link (optional)" },
      valueStreams: {
        type: "array",
        items: { type: "string", enum: ["evaluate", "explore", "integrate", "deploy", "release", "operate", "consume"] },
        description: "IT4IT value streams (optional)",
      },
      tags: { type: "array", items: { type: "string" }, description: "Free-form tags (optional)" },
    },
    required: ["title", "body", "category"],
  },
  requiredCapability: "manage_backlog",
  executionMode: "proposal",
  sideEffect: true,
}
```

### 5.3 `flag_stale_knowledge` (read-only)

```typescript
{
  name: "flag_stale_knowledge",
  description: "Check for knowledge articles that haven't been reviewed within their review interval. Returns articles needing attention.",
  inputSchema: {
    type: "object",
    properties: {
      productId: { type: "string", description: "Filter to a specific product (optional)" },
      portfolioId: { type: "string", description: "Filter to a specific portfolio (optional)" },
    },
  },
  requiredCapability: null,
  executionMode: "immediate",
  sideEffect: false,
}
```

### 5.4 Tool Execution

- `search_knowledge_base` calls `searchKnowledgeArticles()` from `semantic-memory.ts`
- `create_knowledge_article` creates a Prisma record + indexes into Qdrant. Auto-generates `articleId` using the pattern `KA-{next sequential number}` (query max existing articleId to determine next).
- `flag_stale_knowledge` queries Prisma: `status = 'published'` AND (`lastReviewedAt IS NULL AND createdAt + reviewIntervalDays < now()`) OR (`lastReviewedAt + reviewIntervalDays < now()`)

### 5.5 Route Context Integration

Add `search_knowledge_base` to `domainTools` arrays in `apps/web/lib/tak/route-context-map.ts` for all routes — knowledge search is universally useful, like the existing `search_knowledge` tool.

Add a knowledge skill to the `/portfolio` route context:

```typescript
{
  label: "Find knowledge",
  description: "Search knowledge articles for this portfolio or product",
  capability: "view_portfolio",
  prompt: "Search the knowledge base for articles relevant to this product/portfolio. Show me what's available.",
}
```

---

## 6. UI Routes & Components

### 6.1 Route Structure

| Route | Purpose |
|-------|---------|
| `/portfolio/[...slug]/knowledge` | Portfolio-scoped knowledge — articles linked to this portfolio, displayed with persona context |
| `/portfolio/product/[id]/knowledge` | Product Knowledge tab — articles linked to this specific product |
| `/knowledge` | Global knowledge browse/search — cross-cutting view with faceted filtering |
| `/knowledge/new` | New article creation form |
| `/knowledge/[articleId]` | Article view/edit with revision history |

### 6.2 Portfolio Knowledge Page

**Route:** `apps/web/app/(shell)/portfolio/[...slug]/knowledge/page.tsx`

Shows knowledge articles linked to the current portfolio. The portfolio persona context is displayed as a header banner explaining the audience and expected tone:

- **Foundational:** "Technical knowledge for engineers and architects"
- **Manufacturing & Delivery:** "Operational knowledge for delivery and production teams"
- **For Employees:** "People and policy knowledge for HR and managers"
- **Products & Services Sold:** "Business knowledge for product and sales teams"

Articles are grouped by category with counts. Search within portfolio scope. "New Article" pre-fills portfolio linkage.

### 6.3 Product Knowledge Tab

**Route:** `apps/web/app/(shell)/portfolio/product/[id]/knowledge/page.tsx`

Add to `TABS` array in `apps/web/components/product/ProductTabNav.tsx`:

```typescript
{ label: "Knowledge", href: "/knowledge" }
```

**Behavior:**
- Lists articles linked to this product (via `KnowledgeArticleProduct` join)
- Inherits portfolio persona from the product's portfolio
- Grouped by category with counts
- "New Article" button pre-fills product and portfolio linkages
- Staleness badges on articles past their review interval
- **Empty state:** "No knowledge articles yet. Create the first article for [product name] to start building your knowledge base."

### 6.4 Global Knowledge Page

**Route:** `apps/web/app/(shell)/knowledge/page.tsx`

Add "Knowledge" to header navigation.

**Progressive disclosure:**
- Fewer than 20 articles: simple list with search bar
- 20+ articles: add faceted filters (portfolio, product, category, value stream)
- 50+ articles: add sidebar taxonomy navigation

**Features:**
- Browse/search all published articles across the organization
- Sort by: relevance (default for search), recently updated, needs review
- Status filter tabs: Published | Drafts (own) | Needs Review | Archived

### 6.5 Article Detail / Editor Page

**Route:** `apps/web/app/(shell)/knowledge/[articleId]/page.tsx`

**Read mode:**
- Rendered markdown with metadata header (author, category, last reviewed, linked products/portfolios)
- Revision history panel (version number, date, author, change summary)
- "Edit" button, "Flag for review" button, "Archive" button
- Related articles (semantic similarity via Qdrant — top 3 articles similar to this one)

**Edit mode:**
- Split-pane markdown editor with live preview
- On save: creates a new `KnowledgeArticleRevision` record, updates `KnowledgeArticle.body`, re-indexes in Qdrant
- Change summary field (required for non-draft articles)

### 6.6 New Article Page

**Route:** `apps/web/app/(shell)/knowledge/new/page.tsx`

**Fields:**
- Title (required)
- Category (required, dropdown with 7 options)
- Body (required, markdown editor with preview)
- Linked products (multi-select, optional — pre-filled if navigated from product)
- Linked portfolios (multi-select, optional — pre-filled if navigated from portfolio)
- Value streams (multi-select checkboxes, optional)
- Tags (free-form tag input, optional)
- Review interval (number input, default 90 days)
- Visibility (dropdown: internal/team/public)

On submit: creates in `draft` status. User explicitly publishes via a separate action.

### 6.7 Component Breakdown

| Component | Purpose |
|-----------|---------|
| `KnowledgeArticleList` | Reusable list with search/filter, used on product tab, portfolio page, and global page |
| `KnowledgeArticleCard` | Card display with title, category badge, staleness indicator, product/portfolio chips |
| `KnowledgeArticleEditor` | Split-pane markdown editor with live preview |
| `KnowledgeArticleViewer` | Rendered markdown with metadata header |
| `KnowledgeRevisionHistory` | Version list with change summaries |
| `KnowledgeCategoryBadge` | Colored badge per category |
| `StalenessIndicator` | Amber badge for articles past review interval |

All components in `apps/web/components/knowledge/`.

---

## 7. AI Coworker Integration

### 7.1 Contextual Knowledge Injection

When the agent starts a conversation on a product page (`/portfolio/product/[id]/*`), the route context builder queries the top 3 knowledge articles for that product from Qdrant and injects summaries into Block 5 (Domain Context) of the system prompt:

```
RELEVANT KNOWLEDGE ARTICLES FOR [Product Name]:
- KA-005: "Cloud Spend Approval Policy" (policy) — Approvals required for cloud spend exceeding...
- KA-012: "Deployment Runbook" (runbook) — Step-by-step deployment process for production...
- KA-003: "Architecture Decision: Event-Driven" (decision) — Why we chose event-driven...
```

This happens in the agent context assembly phase, not as a tool call. The agent naturally references this knowledge without the user asking.

On portfolio pages, the injection uses the portfolio filter instead of the product filter.

### 7.2 Article Drafting from Conversations

When a user discusses a process or makes a decision during an agent conversation, the agent can proactively offer: "Would you like me to capture this as a knowledge article?"

If yes, the agent uses `create_knowledge_article` with `executionMode: "proposal"` — the article goes through HITL approval before being created. The agent drafts the article from the conversation context, pre-filling the product/portfolio linkage from the current route context.

### 7.3 Staleness Awareness

When a user navigates to a product's Knowledge tab and stale articles exist, the agent mentions them: "I notice KA-012 (Deployment Runbook) hasn't been reviewed in 120 days. Would you like to review it now?"

This uses `flag_stale_knowledge` filtered to the current product.

### 7.4 Change-Triggered Relevance Alerts

When a product undergoes significant changes (new version shipped, architecture change, team change), the agent cross-references knowledge articles linked to that product and flags any that may need updating: "KA-012 (Deployment Runbook) may need updating since you just shipped v2.1."

This is advisory only — the agent does not auto-modify articles.

---

## 8. Staleness / Review Workflow

### 8.1 How Staleness Works

Each article has a `reviewIntervalDays` (default 90) and a `lastReviewedAt` timestamp. An article is "stale" when:

```
now() > lastReviewedAt + reviewIntervalDays
```

Or when `lastReviewedAt IS NULL` and `createdAt + reviewIntervalDays < now()`.

### 8.2 Review Actions

- **Confirm current** — Sets `lastReviewedAt = now()`, keeps `status = published`. No content change needed. One-click action.
- **Update and confirm** — Edit the article, which creates a revision and resets `lastReviewedAt`.
- **Archive** — Sets `status = archived`. Article remains in Qdrant but excluded from default search.

### 8.3 Staleness Surfacing

| Surface | Behavior |
|---------|----------|
| Product Knowledge tab | Stale articles show amber badge with days overdue |
| Portfolio Knowledge page | Stale articles show amber badge |
| Global Knowledge page | "Needs Review" filter tab shows count |
| AI coworker context | Agent mentions stale articles when relevant to conversation |

### 8.4 Status Transitions

```
draft ──publish──> published ──flag──> review-needed ──confirm──> published
  |                    |                                              |
  |                    └──archive──> archived                        |
  |                                     |                            |
  └──delete (hard)                     └──restore──> draft          |
                                                                    └──archive──> archived
```

- `review-needed` is set automatically by staleness detection OR manually by any user.
- Only the author or an admin (HR-000) can archive. Any authenticated user can flag for review.
- Deleting a draft is a hard delete (removes Prisma record and Qdrant point).

---

## 9. API Routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/v1/knowledge` | List/search articles (supports `?productId=`, `?portfolioId=`, `?category=`, `?status=`, `?q=`, `?valueStream=`) |
| POST | `/api/v1/knowledge` | Create article (returns `draft` status) |
| GET | `/api/v1/knowledge/[articleId]` | Get article with revisions |
| PATCH | `/api/v1/knowledge/[articleId]` | Update article (creates revision, re-indexes Qdrant) |
| POST | `/api/v1/knowledge/[articleId]/publish` | Transition draft/review-needed to published |
| POST | `/api/v1/knowledge/[articleId]/archive` | Archive article |
| POST | `/api/v1/knowledge/[articleId]/review` | Confirm article is current (resets `lastReviewedAt`) |
| GET | `/api/v1/knowledge/stale` | List articles past their review interval |

These follow the existing API patterns in `apps/web/app/api/v1/`.

---

## 10. What's NOT in This Design

- **No file attachments** — Articles are markdown text only. Attachments deferred to V2.
- **No collaborative editing** — Single-author model with version history. No real-time co-editing.
- **No auto-generated articles** — AI can draft articles, but a human must review and publish.
- **No notification system integration** — Staleness alerts shown in UI only. Email/push notifications for stale articles deferred to V2 (will use existing `Notification` model).
- **No article templates** — Category provides structure guidance but no pre-filled templates.
- **No analytics/metrics** — No view counts, read tracking, or usage analytics in V1.
- **No external knowledge import** — No bulk import from Confluence, SharePoint, or other KM systems.

---

## 11. Implementation Order

### Phase 1: Foundation (Prisma + Qdrant)

1. Add `KnowledgeArticle`, `KnowledgeArticleRevision`, `KnowledgeArticleProduct`, `KnowledgeArticlePortfolio` models to Prisma schema
2. Add relation fields to `DigitalProduct`, `Portfolio`, `User`, `Agent`
3. Run `pnpm --filter @dpf/db exec prisma migrate dev --name add-knowledge-management`
4. Add `storeKnowledgeArticle()` and `searchKnowledgeArticles()` to `semantic-memory.ts`
5. Add payload indexes to `ensurePayloadIndexes()` in `packages/db/src/qdrant.ts`

### Phase 2: API + MCP Tools

6. Create API route handlers at `apps/web/app/api/v1/knowledge/`
7. Add `search_knowledge_base`, `create_knowledge_article`, `flag_stale_knowledge` tools to `mcp-tools.ts`
8. Add tool execution handlers
9. Add `search_knowledge_base` to `domainTools` in route contexts in `route-context-map.ts`
10. Add agent grants in `apps/web/lib/tak/agent-grants.ts`

### Phase 3: Product + Portfolio Knowledge Views

11. Add "Knowledge" tab to `ProductTabNav.tsx`
12. Create product knowledge page at `apps/web/app/(shell)/portfolio/product/[id]/knowledge/page.tsx`
13. Create portfolio knowledge page at `apps/web/app/(shell)/portfolio/[...slug]/knowledge/page.tsx`
14. Build `KnowledgeArticleList` and `KnowledgeArticleCard` components
15. Portfolio persona banners

### Phase 4: Global Knowledge Pages

16. Create global knowledge page at `apps/web/app/(shell)/knowledge/page.tsx`
17. Create new article page at `apps/web/app/(shell)/knowledge/new/page.tsx`
18. Create article view/edit page at `apps/web/app/(shell)/knowledge/[articleId]/page.tsx`
19. Build `KnowledgeArticleEditor`, `KnowledgeArticleViewer`, `KnowledgeRevisionHistory` components
20. Add "Knowledge" to header navigation

### Phase 5: AI Integration + Staleness

21. Add contextual knowledge injection to agent context builder (Block 5)
22. Implement staleness detection query and surface in UI (`StalenessIndicator`)
23. Add knowledge skill to portfolio route context
24. Add knowledge article count to product overview stats

---

## 12. Files Affected

### New Files

| File | Purpose |
|------|---------|
| `apps/web/app/(shell)/portfolio/product/[id]/knowledge/page.tsx` | Product knowledge tab |
| `apps/web/app/(shell)/portfolio/[...slug]/knowledge/page.tsx` | Portfolio knowledge page |
| `apps/web/app/(shell)/knowledge/page.tsx` | Global knowledge browse/search |
| `apps/web/app/(shell)/knowledge/new/page.tsx` | New article form |
| `apps/web/app/(shell)/knowledge/[articleId]/page.tsx` | Article view/edit |
| `apps/web/app/api/v1/knowledge/route.ts` | List + create API |
| `apps/web/app/api/v1/knowledge/[articleId]/route.ts` | Get + update API |
| `apps/web/app/api/v1/knowledge/[articleId]/publish/route.ts` | Publish action |
| `apps/web/app/api/v1/knowledge/[articleId]/archive/route.ts` | Archive action |
| `apps/web/app/api/v1/knowledge/[articleId]/review/route.ts` | Confirm-current action |
| `apps/web/app/api/v1/knowledge/stale/route.ts` | Stale articles API |
| `apps/web/components/knowledge/KnowledgeArticleList.tsx` | Reusable article list |
| `apps/web/components/knowledge/KnowledgeArticleCard.tsx` | Article card |
| `apps/web/components/knowledge/KnowledgeArticleEditor.tsx` | Markdown editor |
| `apps/web/components/knowledge/KnowledgeArticleViewer.tsx` | Rendered article |
| `apps/web/components/knowledge/KnowledgeRevisionHistory.tsx` | Revision timeline |
| `apps/web/components/knowledge/KnowledgeCategoryBadge.tsx` | Category badge |
| `apps/web/components/knowledge/StalenessIndicator.tsx` | Stale warning |
| `apps/web/lib/actions/knowledge.ts` | Server actions for knowledge CRUD |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | 4 new models + relation fields on existing models |
| `apps/web/lib/inference/semantic-memory.ts` | `storeKnowledgeArticle()`, `searchKnowledgeArticles()` |
| `packages/db/src/qdrant.ts` | Payload indexes in `ensurePayloadIndexes()` |
| `apps/web/lib/mcp-tools.ts` | 3 tool definitions + execution handlers |
| `apps/web/lib/tak/route-context-map.ts` | `search_knowledge_base` in domainTools + knowledge skill |
| `apps/web/lib/tak/agent-grants.ts` | Grants for new tools |
| `apps/web/components/product/ProductTabNav.tsx` | "Knowledge" tab |

---

## 13. Demo Story

A product manager opens the "Customer Portal" product page under the Products & Services Sold portfolio. She clicks the Knowledge tab and sees three articles: a pricing decision record from last quarter, an API integration runbook, and a customer onboarding process guide.

She notices the runbook has an amber "Review needed" badge — it hasn't been reviewed in 95 days. She clicks it, reads through, updates a section about the new v2 API endpoint, and clicks "Confirm current." The badge disappears.

Later, she asks the AI coworker: "What's our policy on customer data retention?" The coworker searches the knowledge base, finds KA-023 (Data Retention Policy) linked to the Foundational portfolio, and provides a grounded answer with a link to the full article.

Her colleague on the engineering team opens the same product from the Foundational portfolio view. The knowledge articles are the same, but the portfolio persona context emphasizes the technical depth: architecture decisions and deployment runbooks are featured prominently.

At the end of a planning session where a pricing change is decided, the AI coworker offers: "Would you like me to capture this pricing decision as a knowledge article?" She says yes, the agent drafts the article with the decision rationale, links it to the Customer Portal product and Products & Services Sold portfolio, and submits it as a draft for her review.
