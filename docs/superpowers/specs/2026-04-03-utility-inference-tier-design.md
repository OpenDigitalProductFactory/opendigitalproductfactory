> **⚠️ SUPERSEDED** — this design doc captures an earlier iteration of routing. See [2026-04-20-routing-architecture-current.md](./2026-04-20-routing-architecture-current.md) for the current authoritative architecture.

# EP-INF-UTIL-001: Utility Inference Tier

| Field | Value |
|-------|-------|
| **Epic** | EP-INF-UTIL-001 |
| **IT4IT Alignment** | Cross-cutting: enables all value streams by providing commoditized AI operations that reduce token spend and improve context quality |
| **Depends On** | Routed Inference (EP-INF-009b, implemented), Quality Tiers (EP-INF-012, implemented), Context Budget Arbitration (EP-CTX-001, implemented), Docker Model Runner (operational) |
| **Complementary** | Knowledge Management (EP-KM-001), Async Coworker Messaging (EP-ASYNC-COWORKER-001) |
| **Status** | Draft |
| **Created** | 2026-04-03 |
| **Author** | Mark Bodman (CEO) + Claude (design partner) |

---

## 1. Problem Statement

The platform has two classes of AI inference: **conversation** (agent reasoning with the human) and **embedding** (vector generation for semantic search). Everything else — summarization, extraction, classification, compression — either doesn't exist or runs through the conversation tier, consuming expensive frontier/strong model capacity for work that a 1B-parameter local model can do in 2 seconds.

### 1.1 The Missing Middle

| Operation | Current Approach | Cost | What It Should Be |
|-----------|-----------------|------|-------------------|
| Summarize a 2,000-token phase handoff to 200 tokens | Not done — full handoff injected into context | 2,000 tokens of context window consumed per turn | Pre-summarized at write time by local model |
| Extract key points from uploaded PDF | Truncated to 500 chars | Information lost | Local model extracts 5-10 bullet points |
| Generate knowledge article abstract | Not done — full body or 80-char preview | 150 tokens of previews in context | One-line abstract generated at publish time |
| Classify article category/tags | Human must select manually | Human time | Local model suggests from content |
| Compress page data (60 backlog items) | All 60 items dumped into prompt | 500+ tokens | Summary: "47 open, 8 in-progress, 5 done across 12 epics" |
| Detect knowledge staleness vs. product changes | Not implemented | Manual review | Local model compares article content against recent changes |

### 1.2 Why Local Models

These operations share three properties:

1. **Low reasoning depth** — summarization, extraction, and classification don't need frontier-tier reasoning. A 3B-parameter model produces adequate summaries.
2. **Write-time, not request-time** — the output is computed once and stored, not generated per-conversation. A 3-second inference is invisible during a publish or upload action.
3. **No tool calling required** — these are single-shot text-in/text-out operations. Local models that struggle with multi-step tool orchestration are perfectly capable of summarization.

Docker Model Runner is already in the stack. The `basic` tier models (Llama, Phi, Qwen) are already discoverable. The routing pipeline already supports local-only dispatch. What's missing is the abstraction that says "this operation is a utility, route it to the cheapest available model."

### 1.3 What This Is NOT

- **Not a new model provider** — uses existing Docker Model Runner / Ollama provider
- **Not a new routing pipeline** — extends the existing `routeAndCall()` with a utility contract family
- **Not real-time inference** — utility operations are background/write-time, never in the conversation loop
- **Not a replacement for embeddings** — embedding generation remains a dedicated adapter (`embedding-adapter.ts`)

---

## 2. Design Principles

| # | Principle | Rationale |
|---|-----------|-----------|
| P1 | **Write-time, not read-time** | Utility outputs are computed when data is created/modified, not when the agent needs them. A 3-second local inference during article publish is invisible; during conversation it's blocking. |
| P2 | **Store the output, not the prompt** | Utility results are persisted alongside the source data (e.g., `summary` field on the model). The conversation tier reads the stored result, never re-derives it. |
| P3 | **Local-first, cloud-fallback** | Prefer Docker Model Runner. If unavailable, fall back to the cheapest cloud model (`adequate` tier). If all fail, degrade gracefully — use truncation instead of summarization. |
| P4 | **Fire-and-forget with retry** | Utility operations are non-blocking. If the local model is busy, queue the operation. If it fails, retry once. If it still fails, store a truncated fallback. |
| P5 | **One function, many uses** | A single `utilityInfer()` function handles all operations. The caller provides the task template; the function handles routing, retry, and fallback. |

