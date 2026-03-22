# NVIDIA Provider Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate NVIDIA cloud API (build.nvidia.com) and local NIM as two providers with full catalog discovery, sensitivity-driven routing, and unified admin experience.

**Architecture:** Dual-provider pattern (`nvidia-cloud`, `nvidia-nim`) with entries in `providers-registry.json`, baseline scores in `family-baselines.ts`, model classification patterns in `model-classifier.ts`, metadata adapter registration, and generalized local-provider routing in `pipeline-v2.ts`. Health check generalizes the Ollama pattern. UI groups both under a single NVIDIA card.

**Tech Stack:** TypeScript, Prisma, Vitest, Next.js React components, Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-22-nvidia-provider-integration-design.md`

---

## File Map

| File | Responsibility |
|------|----------------|
| `packages/db/data/providers-registry.json` | Add `nvidia-cloud` and `nvidia-nim` provider definitions |
| `apps/web/lib/routing/provider-utils.ts` | Add `isNvidia()` and `isLocalProvider()` helpers |
| `apps/web/lib/routing/model-classifier.ts` | Add NVIDIA model ID patterns, fix `^` anchoring for namespaced IDs |
| `apps/web/lib/routing/model-classifier.test.ts` | Tests for new patterns |
| `apps/web/lib/routing/family-baselines.ts` | Add Nemotron family baseline scores |
| `apps/web/lib/routing/adapter-registry.ts` | Register OpenAI adapter for both NVIDIA providers |
| `apps/web/lib/routing/pipeline-v2.ts` | Generalize `local_only` residency check |
| `apps/web/lib/routing/pipeline-v2.test.ts` | Tests for `nvidia-nim` as valid local provider |
| `apps/web/lib/local-provider-health.ts` | Generalized health check for local providers (replaces Ollama-only pattern) |
| `packages/db/scripts/seed-routing-profiles.ts` | Add NVIDIA provider capability scores |
| `packages/db/scripts/seed-model-baselines.ts` | Add Nemotron family patterns |
| `apps/web/components/platform/ServiceSection.tsx` | Group NVIDIA providers under one card |

---

## Task 1: Provider Registry Entries

**Files:**
- Modify: `packages/db/data/providers-registry.json`

- [ ] **Step 1: Add `nvidia-cloud` entry to providers-registry.json**

Insert after the `ollama` entry (line ~209) in `providers-registry.json`:

```json
{
  "providerId": "nvidia-cloud",
  "name": "NVIDIA Cloud (build.nvidia.com)",
  "category": "direct",
  "baseUrl": "https://integrate.api.nvidia.com/v1",
  "authMethod": "api_key",
  "supportedAuthMethods": ["api_key"],
  "authHeader": "Authorization",
  "costModel": "token",
  "families": ["nemotron", "llama", "mistral", "phi", "starcoder"],
  "inputPricePerMToken": 2.00,
  "outputPricePerMToken": 6.00,
  "docsUrl": "https://build.nvidia.com/docs",
  "consoleUrl": "https://build.nvidia.com",
  "billingLabel": "Pay-per-use · NVIDIA AI credits",
  "costPerformanceNotes": "OpenAI-compatible API with 100+ models. Namespaced model IDs (org/model-name).",
  "catalogVisibility": "visible",
  "userFacing": {
    "plainDescription": "NVIDIA's cloud AI platform with access to 100+ models including Nemotron, Llama, Mistral, and specialized domain models.",
    "authExplained": "API key — generated from your NVIDIA NGC account at build.nvidia.com.",
    "costTier": "pay-per-use",
    "costExplained": "Pay-per-token pricing via NVIDIA AI credits. Competitive rates across a wide model catalog.",
    "capabilitySummary": "Broad catalog of chat, code, embedding, and domain-specific models. Strong GPU-optimized inference.",
    "limitations": "Data is processed on NVIDIA's cloud servers. Not suitable for data requiring on-premise processing.",
    "dataResidency": "United States (NVIDIA servers).",
    "setupDifficulty": "easy",
    "regulatoryNotes": "NVIDIA enterprise agreements available. Review data processing terms for regulated data."
  }
}
```

- [ ] **Step 2: Add `nvidia-nim` entry to providers-registry.json**

Insert immediately after the `nvidia-cloud` entry:

```json
{
  "providerId": "nvidia-nim",
  "name": "NVIDIA NIM (Local)",
  "category": "direct",
  "baseUrl": null,
  "authMethod": "none",
  "supportedAuthMethods": ["none"],
  "authHeader": null,
  "costModel": "compute",
  "families": [],
  "computeWatts": 300,
  "electricityRateKwh": 0.12,
  "docsUrl": "https://docs.nvidia.com/nim/",
  "consoleUrl": null,
  "billingLabel": "Local compute · electricity cost only",
  "costPerformanceNotes": "Self-hosted NVIDIA NIM containers. GPU-optimized local inference. OpenAI-compatible API.",
  "catalogVisibility": "visible",
  "userFacing": {
    "plainDescription": "NVIDIA's optimized inference runtime running on your own GPU hardware. No data leaves your network.",
    "authExplained": "None needed — NIM runs on your own infrastructure.",
    "costTier": "free",
    "costExplained": "Costs only the electricity to run your GPU. No per-use charges.",
    "capabilitySummary": "GPU-optimized local inference for chat, code, and embedding models. Better performance than Ollama on NVIDIA hardware.",
    "limitations": "Requires NVIDIA GPU with sufficient VRAM. Model selection limited to what you deploy locally.",
    "dataResidency": "Your machine. Nothing leaves.",
    "setupDifficulty": "moderate",
    "regulatoryNotes": "Maximum privacy. Suitable for all sensitivity levels including restricted/regulated data."
  }
}
```

- [ ] **Step 3: Run the provider registry sync to verify**

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter @dpf/db exec tsx scripts/sync-provider-registry.ts
```

