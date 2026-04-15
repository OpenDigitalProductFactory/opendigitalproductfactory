# Coworker Active Capability Enforcement — Specification

**EP:** EP-AGENT-CAP-002
**Status:** Draft
**Date:** 2026-04-13
**Author:** Platform Architecture

---

## Problem Statement

The DPF routing pipeline has a silent degradation path: when a coworker that depends on tool use is routed to a provider that strips custom function tools (e.g., the ChatGPT subscription backend), `routeAndCall` retries without tools and returns a "limited mode" response. The agent continues operating — but is functionally broken.

The root cause is structural: `AgentModelConfig` has no concept of minimum active capability. It enforces quality tier and budget posture, but nothing prevents a coworker from being routed to a model that cannot do the job.

The platform owner's insight: **tool use is the floor for most coworkers, not an opt-in**. A coworker that can only read and respond is an incomplete product. Specialists that don't call tools are still expected to use some active capability — at minimum `imageInput`. No coworker on the platform should be routeable to a passive text-only model.

This spec also establishes a complete capability taxonomy for AI coworkers — expanding beyond just `toolUse` to cover all the dimensions that determine whether a model can do real work in the platform context, including knowledge retrieval (RAG), document processing, code execution, and multimodal input.

This spec completes the work started by EP-MODEL-CAP-001 (which ensured model capability data is accurate) by enforcing that accurate capability data is acted on as a hard floor per agent.

### Note on Local Model Provider Naming

The platform currently uses Docker Model Runner (built into Docker Desktop 4.40+) for local AI, but the provider is registered under `providerId: "ollama"` — a legacy misnaming. Docker Model Runner exposes an OpenAI-compatible `/v1` API at `http://model-runner.docker.internal/v1`. A separate Ollama service is no longer used.

A companion task (**EP-AGENT-CAP-002-CLEANUP**) will rename `providerId: "ollama"` to `"local"` across the DB, adapter, and UI. This spec uses `"local"` to mean the Docker Model Runner provider throughout. See §Open Questions for the rename scope.

---

## Goals

1. Add `minimumCapabilities` to `AgentModelConfig` — expressing which active capabilities an agent requires from its routed model.
2. Default all existing and newly seeded coworkers to `{ "toolUse": true }` unless explicitly overridden.
3. Enforce the floor in the routing path: if no eligible endpoint satisfies the agent's `minimumCapabilities`, return a `NoEligibleEndpointsError` with a structured reason rather than silently degrading.
4. Define the complete capability taxonomy that characterizes what a model can do for coworker routing.
5. Gate new provider activation: warn if an activated provider has no active capabilities.
6. Surface capability gaps in the admin UI.

---

## Non-Goals

- Changing which task types require tool use (that remains in `TaskRequirement.requiredCapabilities`)
- Enforcing capability requirements inside the tool grant system
- Per-tool-grant capability negotiation
- Changing the existing `requireTools` flag behavior
- The Ollama → local rename (covered by EP-AGENT-CAP-002-CLEANUP)

---

## Capability Taxonomy

The platform's `ModelCardCapabilities` interface defines 15 capability flags. For coworker routing purposes these are classified into four categories.

### Category 1: Active Capabilities (what a coworker can DO)

These are the capabilities that determine whether a model can take action. At least one must be present for a model to be useful as a coworker.

| Flag | What it enables | Coworkers that need it |
|---|---|---|
| `toolUse` | Custom function calling — call platform APIs, read/write data, trigger builds | All standard coworkers (default floor) |
| `codeExecution` | Native code execution inside the model sandbox (e.g., Python notebooks) | Build Specialist, Data Architect |
| `computerUse` | Browser and desktop control (Anthropic computer-use style) | Future: automation specialist |
| `webSearch` | Built-in search capability (not tool-based) | Future: research specialist |

**Platform rule**: Every coworker must declare at least one active capability in its `minimumCapabilities`. A model that satisfies none of these is not routeable for coworker use.

### Category 2: Input Modalities (what a model can RECEIVE)

These determine whether a model can process rich inputs beyond plain text.

