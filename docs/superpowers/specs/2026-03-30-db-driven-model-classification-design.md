# EP-INF-012b: DB-Driven Model Classification, Capability Matching & Contribution Feedback

**Date:** 2026-03-30
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Epic ID:** EP-INF-012b (continuation of EP-INF-012)
**IT4IT Alignment:** SS-2 Portfolio Management (resource governance), S2S Service Portfolio (capability catalog), R2D Requirement to Deploy (model lifecycle)

**Predecessor specs:**

- `2026-03-29-model-routing-simplification-design.md` -- EP-INF-012 (tiers, assignment, admin control)
- `2026-03-18-ai-routing-and-profiling-design.md` -- EP-INF-001 (original pipeline)
- `2026-03-20-contract-based-selection-design.md` -- EP-INF-005a (RequestContract)

---

## Problem Statement

EP-INF-012 introduced quality tiers (frontier/strong/adequate/basic) and admin-configurable agent-to-tier assignment. Three problems remain:

1. **Hardcoded model family classification.** When a new model family appears (e.g. `gpt-6`, `llama-4`), someone must add lines to two TypeScript files (`FAMILY_TIERS` in quality-tiers.ts and `FAMILY_REGISTRY` in family-baselines.ts) and redeploy. With models releasing weekly and retiring just as fast, this is not sustainable.

2. **Blunt agent-to-model matching.** Agents declare a minimum tier but not what capabilities they need. The router cannot distinguish "this agent needs tool calling" from "this agent just needs conversation." When Gemini discovery returns 50+ models including Veo (video), Imagen (images), and Lyria (audio), the system wastes profiling time on models that will never serve a chat agent.

3. **No knowledge sharing.** When one platform instance classifies a new model, that knowledge stays local. The next person who installs DPF must repeat the same research. There is no mechanism to feed discoveries back into the project's seed data.

**Verified on 2026-03-30:** The Gemini provider has 59 model profiles in the database. Of these, 13 are deprecated, 10+ are non-chat models (embedding, image gen, audio, video). All were profiled identically with chat-oriented dimension scores despite having completely different purposes.

---

## Goals

1. Model family classification rules live in the database, not in code. An admin can add or edit rules without redeploying.
2. When discovery finds an unknown model, it is classified asynchronously by the platform-engineer AI coworker using public documentation and benchmarks -- without blocking the UI.
3. Agents declare required capabilities (tool calling, structured output, modalities) alongside minimum tier. Irrelevant models (image gen, speech, embedding) are excluded from chat agent routing without profiling.
4. Newly classified models generate seed data patches that flow back to the project, gated by the platform's contribution mode (fork_only / selective / contribute_all).
5. Re-seeding on upgrade is safe: admin overrides are never clobbered.

---

## Non-Goals

1. Building a hosted central model registry (future -- contribution via PR for now).
2. Rewriting the routing pipeline (pipeline-v2, cost-ranking, execution adapters). These work correctly.
3. Automated benchmark evaluation (golden tests, champion/challenger). These are separate epics (EP-INF-006).
4. Async task dashboard UI (captured as separate epic EP-OPS-ASYNC in the backlog).

---

## Design Summary

```text
Provider configured
  |
  v
Discovery: fetch /v1/models
  |
  v
For each model: match against ModelFamilyRule table
  |
  +-- Match found --> assign tier, scores, modelClass from rule
  |
  +-- No match --> provisional "adequate", create ModelClassificationJob
                     |
                     v
                   Background: platform-engineer coworker
                     - Fetches public docs, benchmarks, model cards
                     - Determines tier, scores, modelClass, modalities
                     - Updates ModelProfile
                     - Creates new ModelFamilyRule (source: "discovered")
                     - Notifies admin
                     |
                     v
                   Contribution gate (respects contribution mode)
                     - fork_only: stays local
                     - selective: backlog item for admin review, then PR
                     - contribute_all: auto-propose PR
  |
  v
Agent routing: AgentModelConfig declares
  - minimumTier (existing)
  - requiredCapabilities (new: { toolUse: true })
  - requiredModelClass (new: "chat")
  - requiredModalities (new: { input: ["text"], output: ["text"] })
  - preferredDimensions (new: { codegen: 85 })
  |
  v
Router filters: tier >= minimum AND capabilities match AND class match
  then ranks by cost-per-success within eligible set
```