Expected: Both `nvidia-cloud` and `nvidia-nim` created with status `unconfigured`.

- [ ] **Step 4: Commit**

```bash
git add packages/db/data/providers-registry.json
git commit -m "feat(providers): add nvidia-cloud and nvidia-nim to provider registry"
```

---

## Task 2: Provider Utility Helpers

**Files:**
- Modify: `apps/web/lib/routing/provider-utils.ts`

- [ ] **Step 1: Add `isNvidia()` and `isLocalProvider()` helpers**

Add to `provider-utils.ts` after the existing `isOpenAI()` function:

```typescript
export function isNvidia(providerId: string): boolean {
  return providerId === "nvidia-cloud" || providerId === "nvidia-nim";
}

/**
 * EP-INF-011: Returns true for providers that run on the user's own hardware.
 * Used by the routing pipeline to enforce residencyPolicy: "local_only".
 */
export function isLocalProvider(providerId: string): boolean {
  return providerId === "ollama" || providerId === "nvidia-nim";
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/routing/provider-utils.ts
git commit -m "feat(routing): add isNvidia() and isLocalProvider() helpers"
```

---

## Task 3: Model Classifier — Namespaced ID Support

**Files:**
- Modify: `apps/web/lib/routing/model-classifier.ts`
- Modify: `apps/web/lib/routing/model-classifier.test.ts`

- [ ] **Step 1: Write failing tests for namespaced NVIDIA model IDs**

Add these test cases to `model-classifier.test.ts` inside the existing `describe("classifyModel")` block, before the "Default to chat" section:

```typescript
  // NVIDIA namespaced model IDs (EP-INF-011)
  it("classifies nvidia/nemotron as chat from namespaced ID", () => {
    expect(classifyModel("nvidia/nemotron-4-340b-instruct", {
      input: ["text"], output: ["text"],
    })).toBe("chat");
  });

  it("classifies snowflake/arctic-embed as embedding from namespaced ID", () => {
    expect(classifyModel("snowflake/arctic-embed-l", {
      input: ["text"], output: ["text"],
    })).toBe("embedding");
  });

  it("classifies nvidia/nv-embed as embedding from namespaced ID", () => {
    expect(classifyModel("nvidia/nv-embed-v2", {
      input: ["text"], output: ["text"],
    })).toBe("embedding");
  });

  it("classifies meta/codellama as code from namespaced ID", () => {
    expect(classifyModel("meta/codellama-70b-instruct", {
      input: ["text"], output: ["text"],
    })).toBe("code");
  });

  it("classifies stabilityai/sdxl-turbo as image_gen from namespaced ID", () => {
    expect(classifyModel("stabilityai/sdxl-turbo", {
      input: ["text"], output: ["text"],
    })).toBe("image_gen");
  });

  it("classifies meta/llama-3.1-70b via namespaced ID as chat (default)", () => {
    expect(classifyModel("meta/llama-3.1-70b-instruct", {
      input: ["text"], output: ["text"],
    })).toBe("chat");
  });
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web exec vitest run apps/web/lib/routing/model-classifier.test.ts
```

