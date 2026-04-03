# EP-CTX-001: Context Budget and Arbitration Layer

| Field | Value |
|-------|-------|
| **Epic** | EP-CTX-001 |
| **IT4IT Alignment** | Cross-cutting: affects all value streams by governing how AI coworkers consume context across every route |
| **Depends On** | Agentic Architecture Patterns (2026-04-02, active reference), Prompt Assembler (implemented), Knowledge Management (EP-KM-001, implemented), Knowledge-Driven Agent Capabilities (EP-AGENT-CAP-001, partially implemented) |
| **Complementary** | Async Coworker Messaging (EP-ASYNC-COWORKER-001, design) — enables two-phase context loading and makes tool-deferred content safer via cancellation support |
| **Predecessor Specs** | Unified MCP Coworker Architecture, Shared Memory / Vector DB, Build Studio IT4IT Alignment |
| **Status** | Draft |
| **Created** | 2026-04-03 |
| **Author** | Mark Bodman (CEO) + Claude (design partner) |

---

## 1. Problem Statement

The platform has accumulated seven distinct data sources that inject into the AI coworker's context window: static prompt blocks, route context providers, semantic memory recall, knowledge articles, build phase context, attachment summaries, and form assist metadata. Each source was designed independently and injects as much data as it wants with no coordination.

### 1.1 Current State: Uncoordinated Injection

| Source | Where Injected | Size Range | Coordination |
|--------|---------------|------------|-------------|
| Identity + Authority + Mode + Sensitivity (Blocks 1-4) | System prompt | 500-625 tokens | None — always full |
| Domain context + tools (Block 5) | System prompt | 125-500 tokens | None — static per route |
| Knowledge articles (Block 5 enrichment) | System prompt | 75-200 tokens | None — always 3 articles |
| Route data providers (Block 6) | System prompt | 50-750 tokens | None — dumps full summary |
| Attachments (Block 7) | System prompt + last user message | 675-4,200 tokens | None — all files, duplicated |
| Build context (phase prompt + brief + spec + handoffs) | System prompt | 625-4,345 tokens | None — accumulates per phase |
| Message history | Conversation array | 125-500 tokens | Fixed limit of 8 messages |
| Semantic memory recall (legacy mode) | System prompt | 0-300 tokens | Fixed limit of 8 results |
| Task guidance | System prompt | 0-125 tokens | Conditional on confidence |
| Form assist | System prompt | 0-250 tokens | Conditional on form context |
| External services | System prompt | 0-250 tokens | Conditional on enablement |
| Ship phase context (impact + approval + contribution) | System prompt | 0-720 tokens | Conditional on phase |

### 1.2 Measured Impact

| Scenario | System Prompt Tokens | Conversation Tokens | Total |
|----------|---------------------|-------------------|-------|
| Simple conversation (workspace) | 750-1,500 | 125-500 | 875-2,000 |
| Portfolio page with knowledge | 1,000-2,500 | 125-500 | 1,125-3,000 |
| Compliance detail page | 1,000-2,500 | 125-500 | 1,125-3,000 |
| Build Studio (ideate phase) | 2,500-4,000 | 125-500 | 2,625-4,500 |
| Build Studio (ship phase, full load) | 5,000-8,000 | 125-500 | 5,125-8,500 |
| Build + attachments (3 files) | 5,675-10,520 | 125-500 | 5,800-11,020 |

These numbers grow as the platform adds more data sources. Knowledge articles, once populated, will add more. Spec indexing will add more. Graph context (planned) will add more. Without arbitration, the system prompt will eventually exceed the effective reasoning window of smaller models.

### 1.3 The Core Problem

**No token budget exists.** Each data source independently decides what to inject. The prompt assembler concatenates everything with no awareness of total size, model capability, or task relevance.

**Consequences:**
- Smaller models (adequate/basic tier) receive the same 8,000+ token prompt as frontier models
- Irrelevant context dilutes the signal — a build agent doesn't need knowledge articles about HR policies
- Attachment context is duplicated (Block 7 + last user message) without reason
- Build phase context accumulates without summarization — ship phase carries all handoff history
- No feedback loop — adding a new data source doesn't reduce other sources

### 1.4 What This Is NOT

