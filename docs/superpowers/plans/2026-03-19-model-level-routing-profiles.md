# Model-Level Routing Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move routing profiles from ModelProvider (per-provider) to ModelProfile (per-model) so each model has its own capability scores, and replace LLM-based profiling with metadata extraction + family baselines.

**Architecture:** Extend ModelProfile with routing dimension scores and lifecycle fields. Refactor the routing pipeline to select (providerId, modelId) pairs by joining ModelProfile with its parent ModelProvider. Build metadata extractors per provider format and a family baseline registry for dimension score seeding. Add discovery reconciliation for model disappearance detection.

**Tech Stack:** TypeScript, Prisma 7, Vitest, PostgreSQL, Next.js

**Spec:** `docs/superpowers/specs/2026-03-19-model-level-routing-profiles-design.md` (EP-INF-002)

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `apps/web/lib/routing/family-baselines.ts` | Static registry mapping model name patterns to baseline capability scores |
| `apps/web/lib/routing/metadata-extractor.ts` | Per-provider metadata extraction from DiscoveredModel.rawMetadata |
| `apps/web/lib/routing/metadata-extractor.test.ts` | Tests for metadata extraction |
| `apps/web/lib/routing/family-baselines.test.ts` | Tests for baseline matching |

### Modified Files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add routing fields to ModelProfile, relation to ModelProvider, missedDiscoveryCount to DiscoveredModel, selectedModelId to RouteDecisionLog, modelId to EndpointTaskPerformance |
| `apps/web/lib/routing/types.ts` | Add `modelId` to EndpointManifest and RouteDecision |
| `apps/web/lib/routing/loader.ts` | Refactor loadEndpointManifests to join ModelProfile + ModelProvider |
| `apps/web/lib/routing/fallback.ts` | Remove resolveModelId, use modelId from RouteDecision |
| `apps/web/lib/routing/pipeline.ts` | Include modelId in RouteDecision output |
| `apps/web/lib/routing/eval-runner.ts` | Target (providerId, modelId) pairs |
| `apps/web/lib/routing/production-feedback.ts` | Write to ModelProfile, not ModelProvider |
| `apps/web/lib/ai-provider-internals.ts` | Add discovery reconciliation |
| `apps/web/lib/actions/agent-coworker.ts` | Pass modelId through routing |
| `apps/web/lib/agentic-loop.ts` | FallbackResult carries modelId |
| `apps/web/lib/orchestrator-evaluator.ts` | Pass modelId to production feedback |
| `apps/web/lib/routing/index.ts` | Export new modules |
| `apps/web/components/platform/RoutingProfilePanel.tsx` | Show per-model profiles |
| `apps/web/lib/actions/endpoint-performance.ts` | Update for per-model data |

---

## Task 1: Schema Migration — Add Routing Fields to ModelProfile

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add routing fields to ModelProfile**

In `packages/db/prisma/schema.prisma`, find the `ModelProfile` model (around line 827). Add these fields after the existing `generatedAt` field:

```prisma
  // ── Relation to parent provider ──
  provider                 ModelProvider @relation(fields: [providerId], references: [providerId])

  // ── Routing Profile: Hard Constraints ──
  maxContextTokens         Int?
  maxOutputTokens          Int?
  inputPricePerMToken      Float?
  outputPricePerMToken     Float?
  supportedModalities      Json       @default("{\"input\":[\"text\"],\"output\":[\"text\"]}")

  // ── Routing Profile: Capability Scores (0-100) ──
  reasoning                Int        @default(50)
  codegen                  Int        @default(50)
  toolFidelity             Int        @default(50)
  instructionFollowingScore Int       @default(50)
  structuredOutputScore    Int        @default(50)
  conversational           Int        @default(50)
  contextRetention         Int        @default(50)
  customScores             Json       @default("{}")

  // ── Routing Profile: Provenance ──
  profileSource            String     @default("seed")
  profileConfidence        String     @default("low")
  evalCount                Int        @default(0)
  lastEvalAt               DateTime?

  // ── Lifecycle ──
  modelStatus              String     @default("active")
  retiredAt                DateTime?
  retiredReason            String?
```

Note: Field is named `modelStatus` not `status` to avoid collision with any Prisma reserved patterns. The existing `capabilityTier`, `codingCapability`, `instructionFollowing` (string fields) stay — they're used by legacy code and removed in Phase 7.

- [ ] **Step 2: Add modelProfiles relation to ModelProvider**

In the `ModelProvider` model, add:

```prisma
  modelProfiles            ModelProfile[]
```

- [ ] **Step 3: Add missedDiscoveryCount to DiscoveredModel**

In the `DiscoveredModel` model, add:

```prisma
  missedDiscoveryCount     Int        @default(0)
```

- [ ] **Step 4: Add selectedModelId to RouteDecisionLog**

In the `RouteDecisionLog` model, add:

```prisma
  selectedModelId          String?
```

- [ ] **Step 5: Add modelId to EndpointTaskPerformance**

In the `EndpointTaskPerformance` model, add:

```prisma
  modelId                  String?
```