---

## 3. Inference Class Taxonomy

The platform now has three classes of AI inference:

| Class | Purpose | Models | Latency Requirement | Output Lifetime |
|-------|---------|--------|-------------------|-----------------|
| **Conversation** | Interactive agent reasoning | frontier/strong/adequate | < 30s response time | Single turn |
| **Embedding** | Vector generation for semantic search | nomic-embed-text (local) | < 5s | Until re-indexed |
| **Utility** (new) | Background data preparation | basic/adequate (local preferred) | < 10s, non-blocking | Until source data changes |

### 3.1 Utility Operations Catalog

| Operation | Input | Output | When Triggered | Stored Where |
|-----------|-------|--------|---------------|-------------|
| `summarize` | Long text (> 500 tokens) | 1-3 sentence summary | Data write/update | `summary` field on source model |
| `extract_key_points` | Document text | 5-10 bullet points | File upload | Attachment metadata |
| `classify` | Article/item text | Category + tags | Article creation | Suggested fields (human confirms) |
| `compress_page_data` | Full route context output | Summary paragraph | Route context generation | Cached per route, invalidated on data change |
| `generate_abstract` | Knowledge article body | One-line abstract | Article publish | `KnowledgeArticle` model (new field) |
| `detect_drift` | Article + recent product changes | Drift score + explanation | Scheduled / on product change | Staleness metadata |
| `extract_entity_metadata` | Unstructured text | Structured fields (names, dates, amounts) | Import/paste operations | Parsed entity fields |

---

## 4. The `utilityInfer()` Function

### 4.1 Interface

New module: `apps/web/lib/inference/utility-inference.ts`

```typescript
export type UtilityTask =
  | "summarize"
  | "extract_key_points"
  | "classify"
  | "compress"
  | "generate_abstract"
  | "detect_drift"
  | "extract_metadata";

export type UtilityInferenceResult = {
  output: string;
  modelId: string;
  providerId: string;
  inputTokens: number;
  outputTokens: number;
  inferenceMs: number;
  fallback: boolean;  // true if truncation was used instead of inference
};

export async function utilityInfer(params: {
  task: UtilityTask;
  input: string;
  maxOutputTokens?: number;
  context?: string;  // Additional context (e.g., product name for drift detection)
}): Promise<UtilityInferenceResult>;
```

### 4.2 Routing Strategy

`utilityInfer()` uses the existing `routeAndCall()` pipeline with a utility-specific contract:

```typescript
const contract: Partial<RequestContract> = {
  contractFamily: `utility.${params.task}`,
  taskType: params.task,
  interactionMode: "sync",
  requiresTools: false,
  requiresStrictSchema: false,
  requiresStreaming: false,
  reasoningDepth: "minimal",
  budgetClass: "minimize_cost",
  residencyPolicy: "local_only",  // Prefer local; see fallback below
  estimatedInputTokens: countTokens(params.input),
  estimatedOutputTokens: params.maxOutputTokens ?? 200,
};
```

**Routing priority:**
1. Docker Model Runner (local) — `residencyPolicy: "local_only"`
2. If local unavailable, retry with `"any_enabled"` and `budgetClass: "minimize_cost"` — cheapest cloud model
3. If all inference fails, return truncated input as fallback with `fallback: true`

### 4.3 Task Templates

Each utility task has a system prompt template optimized for small models:

```typescript
const TASK_TEMPLATES: Record<UtilityTask, string> = {
  summarize:
    "Summarize the following text in 1-3 sentences. Be concise and preserve key facts. Output only the summary, nothing else.",
  extract_key_points:
    "Extract 5-10 key points from the following text as a bullet list. Each point should be one sentence. Output only the bullet list.",
  classify:
    "Classify the following text. Output a JSON object with 'category' (one of: process, policy, decision, how-to, reference, troubleshooting, runbook) and 'tags' (array of 3-5 relevant keywords). Output only the JSON.",
  compress:
    "Compress the following data into a brief summary paragraph. Include counts, status distribution, and key metrics. Output only the summary paragraph.",
  generate_abstract:
    "Write a one-line abstract (under 20 words) for the following article. Output only the abstract.",
  detect_drift:
    "Compare the article content against the recent changes described below. Rate drift risk as low/medium/high and explain in one sentence. Output only the rating and explanation.",
  extract_metadata:
    "Extract structured data from the following text. Output a JSON object with any names, dates, amounts, identifiers, and categories found.",
};
```