---

## Section 1: ModelFamilyRule Table

Replaces the hardcoded `FAMILY_TIERS` (quality-tiers.ts) and `FAMILY_REGISTRY` (family-baselines.ts) maps.

### 1.1 Schema

```prisma
model ModelFamilyRule {
  id               String   @id @default(cuid())
  pattern          String   // Model ID prefix or regex (e.g. "gpt-5", "claude.*opus")
  matchType        String   @default("prefix") // "prefix" | "regex"
  qualityTier      String   // "frontier" | "strong" | "adequate" | "basic"
  scores           Json     // { reasoning, codegen, toolFidelity, instructionFollowing,
                            //   structuredOutput, conversational, contextRetention }
  modelClass       String?  // "chat" | "reasoning" | "image_gen" | "embedding" | "speech" | "audio" | "video"
  inputModalities  Json?    // ["text", "image"]
  outputModalities Json?    // ["text"]
  source           String   @default("seed") // "seed" | "discovered" | "admin"
  confidence       String   @default("low")  // "low" | "medium" | "high"
  priority         Int      @default(100)     // Higher = matched first
  notes            String?  // Human-readable: "Frontier reasoning, weak tool calling"
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@unique([pattern, matchType])
  @@index([priority])
}
```

### 1.2 Matching Logic

Replace `assignTierFromModelId()` and `getBaselineForModel()` with DB queries:

```typescript
async function classifyModel(modelId: string): Promise<{
  qualityTier: QualityTier;
  scores: DimensionScores;
  modelClass: string | null;
  inputModalities: string[] | null;
  outputModalities: string[] | null;
} | null> {
  const rules = await prisma.modelFamilyRule.findMany({
    orderBy: { priority: "desc" },
  });

  const normalised = modelId.toLowerCase();

  for (const rule of rules) {
    const matched = rule.matchType === "prefix"
      ? normalised.startsWith(rule.pattern.toLowerCase())
      : new RegExp(rule.pattern, "i").test(modelId);

    if (matched) {
      return {
        qualityTier: rule.qualityTier as QualityTier,
        scores: rule.scores as DimensionScores,
        modelClass: rule.modelClass,
        inputModalities: rule.inputModalities as string[] | null,
        outputModalities: rule.outputModalities as string[] | null,
      };
    }
  }

  return null; // No match -- triggers async classification
}
```

Cache the rules in memory for the duration of a discovery sync (invalidated on rule change). The table is small (< 100 rows) and read-heavy.

### 1.3 Seed Data

Initial seed from `packages/db/data/model-family-rules.json`, populated from the current hardcoded maps:

```json
[
  {
    "pattern": "claude-opus-4",
    "matchType": "prefix",
    "qualityTier": "frontier",
    "scores": { "reasoning": 95, "codegen": 92, "toolFidelity": 90,
                "instructionFollowing": 92, "structuredOutput": 88,
                "conversational": 90, "contextRetention": 88 },
    "modelClass": "chat",
    "confidence": "medium",
    "priority": 200,
    "notes": "Anthropic flagship. Best-in-class reasoning and tool orchestration."
  },
  ...
]
```

Seed logic uses upsert on `(pattern, matchType)`. Source-aware merge:

| Existing source | Incoming source | Action |
|-----------------|-----------------|--------|
| (none) | seed | Insert |
| seed | seed | Update (improved baselines from community) |
| discovered | seed | Update (community-verified replaces local guess) |
| discovered | discovered | Update if new confidence >= existing confidence; skip otherwise |
| admin | seed | **Skip** (admin made a deliberate choice) |
| admin | discovered | **Skip** (admin made a deliberate choice) |