Expected: FAIL — `snowflake/arctic-embed-l`, `nvidia/nv-embed-v2`, `meta/codellama-70b-instruct`, and `stabilityai/sdxl-turbo` all return `"chat"` instead of their correct classes.

- [ ] **Step 3: Update model-classifier.ts patterns**

Replace the ID-based fallbacks section in `model-classifier.ts` (lines 19-27):

```typescript
  // ID-based fallbacks for providers with poor modality data
  // Patterns use non-anchored matching to support namespaced IDs (e.g., "nvidia/nemotron-4-340b")
  if (/(^|\/)(o1|o3|o4|deepseek-r1)/i.test(modelId)) return "reasoning";
  if (/(^|\/)text-embedding|nv-embed|arctic-embed/i.test(modelId)) return "embedding";
  if (/(^|\/)dall-e/i.test(modelId)) return "image_gen";
  if (/stable-diffusion|sdxl/i.test(modelId)) return "image_gen";
  if (/(^|\/)tts-/i.test(modelId)) return "speech";
  if (/(^|\/)whisper/i.test(modelId)) return "audio";
  if (/(^|\/)omni-moderation/i.test(modelId)) return "moderation";
  if (/(^|\/)codex/i.test(modelId)) return "code";
  if (/codellama|deepseek-coder|starcoder/i.test(modelId)) return "code";
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter web exec vitest run apps/web/lib/routing/model-classifier.test.ts
```

Expected: All tests PASS including new namespaced ID tests and all existing tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/model-classifier.ts apps/web/lib/routing/model-classifier.test.ts
git commit -m "feat(routing): support namespaced model IDs in classifier (EP-INF-011)"
```

---

## Task 4: Family Baselines for Nemotron

**Files:**
- Modify: `apps/web/lib/routing/family-baselines.ts`

- [ ] **Step 1: Add Nemotron baselines**

Add after the Qwen section (line ~57) in `family-baselines.ts`, before the Cohere section:

```typescript
  // ── NVIDIA Nemotron ──
  { pattern: /nemotron.*340b/i, baseline: { scores: { reasoning: 82, codegen: 78, toolFidelity: 55, instructionFollowing: 78, structuredOutput: 60, conversational: 75, contextRetention: 70 }, confidence: "low" } },
  { pattern: /nemotron.*15b/i, baseline: { scores: { reasoning: 62, codegen: 58, toolFidelity: 42, instructionFollowing: 62, structuredOutput: 45, conversational: 65, contextRetention: 52 }, confidence: "low" } },
  { pattern: /nemotron.*mini/i, baseline: { scores: { reasoning: 50, codegen: 45, toolFidelity: 35, instructionFollowing: 55, structuredOutput: 38, conversational: 60, contextRetention: 42 }, confidence: "low" } },
```

- [ ] **Step 2: Verify existing tests still pass**

```bash
pnpm --filter web exec vitest run apps/web/lib/routing/
```

Expected: All routing tests PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/routing/family-baselines.ts
git commit -m "feat(routing): add Nemotron family baseline scores (EP-INF-011)"
```

---

## Task 5: Adapter Registry — Register NVIDIA Providers

**Files:**
- Modify: `apps/web/lib/routing/adapter-registry.ts`

- [ ] **Step 1: Register OpenAI adapter for both NVIDIA providers**

In `adapter-registry.ts`, add two entries to the `ADAPTERS` record (after the `ollama` entry at line 22):

```typescript
  "nvidia-cloud": openAIAdapter,
  "nvidia-nim": openAIAdapter,
```

The full `ADAPTERS` record should now be:

```typescript
const ADAPTERS: Record<string, ProviderAdapter> = {
  openrouter: openRouterAdapter,
  anthropic: anthropicAdapter,
  "anthropic-sub": anthropicAdapter,
  openai: openAIAdapter,
  chatgpt: openAIAdapter,
  codex: openAIAdapter,
  gemini: geminiAdapter,
  ollama: ollamaAdapter,
  "nvidia-cloud": openAIAdapter,
  "nvidia-nim": openAIAdapter,
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/routing/adapter-registry.ts
git commit -m "feat(routing): register NVIDIA providers in adapter registry (EP-INF-011)"
```

---

## Task 6: Pipeline V2 — Generalize Local Residency Check

**Files:**
- Modify: `apps/web/lib/routing/pipeline-v2.ts`
- Modify: `apps/web/lib/routing/pipeline-v2.test.ts`