- **Not prompt engineering** — this is about the architecture that selects and sizes content before prompt assembly, not about wording or tone.
- **Not model selection** — the quality tier system (EP-TAK-PATTERNS) handles which model to use. This spec handles what goes into that model's context.
- **Not caching** — context freshness and retrieval performance are separate concerns.

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| P1 | **Budget, don't dump** | Every context source has a token allocation. If the budget is 200 tokens for knowledge, inject 200 tokens of knowledge — not 3 full articles. |
| P2 | **Pointers over content** | Inject titles and references; let the agent pull full content through tools when needed. One-line knowledge pointers cost 15 tokens; 3 article summaries cost 150. |
| P3 | **Task relevance scores** | A build task doesn't need HR knowledge. A compliance query doesn't need inventory context. Score each source against the inferred task type. |
| P4 | **Model-aware budgets** | Frontier models get generous budgets. Basic models get minimal context — enough to route, not enough to confuse. |
| P5 | **Monotonic accumulation is a bug** | Build phase context grows per phase. After 5 phases, the handoff history alone is 2,500+ tokens. Summarize old phases instead of carrying full history. |
| P6 | **Measure, don't guess** | Token counts must be computed, not estimated. Use the actual tokenizer for the target model. |
| P7 | **Graceful degradation** | If the total exceeds the budget, trim low-priority sources first — never trim identity, authority, or mode blocks. |

---

## 3. Context Tiers

All context sources are classified into tiers based on when and how they should be loaded:

| Tier | Name | When Loaded | Trimmable? | Examples |
|------|------|-------------|-----------|----------|
| **L0** | Core identity | Every turn | Never | Blocks 1-4: identity, authority, mode, sensitivity |
| **L1** | Route essential | Every turn on route | Last resort | Block 5 static domain context, available tool names |
| **L2** | Situational summaries | First turn, refresh on nav | Yes — compress | Knowledge article titles (1 line each), page data summary, build phase summary |
| **L3** | Retrieved on demand | When agent calls a tool | Yes — omit | Full article bodies, semantic memory recall, spec content, form field metadata |
| **L4** | Deep context | Explicit request only | Yes — omit | Full revision history, graph traversals, archived items, all handoff details |

### 3.1 Current Sources Mapped to Tiers

| Source | Current Tier | Proposed Tier | Change |
|--------|-------------|--------------|--------|
| Identity (Block 1) | L0 | L0 | No change |
| Authority (Block 2) | L0 | L0 | No change |
| Mode (Block 3) | L0 | L0 | No change |
| Sensitivity (Block 4) | L0 | L0 | No change |
| Domain context text (Block 5) | L1 | L1 | No change |
| Available tools list (Block 5) | L1 | L1 | No change |
| Knowledge article summaries | L2 (injected as L1) | L2 | **Reduce to title-only pointers** |
| Page data (Block 6) | L2 (injected as L1) | L2 | **Summarize + truncate to budget** |
| Build brief + current phase prompt | L1 | L1 | No change — needed for correct behavior |
| Build running spec (accumulated notes) | L2 (injected as L1) | L2 | **Summarize if > 500 tokens** |
| Build phase handoffs | L4 (injected as L1) | L4 | **Only inject latest handoff; prior ones available via tool** |
| Attachment summaries | L2 (injected as L1+message) | L2 | **Stop duplicating in user message** |
| Attachment full text | L3 (injected as L1) | L3 | **Move to tool retrieval** |
| Semantic memory recall | L3 (injected as L1) | L3 | **Only on explicit recall, not automatic** |
| Task guidance | L2 | L2 | No change — already conditional |
| Form assist fields | L3 | L3 | No change — already conditional |
| External services list | L2 | L2 | No change — already small |
| Ship phase context | L1 (when in ship) | L1 | No change — needed for correct behavior |

---

## 4. Token Budget Allocation

### 4.1 Budget by Model Tier

Total budget = maximum tokens allocated for system prompt + injected context (excluding conversation history).

| Model Tier | Total Budget | Rationale |
|------------|-------------|-----------|
| `frontier` | 6,000 tokens | Large context window; quality-first tasks (Build Studio) |
| `strong` | 3,000 tokens | Most routes; balance of context and cost |
| `adequate` | 1,500 tokens | Simple tasks; minimal context needed |
| `basic` | 800 tokens | Local models; core identity + tools only |

### 4.2 Budget Allocation by Block

| Block | L0 (Core) | L1 (Route) | L2 (Situational) | Total |
|-------|-----------|-----------|------------------|-------|
| **frontier** | 625 | 1,500 | 3,875 | 6,000 |
| **strong** | 625 | 800 | 1,575 | 3,000 |
| **adequate** | 625 | 500 | 375 | 1,500 |
| **basic** | 625 | 175 | 0 | 800 |