| Flag | What it enables | Coworkers that need it |
|---|---|---|
| `imageInput` | Process uploaded screenshots, diagrams, UI mockups | Vision specialists (e.g., Nano Banana), any coworker doing UI review |
| `pdfInput` | Native PDF ingestion — read document structure, tables, layouts | Document Specialist, Compliance Officer |

**Platform rule**: Specialist agents whose job is to process non-text content must declare the corresponding input modality in `minimumCapabilities`. A document-processing coworker assigned to a text-only model is broken in the same way as a tool-calling coworker on ChatGPT subscription.

### Category 3: Knowledge & Context Capabilities (what enables RAG to work well)

These are NOT binary agent requirements but quality characteristics that affect how well a model works with the platform's Qdrant-backed retrieval pipeline.

**How RAG works on this platform**: When a coworker handles a message, the platform performs a vector similarity search against Qdrant (conversation memory + knowledge articles + platform knowledge) and injects retrieved chunks into the system prompt as L2 context. The model never calls a retrieval tool — the platform does the retrieval and the model reasons over the injected text.

| Flag/Field | What it enables | Routing relevance |
|---|---|---|
| `contextManagement` | Model handles long context efficiently (e.g., KV cache, sliding window) | Affects budget tier — Basic tier gets zero L2 context (no retrieved chunks) |
| `maxContextTokens` | Hard context limit | Determines how many retrieved chunks fit: frontier ≥ 6K RAG tokens, strong ≥ 3K |
| `contextRetention` (score) | Quality of reasoning over injected context (0-100) | Low score = poor RAG output quality even if context fits |
| `promptCaching` | Reduces cost on repeated system prompts with large injected context | Cost optimization for RAG-heavy agents |
| `citations` | Model can attribute claims to specific injected chunks | Future: citation-aware knowledge agents |

**RAG minimum criteria**: For a model to be useful for knowledge-intensive coworkers:
- `maxContextTokens >= 32000` (fits meaningful retrieval results)
- `contextRetention >= 60` (can reason coherently over retrieved text)
- `contextManagement: true` preferred (efficient long-context handling)

These are expressed as `preferredMinScores` and `minimumContextTokens` in `AgentModelConfig`, not as binary `minimumCapabilities` flags.

### Category 4: Reasoning & Output Capabilities

These affect quality and cost but are not enforced as coworker minimums.

| Flag | What it enables |
|---|---|
| `thinking` | Extended reasoning before responding (chain-of-thought) |
| `adaptiveThinking` | Dynamic reasoning depth based on task complexity |
| `structuredOutput` | Reliable JSON/schema output |
| `streaming` | Real-time token streaming |
| `batch` | Asynchronous batch processing |
| `effortLevels` | Variable reasoning effort (e.g., `low`, `medium`, `high`) |

`structuredOutput` and `streaming` are already enforced at the task-requirement level in `TaskRequirement.requiredCapabilities` and remain there.

---

## Coworker Minimum Criteria

An AI coworker on the DPF platform must satisfy **all three** of these criteria:

### Criterion 1: At least one active capability

The routed model must support at least one capability from Category 1:
- `toolUse: true`, OR
- `imageInput: true` (for vision specialists), OR
- `pdfInput: true` (for document specialists), OR
- `codeExecution: true`

A model with none of these is eligible only for passive workflows (greeting, summarization) and must not be routed to any registered coworker agent.

### Criterion 2: Minimum context for knowledge retrieval

The routed model must have `maxContextTokens >= 16000` to receive any L2 context (retrieved knowledge). Below this, the context budget system assigns `0` tokens to L2, meaning the coworker has no access to conversation memory or knowledge articles.

### Criterion 3: Minimum quality floor

`minimumTier` already enforces a quality floor via the `AgentModelConfig.minimumTier` field. No change needed here — this remains as-is.

---

## Known Provider Profiles (Current Active Providers)

### `codex` — `api.openai.com/v1` (gpt-5.3-codex, gpt-5.4)
- `toolUse: true`, `structuredOutput: true`, `streaming: true`, `imageInput: true`
- `maxContextTokens: 400K / 1M`, `contextRetention: 78-90`
- **Coworker eligible**: YES — all active capability criteria satisfied