- [ ] **Step 1: Write failing test for nvidia-nim local residency**

Add this test in `pipeline-v2.test.ts` after the existing "allows ollama models for local_only residency" test (line ~207):

```typescript
  it("allows nvidia-nim models for local_only residency (EP-INF-011)", () => {
    const nimModel = makeEndpoint({ providerId: "nvidia-nim" });
    const contract = makeContract({ residencyPolicy: "local_only" });
    expect(getExclusionReasonV2(nimModel, contract)).toBeNull();
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter web exec vitest run apps/web/lib/routing/pipeline-v2.test.ts
```

Expected: FAIL — `nvidia-nim` excluded with "Residency policy 'local_only' requires ollama provider"

- [ ] **Step 3: Update pipeline-v2.ts to use isLocalProvider()**

In `pipeline-v2.ts`, add the import at the top (with existing imports):

```typescript
import { isLocalProvider } from "./provider-utils";
```

Then replace line 120:

```typescript
  // Before:
  if (contract.residencyPolicy === "local_only" && ep.providerId !== "ollama") {
    return "Residency policy 'local_only' requires ollama provider";
  }

  // After:
  if (contract.residencyPolicy === "local_only" && !isLocalProvider(ep.providerId)) {
    return "Residency policy 'local_only' requires a local provider";
  }
```

- [ ] **Step 4: Run tests to verify all pass**

```bash
pnpm --filter web exec vitest run apps/web/lib/routing/pipeline-v2.test.ts
```

Expected: All tests PASS including new nvidia-nim test.

- [ ] **Step 5: Update test description for accuracy**

In `pipeline-v2.test.ts`, update the existing test descriptions to reflect the generalization:

```typescript
  // Line 198: Change description
  it("handles residencyPolicy local_only (excludes cloud providers)", () => {

  // Line 204: Change description
  it("allows local providers for local_only residency", () => {

  // Line 377: Change description (integration test)
  it("handles residencyPolicy local_only (excludes cloud providers)", async () => {
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/routing/pipeline-v2.ts apps/web/lib/routing/pipeline-v2.test.ts
git commit -m "feat(routing): generalize local_only residency to support nvidia-nim (EP-INF-011)"
```

---

## Task 7: Seed Routing Profiles

**Files:**
- Modify: `packages/db/scripts/seed-routing-profiles.ts`

- [ ] **Step 1: Add NVIDIA provider profiles**

Add these two entries to the `PROFILES` array in `seed-routing-profiles.ts`:

```typescript
  {
    providerId: "nvidia-cloud",
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    modelRestrictions: [],
    reasoning: 78,
    codegen: 75,
    toolFidelity: 55,
    instructionFollowing: 75,
    structuredOutput: 60,
    conversational: 72,
    contextRetention: 65,
  },
  {
    providerId: "nvidia-nim",
    supportsToolUse: true,
    supportsStructuredOutput: false,
    supportsStreaming: true,
    maxContextTokens: 32768,
    maxOutputTokens: 4096,
    modelRestrictions: [],
    reasoning: 65,
    codegen: 60,
    toolFidelity: 42,
    instructionFollowing: 62,
    structuredOutput: 40,
    conversational: 65,
    contextRetention: 52,
  },
```

- [ ] **Step 2: Add Nemotron baselines to seed-model-baselines.ts**

Add Nemotron patterns to the `PATTERNS` array in `seed-model-baselines.ts`:

```typescript
  { pattern: /nemotron.*340b/i, scores: { reasoning: 82, codegen: 78, toolFidelity: 55, instructionFollowing: 78, structuredOutput: 60, conversational: 75, contextRetention: 70 }, confidence: "low" },
  { pattern: /nemotron.*15b/i, scores: { reasoning: 62, codegen: 58, toolFidelity: 42, instructionFollowing: 62, structuredOutput: 45, conversational: 65, contextRetention: 52 }, confidence: "low" },
  { pattern: /nemotron.*mini/i, scores: { reasoning: 50, codegen: 45, toolFidelity: 35, instructionFollowing: 55, structuredOutput: 38, conversational: 60, contextRetention: 42 }, confidence: "low" },
```

- [ ] **Step 3: Commit**

```bash
git add packages/db/scripts/seed-routing-profiles.ts packages/db/scripts/seed-model-baselines.ts
git commit -m "feat(seed): add NVIDIA provider routing profiles and Nemotron baselines (EP-INF-011)"
```

---

## Task 8: Generalized Local Provider Health Check