These prompts are short (< 50 tokens), imperative, and format-constrained — optimized for small models that struggle with open-ended instructions.

### 4.4 Input Size Limits

Local models have small context windows (2K-8K tokens). The utility function enforces limits:

| Task | Max Input Tokens | Truncation Strategy |
|------|-----------------|-------------------|
| `summarize` | 2,000 | Keep first 2,000 tokens |
| `extract_key_points` | 3,000 | Keep first 3,000 tokens |
| `classify` | 1,000 | Keep first 1,000 tokens |
| `compress` | 2,000 | Keep first 2,000 tokens |
| `generate_abstract` | 2,000 | Keep first 2,000 tokens |
| `detect_drift` | 1,500 (article) + 500 (changes) | Truncate each independently |
| `extract_metadata` | 1,000 | Keep first 1,000 tokens |

If input exceeds the limit, truncate before sending — don't rely on the model to handle overflow gracefully.

---

## 5. Integration Points

### 5.1 Knowledge Article Publish (EP-KM-001)

When an article is published via `publishKnowledgeArticle()`:

```typescript
// After status update, before Qdrant indexing
const { utilityInfer } = await import("@/lib/inference/utility-inference");
const abstractResult = await utilityInfer({
  task: "generate_abstract",
  input: article.body,
});
// Store abstract for context arbitrator's L2 injection
await prisma.knowledgeArticle.update({
  where: { id },
  data: { abstract: abstractResult.output },
});
```

**Schema addition:** Add `abstract String?` field to `KnowledgeArticle` model.

### 5.2 Context Arbitrator Compression (EP-CTX-001)

When the arbitrator needs `compressedContent` for page data:

```typescript
// In route context provider, after generating full output
const { utilityInfer } = await import("@/lib/inference/utility-inference");
const compressed = await utilityInfer({
  task: "compress",
  input: fullPageData,
  maxOutputTokens: 150,
});
return {
  detail: fullPageData,
  summary: compressed.fallback ? fullPageData.slice(0, 400) : compressed.output,
};
```

This is cached per route — recomputed only when underlying data changes (via `revalidatePath`).

### 5.3 Phase Handoff Summarization

When a `PhaseHandoff` is created during build phase transition:

```typescript
const { utilityInfer } = await import("@/lib/inference/utility-inference");
const summaryResult = await utilityInfer({
  task: "summarize",
  input: JSON.stringify({ summary: handoff.summary, decisions: handoff.decisions, openIssues: handoff.openIssues }),
});
// Store alongside the handoff
await prisma.phaseHandoff.update({
  where: { id: handoff.id },
  data: { compressedSummary: summaryResult.output },
});
```

**Schema addition:** Add `compressedSummary String?` field to `PhaseHandoff` model.

### 5.4 Attachment Processing

When a file is uploaded and parsed:

```typescript
const { utilityInfer } = await import("@/lib/inference/utility-inference");
const keyPoints = await utilityInfer({
  task: "extract_key_points",
  input: parsedText,
});
// Store key points as attachment metadata
```

### 5.5 Knowledge Article Category Suggestion

In the `create_knowledge_article` MCP tool handler:

```typescript
if (!params.category) {
  const { utilityInfer } = await import("@/lib/inference/utility-inference");
  const classification = await utilityInfer({
    task: "classify",
    input: `${params.title}\n${params.body}`,
  });
  // Parse JSON output, use as default (human can override)
}
```

---

## 6. Graceful Degradation

The utility tier must never block platform operations. If inference is unavailable:

| Failure | Fallback | User Impact |
|---------|----------|-------------|
| Local model unavailable | Try cheapest cloud model | None — slightly higher cost |
| All inference unavailable | Truncate input to configured length | Summaries are less useful but present |
| Model returns garbage | Detect via length/format check, use truncation | Same as above |
| Model too slow (> 10s) | Abort, use truncation | None — write-time operation |