L0 is fixed. L1 and L2 are allocated proportionally. L3 and L4 are never pre-injected — they're pulled through tools.

### 4.3 Per-Source Limits Within L2

When multiple L2 sources compete for the situational budget:

| Source | Priority | Max Allocation (% of L2 budget) |
|--------|----------|-------------------------------|
| Page data summary (Block 6) | 1 — highest | 40% |
| Build context (brief + spec summary) | 2 | 30% |
| Knowledge pointers | 3 | 10% |
| Attachment summaries | 4 | 15% |
| Task guidance | 5 | 5% |

If a source doesn't use its allocation (e.g., no build context on a portfolio page), the unused budget is available to lower-priority sources.

---

## 5. Context Arbitrator

### 5.1 Interface

New module: `apps/web/lib/tak/context-arbitrator.ts`

```typescript
export type ContextSource = {
  tier: "L0" | "L1" | "L2" | "L3" | "L4";
  priority: number;        // Lower = higher priority
  content: string;         // The content to inject
  tokenCount: number;      // Pre-computed token count
  source: string;          // For debugging: "identity", "knowledge", "page-data", etc.
  compressible: boolean;   // Can this be summarized if over budget?
  compressedContent?: string; // Shorter version if available
  compressedTokenCount?: number;
};

export type ContextBudget = {
  modelTier: "frontier" | "strong" | "adequate" | "basic";
  totalBudget: number;
  l0Budget: number;
  l1Budget: number;
  l2Budget: number;
};

export function arbitrate(
  sources: ContextSource[],
  budget: ContextBudget,
): ContextSource[] {
  // 1. Always include L0 sources (identity, authority, mode, sensitivity)
  // 2. Include L1 sources up to l1Budget, priority order
  // 3. Include L2 sources up to l2Budget, priority order
  // 4. Never include L3/L4 — those are tool-retrieved
  // 5. If a source exceeds its allocation and is compressible, use compressedContent
  // 6. If still over budget, drop lowest-priority L2 sources
  // Return the selected sources in injection order
}

export function getBudgetForTier(
  modelTier: "frontier" | "strong" | "adequate" | "basic",
): ContextBudget;
```

### 5.2 Token Counting

Use a lightweight tokenizer for budget calculation. Options in order of preference:

1. **`gpt-tokenizer`** (npm) — fast, browser-compatible, cl100k_base encoding. Good enough for budget estimation across all providers.
2. **Character-based estimate** (4 chars = 1 token) — fallback if tokenizer unavailable.

Exact token counts per model are unnecessary for budget arbitration. We need "close enough" estimates to prevent overflow, not billing accuracy.

### 5.3 Integration Point

The arbitrator replaces the current direct injection pattern in `agent-coworker.ts`. Instead of:

```typescript
// Current: each source independently injects
const routeData = await getRouteDataContext(input.routeContext, user.id!);
const knowledgeContext = await getKnowledgeContextForRoute(input.routeContext);
enrichedDomainContext += "\n\n" + knowledgeContext;
// ... all sources concatenated without limit
```

The new pattern:

```typescript
// New: all sources submit to arbitrator with pre-computed token counts
const sources: ContextSource[] = [
  { tier: "L0", priority: 0, content: identityBlock, tokenCount: countTokens(identityBlock), source: "identity", compressible: false },
  { tier: "L1", priority: 1, content: domainContext, tokenCount: countTokens(domainContext), source: "domain", compressible: false },
  { tier: "L2", priority: 1, content: pageDataSummary, tokenCount: countTokens(pageDataSummary), source: "page-data", compressible: true, compressedContent: pageDataOneLiner, compressedTokenCount: countTokens(pageDataOneLiner) },
  { tier: "L2", priority: 3, content: knowledgePointers, tokenCount: countTokens(knowledgePointers), source: "knowledge", compressible: true, compressedContent: "", compressedTokenCount: 0 },
  // ... etc
];
const budget = getBudgetForTier(modelTier);
const selected = arbitrate(sources, budget);
// Build prompt from selected sources only
```

---

## 6. Specific Optimizations

### 6.1 Knowledge Articles: Pointers Not Summaries

**Current:** 3 article summaries with 80-char previews (~150 tokens).

**Proposed:** Title-only pointers (~45 tokens):

