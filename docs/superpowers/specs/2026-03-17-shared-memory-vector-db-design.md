# EP-MEMORY-001: Shared Agent Memory with Qdrant Vector Database — Design Spec

**Date:** 2026-03-17
**Goal:** Give AI co-workers persistent semantic memory across conversations using Qdrant vector database. Agents recall relevant past interactions and platform knowledge to provide better, context-aware responses.

---

## 1. Architecture

```
User sends message
    ↓
sendMessage() builds prompt
    ↓
Query Qdrant: top 5 similar past messages (cross-thread)
    ↓
Inject recalled context into system prompt
    ↓
LLM generates response
    ↓
Fire-and-forget: embed message + response → upsert to Qdrant
```

**Two Qdrant collections:**
- `agent-memory` — conversation message embeddings with metadata (threadId, agentId, userId, routeContext, timestamp)
- `platform-knowledge` — backlog items, epic descriptions, improvement proposals, spec summaries

**Embedding provider:** Ollama local (`nomic-embed-text`, 768 dimensions, 274MB). Cloud fallback architected in the embedding interface but not implemented (see EP-MEMORY-002 placeholder).

---

## 2. Docker Setup

Add to `docker-compose.yml`:

```yaml
qdrant:
  image: qdrant/qdrant:latest
  restart: unless-stopped
  ports:
    - "${QDRANT_HOST_PORT:-6333}:6333"
  volumes:
    - qdrant_data:/qdrant/storage
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:6333/readyz"]
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 10s
  environment:
    QDRANT__SERVICE__GRPC_PORT: "6334"
```

Add `qdrant_data:` to the volumes section.

**Environment variables:**
```
QDRANT_URL=http://localhost:6333         # host dev
QDRANT_INTERNAL_URL=http://qdrant:6333   # Docker internal
```

---

## 3. Qdrant Client Module

`packages/db/src/qdrant.ts` — follows Neo4j singleton pattern:

- `getQdrantUrl()` — returns `QDRANT_INTERNAL_URL` (Docker) or `QDRANT_URL` (dev) or fallback `http://localhost:6333`
- `ensureCollections()` — creates collections if they don't exist:
  - `agent-memory`: 768 dimensions, cosine distance, payload indexes on userId, agentId, routeContext
  - `platform-knowledge`: 768 dimensions, cosine distance, payload indexes on type, entityId
- `upsertVectors(collection, points)` — batch upsert with id, vector, payload
- `searchSimilar(collection, vector, filter?, limit?)` — filtered similarity search
- `deleteVectors(collection, filter)` — remove by payload filter

All operations use Qdrant's REST API via `fetch` — no SDK dependency needed. Keeps the dependency footprint minimal.

---

## 4. Embedding Pipeline

`apps/web/lib/embedding.ts`:

```typescript
export async function generateEmbedding(text: string): Promise<number[] | null>
```

- Calls Ollama's `/api/embeddings` endpoint with model `nomic-embed-text`
- Returns 768-dimensional vector or null on failure
- Truncates input to 8192 tokens (model limit)
- Graceful failure — if Ollama is down or model not available, returns null (memory features degrade silently, chat still works)

**Auto-pull:** The Ollama entrypoint script (`scripts/ollama-entrypoint.sh`) will be updated to also pull `nomic-embed-text` alongside the chat model.

---

## 5. Semantic Memory Module

`apps/web/lib/semantic-memory.ts`:

### Store Memory

Called after each message save in `sendMessage` (fire-and-forget):

```typescript
export async function storeConversationMemory(params: {
  messageId: string;
  content: string;
  role: "user" | "assistant";
  userId: string;
  agentId: string;
  routeContext: string;
  threadId: string;
}): Promise<void>
```

- Generates embedding for `content`
- Upserts to `agent-memory` collection with payload: messageId, userId, agentId, routeContext, threadId, role, contentPreview (first 200 chars), timestamp