The `fallback: true` flag in the result tells the caller that truncation was used instead of real inference. Callers can log this for monitoring.

### 6.1 Quality Validation

Utility outputs are validated before storage:

| Task | Validation | On Failure |
|------|-----------|------------|
| `summarize` | Output length 10-500 chars, no repetition | Use first 200 chars of input |
| `extract_key_points` | Contains at least 2 bullet points | Use first 400 chars of input |
| `classify` | Valid JSON with expected fields | Return null (human selects) |
| `compress` | Output shorter than input | Use first 400 chars of input |
| `generate_abstract` | Output under 100 chars | Use first 80 chars of title+body |
| `detect_drift` | Contains "low"/"medium"/"high" | Return "unknown" |
| `extract_metadata` | Valid JSON | Return empty object |

---

## 7. Metrics and Observability

### 7.1 Prometheus Metrics

```typescript
// Utility inference outcomes
utilityInferenceOps: Counter    // labels: task, status (success|fallback|error), provider
utilityInferenceLatency: Histogram  // labels: task, provider
utilityInferenceTokens: Histogram   // labels: task, direction (input|output)
```

### 7.2 Cost Tracking

Utility operations use the existing `TokenUsage` table with `contextKey: "utility:{task}"`. This allows cost analysis per utility operation type.

### 7.3 Admin Dashboard

Add to the AI Workforce page:
- Utility operations count (24h)
- Fallback rate (% of operations that used truncation)
- Average latency by task type
- Token spend on utility vs. conversation vs. embedding

---

## 8. Hardware Considerations

### 8.1 Model Selection for Utility Tasks

The existing hardware detection (`selectModelForHardware`) selects a single model for conversation. Utility tasks have different requirements:

| Hardware | Conversation Model | Utility Model | Rationale |
|----------|-------------------|---------------|-----------|
| < 4GB VRAM | tinyllama (~0.6GB) | tinyllama | Same model — limited capacity |
| 4-8GB VRAM | phi3:mini (~2.3GB) | phi3:mini | Adequate for summarization |
| 8GB+ VRAM | llama3.1:8b (~5GB) | phi3:mini or qwen2.5:3b | Use smaller model — leaves VRAM for conversation |
| 16GB+ VRAM | llama3.1:8b | llama3.1:8b | Plenty of headroom for concurrent use |

**Key constraint:** Utility inference runs concurrently with conversation inference. If both use the same 5GB model on an 8GB GPU, one will be swapped to CPU. The utility tier should prefer a smaller model to avoid VRAM contention.

### 8.2 Configuration

Add to `AgentModelConfig` or a new `UtilityModelConfig`:

```typescript
// Optional admin override for utility model
utilityProviderId: "ollama"  // Default: same as local provider
utilityModelId: "phi3:mini"  // Default: selected by hardware detection
```

If not configured, the utility tier uses the hardware detection logic to select the smallest adequate model.

---

## 9. Implementation Order

### Phase 1: Core Function

1. Create `apps/web/lib/inference/utility-inference.ts` with `utilityInfer()`, task templates, input limits
2. Wire into `routeAndCall()` with `minimize_cost` + `local_only` contract
3. Add graceful fallback (truncation when inference unavailable)
4. Add quality validation per task type
5. Add Prometheus metrics

### Phase 2: Knowledge Integration

6. Add `abstract` field to `KnowledgeArticle` Prisma model
7. Generate abstract on article publish via `utilityInfer("generate_abstract")`
8. Update context arbitrator to use stored abstracts instead of article previews
9. Add category suggestion to `create_knowledge_article` MCP tool

### Phase 3: Context Compression

10. Add `compressedSummary` field to `PhaseHandoff` model
11. Generate compressed handoff on phase transition
12. Update build context injection to use compressed summaries
13. Add `compress` calls to route context providers (ops, compliance, inventory)

### Phase 4: Attachment Enhancement

14. Integrate `extract_key_points` into file upload processing
15. Store key points as attachment metadata
16. Update attachment context injection to use key points instead of raw text

### Phase 5: Observability

17. Add utility operations to AI Workforce admin dashboard
18. Add cost comparison: utility vs. conversation token spend
19. Add fallback rate monitoring and alerting