```
KNOWLEDGE: 3 articles for this product — use search_knowledge_base for details.
- KA-005: "Cloud Spend Approval Policy" (policy)
- KA-012: "Deployment Runbook" (runbook)
- KA-003: "Architecture Decision: Event-Driven" (decision)
```

The agent knows articles exist and can pull content when needed. The 80-char preview rarely helps and costs 100+ tokens.

### 6.2 Page Data: Summary + Truncation

**Current:** Full page summary injected regardless of size. Ops context dumps 60 backlog items.

**Proposed:** Each route context provider returns two versions:
- `summary`: One-paragraph overview with counts and key metrics (max 200 tokens)
- `detail`: Full data (current format)

The arbitrator uses `summary` by default. If the model tier is `frontier` AND the route is the primary work surface AND budget allows, it uses `detail`.

### 6.3 Build Phase Handoffs: Latest Only

**Current:** All phase handoffs injected, accumulating ~2,000 tokens by ship phase.

**Proposed:** Only the most recent handoff is injected. Prior handoffs are available via a new `recall_phase_handoff` tool that queries the `PhaseHandoff` table.

### 6.4 Attachments: Stop Duplicating

**Current:** Attachment summaries injected in Block 7 AND appended to the last user message.

**Proposed:** Inject in Block 7 only. Remove the duplication in the user message. This saves 675-2,520 tokens per conversation with attachments.

### 6.5 Running Spec: Summarize When Large

**Current:** Full running spec JSON injected (up to 1,000 tokens in later phases).

**Proposed:** If running spec exceeds 500 tokens, inject a summary line ("Running spec: 12 entries covering architecture, testing, and deployment decisions. Use recall_build_context for details.") and provide full content through a tool.

### 6.6 Semantic Memory: Tool-Only

**Current (legacy mode):** 8 similar past messages auto-injected into system prompt.

**Proposed:** Remove automatic injection. Semantic memory is available through the existing `recallRelevantContext` pathway but only when the agent decides it needs past context. This eliminates 300 tokens of potentially irrelevant history from every conversation.

---

## 7. New Tools for Deferred Content

Sources moved from L1/L2 to L3/L4 need tool-based retrieval:

| Tool | Purpose | Returns |
|------|---------|---------|
| `recall_phase_handoff` | Retrieve a specific phase handoff by phase name | Full handoff document |
| `recall_build_context` | Retrieve the running spec or feature brief | Full JSON content |
| `get_page_detail` | Retrieve the full page data summary for the current route | Full route context provider output |
| `get_attachment_content` | Retrieve full text of a specific attachment | Parsed file content |

These are read-only, immediate-execution, no side effects. They replace pre-injected content with on-demand retrieval.

The existing `search_knowledge_base` already handles knowledge article retrieval. No new tool needed for knowledge.

---

## 8. Compression Strategies

When a source exceeds its budget allocation and is marked `compressible`:

| Strategy | When | How |
|----------|------|-----|
| **Truncate** | Structured data (lists, tables) | Keep first N items, append "... and X more" |
| **Summarize** | Prose content (handoffs, specs) | Pre-generate one-line summary at write time |
| **Pointer** | Large documents (articles, attachments) | Replace with title + tool reference |
| **Drop** | Lowest-priority L2 sources | Omit entirely if budget is exhausted |

Pre-generated summaries are preferred over runtime summarization. Each data source should store a `summary` field alongside its full content, generated at write time. This avoids spending inference budget on compression.

---

## 9. Observability

### 9.1 Context Budget Metrics

Add to Prometheus metrics (`apps/web/lib/metrics.ts`):

```typescript
// Token budget utilization per conversation
contextBudgetUtilization: Histogram  // labels: model_tier, route
  // Buckets: 0.1, 0.25, 0.5, 0.75, 0.9, 1.0, 1.25 (>1.0 = over budget)

// Per-source token counts
contextSourceTokens: Histogram  // labels: source, tier
  // Track how many tokens each source contributes

// Sources dropped due to budget
contextSourcesDropped: Counter  // labels: source, model_tier
  // Track how often sources are trimmed
```

### 9.2 Debug Logging

In development mode, log the arbitration decision:

```
[context-arbitrator] model=strong budget=3000 used=2847 (95%)
  L0: identity=320 authority=85 mode=40 sensitivity=25 (total=470)
  L1: domain=245 tools=55 (total=300)
  L2: page-data=680(compressed from 1200) knowledge=45 task-guidance=52 (total=777)
  L2 dropped: attachments(420 tokens, over budget)
```