**Files:**
- Create: `apps/web/lib/local-provider-health.ts`
- Modify: `apps/web/lib/ollama.ts`

- [ ] **Step 1: Create generalized local provider health check**

Create `apps/web/lib/local-provider-health.ts`:

```typescript
// apps/web/lib/local-provider-health.ts
// EP-INF-011: Generalized health check for local inference providers.
// Supports Ollama, NVIDIA NIM, and future local providers.

import { prisma } from "@dpf/db";
import { discoverModelsInternal, profileModelsInternal } from "./ai-provider-internals";

/**
 * Check reachability of a local inference provider and update its status.
 * Triggers discovery and profiling on first activation.
 */
export async function checkLocalProvider(providerId: string): Promise<void> {
  const provider = await prisma.modelProvider.findFirst({
    where: { providerId },
    select: { providerId: true, status: true, baseUrl: true, endpoint: true },
  });

  if (!provider || !provider.baseUrl) return;

  const baseUrl = provider.baseUrl;
  let reachable = false;

  try {
    const url = baseUrl.endsWith("/v1") ? `${baseUrl}/models` : `${baseUrl}/v1/models`;
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    reachable = res.ok;
  } catch {
    // Timeout or connection error
  }

  if (reachable && provider.status === "unconfigured") {
    await prisma.modelProvider.update({
      where: { providerId },
      data: { status: "active" },
    });

    const result = await discoverModelsInternal(providerId);
    if (result.discovered < 50) {
      await profileModelsInternal(providerId);
    }
  } else if (reachable && provider.status === "active") {
    const profileCount = await prisma.modelProfile.count({ where: { providerId } });
    if (profileCount === 0) {
      const result = await discoverModelsInternal(providerId);
      if (result.discovered < 50) {
        await profileModelsInternal(providerId);
      }
    }
  } else if (!reachable && provider.status === "active") {
    await prisma.modelProvider.update({
      where: { providerId },
      data: { status: "inactive" },
    });
  }
}
```

- [ ] **Step 2: Update ollama.ts to use generalized health check for NIM**

Add the import at the **top** of `ollama.ts` (with other imports):

```typescript
import { checkLocalProvider } from "./local-provider-health";
```

Add the function at the **end** of `ollama.ts`, after `checkBundledProviders()`:

```typescript
/**
 * EP-INF-011: Check NVIDIA NIM local provider health.
 * Called alongside checkBundledProviders() on page load.
 */
export async function checkNimProvider(): Promise<void> {
  await checkLocalProvider("nvidia-nim");
}
```

- [ ] **Step 3: Wire NIM health check into page load**

The call site is `apps/web/app/(shell)/platform/ai/providers/page.tsx` (line ~41). Add `checkNimProvider()` alongside the existing `checkBundledProviders()` call:

```typescript
import { checkNimProvider } from "@/lib/ollama";
// ... existing code ...
await checkBundledProviders();
await checkNimProvider();
```

- [ ] **Step 4: Write basic test for checkLocalProvider()**

Create `apps/web/lib/local-provider-health.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock prisma
vi.mock("@dpf/db", () => ({
  prisma: {
    modelProvider: {
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    modelProfile: {
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

// Mock discovery/profiling
vi.mock("./ai-provider-internals", () => ({
  discoverModelsInternal: vi.fn().mockResolvedValue({ discovered: 3 }),
  profileModelsInternal: vi.fn().mockResolvedValue(undefined),
}));

import { checkLocalProvider } from "./local-provider-health";
import { prisma } from "@dpf/db";

describe("checkLocalProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  it("skips when provider not found", async () => {
    (prisma.modelProvider.findFirst as any).mockResolvedValue(null);
    await checkLocalProvider("nvidia-nim");
    expect(prisma.modelProvider.update).not.toHaveBeenCalled();
  });

  it("activates unconfigured provider when reachable", async () => {
    (prisma.modelProvider.findFirst as any).mockResolvedValue({
      providerId: "nvidia-nim", status: "unconfigured", baseUrl: "http://localhost:8000/v1",
    });
    (global.fetch as any).mockResolvedValue({ ok: true });

    await checkLocalProvider("nvidia-nim");

    expect(prisma.modelProvider.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "active" } }),
    );
  });

  it("deactivates active provider when unreachable", async () => {
    (prisma.modelProvider.findFirst as any).mockResolvedValue({
      providerId: "nvidia-nim", status: "active", baseUrl: "http://localhost:8000/v1",
    });
    (global.fetch as any).mockRejectedValue(new Error("ECONNREFUSED"));

    await checkLocalProvider("nvidia-nim");

    expect(prisma.modelProvider.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "inactive" } }),
    );
  });
});
```