---

## 10. Files Affected

### New Files

| File | Purpose |
|------|---------|
| `apps/web/lib/inference/utility-inference.ts` | Core `utilityInfer()` function, task templates, validation |
| `apps/web/lib/inference/utility-inference.test.ts` | Unit tests for templates, validation, fallback logic |

### Modified Files

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add `abstract` to `KnowledgeArticle`, `compressedSummary` to `PhaseHandoff` |
| `apps/web/lib/actions/knowledge.ts` | Generate abstract on publish |
| `apps/web/lib/mcp-tools.ts` | Category suggestion in `create_knowledge_article` handler |
| `apps/web/lib/tak/context-arbitrator.ts` | Use stored abstracts for knowledge L2 content |
| `apps/web/lib/integrate/build-agent-prompts.ts` | Use compressed handoff summaries |
| `apps/web/lib/tak/route-context.ts` | Add `compress` calls for large route contexts |
| `apps/web/lib/metrics.ts` | Utility inference metrics |

---

## 11. Relationship to Other Specs

### EP-CTX-001 (Context Budget Arbitration)

The utility tier fills the `compressedContent` field that the arbitrator uses for budget-constrained injection. Without utility inference, `compressedContent` is simple truncation. With it, `compressedContent` is an intelligent summary that preserves meaning in fewer tokens.

The arbitrator's L2 budget for knowledge pointers (~45 tokens) was designed assuming title-only injection. With utility-generated abstracts, the pointer can include the abstract (still under 60 tokens) without needing the agent to call `search_knowledge_base` for basic context.

### EP-ASYNC-COWORKER-001 (Async Messaging)

The async messaging architecture's two-phase context loading (Section 13.1 of EP-CTX-001) can leverage utility inference for the deferred L2 phase. While the agent starts with L0+L1, the L2 compression runs in parallel using the utility tier. The compressed page data arrives before the agent processes the user message.

### EP-KM-001 (Knowledge Management)

Knowledge articles gain an `abstract` field populated by the utility tier at publish time. This abstract replaces the 80-char content preview in both the Qdrant payload and the context arbitrator's L2 injection — better summaries in fewer tokens.

### EP-TAK-PATTERNS (Agentic Architecture)

The utility tier adds a third inference class to the architecture patterns spec. Future implementations should check: "Is this a conversation, an embedding, or a utility operation?" and route accordingly.

---

## 12. Demo Story

A product manager publishes a knowledge article titled "Cloud Infrastructure Procurement Policy" with a 3,000-word body. The platform:

1. **Generates an abstract** via the local Phi-3 model: "Approval workflow and cost thresholds for cloud infrastructure purchases exceeding departmental budgets." (stored in `abstract` field, 15 tokens)

2. **Indexes into Qdrant** with the abstract as `contentPreview` instead of the first 500 characters of the body.

3. When the AI coworker starts a conversation on this product's page, the **context arbitrator** injects a knowledge pointer:
   ```
   KNOWLEDGE: 3 articles — use search_knowledge_base for details.
   - KA-015: "Cloud Infrastructure Procurement Policy" (policy)
   ```
   Cost: 25 tokens. The agent knows the article exists and can pull the full body via tool if needed.

4. Meanwhile, the ops backlog page has 60 items. Instead of injecting all 60 (500+ tokens), the **utility tier compresses** them:
   ```
   Operations: 60 backlog items — 32 open, 18 in-progress, 10 done across 8 epics.
   Top priorities: EP-015 infrastructure migration (12 items), EP-022 compliance audit (8 items).
   ```
   Cost: 50 tokens instead of 500.

5. A build reaches ship phase with 4 prior handoffs totaling 8,000 tokens. Each handoff was **summarized at write time**:
   ```
   Phase handoffs: ideate→plan (architecture decided, 3 constraints), plan→build (12 tasks, sandbox configured),
   build→review (all tests pass, 2 review items), review→ship (approved with conditions).
   ```
   Cost: 60 tokens instead of 2,000. The agent calls `recall_phase_handoff` if it needs the full history.

Total context saving in this scenario: **~2,900 tokens** replaced by **~135 tokens** of utility-generated summaries. The local model consumed ~3 seconds of inference across all operations — invisible to the user since it happened at write time.