---

## 10. Implementation Order

### Phase 1: Token Counting + Budget Definition

1. Add `gpt-tokenizer` dependency (or implement char-based estimator)
2. Create `apps/web/lib/tak/context-arbitrator.ts` with `ContextSource`, `ContextBudget` types
3. Implement `getBudgetForTier()` with the budget table from Section 4
4. Implement `countTokens()` utility function
5. Add Prometheus metrics

### Phase 2: Arbitration Logic

6. Implement `arbitrate()` function with tier-based selection and priority ordering
7. Add compression fallback (use `compressedContent` when over budget)
8. Add drop logic for lowest-priority L2 sources
9. Add debug logging

### Phase 3: Refactor Injection Points

10. Refactor `agent-coworker.ts` `sendMessage()` to use arbitrator instead of direct injection
11. Move knowledge injection from inline enrichment to ContextSource submission
12. Add `summary` + `detail` return format to all route context providers
13. Remove attachment duplication (Block 7 only, not user message)
14. Add `compressedContent` generation to build context section

### Phase 4: Deferred Content Tools

15. Create `recall_phase_handoff` tool (read latest or specific phase handoff)
16. Create `recall_build_context` tool (read running spec or brief)
17. Create `get_page_detail` tool (read full page data summary)
18. Create `get_attachment_content` tool (read specific attachment)
19. Add tool definitions to `mcp-tools.ts` and execution handlers
20. Update agent grants

### Phase 5: Source-Level Optimizations

21. Knowledge articles: reduce to title-only pointers in L2 injection
22. Phase handoffs: inject only latest, defer prior to tool
23. Running spec: summarize when > 500 tokens
24. Remove legacy semantic memory auto-injection
25. Reduce message history from 8 to 4 for adequate/basic tiers

---

## 11. Files Affected

### New Files