### `chatgpt` — `chatgpt.com/backend-api` (gpt-5.4)
- `toolUse: false`, `structuredOutput: true`, `streaming: true`, `imageInput: true`
- **Coworker eligible**: NO — no active capability (custom tools stripped by endpoint)
- **Use case**: Passive chat-only, non-coworker workflows. Should never be routed to a registered coworker agent.

### `local` (currently `"ollama"`) — Docker Model Runner (ai/gemma4)
- `toolUse: true` (confirmed — gemma4 is in TOOL_CAPABLE_FAMILIES)
- `streaming: true`
- `imageInput: ?` — Gemma 3 27B-IT is multimodal; Gemma 4 likely yes, but must be confirmed via `/v1/models` metadata or manual capability entry
- `pdfInput: false` — no native PDF support; RAG handles document content via chunked injection
- `codeExecution: false` — no native code execution sandbox
- `contextManagement: true` — 128K context (gemma3 27B)
- `maxContextTokens: 131072` (128K)
- `contextRetention: ~65` (estimated — good but below frontier models)
- **Coworker eligible**: YES (toolUse satisfied) once imageInput is confirmed and scores verified
- **Structured output**: Supported via OpenAI-compatible API with `response_format: json_object`

### `anthropic-sub` — currently `inactive`
- All claude-4-* models: full active capabilities (toolUse, imageInput, pdfInput, thinking)
- When reactivated: highest-capability coworker provider

---

## Data Model Changes

### `AgentModelConfig` — add `minimumCapabilities` and `minimumContextTokens`

```prisma
model AgentModelConfig {
  agentId              String    @id
  minimumTier          String    @default("adequate")
  pinnedProviderId     String?
  pinnedModelId        String?
  budgetClass          String    @default("balanced")
  // EP-AGENT-CAP-002: Capability floor — model must satisfy ALL declared capabilities.
  // Null = system default { "toolUse": true }.
  // {} = passive agent — no capability floor (rare: pure summarizer).
  minimumCapabilities  Json?
  // EP-AGENT-CAP-002: Minimum context window required (for RAG/knowledge retrieval).
  // Null = use system default (16000 tokens).
  minimumContextTokens Int?
  configuredAt         DateTime  @default(now())
  configuredById       String?
  configuredBy         User?     @relation("AgentModelConfiguredBy", fields: [configuredById], references: [id])
}
```

### Migration SQL

```sql
-- EP-AGENT-CAP-002: Add capability floor fields to AgentModelConfig
ALTER TABLE "AgentModelConfig" ADD COLUMN "minimumCapabilities"  JSONB;
ALTER TABLE "AgentModelConfig" ADD COLUMN "minimumContextTokens" INTEGER;

-- Backfill all existing coworker rows to the standard default.
-- All currently seeded agents have tool_grants; toolUse: true is correct for all.
UPDATE "AgentModelConfig"
SET "minimumCapabilities" = '{"toolUse": true}'::jsonb
WHERE "minimumCapabilities" IS NULL;
```

### TypeScript types

```typescript
// apps/web/lib/routing/agent-capability-types.ts

/** Subset of ModelCardCapabilities used as a routing floor. */
export interface AgentMinimumCapabilities {
  toolUse?: boolean;
  imageInput?: boolean;
  pdfInput?: boolean;
  codeExecution?: boolean;
  computerUse?: boolean;
  webSearch?: boolean;
}

/** Runtime default when minimumCapabilities is null in DB. */
export const DEFAULT_MINIMUM_CAPABILITIES: AgentMinimumCapabilities = { toolUse: true };

/** Passive agent — no capability floor. Explicit opt-out, not a default. */
export const PASSIVE_AGENT_CAPABILITIES: AgentMinimumCapabilities = {};

/** System default minimum context window for RAG to function. */
export const DEFAULT_MINIMUM_CONTEXT_TOKENS = 16_000;

/** Check whether an endpoint satisfies an agent's minimum capability floor. */
export function satisfiesMinimumCapabilities(
  endpoint: Pick<EndpointManifest, "supportsToolUse" | "supportsImageInput" | "supportsPdfInput" | "capabilities">,
  floor: AgentMinimumCapabilities,
): { satisfied: boolean; missingCapability?: keyof AgentMinimumCapabilities } {
  if (floor.toolUse && !endpoint.supportsToolUse) return { satisfied: false, missingCapability: "toolUse" };
  if (floor.imageInput && !endpoint.supportsImageInput) return { satisfied: false, missingCapability: "imageInput" };
  if (floor.pdfInput && !endpoint.supportsPdfInput) return { satisfied: false, missingCapability: "pdfInput" };
  if (floor.codeExecution && !endpoint.capabilities?.codeExecution) return { satisfied: false, missingCapability: "codeExecution" };
  if (floor.computerUse && !endpoint.capabilities?.computerUse) return { satisfied: false, missingCapability: "computerUse" };
  return { satisfied: true };
}
```