**Rules are additive-only.** If a model family is removed from the seed file in a future release, existing `source: "seed"` rows are NOT deleted. Retired families should have their `qualityTier` updated to reflect deprecation rather than being removed.

**Re-seed for other tables:**

- `ModelClassificationJob`: Jobs with status `"classified"` are preserved across upgrades (audit trail). Jobs with status `"pending"` or `"failed"` are reset to `"pending"` to allow retry with the new code. Jobs with status `"researching"` are reset to `"pending"` (stale from a previous container).
- `AgentModelConfig`: Existing rows where `configuredById IS NOT NULL` are never overwritten (admin configured). Rows where `configuredById IS NULL` (system-seeded) receive updated defaults for new fields only if the field is currently at its migration default (e.g., `requiredCapabilities = "{}"`).

### 1.4 Code Changes

- `quality-tiers.ts`: `assignTierFromModelId()` becomes a thin wrapper that calls `classifyModel()`. Falls back to hardcoded map only if DB is unreachable (resilience).
- `family-baselines.ts`: `getBaselineForModel()` same pattern -- DB-first, hardcoded fallback.
- `ai-provider-internals.ts`: `profileModelsInternal()` calls the new DB-based classifier instead of the hardcoded functions.

The hardcoded maps remain in code as a fallback but are no longer the source of truth.

---

## Section 2: Async Model Classification Pipeline

### 2.1 ModelClassificationJob Table

```prisma
model ModelClassificationJob {
  id                 String    @id @default(cuid())
  providerId         String
  modelId            String
  rawMetadata        Json?     // Whatever the provider API returned
  status             String    @default("pending") // "pending" | "researching" | "classified" | "failed"
  provisionalTier    String    @default("adequate")
  resolvedTier       String?
  resolvedScores     Json?
  resolvedModelClass String?
  resolvedModalities Json?     // { input: [...], output: [...] }
  researchSummary    String?   // What the AI coworker found
  sourceUrls         Json?     // URLs consulted
  reviewedByAgentId  String?
  errorMessage       String?   // If status = "failed"
  retryCount         Int       @default(0)  // Number of failed attempts
  lastAttemptAt      DateTime? // When the last attempt started
  createdAt          DateTime  @default(now())
  completedAt        DateTime?

  @@unique([providerId, modelId])
  @@index([status])
}
```

**Retry policy:**

- Maximum 3 retries per job (total 4 attempts including the first)
- Exponential backoff: 5 min, 20 min, 60 min between retries
- After max retries, status stays `"failed"` -- admin can manually re-queue via the UI
- A new discovery sync for the same model resets `retryCount` to 0 and status to `"pending"` (the model is still present, worth retrying with fresh metadata)

**Concurrency guard:**

`processClassificationJobs()` uses `SELECT ... FOR UPDATE SKIP LOCKED` semantics via Prisma's interactive transactions to prevent two concurrent invocations from picking up the same job. Maximum 3 jobs processed concurrently (configurable). The scheduler guarantees single-instance execution via the existing platform job infrastructure (or a simple database advisory lock if no scheduler exists yet).

### 2.2 Pipeline Flow

**Step 1: Discovery creates provisional profile (synchronous, fast)**

When `profileModelsInternal()` encounters a model with no `ModelFamilyRule` match:

**`qualityTierSource` vocabulary:** The existing schema uses `"auto"` and `"admin"`. This spec extends the vocabulary to: `"auto"` (family rule match during sync), `"discovered"` (async classification by AI coworker), `"admin"` (human override). The existing `"auto"` value on all current ModelProfile rows is equivalent to `"seed"` for re-seed purposes -- it will be overwritten by improved baselines but never by the async pipeline. On upgrade, existing `"auto"` rows are left as-is; new rows use the extended vocabulary.