| File | Purpose |
|------|---------|
| `apps/web/lib/tak/context-arbitrator.ts` | Budget definitions, arbitration logic, token counting |
| `apps/web/lib/tak/context-arbitrator.test.ts` | Unit tests for arbitration priorities and budget enforcement |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/lib/actions/agent-coworker.ts` | Replace direct injection with arbitrator submission; remove attachment duplication |
| `apps/web/lib/tak/prompt-assembler.ts` | Accept pre-arbitrated content instead of raw blocks |
| `apps/web/lib/tak/route-context.ts` | Add `summary` return variant to all route context providers |
| `apps/web/lib/integrate/build-agent-prompts.ts` | Add summary generation for running spec; limit handoff injection |
| `apps/web/lib/mcp-tools.ts` | Add 4 new deferred-content tools |
| `apps/web/lib/tak/agent-grants.ts` | Grants for new tools |
| `apps/web/lib/metrics.ts` | Context budget utilization metrics |

---

## 12. Migration Strategy

This is a refactor, not a rewrite. The change is backward-compatible:

1. **Phase 1-2** can be built and tested independently — the arbitrator is a pure function with no side effects.
2. **Phase 3** is the integration point — a single change to `sendMessage()` replaces the injection pattern.
3. **Phase 4** adds tools that make deferred content accessible — these can be added incrementally.
4. **Phase 5** optimizations can be done one source at a time, each measurable via the observability metrics.

The legacy persona mode path in `sendMessage()` is not modified — it's already being deprecated in favor of unified mode. The arbitrator only applies to the unified prompt path.

---

## 13. Relationship to Async Coworker Messaging (EP-ASYNC-COWORKER-001)

EP-ASYNC-COWORKER-001 replaces the blocking `useTransition` + server action pattern with fire-and-forget `POST /api/agent/send` + SSE completion. This is complementary to context budget arbitration — async fixes the UX layer (no page freeze), this spec fixes the data layer (right-size the prompt). Together they address both sides of the token spend problem.

### 13.1 Two-Phase Context Loading

The async model decouples message submission from agent execution. This enables a pattern where the arbitrator assembles context in two phases:

| Phase | What | When | Blocking? |
|-------|------|------|-----------|
| **Fast (L0+L1)** | Identity, authority, mode, sensitivity, domain context, tool list | Before first inference call | Yes — but < 10ms, deterministic |
| **Deferred (L2)** | Knowledge pointers, page data summary, build context summary | After agent starts, before processing user message | No — injected as first system message in conversation array |

The agent sees L2 context before it reasons about the user's question, but the HTTP ack to the client is not delayed by L2 loading. Knowledge article search, page data summarization, and build context assembly can run in parallel during the background execution window.

### 13.2 Cancellation Makes Tool Deferral Safer

EP-ASYNC-COWORKER-001 adds cancel support (after 15s, the user can stop the agent). This makes L3/L4 tool-deferred content safer: if the agent calls `recall_phase_handoff` and the extra round-trip makes execution slow, the user can cancel. Without cancellation, deferring to tools risks unbounded execution with no escape.

### 13.3 SSE Observability for Arbitration

The enriched event bus from EP-ASYNC-COWORKER-001 can surface arbitration decisions:

```typescript
{ type: "context:loaded", sources: ["identity", "domain", "knowledge(3)", "page-summary"], totalTokens: 2105 }
```

This makes the budget visible in development and debuggable in production without adding a separate observability channel.

### 13.4 Attachment Deduplication Is Now Clean

The async spec's DB snapshot reconciliation (`getOrCreateThreadSnapshot` on `done`) means the client fetches messages from DB after completion. Attachments no longer need to be stuffed into the user message for client-side rendering — they're already persisted. This supports Section 6.4's recommendation to stop duplicating attachment content.

### 13.5 Implementation Sequencing

These specs can be implemented independently, but the optimal sequence is:

1. **EP-ASYNC-COWORKER-001 first** — fixes the UX-blocking problem immediately
2. **EP-CTX-001 Phase 1-2** — token counting + arbitration logic (pure functions, testable independently)
3. **EP-CTX-001 Phase 3** — refactor injection points in `agent-coworker.ts` (now refactored by async spec into `executeAgentInBackground`)
4. **EP-CTX-001 Phase 4-5** — deferred content tools + source optimizations

Phase 3 of this spec modifies `agent-coworker.ts`, which EP-ASYNC-COWORKER-001 also refactors (extracting `persistUserMessage` + `executeAgentInBackground`). Implementing async first means the context arbitrator integrates into `executeAgentInBackground` rather than the monolithic `sendMessage` — a cleaner integration point.

---

## 14. What's NOT in This Design

- **Adaptive budgets** — budgets are static per model tier. Dynamic adjustment based on conversation length or complexity is a future enhancement.
- **Cross-turn context management** — this spec covers single-turn system prompt assembly. Multi-turn context window management (sliding windows, summarization of earlier turns) is a separate concern.
- **Model-specific tokenizers** — we use a single tokenizer (cl100k_base) for budget estimation. Exact counts per model are unnecessary for this purpose.
- **Cost optimization** — this spec optimizes context quality, not inference cost. Cost is handled by the model routing tier system.
- **Prompt caching** — Anthropic's prompt caching and similar features are an inference optimization, not a context selection concern.

---

## 14. Demo Story

A product manager opens a product page in the Products & Services Sold portfolio. The system prompt is assembled:

**Before (no arbitration):**
- Block 1-4: 625 tokens (identity, authority, mode, sensitivity)
- Block 5: 400 tokens (domain context + tools + 3 knowledge article summaries)
- Block 6: 750 tokens (full page data with all backlog items, inventory, versions)
- Total: 1,775 tokens — acceptable for `strong` tier

**But on Build Studio (ship phase, with attachments):**
- Block 1-4: 625 tokens
- Block 5: 400 tokens (domain + tools)
- Build context: 2,500 tokens (brief + spec + 4 handoffs + ship phase prompt)
- Block 6: 200 tokens (build page data)
- Block 7: 1,600 tokens (3 attached files)
- Block 7 duplicate: 1,600 tokens (same content in user message)
- Knowledge: 150 tokens (3 article summaries — irrelevant during build)
- Total: **7,075 tokens** — over the `strong` budget, wasteful for ship phase

**After (with arbitration):**
- L0: 625 tokens (unchanged)
- L1: 400 tokens (domain + tools + build phase prompt)
- L2: 680 tokens (page data summary=200, build brief summary=300, latest handoff only=150, task guidance=30)
- Attachments: 400 tokens (summaries only, no duplication)
- Knowledge: dropped (budget exhausted, irrelevant to build)
- Prior handoffs: available via `recall_phase_handoff`
- Full running spec: available via `recall_build_context`
- Total: **2,105 tokens** — within `strong` budget, higher signal density

The agent can still access everything it needs — it just pulls detail through tools instead of having everything pre-loaded. The signal-to-noise ratio is dramatically better.