### `EndpointManifest` — promote `imageInput` and `pdfInput` to top-level

```typescript
export interface EndpointManifest {
  // ... existing fields ...
  supportsToolUse: boolean;          // existing
  supportsImageInput: boolean;       // NEW — promoted from capabilities.imageInput
  supportsPdfInput: boolean;         // NEW — promoted from capabilities.pdfInput
  supportsCodeExecution: boolean;    // NEW — promoted from capabilities.codeExecution
}
```

Populate in `loader.ts`:
```typescript
supportsImageInput: (mp.capabilities as ModelCardCapabilities)?.imageInput === true,
supportsPdfInput: (mp.capabilities as ModelCardCapabilities)?.pdfInput === true,
supportsCodeExecution: (mp.capabilities as ModelCardCapabilities)?.codeExecution === true,
```

---

## Routing Changes

### 1. `agentic-loop.ts` — read and forward `minimumCapabilities`

```typescript
import { DEFAULT_MINIMUM_CAPABILITIES, DEFAULT_MINIMUM_CONTEXT_TOKENS } from "@/lib/routing/agent-capability-types";
import type { AgentMinimumCapabilities } from "@/lib/routing/agent-capability-types";

const rawMinCaps = agentModelConfig?.minimumCapabilities as AgentMinimumCapabilities | null | undefined;
const minimumCapabilities: AgentMinimumCapabilities =
  rawMinCaps != null ? rawMinCaps : DEFAULT_MINIMUM_CAPABILITIES;

const minimumContextTokens: number =
  agentModelConfig?.minimumContextTokens ?? DEFAULT_MINIMUM_CONTEXT_TOKENS;
```

### 2. `pipeline-v2.ts` — Stage 1 hard filter

Add BEFORE graceful tool-stripping:

```typescript
// EP-AGENT-CAP-002: Agent minimum capability floor — non-negotiable hard filter
if (contract.minimumCapabilities) {
  const check = satisfiesMinimumCapabilities(endpoint, contract.minimumCapabilities);
  if (!check.satisfied) {
    excluded = true;
    reason = `Excluded: agent requires ${check.missingCapability} capability (EP-AGENT-CAP-002)`;
    missingCapability = check.missingCapability;
  }
}

// EP-AGENT-CAP-002: Minimum context window for RAG
if (contract.minimumContextTokens && endpoint.maxContextTokens !== null) {
  if (endpoint.maxContextTokens < contract.minimumContextTokens) {
    excluded = true;
    reason = `Excluded: context window ${endpoint.maxContextTokens} < agent minimum ${contract.minimumContextTokens}`;
  }
}
```

### 3. `routed-inference.ts` — capability floor bypasses tool-stripping

```typescript
const agentRequiresTool = contract.minimumCapabilities?.toolUse === true;

if (options?.requireTools || agentRequiresTool) {
  throw new NoEligibleEndpointsError(
    taskType,
    agentRequiresTool
      ? `No tool-capable endpoint available. Agent '${agentId}' requires toolUse. ` +
        `Configure a tool-capable provider at Platform > AI > Model Assignment.`
      : `No tool-capable endpoint available.`,
    decision.excludedCount,
    "toolUse",
    contract.agentId,
  );
}
```

### 4. `NoEligibleEndpointsError` — extended with capability context