```typescript
// No family rule match -- create provisional profile
await upsertModelProfile({
  ...modelCard,
  qualityTier: "adequate",
  qualityTierSource: "auto", // provisional, uses existing "auto" value
  reasoning: 50, codegen: 50, toolFidelity: 50, // neutral scores
});

// Queue async classification
await prisma.modelClassificationJob.upsert({
  where: { providerId_modelId: { providerId, modelId } },
  create: { providerId, modelId, rawMetadata, status: "pending" },
  update: { rawMetadata, status: "pending" }, // re-queue if previously failed
});
```

Routing works immediately with conservative defaults. The model is eligible for "adequate" tier agents but won't be selected for "frontier" or "strong" agents until classified.

**Step 2: Background classification (asynchronous)**

A scheduled process (or on-demand trigger) picks up pending jobs:

```typescript
async function processClassificationJobs(): Promise<void> {
  const jobs = await prisma.modelClassificationJob.findMany({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    take: 5, // batch size
  });

  for (const job of jobs) {
    await prisma.modelClassificationJob.update({
      where: { id: job.id },
      data: { status: "researching", reviewedByAgentId: "platform-engineer" },
    });

    try {
      const result = await classifyModelViaAgent(job);
      // ... update job and ModelProfile
    } catch (e) {
      await prisma.modelClassificationJob.update({
        where: { id: job.id },
        data: { status: "failed", errorMessage: e.message },
      });
    }
  }
}
```

**Step 3: Platform-engineer coworker research**

The `classifyModelViaAgent()` function invokes the platform-engineer agent with a structured research prompt:

```
Research the model "{modelId}" from provider "{providerId}".

Use search_public_web and fetch_public_website to find:
1. The official model card or documentation page
2. Published benchmark results (MMLU, HumanEval, MATH, etc.)
3. Stated capabilities: modalities (text/image/audio/video), tool calling, structured output
4. Advised use cases and known limitations
5. Pricing if publicly available
6. Context window size

Based on your research, classify this model:
- Quality tier: frontier / strong / adequate / basic
- Model class: chat / reasoning / image_gen / embedding / speech / audio / video
- Input modalities: ["text"], ["text", "image"], etc.
- Output modalities: ["text"], ["text", "image"], etc.
- Dimension scores (0-100): reasoning, codegen, toolFidelity, instructionFollowing,
  structuredOutput, conversational, contextRetention

Respond with a JSON block containing your classification and a brief summary with source URLs.
```

External access is enabled for this task. The coworker uses its existing `search_public_web` and `fetch_public_website` tools.

**Step 4: Update ModelProfile and create ModelFamilyRule**

On successful classification:

```typescript
// Update the specific model profile
await prisma.modelProfile.update({
  where: { providerId_modelId: { providerId, modelId } },
  data: {
    qualityTier: result.tier,
    qualityTierSource: "discovered",
    reasoning: result.scores.reasoning,
    codegen: result.scores.codegen,
    // ... remaining dimension scores
    modelClass: result.modelClass,
    inputModalities: result.inputModalities,
    outputModalities: result.outputModalities,
  },
});

// Create family rule so future models of this family auto-classify.
// The AI coworker's research prompt must output the family prefix as part of
// its classification response -- no heuristic extraction. The prompt explicitly
// asks: "What is the model family prefix for routing rules? (e.g. 'gpt-6', 'claude-opus-4')"
const familyPrefix = result.familyPrefix; // from coworker's structured response

const existingRule = await prisma.modelFamilyRule.findUnique({
  where: { pattern_matchType: { pattern: familyPrefix, matchType: "prefix" } },
});

if (!existingRule) {
  // No existing rule -- create
  await prisma.modelFamilyRule.create({
    data: {
      pattern: familyPrefix, matchType: "prefix",
      qualityTier: result.tier, scores: result.scores,
      modelClass: result.modelClass,
      inputModalities: result.inputModalities, outputModalities: result.outputModalities,
      source: "discovered", confidence: "medium", priority: 100,
      notes: result.summary,
    },
  });
} else if (existingRule.source === "admin") {
  // Admin override -- never touch
} else if (existingRule.source === "discovered" && existingRule.confidence < "medium") {
  // Existing discovered rule with lower confidence -- upgrade
  await prisma.modelFamilyRule.update({
    where: { id: existingRule.id },
    data: {
      qualityTier: result.tier, scores: result.scores,
      modelClass: result.modelClass,
      inputModalities: result.inputModalities, outputModalities: result.outputModalities,
      confidence: "medium", notes: result.summary,
    },
  });
}
// else: existing seed or same-confidence discovered rule -- leave as-is

// Mark job complete
await prisma.modelClassificationJob.update({
  where: { id: job.id },
  data: {
    status: "classified",
    resolvedTier: result.tier,
    resolvedScores: result.scores,
    resolvedModelClass: result.modelClass,
    resolvedModalities: { input: result.inputModalities, output: result.outputModalities },
    researchSummary: result.summary,
    sourceUrls: result.sourceUrls,
    completedAt: new Date(),
  },
});
```

**Step 5: Admin notification**

Create a system notification visible on /platform/ai:

```
"Classified gpt-6-turbo as frontier (chat model). Based on OpenAI docs and benchmark results.
 Reasoning: 92, Codegen: 90, Tool Fidelity: 88. [View details]"
```

Admin can accept (no action needed), adjust tier/scores via the model card UI, or override (sets `qualityTierSource: "admin"`).

---

## Section 3: Agent Capability Matching

### 3.1 Extended AgentModelConfig Schema

Add fields to the existing `AgentModelConfig` table:

```prisma
model AgentModelConfig {
  agentId              String    @id
  minimumTier          String    @default("adequate")
  pinnedProviderId     String?
  pinnedModelId        String?
  budgetClass          String    @default("balanced")
  // NEW: capability requirements
  requiredCapabilities Json      @default("{}")     // { toolUse: true, structuredOutput: true }
  requiredModelClass   String?                       // "chat" | "reasoning" | null (any class eligible)
  requiredModalities   Json?                         // { input: ["text"], output: ["text"] }
  preferredDimensions  Json?                         // { codegen: 85, toolFidelity: 85 }
  // Existing
  configuredAt         DateTime  @default(now())
  configuredById       String?
  configuredBy         User?     @relation(...)
}
```

### 3.2 Routing Integration

In `agentic-loop.ts`, the effective config builder extends to include capability requirements:

```typescript
const effectiveConfig = agentModelConfig
  ? {
      minimumDimensions: TIER_MINIMUM_DIMENSIONS[agentModelConfig.minimumTier],
      budgetClass: agentModelConfig.budgetClass,
      preferredProviderId: agentModelConfig.pinnedProviderId,
      preferredModelId: agentModelConfig.pinnedModelId,
      // NEW
      requiredCapabilities: agentModelConfig.requiredCapabilities,
      requiredModelClass: agentModelConfig.requiredModelClass,
      requiredModalities: agentModelConfig.requiredModalities,
      preferredDimensions: agentModelConfig.preferredDimensions,
    }
  : { /* code-level defaults as fallback */ };
```

In the routing pipeline, these new fields are injected into the RequestContract and applied as hard filters in `cost-ranking.ts`:

```typescript
// Hard filter: required capabilities
if (contract.requiredCapabilities?.toolUse && !endpoint.capabilities.toolUse) return 0;
if (contract.requiredCapabilities?.structuredOutput && !endpoint.capabilities.structuredOutput) return 0;

// Hard filter: model class
if (contract.requiredModelClass && endpoint.modelClass !== contract.requiredModelClass) return 0;

// Hard filter: modalities
if (contract.requiredModalities?.input) {
  const hasAll = contract.requiredModalities.input.every(m =>
    endpoint.inputModalities.includes(m));
  if (!hasAll) return 0;
}

// Soft preference: preferred dimensions boost ranking score
if (contract.preferredDimensions) {
  for (const [dim, preferred] of Object.entries(contract.preferredDimensions)) {
    if (getDimensionScore(endpoint, dim) >= preferred) score *= 1.2;
  }
}
```

### 3.3 Seeded Defaults

Updated seed in `packages/db/src/seed.ts` (extends the existing `seedAgentModelDefaults`):

| Agent | Tier | requiredCapabilities | requiredModelClass | preferredDimensions |
|-------|------|---------------------|--------------------|---------------------|
| build-specialist | frontier | `{ toolUse: true }` | chat | `{ codegen: 85, toolFidelity: 85 }` |
| coo | strong | `{ toolUse: true }` | chat | `{ reasoning: 75 }` |
| platform-engineer | strong | `{ toolUse: true }` | chat | `{ reasoning: 70 }` |
| admin-assistant | strong | `{ toolUse: true }` | chat | `{ reasoning: 70 }` |
| ops-coordinator | adequate | `{ toolUse: true }` | chat | null |
| portfolio-advisor | adequate | `{ toolUse: true }` | chat | null |
| inventory-specialist | adequate | `{ toolUse: true }` | chat | null |
| ea-architect | adequate | `{ toolUse: true, structuredOutput: true }` | chat | null |
| hr-specialist | adequate | `{ toolUse: true }` | chat | null |
| customer-advisor | adequate | `{ toolUse: true }` | chat | null |
| onboarding-coo | basic | `{}` | chat | null |

Seed logic: skip rows where `configuredById IS NOT NULL` (admin has configured).

### 3.4 Admin UI Extension

The model-assignment page at `/platform/ai/model-assignment` gains an expandable "Advanced" section per agent row:

- Required Capabilities: checkboxes (Tool Use, Structured Output, Streaming, Image Input, etc.)
- Model Class: dropdown (Chat, Reasoning, Any)
- Preferred Dimensions: optional score inputs per dimension

Changes saved via the existing `saveAgentModelConfig()` action, extended with the new fields.

---

## Section 4: Contribution Feedback Loop

### 4.1 Contribution Mode Gate

After a `ModelClassificationJob` completes with status `"classified"`, the system checks `PlatformDevConfig.contributionMode`:

| Mode | Action |
|------|--------|
| `fork_only` | No further action. Classification stays local in the instance's `ModelFamilyRule` table. |
| `selective` | Create a backlog item: "New model classified: {modelId} as {tier}. Review and approve contribution." Admin reviews on /ops. If approved, trigger contribution step. |
| `contribute_all` | Automatically trigger contribution step. |

### 4.2 Contribution Artifact

The contribution is a JSON patch to `packages/db/data/model-family-rules.json`:

```json
{
  "pattern": "gpt-6",
  "matchType": "prefix",
  "qualityTier": "frontier",
  "scores": {
    "reasoning": 92, "codegen": 90, "toolFidelity": 88,
    "instructionFollowing": 88, "structuredOutput": 85,
    "conversational": 88, "contextRetention": 85
  },
  "modelClass": "chat",
  "inputModalities": ["text", "image"],
  "outputModalities": ["text"],
  "confidence": "medium",
  "priority": 100,
  "notes": "Based on OpenAI gpt-6 model card (2026-04). 1M context, native tool calling, multimodal input. Benchmarks: MMLU 94.2, HumanEval 91.5."
}
```

This includes the research summary and source URLs from the classification job, combined with any local profiling results (eval scores if golden tests were run).

### 4.3 Contribution Mechanism

The platform-engineer coworker uses the existing `propose_file_change` tool to generate a PR against the project repository:

1. Read current `packages/db/data/model-family-rules.json`
2. Append or update the entry for the new model family
3. Generate a commit message: `feat(seed): add model family rule for {pattern} ({tier})`
4. Propose via `propose_file_change` -- creates a PR or local patch depending on the project's git configuration

This matches the Build Studio's existing contribution flow and respects the same git/PR infrastructure.

### 4.4 Re-seed Safety

On platform upgrade, `packages/db/data/model-family-rules.json` is loaded and seeded into `ModelFamilyRule`:

```typescript
async function seedModelFamilyRules(): Promise<void> {
  const rules = JSON.parse(fs.readFileSync("data/model-family-rules.json", "utf8"));
  let seeded = 0, updated = 0, skipped = 0;

  for (const rule of rules) {
    const existing = await prisma.modelFamilyRule.findUnique({
      where: { pattern_matchType: { pattern: rule.pattern, matchType: rule.matchType } },
    });

    if (!existing) {
      await prisma.modelFamilyRule.create({ data: { ...rule, source: "seed" } });
      seeded++;
    } else if (existing.source === "admin") {
      // Admin made a deliberate choice -- never overwrite
      skipped++;
    } else {
      // source is "seed" or "discovered" -- update with community-improved data
      await prisma.modelFamilyRule.update({
        where: { id: existing.id },
        data: { ...rule, source: "seed", updatedAt: new Date() },
      });
      updated++;
    }
  }

  console.log(`  Model family rules: ${seeded} seeded, ${updated} updated, ${skipped} admin-preserved`);
}
```

---

## Section 5: Migration & Rollout

### 5.1 Database Migration

Single migration adding:

1. `ModelFamilyRule` table
2. `ModelClassificationJob` table
3. New fields on `AgentModelConfig`: `requiredCapabilities`, `requiredModelClass`, `requiredModalities`, `preferredDimensions`

### 5.2 Seed Data

1. `model-family-rules.json` -- populated from current `FAMILY_TIERS` (25 entries) + `FAMILY_REGISTRY` (17 entries), deduplicated and merged. Approximately 30 rules covering all known model families.
2. `seedAgentModelDefaults()` extended with capability requirements per agent.

### 5.3 Code Changes

| File | Change |
|------|--------|
| `quality-tiers.ts` | `assignTierFromModelId()` queries ModelFamilyRule, falls back to hardcoded map |
| `family-baselines.ts` | `getBaselineForModel()` queries ModelFamilyRule, falls back to hardcoded registry |
| `ai-provider-internals.ts` | `profileModelsInternal()` uses DB classifier; creates ModelClassificationJob for unknowns |
| `agentic-loop.ts` | Load new AgentModelConfig fields into effectiveConfig |
| `routed-inference.ts` | Pass capability requirements into RequestContract |
| `cost-ranking.ts` | Add hard filters for requiredCapabilities, requiredModelClass, requiredModalities; add soft boost for preferredDimensions |
| `seed.ts` | New `seedModelFamilyRules()` function; extend `seedAgentModelDefaults()` with capability fields |
| `agent-model-config.ts` | Extend `saveAgentModelConfig()` to accept new fields |
| Model-assignment page | Add "Advanced" section with capability controls |

### 5.4 Backward Compatibility

- Hardcoded `FAMILY_TIERS` and `FAMILY_REGISTRY` remain as resilience fallbacks (DB unreachable)
- Existing `AgentModelConfig` rows gain `requiredCapabilities: {}` (empty = no filter) and `requiredModelClass: NULL` (null = any class eligible) via migration defaults. This is NOT a behavior change -- null means "accept any model class", which matches current behavior where no class filter exists. The seed then explicitly sets `requiredModelClass: "chat"` for agents that need it, but only for rows where `configuredById IS NULL`.
- Existing `ModelProfile` rows unaffected -- the new classifier only runs during future discovery syncs