- [ ] **Step 6: Generate and apply migration**

```bash
cd packages/db
DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx prisma db push
DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx prisma generate
```

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma
git commit -m "feat(db): add routing profile fields to ModelProfile, model lifecycle (EP-INF-002 Phase 1)"
```

---

## Task 2: Family Baseline Registry — TDD

**Files:**
- Create: `apps/web/lib/routing/family-baselines.test.ts`
- Create: `apps/web/lib/routing/family-baselines.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/routing/family-baselines.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { getBaselineForModel, type FamilyBaseline } from "./family-baselines";

describe("getBaselineForModel", () => {
  it("matches claude-sonnet models", () => {
    const baseline = getBaselineForModel("claude-sonnet-4-5");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(88);
    expect(baseline!.confidence).toBe("medium");
  });

  it("matches claude-haiku models", () => {
    const baseline = getBaselineForModel("claude-3-5-haiku-20241022");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(65);
  });

  it("matches OpenRouter namespaced models", () => {
    const baseline = getBaselineForModel("anthropic/claude-sonnet-4-5");
    expect(baseline).not.toBeNull();
    expect(baseline!.scores.reasoning).toBe(88);
  });

  it("matches gpt-4o but not gpt-4o-mini", () => {
    const full = getBaselineForModel("gpt-4o");
    const mini = getBaselineForModel("gpt-4o-mini");
    expect(full!.scores.reasoning).toBe(88);
    expect(mini!.scores.reasoning).toBe(68);
  });

  it("matches llama models by size", () => {
    const big = getBaselineForModel("llama-3.1-70b-instruct");
    const small = getBaselineForModel("llama-3.1-8b-instruct");
    expect(big!.scores.reasoning).toBeGreaterThan(small!.scores.reasoning);
  });

  it("returns null for unknown models", () => {
    const baseline = getBaselineForModel("totally-unknown-model-v1");
    expect(baseline).toBeNull();
  });

  it("does not false-match reasoning model regex on generic IDs", () => {
    const baseline = getBaselineForModel("proto1-7b");
    // Should NOT match the o1- pattern
    expect(baseline?.scores.reasoning).not.toBe(95);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/routing/family-baselines.test.ts
```

- [ ] **Step 3: Implement family-baselines.ts**

Create `apps/web/lib/routing/family-baselines.ts`:

```typescript
/**
 * EP-INF-002: Model family baseline registry.
 * Maps model name patterns to known baseline capability scores.
 * Used to seed profiles when a model is first discovered.
 */

export interface FamilyBaseline {
  scores: {
    reasoning: number;
    codegen: number;
    toolFidelity: number;
    instructionFollowing: number;
    structuredOutput: number;
    conversational: number;
    contextRetention: number;
  };
  confidence: "low" | "medium";
}

interface FamilyEntry {
  pattern: RegExp;
  baseline: FamilyBaseline;
}

// Order matters — first match wins. More specific patterns before general ones.
const FAMILY_REGISTRY: FamilyEntry[] = [
  // ── Anthropic ──
  { pattern: /claude.*opus/i, baseline: { scores: { reasoning: 95, codegen: 92, toolFidelity: 90, instructionFollowing: 92, structuredOutput: 88, conversational: 90, contextRetention: 88 }, confidence: "medium" } },
  { pattern: /claude.*sonnet/i, baseline: { scores: { reasoning: 88, codegen: 91, toolFidelity: 85, instructionFollowing: 88, structuredOutput: 82, conversational: 85, contextRetention: 80 }, confidence: "medium" } },
  { pattern: /claude.*haiku/i, baseline: { scores: { reasoning: 65, codegen: 60, toolFidelity: 62, instructionFollowing: 70, structuredOutput: 68, conversational: 72, contextRetention: 60 }, confidence: "medium" } },

  // ── OpenAI — specific before general ──
  { pattern: /gpt-4o-mini/i, baseline: { scores: { reasoning: 68, codegen: 62, toolFidelity: 65, instructionFollowing: 68, structuredOutput: 65, conversational: 70, contextRetention: 58 }, confidence: "medium" } },
  { pattern: /gpt-4o/i, baseline: { scores: { reasoning: 88, codegen: 85, toolFidelity: 88, instructionFollowing: 85, structuredOutput: 82, conversational: 85, contextRetention: 78 }, confidence: "medium" } },
  { pattern: /gpt-4-turbo/i, baseline: { scores: { reasoning: 82, codegen: 80, toolFidelity: 82, instructionFollowing: 80, structuredOutput: 78, conversational: 80, contextRetention: 72 }, confidence: "medium" } },
  { pattern: /(?:^|\/)?o[134]-/i, baseline: { scores: { reasoning: 95, codegen: 88, toolFidelity: 75, instructionFollowing: 82, structuredOutput: 75, conversational: 70, contextRetention: 80 }, confidence: "medium" } },

  // ── Meta Llama ──
  { pattern: /llama.*3\.1.*405b/i, baseline: { scores: { reasoning: 80, codegen: 75, toolFidelity: 60, instructionFollowing: 72, structuredOutput: 55, conversational: 75, contextRetention: 65 }, confidence: "low" } },
  { pattern: /llama.*3\.1.*70b/i, baseline: { scores: { reasoning: 72, codegen: 68, toolFidelity: 50, instructionFollowing: 65, structuredOutput: 48, conversational: 70, contextRetention: 55 }, confidence: "low" } },
  { pattern: /llama.*3\.1.*8b/i, baseline: { scores: { reasoning: 55, codegen: 50, toolFidelity: 40, instructionFollowing: 52, structuredOutput: 35, conversational: 58, contextRetention: 45 }, confidence: "low" } },

  // ── Google ──
  { pattern: /gemini.*2\.0.*flash/i, baseline: { scores: { reasoning: 75, codegen: 72, toolFidelity: 70, instructionFollowing: 75, structuredOutput: 70, conversational: 72, contextRetention: 68 }, confidence: "low" } },
  { pattern: /gemini.*1\.5.*pro/i, baseline: { scores: { reasoning: 82, codegen: 78, toolFidelity: 75, instructionFollowing: 80, structuredOutput: 75, conversational: 78, contextRetention: 85 }, confidence: "low" } },

  // ── Mistral ──
  { pattern: /mistral.*large/i, baseline: { scores: { reasoning: 78, codegen: 72, toolFidelity: 68, instructionFollowing: 75, structuredOutput: 65, conversational: 72, contextRetention: 65 }, confidence: "low" } },
  { pattern: /mixtral/i, baseline: { scores: { reasoning: 65, codegen: 60, toolFidelity: 50, instructionFollowing: 62, structuredOutput: 48, conversational: 65, contextRetention: 55 }, confidence: "low" } },

  // ── DeepSeek ──
  { pattern: /deepseek.*coder/i, baseline: { scores: { reasoning: 60, codegen: 88, toolFidelity: 55, instructionFollowing: 65, structuredOutput: 55, conversational: 55, contextRetention: 58 }, confidence: "low" } },
  { pattern: /deepseek.*v3/i, baseline: { scores: { reasoning: 82, codegen: 85, toolFidelity: 65, instructionFollowing: 72, structuredOutput: 60, conversational: 68, contextRetention: 70 }, confidence: "low" } },

  // ── Qwen ──
  { pattern: /qwen.*2\.5.*72b/i, baseline: { scores: { reasoning: 78, codegen: 75, toolFidelity: 55, instructionFollowing: 70, structuredOutput: 55, conversational: 68, contextRetention: 62 }, confidence: "low" } },
  { pattern: /qwen.*2\.5.*7b/i, baseline: { scores: { reasoning: 55, codegen: 52, toolFidelity: 38, instructionFollowing: 50, structuredOutput: 38, conversational: 55, contextRetention: 42 }, confidence: "low" } },

  // ── Cohere ──
  { pattern: /command-r-plus/i, baseline: { scores: { reasoning: 78, codegen: 70, toolFidelity: 72, instructionFollowing: 75, structuredOutput: 68, conversational: 75, contextRetention: 70 }, confidence: "low" } },
  { pattern: /command-r(?!-plus)/i, baseline: { scores: { reasoning: 65, codegen: 58, toolFidelity: 58, instructionFollowing: 62, structuredOutput: 55, conversational: 65, contextRetention: 58 }, confidence: "low" } },
];

/**
 * Find the baseline capability scores for a model based on its name.
 * Returns null if no family pattern matches — caller should use defaults (all 50s).
 */
export function getBaselineForModel(modelId: string): FamilyBaseline | null {
  for (const entry of FAMILY_REGISTRY) {
    if (entry.pattern.test(modelId)) {
      return entry.baseline;
    }
  }
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/routing/family-baselines.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/family-baselines.ts apps/web/lib/routing/family-baselines.test.ts
git commit -m "feat: add model family baseline registry with TDD (EP-INF-002 Phase 2)"
```

---

## Task 3: Metadata Extractor — TDD

**Files:**
- Create: `apps/web/lib/routing/metadata-extractor.test.ts`
- Create: `apps/web/lib/routing/metadata-extractor.ts`

- [ ] **Step 1: Write failing tests**

Create `apps/web/lib/routing/metadata-extractor.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { extractModelMetadata, type ExtractedMetadata } from "./metadata-extractor";

describe("extractModelMetadata", () => {
  it("extracts OpenRouter metadata", () => {
    const raw = {
      id: "anthropic/claude-sonnet-4-5",
      context_length: 200000,
      pricing: { prompt: "0.000003", completion: "0.000015" },
      supported_parameters: ["tools", "structured_outputs", "temperature", "max_tokens"],
      architecture: { modality: "text+image->text" },
    };
    const result = extractModelMetadata("openrouter", "anthropic/claude-sonnet-4-5", raw);
    expect(result.maxContextTokens).toBe(200000);
    expect(result.inputPricePerMToken).toBeCloseTo(3.0);
    expect(result.outputPricePerMToken).toBeCloseTo(15.0);
    expect(result.supportsToolUse).toBe(true);
    expect(result.supportsStructuredOutput).toBe(true);
    expect(result.inputModalities).toContain("image");
  });

  it("extracts Gemini metadata", () => {
    const raw = {
      name: "models/gemini-2.0-flash",
      inputTokenLimit: 1048576,
      outputTokenLimit: 8192,
      supportedGenerationMethods: ["generateContent"],
    };
    const result = extractModelMetadata("gemini", "gemini-2.0-flash", raw);
    expect(result.maxContextTokens).toBe(1048576);
    expect(result.maxOutputTokens).toBe(8192);
  });

  it("extracts Ollama metadata", () => {
    const raw = {
      name: "llama3.1:latest",
      size: 4661224000, // ~4.3GB ≈ 8B params
    };
    const result = extractModelMetadata("ollama", "llama3.1:latest", raw);
    expect(result.inputPricePerMToken).toBe(0);
    expect(result.outputPricePerMToken).toBe(0);
  });

  it("returns defaults for unknown provider format", () => {
    const result = extractModelMetadata("unknown-provider", "some-model", {});
    expect(result.maxContextTokens).toBeNull();
    expect(result.supportsToolUse).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/routing/metadata-extractor.test.ts
```

- [ ] **Step 3: Implement metadata-extractor.ts**

Create `apps/web/lib/routing/metadata-extractor.ts`:

```typescript
/**
 * EP-INF-002: Extract structured metadata from DiscoveredModel.rawMetadata.
 * Each provider returns different response shapes — this normalizes them.
 */

export interface ExtractedMetadata {
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  inputPricePerMToken: number | null;
  outputPricePerMToken: number | null;
  supportsToolUse: boolean | null;
  supportsStructuredOutput: boolean | null;
  inputModalities: string[];
  outputModalities: string[];
}

const EMPTY: ExtractedMetadata = {
  maxContextTokens: null,
  maxOutputTokens: null,
  inputPricePerMToken: null,
  outputPricePerMToken: null,
  supportsToolUse: null,
  supportsStructuredOutput: null,
  inputModalities: ["text"],
  outputModalities: ["text"],
};

/**
 * Extract normalized metadata from a provider's raw model response.
 */
export function extractModelMetadata(
  providerId: string,
  modelId: string,
  rawMetadata: unknown,
): ExtractedMetadata {
  const raw = rawMetadata as Record<string, unknown>;
  if (!raw || typeof raw !== "object") return { ...EMPTY };

  // Detect format by provider or response shape
  if (providerId === "ollama") return extractOllama(raw);
  if (providerId === "gemini" || providerId.startsWith("gemini")) return extractGemini(raw);
  if (raw.context_length !== undefined || raw.pricing !== undefined) return extractOpenRouter(raw);
  if (raw.inputTokenLimit !== undefined) return extractGemini(raw);
  return { ...EMPTY };
}

function extractOpenRouter(raw: Record<string, unknown>): ExtractedMetadata {
  const pricing = raw.pricing as Record<string, string> | undefined;
  const supportedParams = raw.supported_parameters as string[] | undefined;
  const arch = raw.architecture as Record<string, string> | undefined;

  // Parse modalities from "text+image->text" format
  const modality = arch?.modality ?? "text->text";
  const [inputMod, outputMod] = modality.split("->");
  const inputModalities = (inputMod ?? "text").split("+").map((m) => m.trim());
  const outputModalities = (outputMod ?? "text").split("+").map((m) => m.trim());

  return {
    maxContextTokens: typeof raw.context_length === "number" ? raw.context_length : null,
    maxOutputTokens: null, // OpenRouter doesn't expose this per-model
    inputPricePerMToken: pricing?.prompt ? parseFloat(pricing.prompt) * 1e6 : null,
    outputPricePerMToken: pricing?.completion ? parseFloat(pricing.completion) * 1e6 : null,
    supportsToolUse: supportedParams?.includes("tools") ?? null,
    supportsStructuredOutput: supportedParams?.includes("structured_outputs") ?? null,
    inputModalities,
    outputModalities,
  };
}

function extractGemini(raw: Record<string, unknown>): ExtractedMetadata {
  const methods = raw.supportedGenerationMethods as string[] | undefined;
  return {
    maxContextTokens: typeof raw.inputTokenLimit === "number" ? raw.inputTokenLimit : null,
    maxOutputTokens: typeof raw.outputTokenLimit === "number" ? raw.outputTokenLimit : null,
    inputPricePerMToken: null,
    outputPricePerMToken: null,
    supportsToolUse: methods?.includes("generateContent") ?? null,
    supportsStructuredOutput: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
  };
}

function extractOllama(raw: Record<string, unknown>): ExtractedMetadata {
  return {
    maxContextTokens: null, // Ollama doesn't report this in /api/tags
    maxOutputTokens: null,
    inputPricePerMToken: 0, // Local — free
    outputPricePerMToken: 0,
    supportsToolUse: null, // Depends on model, not reliably in metadata
    supportsStructuredOutput: null,
    inputModalities: ["text"],
    outputModalities: ["text"],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/routing/metadata-extractor.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/metadata-extractor.ts apps/web/lib/routing/metadata-extractor.test.ts
git commit -m "feat: add per-provider metadata extraction with TDD (EP-INF-002 Phase 2)"
```

---

## Task 4: Refactor Types and Loader for Model-Level Routing

**Files:**
- Modify: `apps/web/lib/routing/types.ts`
- Modify: `apps/web/lib/routing/loader.ts`

- [ ] **Step 1: Add modelId to EndpointManifest**

In `apps/web/lib/routing/types.ts`, add `modelId` to the `EndpointManifest` interface after the `providerId` field:

```typescript
  modelId: string;     // from ModelProfile
```

- [ ] **Step 2: Add selectedModelId to RouteDecision**

In `apps/web/lib/routing/types.ts`, add to `RouteDecision` after `selectedEndpoint`:

```typescript
  selectedModelId: string | null;
```

- [ ] **Step 3: Add modelId to CandidateTrace**

In `apps/web/lib/routing/types.ts`, add to `CandidateTrace` after `endpointId`:

```typescript
  modelId: string;
```

- [ ] **Step 4: Refactor loadEndpointManifests to join ModelProfile + ModelProvider**

Replace the entire `loadEndpointManifests` function in `apps/web/lib/routing/loader.ts`:

```typescript
export async function loadEndpointManifests(): Promise<EndpointManifest[]> {
  const profiles = await prisma.modelProfile.findMany({
    where: {
      modelStatus: "active",
      retiredAt: null,
      provider: {
        status: { in: ["active", "degraded"] },
        endpointType: "llm",
      },
    },
    include: {
      provider: true,
    },
  });

  return profiles.map((mp) => ({
    id: mp.providerId,                    // backward-compatible with EndpointTaskPerformance
    providerId: mp.providerId,
    modelId: mp.modelId,
    name: mp.friendlyName || mp.modelId,
    endpointType: mp.provider.endpointType,
    status: mp.provider.status as EndpointManifest["status"],
    sensitivityClearance: mp.provider.sensitivityClearance as SensitivityLevel[],
    supportsToolUse: mp.supportsToolUse || mp.provider.supportsToolUse,
    supportsStructuredOutput: mp.provider.supportsStructuredOutput,
    supportsStreaming: mp.provider.supportsStreaming,
    maxContextTokens: mp.maxContextTokens ?? mp.provider.maxContextTokens,
    maxOutputTokens: mp.maxOutputTokens ?? mp.provider.maxOutputTokens,
    modelRestrictions: mp.provider.modelRestrictions,
    // Capability scores from ModelProfile (mapped names)
    reasoning: mp.reasoning,
    codegen: mp.codegen,
    toolFidelity: mp.toolFidelity,
    instructionFollowing: mp.instructionFollowingScore,
    structuredOutput: mp.structuredOutputScore,
    conversational: mp.conversational,
    contextRetention: mp.contextRetention,
    customScores: (mp.customScores as Record<string, number>) ?? {},
    avgLatencyMs: mp.provider.avgLatencyMs,
    recentFailureRate: mp.provider.recentFailureRate,
    costPerOutputMToken: mp.outputPricePerMToken ?? mp.provider.outputPricePerMToken,
    profileSource: mp.profileSource as EndpointManifest["profileSource"],
    profileConfidence: mp.profileConfidence as EndpointManifest["profileConfidence"],
    retiredAt: mp.retiredAt,
  }));
}
```

- [ ] **Step 5: Update persistRouteDecision to include modelId**

In `loader.ts`, update `persistRouteDecision` to include `selectedModelId`:

```typescript
export async function persistRouteDecision(
  decision: import("./types").RouteDecision,
  agentMessageId?: string,
  shadowMode = false,
): Promise<string> {
  const record = await prisma.routeDecisionLog.create({
    data: {
      agentMessageId: agentMessageId ?? null,
      selectedEndpointId: decision.selectedEndpoint ?? "none",
      selectedModelId: decision.selectedModelId ?? null,
      taskType: decision.taskType,
      sensitivity: decision.sensitivity,
      reason: decision.reason,
      fitnessScore: decision.fitnessScore,
      candidateTrace: decision.candidates as any,
      excludedTrace: decision.candidates.filter((c) => c.excluded) as any,
      policyRulesApplied: decision.policyRulesApplied,
      fallbackChain: decision.fallbackChain,
      shadowMode,
    },
  });
  return record.id;
}
```

- [ ] **Step 6: Run routing tests**

```bash
cd apps/web && npx vitest run lib/routing/
```

Note: Some pipeline tests may need fixture updates to include `modelId`. Fix any failures.

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/routing/
git commit -m "feat: refactor types and loader for model-level routing (EP-INF-002 Phase 3)"
```

---

## Task 5: Update Pipeline and Fallback for Model Selection

**Files:**
- Modify: `apps/web/lib/routing/pipeline.ts`
- Modify: `apps/web/lib/routing/fallback.ts`

- [ ] **Step 1: Update pipeline to include modelId in RouteDecision**

In `apps/web/lib/routing/pipeline.ts`, find where the `RouteDecision` is constructed (the return statements). Add `selectedModelId` wherever `selectedEndpoint` is set:

For the pinned override return:
```typescript
selectedModelId: pinnedEp.modelId ?? null,
```

For the no-eligible return:
```typescript
selectedModelId: null,
```

For the main winner return:
```typescript
selectedModelId: winner.endpoint.modelId ?? null,
```

Also update `CandidateTrace` construction to include `modelId`:
```typescript
modelId: ep.modelId ?? "",
```

- [ ] **Step 2: Refactor fallback.ts — remove resolveModelId, use RouteDecision modelId**

In `apps/web/lib/routing/fallback.ts`:

1. Remove the `NON_CHAT_PATTERN` constant, `TIER_RANK` constant, and the entire `resolveModelId` function
2. Add `modelId` to the `FallbackResult` type (if not already there — check)
3. In `callWithFallbackChain`, the chain entries need to carry both `providerId` and `modelId`. Change the chain type:

Replace the chain building logic. Instead of iterating provider IDs and resolving models, the chain comes directly from the RouteDecision candidates (which now have modelId):

```typescript
// Build chain from RouteDecision — each entry is { providerId, modelId }
const selectedEntry = { providerId: decision.selectedEndpoint!, modelId: decision.selectedModelId! };
const fallbackEntries = decision.fallbackChain.map(epId => {
  const candidate = decision.candidates.find(c => c.endpointId === epId && !c.excluded);
  return { providerId: epId, modelId: candidate?.modelId ?? "" };
});
const chain = [selectedEntry, ...fallbackEntries];
```

Then iterate using `entry.providerId` and `entry.modelId` directly instead of calling `resolveModelId`.

- [ ] **Step 3: Run all routing tests**

```bash
cd apps/web && npx vitest run lib/routing/
```

Fix any test failures from the modelId additions (pipeline test fixtures may need `modelId` on endpoints).

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/routing/
git commit -m "feat: pipeline and fallback use modelId from RouteDecision (EP-INF-002 Phase 3)"
```

---

## Task 6: Update Agent Coworker and Agentic Loop

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Modify: `apps/web/lib/agentic-loop.ts`
- Modify: `apps/web/lib/orchestrator-evaluator.ts`

- [ ] **Step 1: Pass modelId through agent-coworker routing**

In `apps/web/lib/actions/agent-coworker.ts`, find where `manifestRouteDecision` is stored (around line 455). The `runAgenticLoop` call already passes `routeDecision`. The `FallbackResult` will now carry `modelId`. No changes needed here unless the coworker needs to log it — check and adjust.

- [ ] **Step 2: Update orchestrator-evaluator to pass modelId**

In `apps/web/lib/orchestrator-evaluator.ts`, find the call to `updateEndpointDimensionScores`. It currently passes `(endpointId, taskType, score)`. Add `modelId`:

```typescript
await updateEndpointDimensionScores(input.endpointId, input.modelId ?? "", input.taskType, score).catch(...)
```

Check if the `EvaluateInput` type has a `modelId` field. If not, add it.

- [ ] **Step 3: Update production-feedback.ts to accept modelId**

In `apps/web/lib/routing/production-feedback.ts`, update `updateEndpointDimensionScores` signature:

```typescript
export async function updateEndpointDimensionScores(
  endpointId: string,
  modelId: string,
  taskType: string,
  orchestratorScore: number,
): Promise<void>
```

Update the function to write `modelId` to `EndpointTaskPerformance` records.

- [ ] **Step 4: Update eval-runner.ts for model-level evals**

In `apps/web/lib/routing/eval-runner.ts`, update `runDimensionEval` to take `modelId` and write scores to `ModelProfile` instead of `ModelProvider`:

```typescript
export async function runDimensionEval(
  providerId: string,
  modelId: string,
  triggeredBy: string,
): Promise<EvalRunResult>
```

Update the score-writing section to use `prisma.modelProfile.update` instead of `prisma.modelProvider.update`.

- [ ] **Step 5: Update server action**

In `apps/web/lib/actions/endpoint-performance.ts`, update `triggerDimensionEval` to accept `modelId`:

```typescript
export async function triggerDimensionEval(endpointId: string, modelId?: string)
```

If `modelId` is provided, evaluate that specific model. If not, evaluate all active models for the provider.

- [ ] **Step 6: Run full routing test suite**

```bash
cd apps/web && npx vitest run lib/routing/
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/routing/ apps/web/lib/actions/ apps/web/lib/orchestrator-evaluator.ts apps/web/lib/agentic-loop.ts apps/web/lib/actions/agent-coworker.ts
git commit -m "feat: route through model-level profiles end-to-end (EP-INF-002 Phase 3-4)"
```

---

## Task 7: Discovery Reconciliation — Model Disappearance

**Files:**
- Modify: `apps/web/lib/ai-provider-internals.ts`

- [ ] **Step 1: Read discoverModelsInternal**

Read `apps/web/lib/ai-provider-internals.ts` and find the `discoverModelsInternal` function. Understand where models are upserted.

- [ ] **Step 2: Add reconciliation after discovery**

After the discovery upsert loop, add:

```typescript
// ── EP-INF-002: Discovery reconciliation — detect gone models ──
const isLocalProvider = providerId === "ollama";
if (!isLocalProvider) {
  const allKnown = await prisma.discoveredModel.findMany({
    where: { providerId },
    select: { id: true, modelId: true, missedDiscoveryCount: true },
  });
  const freshIds = new Set(discoveredModelIds); // the IDs from this discovery run

  for (const known of allKnown) {
    if (freshIds.has(known.modelId)) {
      // Model still exists — reset counter
      if (known.missedDiscoveryCount > 0) {
        await prisma.discoveredModel.update({
          where: { id: known.id },
          data: { missedDiscoveryCount: 0 },
        });
      }
    } else {
      // Model not in fresh list — increment counter
      const newCount = known.missedDiscoveryCount + 1;
      await prisma.discoveredModel.update({
        where: { id: known.id },
        data: { missedDiscoveryCount: newCount },
      });

      if (newCount >= 2) {
        // Retire the model profile
        await prisma.modelProfile.updateMany({
          where: { providerId, modelId: known.modelId },
          data: {
            modelStatus: "retired",
            retiredAt: new Date(),
            retiredReason: `Model no longer listed by provider after ${newCount} discovery cycles`,
          },
        });
        console.log(`[discovery] Retired model ${known.modelId} from ${providerId} (missed ${newCount} discoveries)`);
      }
    }
  }
}
```

You'll need to track `discoveredModelIds` — the set of model IDs discovered in this run. Look at how the existing discovery loop builds this.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/ai-provider-internals.ts
git commit -m "feat: add discovery reconciliation for model disappearance (EP-INF-002 Phase 5)"
```

---

## Task 8: Seed Existing ModelProfile Rows with Baselines

**Files:**
- Create: `packages/db/scripts/seed-model-baselines.ts`

- [ ] **Step 1: Create seed script**

```typescript
/**
 * EP-INF-002: Seed existing ModelProfile rows with family baseline scores
 * and extract metadata from DiscoveredModel.rawMetadata.
 * Run: DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx packages/db/scripts/seed-model-baselines.ts
 */
import { prisma } from "../src/client";

// Inline the baseline logic (or import from apps/web if module resolution works)
// For simplicity, duplicate the core pattern matching here.

interface BaselineScores {
  reasoning: number; codegen: number; toolFidelity: number;
  instructionFollowing: number; structuredOutput: number;
  conversational: number; contextRetention: number;
}

const PATTERNS: Array<{ pattern: RegExp; scores: BaselineScores; confidence: string }> = [
  { pattern: /claude.*opus/i, scores: { reasoning: 95, codegen: 92, toolFidelity: 90, instructionFollowing: 92, structuredOutput: 88, conversational: 90, contextRetention: 88 }, confidence: "medium" },
  { pattern: /claude.*sonnet/i, scores: { reasoning: 88, codegen: 91, toolFidelity: 85, instructionFollowing: 88, structuredOutput: 82, conversational: 85, contextRetention: 80 }, confidence: "medium" },
  { pattern: /claude.*haiku/i, scores: { reasoning: 65, codegen: 60, toolFidelity: 62, instructionFollowing: 70, structuredOutput: 68, conversational: 72, contextRetention: 60 }, confidence: "medium" },
  { pattern: /gpt-4o-mini/i, scores: { reasoning: 68, codegen: 62, toolFidelity: 65, instructionFollowing: 68, structuredOutput: 65, conversational: 70, contextRetention: 58 }, confidence: "medium" },
  { pattern: /gpt-4o/i, scores: { reasoning: 88, codegen: 85, toolFidelity: 88, instructionFollowing: 85, structuredOutput: 82, conversational: 85, contextRetention: 78 }, confidence: "medium" },
  { pattern: /llama.*3\.1.*70b/i, scores: { reasoning: 72, codegen: 68, toolFidelity: 50, instructionFollowing: 65, structuredOutput: 48, conversational: 70, contextRetention: 55 }, confidence: "low" },
  { pattern: /llama.*3\.1.*8b/i, scores: { reasoning: 55, codegen: 50, toolFidelity: 40, instructionFollowing: 52, structuredOutput: 35, conversational: 58, contextRetention: 45 }, confidence: "low" },
];

function findBaseline(modelId: string): { scores: BaselineScores; confidence: string } | null {
  for (const p of PATTERNS) {
    if (p.pattern.test(modelId)) return p;
  }
  return null;
}

async function main() {
  const profiles = await prisma.modelProfile.findMany();
  let seeded = 0;
  let defaulted = 0;

  for (const profile of profiles) {
    const baseline = findBaseline(profile.modelId);
    const scores = baseline?.scores ?? {
      reasoning: 50, codegen: 50, toolFidelity: 50,
      instructionFollowing: 50, structuredOutput: 50,
      conversational: 50, contextRetention: 50,
    };
    const confidence = baseline?.confidence ?? "low";

    await prisma.modelProfile.update({
      where: { id: profile.id },
      data: {
        reasoning: scores.reasoning,
        codegen: scores.codegen,
        toolFidelity: scores.toolFidelity,
        instructionFollowingScore: scores.instructionFollowing,
        structuredOutputScore: scores.structuredOutput,
        conversational: scores.conversational,
        contextRetention: scores.contextRetention,
        profileSource: "seed",
        profileConfidence: confidence,
        modelStatus: "active",
      },
    });

    if (baseline) {
      console.log(`BASELINED: ${profile.providerId}/${profile.modelId} (${confidence})`);
      seeded++;
    } else {
      console.log(`DEFAULTED: ${profile.providerId}/${profile.modelId} (all 50s)`);
      defaulted++;
    }
  }

  console.log(`\nDone: ${seeded} baselined, ${defaulted} defaulted, ${profiles.length} total`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Run the seed script**

```bash
DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx packages/db/scripts/seed-model-baselines.ts
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/scripts/seed-model-baselines.ts
git commit -m "feat(db): seed ModelProfile rows with family baseline scores (EP-INF-002 Phase 2)"
```

---

## Task 9: Update UI — Per-Model Routing Profiles

**Files:**
- Modify: `apps/web/components/platform/RoutingProfilePanel.tsx`
- Modify: `apps/web/lib/actions/endpoint-performance.ts`

- [ ] **Step 1: Update getRoutingProfile to return per-model data**

In `apps/web/lib/actions/endpoint-performance.ts`, replace `getRoutingProfile` to return an array of model profiles:

```typescript
export async function getRoutingProfiles(endpointId: string) {
  await requireViewAccess();

  const profiles = await prisma.modelProfile.findMany({
    where: { providerId: endpointId },
    select: {
      modelId: true,
      friendlyName: true,
      reasoning: true,
      codegen: true,
      toolFidelity: true,
      instructionFollowingScore: true,
      structuredOutputScore: true,
      conversational: true,
      contextRetention: true,
      profileSource: true,
      profileConfidence: true,
      evalCount: true,
      lastEvalAt: true,
      maxContextTokens: true,
      supportsToolUse: true,
      modelStatus: true,
      retiredAt: true,
    },
    orderBy: [{ modelStatus: "asc" }, { reasoning: "desc" }],
  });

  return JSON.parse(JSON.stringify(profiles));
}
```

- [ ] **Step 2: Update RoutingProfilePanel to show per-model profiles**

Refactor `apps/web/components/platform/RoutingProfilePanel.tsx` to accept an array of model profiles and render each one with its own score bars. Active models first, retired models greyed out at bottom. Each model row shows: modelId, friendlyName, 7 score bars, confidence badge, "Run Eval" button.

- [ ] **Step 3: Update provider detail page to use new data shape**

In the provider detail page, replace `getRoutingProfile(providerId)` with `getRoutingProfiles(providerId)` and pass the array to the updated panel.

- [ ] **Step 4: Update barrel exports**

Add new exports to `apps/web/lib/routing/index.ts`:

```typescript
export { getBaselineForModel } from "./family-baselines";
export { extractModelMetadata } from "./metadata-extractor";
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/platform/ apps/web/lib/actions/endpoint-performance.ts apps/web/app/ apps/web/lib/routing/index.ts
git commit -m "feat: per-model routing profiles in ops UI (EP-INF-002 Phase 6)"
```

---

## Task 10: Run Full Test Suite & Verify

- [ ] **Step 1: Run all routing tests**

```bash
cd apps/web && npx vitest run lib/routing/
```

- [ ] **Step 2: Check TypeScript compilation**

```bash
cd apps/web && npx tsc --noEmit 2>&1 | grep routing/
```

- [ ] **Step 3: Verify database state**

```bash
DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx -e "
const { prisma } = require('./packages/db/src/client');
async function main() {
  const profileCount = await prisma.modelProfile.count({ where: { profileSource: 'seed' } });
  const activeModels = await prisma.modelProfile.count({ where: { modelStatus: 'active' } });
  console.log('Seeded profiles:', profileCount);
  console.log('Active models:', activeModels);
  await prisma.\$disconnect();
}
main();
"
```

---

## Summary

After completing these 10 tasks:

1. **Schema** — ModelProfile extended with 7 dimension scores, hard constraints, provenance, lifecycle fields. Relations to ModelProvider. DiscoveredModel gains missedDiscoveryCount.
2. **Family baselines** — 20+ model families with known capability scores, TDD tested
3. **Metadata extraction** — per-provider parsers for OpenRouter, Gemini, Ollama with TDD
4. **Routing pipeline** — selects (providerId, modelId) pairs, not just providers
5. **Fallback chain** — uses modelId from RouteDecision directly, no more resolveModelId
6. **Eval loop** — targets specific models, writes to ModelProfile
7. **Production feedback** — writes to ModelProfile dimension scores
8. **Discovery reconciliation** — detects gone models, retires after 2 missed cycles (Ollama exempt)
9. **Seed data** — all existing ModelProfile rows baselined from family registry
10. **UI** — per-model routing profiles on provider detail page