```typescript
export class NoEligibleEndpointsError extends Error {
  constructor(
    public readonly taskType: string,
    public readonly reason: string,
    public readonly excludedCount: number,
    public readonly missingCapability?: keyof AgentMinimumCapabilities,
    public readonly agentId?: string,
  ) {
    super(`No eligible endpoints for '${taskType}': ${reason}`);
    this.name = "NoEligibleEndpointsError";
  }
}
```

---

## Seed Defaults

All agents default to `{ "toolUse": true }` via the migration backfill. Explicit upserts in `seed.ts` document the intent:

| `agentId` | `minimumCapabilities` | `minimumContextTokens` | Rationale |
|---|---|---|---|
| `build-specialist` | `{ "toolUse": true }` | 32000 | Code gen tools + build context injection |
| `coo` | `{ "toolUse": true }` | 32000 | Workforce/registry reads + long planning context |
| `admin-assistant` | `{ "toolUse": true }` | 16000 | Platform config tools |
| `platform-engineer` | `{ "toolUse": true }` | 32000 | Provider management + knowledge retrieval |
| `compliance-officer` | `{ "toolUse": true }` | 32000 | Policy reads + document context |
| `finance-controller` | `{ "toolUse": true }` | 16000 | Financial data tools |
| `hr-specialist` | `{ "toolUse": true }` | 16000 | People/role tools |
| `customer-advisor` | `{ "toolUse": true }` | 16000 | CRM data reads |
| `portfolio-advisor` | `{ "toolUse": true }` | 32000 | Backlog + portfolio context |
| `inventory-specialist` | `{ "toolUse": true }` | 16000 | Product lifecycle tools |
| `ea-architect` | `{ "toolUse": true }` | 32000 | Architecture + diagram tools |
| `ops-coordinator` | `{ "toolUse": true }` | 32000 | Sprint/backlog management |
| `data-architect` | `{ "toolUse": true }` | 32000 | Schema + data pipeline tools |
| `doc-specialist` | `{ "toolUse": true }` | 32000 | Diagram generation + document context |
| `onboarding-coo` | `{ "toolUse": true }` | 16000 | Registry/backlog read tools |
| Future: Nano Banana | `{ "imageInput": true }` | 16000 | Vision specialist — no tools, processes images |
| Future: doc-ingestion | `{ "toolUse": true, "pdfInput": true }` | 64000 | Document ingestion + extraction tools |

---

## Provider Activation Gate

When an admin activates a new LLM provider, compute its active capabilities across all `ModelProfile` records. If zero models in the provider satisfy Criterion 1 (at least one active capability), show:

```
Warning: This provider's models have no active capabilities (toolUse, imageInput, pdfInput, or codeExecution).
It will not be eligible for routing to any registered coworker.
It may still be used for passive chat workflows (greeting, summarization, creative writing).
```

This is a warning, not a blocker. Passive providers are valid for non-coworker routing.

---

## Admin UI Changes

### `/platform/ai/assignments` — capability gap banner

```
⚠ N agents have no eligible endpoints for their required capabilities. View →
```

Computed by cross-joining `AgentModelConfig.minimumCapabilities` against live `EndpointManifest` records.

### Per-agent row enhancements

- **Required capabilities**: Badge row showing `[Tools]` `[Image]` `[PDF]` `[Code]`
- **Coverage**: Green (≥1 active endpoint satisfies all required caps) / Amber (only degraded) / Red (none)
- **RAG readiness**: Tooltip showing whether minimum context tokens are met

---

## Migration Strategy

### Phase 1 — Schema + seed (no behavior change)

1. Add `minimumCapabilities Json?` and `minimumContextTokens Int?` columns; backfill `{ "toolUse": true }`.
2. Promote `supportsImageInput`, `supportsPdfInput`, `supportsCodeExecution` to top-level `EndpointManifest` fields.
3. Update `seed.ts` to upsert `minimumCapabilities` and `minimumContextTokens` per coworker.
4. Deploy. Router behavior unchanged.

### Phase 2 — Routing enforcement

1. Add types and `satisfiesMinimumCapabilities` helper.
2. Update `agentic-loop.ts` to read and pass capability floor.
3. Add Stage 1 hard filter in `pipeline-v2.ts`.
4. Update `routeAndCall` degradation gate.
5. Deploy with monitoring on `NoEligibleEndpointsError` rates.