### 5.5 ModelProfile Field Name Mapping

The existing `ModelProfile` schema has dual-named fields for two dimensions:

- `instructionFollowing` (String, legacy descriptive) vs `instructionFollowingScore` (Int, numeric)
- `structuredOutput` is absent; the numeric field is `structuredOutputScore`

All code in this spec that references dimension scores uses the **numeric** field names as they exist in the Prisma schema: `reasoning`, `codegen`, `toolFidelity`, `instructionFollowingScore`, `structuredOutputScore`, `conversational`, `contextRetention`. The `DimensionScores` type in the ModelFamilyRule `scores` JSON uses the canonical short names (`instructionFollowing`, `structuredOutput`) and the mapping layer in `loader.ts` handles the translation (as it does today).

### 5.6 Capability Field Canonical Source

The existing `ModelProfile` has three overlapping representations for capabilities:

1. `supportsToolUse` (Boolean) on ModelProfile -- legacy per-model flag
2. `supportsToolUse` / `supportsStructuredOutput` / `supportsStreaming` (Boolean) on ModelProvider -- provider-level flags
3. `capabilities` (Json) on ModelProfile -- structured `{ toolUse: bool, structuredOutput: bool, streaming: bool, ... }`

**The `capabilities` JSON on ModelProfile is the canonical source for routing.** The loader (`loader.ts` line 47) already reads `(mp.capabilities as any)?.toolUse ?? mp.supportsToolUse ?? mp.provider.supportsToolUse` with JSON as highest priority. The `requiredCapabilities` filter in Section 3.2 matches against `endpoint.capabilities` (which comes from this merged read). The legacy boolean fields are preserved for backward compatibility but are not the authoritative source.

### 5.7 Modality Field Canonical Source

The existing `ModelProfile` has:

- `inputModalities` (Json array, e.g. `["text", "image"]`)
- `outputModalities` (Json array, e.g. `["text"]`)

These are the canonical fields. The `requiredModalities` filter reads `endpoint.inputModalities` and `endpoint.outputModalities` which map directly to these arrays via `loader.ts`. Any legacy `supportedModalities` JSON object field is not used by routing and can be deprecated.

---

## Related Epics

| Epic | Relationship |
|------|-------------|
| EP-INF-012 | Predecessor -- tiers, agent assignment, admin UI |
| EP-INF-006 | Golden test evaluation -- feeds into dimension scores post-classification |
| EP-OPS-ASYNC | Async task dashboard -- visibility and control for classification jobs |
| EP-INF-001 | Original routing pipeline -- execution layer unchanged |
| EP-INF-003 | Model card metadata -- enriched by classification research |

---

## Open Questions

1. **Classification job scheduling.** Should jobs be processed on a timer (e.g. every 5 minutes), on discovery completion, or on-demand via admin trigger? Recommendation: on discovery completion + admin trigger.

2. ~~**Rate limiting research.**~~ **Resolved:** Max 3 concurrent jobs, exponential backoff (5/20/60 min), max 3 retries. See Section 2.1 retry policy.

3. ~~**Family prefix extraction.**~~ **Resolved:** The AI coworker's research prompt explicitly asks for the family prefix as part of its structured response. No heuristic extraction needed. See Section 2.2 Step 4.

4. **Reasoning model class and chat agents.** Models like o1, o3, o4 are classified as `modelClass: "reasoning"` but are useful for chat agents that need deep reasoning. Should `requiredModelClass: "chat"` exclude them? Recommendation: treat `"reasoning"` as a specialization of `"chat"` -- when an agent requires `"chat"`, models with class `"chat"` OR `"reasoning"` are eligible. Only non-conversational classes (`"image_gen"`, `"embedding"`, `"speech"`, `"audio"`, `"video"`) are excluded. The filter logic should be: `if (requiredModelClass === "chat" && !["chat", "reasoning", "code"].includes(endpoint.modelClass)) return 0;`