### Recall Memory

Called before building the agent prompt in `sendMessage`:

```typescript
export async function recallRelevantContext(params: {
  query: string;
  userId: string;
  limit?: number;
}): Promise<string | null>
```

- Generates embedding for the user's current message
- Searches `agent-memory` collection filtered by userId, excluding current thread
- Returns top 5 results formatted as context block, or null if no relevant matches (score threshold: 0.7)

### Store Platform Knowledge

Called on backlog/epic/improvement create/update:

```typescript
export async function storePlatformKnowledge(params: {
  entityId: string;
  entityType: "backlog" | "epic" | "improvement" | "spec";
  title: string;
  content: string;
}): Promise<void>
```

### Search Platform Knowledge

Available as an MCP tool for agents:

```typescript
export async function searchPlatformKnowledge(params: {
  query: string;
  entityType?: string;
  limit?: number;
}): Promise<Array<{ entityId: string; title: string; score: number }>>
```

---

## 6. Agent Integration

In `sendMessage()` (agent-coworker.ts), two additions:

### Before prompt building (recall):
```typescript
const recalledContext = await recallRelevantContext({
  query: userMessageContent,
  userId: user.id,
}).catch(() => null);

if (recalledContext) {
  promptSections.push(recalledContext);
}
```

### After message save (store, fire-and-forget):
```typescript
storeConversationMemory({
  messageId: userMsg.id,
  content: userMessageContent,
  role: "user",
  userId: user.id,
  agentId: agent.agentId,
  routeContext: input.routeContext,
  threadId: input.threadId,
}).catch(() => {});

storeConversationMemory({
  messageId: agentMsg.id,
  content: responseContent,
  role: "assistant",
  userId: user.id,
  agentId: agent.agentId,
  routeContext: input.routeContext,
  threadId: input.threadId,
}).catch(() => {});
```

---

## 7. Files Affected

### New Files (3)
| File | Purpose |
|------|---------|
| `packages/db/src/qdrant.ts` | Singleton client, collection management, REST API wrapper |
| `apps/web/lib/embedding.ts` | Generate embeddings via Ollama local |
| `apps/web/lib/semantic-memory.ts` | Store/recall conversation memory, store/search platform knowledge |

### Modified Files (4)
| File | Change |
|------|--------|
| `docker-compose.yml` | Add qdrant service + volume |
| `packages/db/src/index.ts` | Export qdrant functions |
| `apps/web/lib/actions/agent-coworker.ts` | Recall context before prompt, store memories after message |
| `scripts/ollama-entrypoint.sh` | Auto-pull nomic-embed-text model |

---

## 8. Implementation Order (3 Chunks)

1. **Docker + Qdrant client + collections** — Add service to docker-compose, create qdrant.ts client, ensure collections on startup, export from @dpf/db
2. **Embedding pipeline + memory store** — embedding.ts with Ollama integration, semantic-memory.ts store functions, wire into sendMessage for fire-and-forget storage
3. **Semantic recall + platform knowledge** — recall function, inject into agent prompt, platform knowledge indexing on backlog/epic changes

---

## 9. Not In Scope (v1)

- Cloud embedding fallback (EP-MEMORY-002 — epic placeholder)
- Platform knowledge auto-indexing of all existing data (manual trigger only)
- Memory management UI (view/delete stored memories)
- Per-agent memory isolation (all agents share memory pool, filtered by userId)
- Memory summarization/compression (raw messages stored, no consolidation)
- Cross-user knowledge sharing (memory is per-user only)

---

## 10. Epic Placeholder: Cloud Embedding Fallback

**EP-MEMORY-002: Cloud Embedding Provider Fallback**

When Ollama is unavailable or for higher-quality embeddings, fall back to cloud providers (OpenAI `text-embedding-3-small`, Cohere `embed-english-v3.0`). Follows the existing provider failover pattern. Architected in the embedding.ts interface but not implemented in v1.