- [ ] **Step 5: Run tests**

```bash
pnpm --filter web exec vitest run apps/web/lib/local-provider-health.test.ts
```

Expected: All 3 tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/local-provider-health.ts apps/web/lib/local-provider-health.test.ts apps/web/lib/ollama.ts
git commit -m "feat: generalized local provider health check for NIM support (EP-INF-011)"
```

---

## Task 9: Provider Panel UI — NVIDIA Grouping

**Files:**
- Modify: `apps/web/components/platform/ServiceSection.tsx`
- Modify: `apps/web/lib/ai-provider-data.ts` (grouping function)

- [ ] **Step 1: Add vendorGroup to grouping logic**

In `ai-provider-data.ts`, update `groupByEndpointTypeAndCategory()` to recognize `vendorGroup`. Providers with the same `vendorGroup` should appear consecutively in the same section.

The `vendorGroup` field is already in `providers-registry.json` (added in Task 1). If the field is not yet on the `ModelProvider` schema, the UI can derive grouping from provider ID prefix matching instead:

```typescript
/** Group NVIDIA providers together in the UI */
function getVendorGroup(providerId: string): string | null {
  if (providerId === "nvidia-cloud" || providerId === "nvidia-nim") return "nvidia";
  if (providerId === "anthropic" || providerId.startsWith("anthropic-")) return "anthropic";
  return null;
}
```

- [ ] **Step 2: Update ServiceSection to show grouped heading**

In `ServiceSection.tsx`, when rendering providers that share a `vendorGroup`, show a single heading with both providers nested underneath. The implementation should follow the existing expand/collapse pattern.

For the NVIDIA group:
- Heading: "NVIDIA" with both status dots
- Subrows: "Cloud (build.nvidia.com)" and "Local (NIM)"
- If only one is configured, only show that subrow (but keep the NVIDIA heading)

- [ ] **Step 3: Verify the UI renders correctly**

```bash
cd h:/OpenDigitalProductFactory
pnpm --filter web dev
```

Navigate to `/platform/ai/providers` and verify:
- NVIDIA appears as a single grouped section in the "Direct" category
- Both Cloud and Local subrows appear
- Status dots, model counts, and expand/collapse work correctly
- Links to NVIDIA docs appear in expanded detail

- [ ] **Step 4: Commit**

```bash
git add apps/web/components/platform/ServiceSection.tsx apps/web/lib/ai-provider-data.ts
git commit -m "feat(ui): group NVIDIA providers under single card in provider panel (EP-INF-011)"
```

---

## Note: Execution Recipes

No explicit recipe seeding task is needed. The `profileModelsInternal()` call in the health check (Task 8) triggers the recipe seeder's generic fallback path, which auto-generates champion `chat` recipes for each discovered model. Embedding, code, and image_gen recipes are also auto-generated when models of those classes are discovered. NVIDIA models use the generic recipe path (no `isNvidia()` branch in `recipe-seeder.ts`) — this produces functional recipes. Nemotron-specific parameters can be added later if needed.

---

## Task 10: Run Full Test Suite and Seed Epics

**Files:** None new — validation only.

- [ ] **Step 1: Run all routing tests**

```bash
pnpm --filter web exec vitest run apps/web/lib/routing/
```

Expected: All tests PASS.

- [ ] **Step 2: Run the full web test suite**

```bash
pnpm --filter web test
```

Expected: All tests PASS.

- [ ] **Step 3: Seed the NVIDIA epics into the database**

```bash
pnpm --filter @dpf/db exec tsx scripts/seed-nvidia-epics.ts
```

Expected: `EP-INF-011` and `EP-AUTH-002` seeded as backlog epics.

- [ ] **Step 4: Sync provider registry**

```bash
pnpm --filter @dpf/db exec tsx scripts/sync-provider-registry.ts
```

Expected: `nvidia-cloud` and `nvidia-nim` created with status `unconfigured`.

- [ ] **Step 5: Seed routing profiles**

```bash
pnpm --filter @dpf/db exec tsx scripts/seed-routing-profiles.ts
```

Expected: `SEEDED: nvidia-cloud` and `SEEDED: nvidia-nim`.

- [ ] **Step 6: Final commit with any remaining changes**

```bash
git status
# Stage any remaining files
git commit -m "chore: NVIDIA provider integration complete (EP-INF-011)"
```