### Phase 3 — Admin UI + provider gate

1. Capability gap banner and per-agent badges.
2. Provider activation warning.

### Phase 4 — Local provider rename (EP-AGENT-CAP-002-CLEANUP)

Rename `providerId: "ollama"` → `"local"` across DB, adapter, UI, and seed. Update `onboarding-coo` pin. Remove Ollama-specific documentation that implies a separate Ollama service is required.

---

## Relation to EP-MODEL-CAP-001

| Concern | Spec |
|---|---|
| Model capability data goes stale → wrong `toolUse` in DB | EP-MODEL-CAP-001 |
| Tool-capable agents routed to tool-less endpoints despite accurate data | EP-AGENT-CAP-002 (this) |
| Local provider registered as "ollama" despite running Docker Model Runner | EP-AGENT-CAP-002-CLEANUP |

---

## Open Questions

1. **Gemma 4 `imageInput`**: Gemma 3 27B-IT is multimodal; Gemma 4 is expected to maintain this. Needs confirmation by querying the Docker Model Runner `/v1/models` endpoint for the model's declared capabilities, or by running a test image prompt. Until confirmed, `imageInput` should remain `null` (unknown) on the local provider's ModelProfile, not `false`.

2. **`onboarding-coo` capability during bootstrap**: When a customer first installs the platform, `onboarding-coo` is the first active agent and it's pinned to the local provider. If the local model isn't tool-capable (wrong variant, or Docker Model Runner not started), Phase 2 enforcement will immediately throw `NoEligibleEndpointsError`. Recommendation: bootstrap-first-run validates tool capability before `onboarding-coo` is activated; if validation fails, `minimumCapabilities` is set to `{}` with a warning surfaced in the admin.

3. **Passive agent UX**: No current agent is intentionally passive. When a future passive agent is created, admins should set it via an "Agent type" selector (Active / Vision / Document / Passive) rather than editing raw JSON. The selector maps to preset `minimumCapabilities` values.

4. **RAG minimum context as an enforced floor**: The spec proposes `minimumContextTokens` as a hard filter. This could be overly aggressive for agents where RAG is useful but not required. Alternative: make it a soft preference (affects scoring) rather than a hard filter. Recommendation: start as a soft preference in Phase 1; promote to hard filter in Phase 2 only for agents where knowledge retrieval is essential (e.g., Compliance Officer, Portfolio Advisor).

5. **Ollama rename scope**: `providerId: "ollama"` appears in 103 files. The rename affects seed data, migration, adapter registration key, UI labels, and documentation. This is a separate PR but must be coordinated with the Phase 2 rollout to avoid a window where `onboarding-coo.pinnedProviderId = "ollama"` points to a non-existent provider.

---

## Critical Files for Implementation

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add `minimumCapabilities Json?`, `minimumContextTokens Int?` to `AgentModelConfig` |
| `packages/db/prisma/migrations/TIMESTAMP_ep_agent_cap_002/migration.sql` | ALTER + backfill |
| `packages/db/src/seed.ts` | Upsert per-coworker `minimumCapabilities` + `minimumContextTokens` |
| `apps/web/lib/routing/agent-capability-types.ts` | New file — types, defaults, `satisfiesMinimumCapabilities` helper |
| `apps/web/lib/routing/loader.ts` | Promote `supportsImageInput`, `supportsPdfInput`, `supportsCodeExecution` on `EndpointManifest` |
| `apps/web/lib/routing/types.ts` | Add promoted fields to `EndpointManifest` interface |
| `apps/web/lib/routing/task-router.ts` | Stage 1 capability floor check |
| `apps/web/lib/inference/routed-inference.ts` | Capability floor in degradation gate |
| `apps/web/lib/tak/agentic-loop.ts` | Read and forward `minimumCapabilities` from `AgentModelConfig` |
| `apps/web/lib/routing/request-contract.ts` | Add `minimumCapabilities`, `minimumContextTokens` to `RequestContract` |
| `apps/web/app/(shell)/platform/ai/assignments/page.tsx` | Capability gap banner + per-agent badges |
