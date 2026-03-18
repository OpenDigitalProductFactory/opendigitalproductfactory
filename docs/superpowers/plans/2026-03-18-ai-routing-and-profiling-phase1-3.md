# AI Endpoint Routing & Model Profiling — Phases 1–3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragile, overlapping AI routing system with a schema-first, single-pipeline architecture that produces explainable routing decisions — running in shadow mode alongside legacy.

**Architecture:** Extend `ModelProvider` with multi-dimensional capability scores and hard constraint flags (Phase 1). Create `TaskRequirement`, `PolicyRule`, `RouteDecision` tables (Phase 2). Implement a pure `routeEndpoint` function behind the `USE_MANIFEST_ROUTER` feature flag that logs decisions alongside legacy routing for comparison (Phase 3).

**Tech Stack:** TypeScript, Prisma 7, Vitest, PostgreSQL, Next.js server actions

**Spec:** `docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md` (EP-INF-001)

**Scope:** Phases 1–3 only. Phases 4–6 (cut over, cleanup, eval loop) will be planned separately after Phase 3 is validated in shadow mode.

---

## File Structure

### New Files

| File | Responsibility |
|---|---|
| `packages/db/prisma/migrations/20260319100000_add_routing_manifest_fields/migration.sql` | Schema migration: new fields on ModelProvider, new tables |
| `packages/db/scripts/seed-routing-profiles.ts` | Seed capability profiles for all existing endpoints |
| `apps/web/lib/routing/types.ts` | All routing type definitions: `EndpointManifest`, `TaskRequirement`, `PolicyRule`, `RouteDecision`, `CandidateTrace` |
| `apps/web/lib/routing/pipeline.ts` | The pure routing function: `routeEndpoint` — filter, score, rank, select |
| `apps/web/lib/routing/scoring.ts` | Fitness scoring and weight calculation — isolated for testability |
| `apps/web/lib/routing/loader.ts` | Load endpoints, task requirements, policy rules from database |
| `apps/web/lib/routing/fallback.ts` | `callWithFallbackChain` — replaces `callWithFailover` **(Phase 4 — not created in this plan)** |
| `apps/web/lib/routing/explain.ts` | Build human-readable `reason` strings from routing traces |
| `apps/web/lib/routing/index.ts` | Public API barrel export |
| `apps/web/lib/routing/pipeline.test.ts` | Tests for the routing pipeline |
| `apps/web/lib/routing/scoring.test.ts` | Tests for scoring and weight calculation |

### Modified Files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Add fields to ModelProvider, add TaskRequirement/PolicyRule/RouteDecision/CustomEvalDimension models |
| `apps/web/lib/actions/agent-coworker.ts` | Add shadow-mode routing call behind feature flag |
| `apps/web/lib/task-types.ts` | No changes yet — kept until Phase 5 cleanup |
| `apps/web/lib/feature-flags.ts` | Add `USE_MANIFEST_ROUTER` flag |

### Untouched Files (explicitly)

| File | Why |
|---|---|
| `apps/web/lib/ai-inference.ts` | `callProvider` stays as-is |
| `apps/web/lib/ai-provider-priority.ts` | Legacy path stays until Phase 4 |
| `apps/web/lib/agent-router.ts` | Old router stays until Phase 5 |
| `apps/web/lib/agent-sensitivity.ts` | Legacy sensitivity stays until Phase 5 |
| `apps/web/lib/agentic-loop.ts` | No changes until Phase 4 |

---

## Task 1: Schema Migration — Extend ModelProvider

**Files:**
- Modify: `packages/db/prisma/schema.prisma:708-744` (ModelProvider model)
- Create: `packages/db/prisma/migrations/20260319100000_add_routing_manifest_fields/migration.sql`

- [ ] **Step 1: Add capability profile fields to ModelProvider in schema.prisma**

In `packages/db/prisma/schema.prisma`, add these fields to the `ModelProvider` model after the existing `catalogEntry` field:

```prisma
  // ── Routing Manifest: Hard Constraints ──
  supportedModalities    Json       @default("{\"input\":[\"text\"],\"output\":[\"text\"]}")
  supportsToolUse        Boolean    @default(false)
  supportsStructuredOutput Boolean  @default(false)
  supportsStreaming       Boolean   @default(true)
  maxContextTokens       Int?
  maxOutputTokens        Int?
  modelRestrictions      String[]   @default([])

  // ── Routing Manifest: Capability Profile (0-100) ──
  reasoning              Int        @default(50)
  codegen                Int        @default(50)
  toolFidelity           Int        @default(50)
  instructionFollowing   Int        @default(50)
  structuredOutput       Int        @default(50)
  conversational         Int        @default(50)
  contextRetention       Int        @default(50)
  customScores           Json       @default("{}")

  // ── Routing Manifest: Operational Metrics ──
  avgLatencyMs           Float?
  recentFailureRate      Float      @default(0)
  lastEvalAt             DateTime?
  lastCallAt             DateTime?
  costPerInputMToken     Float?
  costPerOutputMToken    Float?

  // ── Routing Manifest: Provenance ──
  profileSource          String     @default("seed")
  profileConfidence      String     @default("low")
  evalCount              Int        @default(0)

  // ── Routing Manifest: Lifecycle ──
  retiredAt              DateTime?
  retiredReason          String?
```

- [ ] **Step 2: Add new models for TaskRequirement, PolicyRule, RouteDecision, CustomEvalDimension**

Append these models to `schema.prisma`:

```prisma
model TaskRequirement {
  id                    String    @id @default(cuid())
  taskType              String    @unique
  description           String
  selectionRationale    String
  requiredCapabilities  Json      @default("{}")
  preferredMinScores    Json      @default("{}")
  maxLatencyMs          Int?
  preferCheap           Boolean   @default(false)
  defaultInstructions   String?
  evaluationTokenLimit  Int       @default(500)
  origin                String    @default("system")
  createdById           String?
  createdBy             User?     @relation("TaskRequirementCreator", fields: [createdById], references: [id])
  approvedById          String?
  approvedBy            User?     @relation("TaskRequirementApprover", fields: [approvedById], references: [id])
  approvedAt            DateTime?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
}

model PolicyRule {
  id              String    @id @default(cuid())
  name            String
  description     String
  condition       Json
  action          String    @default("exclude")
  createdById     String?
  createdBy       User?     @relation("PolicyRuleCreator", fields: [createdById], references: [id])
  version         Int       @default(1)
  effectiveFrom   DateTime  @default(now())
  effectiveUntil  DateTime?
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}

model RouteDecisionLog {
  id                  String    @id @default(cuid())
  agentMessageId      String?
  selectedEndpointId  String
  taskType            String
  sensitivity         String
  reason              String
  fitnessScore        Float
  candidateTrace      Json
  excludedTrace       Json
  policyRulesApplied  String[]  @default([])
  fallbackChain       String[]  @default([])
  fallbacksUsed       Json?
  shadowMode          Boolean   @default(false)
  createdAt           DateTime  @default(now())

  @@index([taskType])
  @@index([selectedEndpointId])
  @@index([createdAt])
}

model CustomEvalDimension {
  id              String    @id @default(cuid())
  name            String    @unique
  description     String
  evalScenarios   Json      @default("[]")
  createdById     String?
  createdBy       User?     @relation("CustomEvalDimensionCreator", fields: [createdById], references: [id])
  approvedById    String?
  approvedBy      User?     @relation("CustomEvalDimensionApprover", fields: [approvedById], references: [id])
  status          String    @default("draft")
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
}
```

- [ ] **Step 3: Add required relations to User model**

In the `User` model in `schema.prisma`, add:

```prisma
  taskRequirementsCreated    TaskRequirement[]    @relation("TaskRequirementCreator")
  taskRequirementsApproved   TaskRequirement[]    @relation("TaskRequirementApprover")
  policyRulesCreated         PolicyRule[]         @relation("PolicyRuleCreator")
  customEvalDimsCreated      CustomEvalDimension[] @relation("CustomEvalDimensionCreator")
  customEvalDimsApproved     CustomEvalDimension[] @relation("CustomEvalDimensionApprover")
```

- [ ] **Step 4: Update EndpointTaskPerformance — add dimensionScores, rename instructionPhase**

In the `EndpointTaskPerformance` model, add:

```prisma
  dimensionScores        Json       @default("{}")
  profileConfidence      String     @default("low")
```

Note: `instructionPhase` field stays for now (will be removed in Phase 5 cleanup). `profileConfidence` is the new canonical field.

- [ ] **Step 5: Generate and run migration**

Run:
```bash
cd packages/db
npx prisma migrate dev --name add_routing_manifest_fields
```

Expected: Migration created and applied successfully. No data loss — all new fields have defaults.

- [ ] **Step 6: Verify migration**

Run:
```bash
npx prisma studio
```

Expected: `ModelProvider` table shows all new columns with default values. New tables (`TaskRequirement`, `PolicyRule`, `RouteDecisionLog`, `CustomEvalDimension`) exist and are empty.

- [ ] **Step 7: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/
git commit -m "feat(db): add routing manifest fields and task requirement tables (EP-INF-001 Phase 1)"
```

---

## Task 2: Seed Capability Profiles for Existing Endpoints

**Files:**
- Create: `packages/db/scripts/seed-routing-profiles.ts`

- [ ] **Step 1: Write the seed script**

Create `packages/db/scripts/seed-routing-profiles.ts`:

```typescript
/**
 * Seed capability profiles for all existing ModelProvider endpoints.
 * Based on known benchmark data and model cards.
 * Run: DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx packages/db/scripts/seed-routing-profiles.ts
 */
import { prisma } from "../src/client";

interface ProfileSeed {
  providerId: string;
  // Hard constraints
  supportsToolUse: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  modelRestrictions: string[];
  // Capability scores (0-100)
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowing: number;
  structuredOutput: number;
  conversational: number;
  contextRetention: number;
  // Cost
  costPerInputMToken: number | null;
  costPerOutputMToken: number | null;
}

const PROFILES: ProfileSeed[] = [
  // ── Anthropic API Key (full model access) ──
  {
    providerId: "anthropic",
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    modelRestrictions: [],
    reasoning: 92,
    codegen: 90,
    toolFidelity: 88,
    instructionFollowing: 90,
    structuredOutput: 85,
    conversational: 88,
    contextRetention: 85,
    costPerInputMToken: 3.0,
    costPerOutputMToken: 15.0,
  },
  // ── Anthropic Subscription (OAuth, Haiku only) ──
  {
    providerId: "anthropic-subscription",
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 200000,
    maxOutputTokens: 8192,
    modelRestrictions: ["claude-haiku-3-5-20241022", "claude-3-5-haiku-20241022"],
    reasoning: 65,
    codegen: 60,
    toolFidelity: 62,
    instructionFollowing: 70,
    structuredOutput: 68,
    conversational: 72,
    contextRetention: 60,
    costPerInputMToken: 0.8,
    costPerOutputMToken: 4.0,
  },
  // ── OpenRouter ──
  {
    providerId: "openrouter",
    supportsToolUse: true,
    supportsStructuredOutput: true,
    supportsStreaming: true,
    maxContextTokens: 128000,
    maxOutputTokens: 4096,
    modelRestrictions: [],
    reasoning: 85,
    codegen: 82,
    toolFidelity: 80,
    instructionFollowing: 82,
    structuredOutput: 78,
    conversational: 85,
    contextRetention: 75,
    costPerInputMToken: 2.0,
    costPerOutputMToken: 10.0,
  },
  // ── Ollama (local) ──
  {
    providerId: "ollama",
    supportsToolUse: true,
    supportsStructuredOutput: false,
    supportsStreaming: true,
    maxContextTokens: 32768,
    maxOutputTokens: 4096,
    modelRestrictions: [],
    reasoning: 55,
    codegen: 50,
    toolFidelity: 40,
    instructionFollowing: 52,
    structuredOutput: 35,
    conversational: 58,
    contextRetention: 45,
    costPerInputMToken: null,
    costPerOutputMToken: null,
  },
];

async function main() {
  for (const profile of PROFILES) {
    const provider = await prisma.modelProvider.findUnique({
      where: { providerId: profile.providerId },
    });
    if (!provider) {
      console.log(`SKIP: ${profile.providerId} not found in database`);
      continue;
    }

    await prisma.modelProvider.update({
      where: { providerId: profile.providerId },
      data: {
        supportsToolUse: profile.supportsToolUse,
        supportsStructuredOutput: profile.supportsStructuredOutput,
        supportsStreaming: profile.supportsStreaming,
        maxContextTokens: profile.maxContextTokens,
        maxOutputTokens: profile.maxOutputTokens,
        modelRestrictions: profile.modelRestrictions,
        reasoning: profile.reasoning,
        codegen: profile.codegen,
        toolFidelity: profile.toolFidelity,
        instructionFollowing: profile.instructionFollowing,
        structuredOutput: profile.structuredOutput,
        conversational: profile.conversational,
        contextRetention: profile.contextRetention,
        costPerInputMToken: profile.costPerInputMToken,
        costPerOutputMToken: profile.costPerOutputMToken,
        profileSource: "seed",
        profileConfidence: "low",
      },
    });
    console.log(`SEEDED: ${profile.providerId}`);
  }

  // Seed any providers not in the PROFILES list with conservative defaults
  const allProviders = await prisma.modelProvider.findMany({
    where: { endpointType: "llm" },
    select: { providerId: true },
  });
  const seededIds = new Set(PROFILES.map((p) => p.providerId));
  for (const p of allProviders) {
    if (!seededIds.has(p.providerId)) {
      console.log(`DEFAULT: ${p.providerId} — using schema defaults (all 50s)`);
    }
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the seed script**

Run:
```bash
DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx packages/db/scripts/seed-routing-profiles.ts
```

Expected: Each existing provider gets a SEEDED or DEFAULT message. No errors.

- [ ] **Step 3: Verify profiles in database**

Run:
```bash
DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx -e "
const { prisma } = require('./packages/db/src/client');
async function main() {
  const providers = await prisma.modelProvider.findMany({
    where: { endpointType: 'llm' },
    select: { providerId: true, reasoning: true, codegen: true, toolFidelity: true, supportsToolUse: true, profileSource: true },
  });
  console.table(providers);
  await prisma.\$disconnect();
}
main();
"
```

Expected: Table shows correct scores per provider. `anthropic` has reasoning: 92. `ollama` has reasoning: 55.

- [ ] **Step 4: Commit**

```bash
git add packages/db/scripts/seed-routing-profiles.ts
git commit -m "feat(db): seed capability profiles for existing endpoints (EP-INF-001 Phase 1)"
```

---

## Task 3: Seed Task Requirements

**Files:**
- Create: `packages/db/scripts/seed-task-requirements.ts`

- [ ] **Step 1: Write the task requirement seed script**

Create `packages/db/scripts/seed-task-requirements.ts`:

```typescript
/**
 * Seed TaskRequirement records for the 9 built-in task types.
 * Run: DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx packages/db/scripts/seed-task-requirements.ts
 */
import { prisma } from "../src/client";

interface TaskReqSeed {
  taskType: string;
  description: string;
  selectionRationale: string;
  requiredCapabilities: Record<string, unknown>;
  preferredMinScores: Record<string, number>;
  preferCheap: boolean;
  defaultInstructions?: string;
  evaluationTokenLimit: number;
}

const TASK_REQUIREMENTS: TaskReqSeed[] = [
  {
    taskType: "greeting",
    description: "Simple conversational greeting or small talk",
    selectionRationale: "Simple dialog — any capable model works, prefer cheapest",
    requiredCapabilities: {},
    preferredMinScores: { conversational: 40 },
    preferCheap: true,
    evaluationTokenLimit: 200,
  },
  {
    taskType: "status-query",
    description: "Data lookup or status check against platform data",
    selectionRationale: "Data lookup — needs accuracy not depth, prefer cheapest",
    requiredCapabilities: {},
    preferredMinScores: { instructionFollowing: 40 },
    preferCheap: true,
    evaluationTokenLimit: 300,
  },
  {
    taskType: "summarization",
    description: "Summarize or condense information following specific format requirements",
    selectionRationale: "Needs to follow formatting instructions precisely",
    requiredCapabilities: {},
    preferredMinScores: { instructionFollowing: 50 },
    preferCheap: true,
    evaluationTokenLimit: 500,
  },
  {
    taskType: "reasoning",
    description: "Complex analysis, comparison, evaluation, or multi-step logical reasoning",
    selectionRationale: "Complex analysis needs strong reasoning — quality over cost",
    requiredCapabilities: {},
    preferredMinScores: { reasoning: 80 },
    preferCheap: false,
    evaluationTokenLimit: 1000,
  },
  {
    taskType: "data-extraction",
    description: "Extract structured data from unstructured input",
    selectionRationale: "Must produce valid structured output — hard requirement",
    requiredCapabilities: { supportsStructuredOutput: true },
    preferredMinScores: { structuredOutput: 70 },
    preferCheap: true,
    evaluationTokenLimit: 500,
  },
  {
    taskType: "code-gen",
    description: "Generate, edit, or review code",
    selectionRationale: "Code quality is critical — requires tool support for applying changes",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { codegen: 75, instructionFollowing: 60 },
    preferCheap: false,
    evaluationTokenLimit: 1000,
  },
  {
    taskType: "web-search",
    description: "Search the web and synthesize results",
    selectionRationale: "Must call search tools correctly",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { toolFidelity: 60 },
    preferCheap: true,
    evaluationTokenLimit: 500,
  },
  {
    taskType: "creative",
    description: "Creative writing, brainstorming, or content generation",
    selectionRationale: "Needs both creativity and coherence — quality over cost",
    requiredCapabilities: {},
    preferredMinScores: { conversational: 60, reasoning: 50 },
    preferCheap: false,
    evaluationTokenLimit: 500,
  },
  {
    taskType: "tool-action",
    description: "Multi-step tool use with platform actions or external APIs",
    selectionRationale: "Must call tools accurately and abstain when no tool fits — quality critical",
    requiredCapabilities: { supportsToolUse: true },
    preferredMinScores: { toolFidelity: 70 },
    preferCheap: false,
    evaluationTokenLimit: 800,
  },
];

async function main() {
  for (const req of TASK_REQUIREMENTS) {
    await prisma.taskRequirement.upsert({
      where: { taskType: req.taskType },
      update: {
        description: req.description,
        selectionRationale: req.selectionRationale,
        requiredCapabilities: req.requiredCapabilities,
        preferredMinScores: req.preferredMinScores,
        preferCheap: req.preferCheap,
        defaultInstructions: req.defaultInstructions ?? null,
        evaluationTokenLimit: req.evaluationTokenLimit,
        origin: "system",
      },
      create: {
        taskType: req.taskType,
        description: req.description,
        selectionRationale: req.selectionRationale,
        requiredCapabilities: req.requiredCapabilities,
        preferredMinScores: req.preferredMinScores,
        preferCheap: req.preferCheap,
        defaultInstructions: req.defaultInstructions ?? null,
        evaluationTokenLimit: req.evaluationTokenLimit,
        origin: "system",
      },
    });
    console.log(`SEEDED: ${req.taskType}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
```

- [ ] **Step 2: Run the seed script**

Run:
```bash
DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx packages/db/scripts/seed-task-requirements.ts
```

Expected: 9 SEEDED lines, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/db/scripts/seed-task-requirements.ts
git commit -m "feat(db): seed task requirement contracts for 9 built-in task types (EP-INF-001 Phase 2)"
```

---

## Task 4: Routing Types

**Files:**
- Create: `apps/web/lib/routing/types.ts`

- [ ] **Step 1: Create the routing types file**

Create `apps/web/lib/routing/types.ts`:

```typescript
/**
 * EP-INF-001: Type definitions for the manifest-based routing pipeline.
 * See: docs/superpowers/specs/2026-03-18-ai-routing-and-profiling-design.md
 */

// ── Sensitivity ──

export type SensitivityLevel = "public" | "internal" | "confidential" | "restricted";

// ── Endpoint Manifest (loaded from ModelProvider) ──

export interface EndpointManifest {
  // Identity
  id: string;
  providerId: string;
  name: string;
  endpointType: string;
  status: "active" | "degraded" | "disabled" | "unconfigured" | "retired";

  // Hard constraints
  sensitivityClearance: SensitivityLevel[];
  supportsToolUse: boolean;
  supportsStructuredOutput: boolean;
  supportsStreaming: boolean;
  maxContextTokens: number | null;
  maxOutputTokens: number | null;
  modelRestrictions: string[];

  // Capability profile (0-100)
  reasoning: number;
  codegen: number;
  toolFidelity: number;
  instructionFollowing: number;
  structuredOutput: number;
  conversational: number;
  contextRetention: number;
  customScores: Record<string, number>;

  // Operational
  avgLatencyMs: number | null;
  recentFailureRate: number;
  costPerInputMToken: number | null;
  costPerOutputMToken: number | null;

  // Provenance
  profileSource: "seed" | "evaluated" | "production";
  profileConfidence: "low" | "medium" | "high";

  // Lifecycle
  retiredAt: Date | null;
}

// ── Task Requirement (loaded from TaskRequirement table) ──

export interface TaskRequirementContract {
  taskType: string;
  description: string;
  selectionRationale: string;
  requiredCapabilities: {
    supportsToolUse?: boolean;
    supportsStructuredOutput?: boolean;
    supportsStreaming?: boolean;
    minContextTokens?: number;
  };
  preferredMinScores: Record<string, number>;
  maxLatencyMs?: number;
  preferCheap: boolean;
}

// ── Policy Rule ──

export interface PolicyRuleEval {
  id: string;
  name: string;
  description: string;
  condition: PolicyCondition;
}

export interface PolicyCondition {
  field: "providerId" | "sensitivityClearance" | "profileConfidence" | "endpointType";
  operator: "equals" | "not_equals" | "includes" | "not_includes";
  value: string | string[];
}

// ── Route Decision (the audit trail) ──

export interface CandidateTrace {
  endpointId: string;
  endpointName: string;
  fitnessScore: number;
  dimensionScores: Record<string, number>;
  costPerOutputMToken: number | null;
  excluded: boolean;
  excludedReason?: string;
}

export interface RouteDecision {
  selectedEndpoint: string | null;
  reason: string;
  fitnessScore: number;
  fallbackChain: string[];
  candidates: CandidateTrace[];
  excludedCount: number;
  excludedReasons: string[];
  policyRulesApplied: string[];
  taskType: string;
  sensitivity: SensitivityLevel;
  timestamp: Date;
}

// ── Pinned / Blocked overrides ──

export interface EndpointOverride {
  endpointId: string;
  taskType: string;
  pinned: boolean;
  blocked: boolean;
}

// ── Built-in capability dimension names ──

export const BUILTIN_DIMENSIONS = [
  "reasoning",
  "codegen",
  "toolFidelity",
  "instructionFollowing",
  "structuredOutput",
  "conversational",
  "contextRetention",
] as const;

export type BuiltinDimension = (typeof BUILTIN_DIMENSIONS)[number];
```

- [ ] **Step 2: Create barrel export**

Create `apps/web/lib/routing/index.ts`:

```typescript
export type {
  SensitivityLevel,
  EndpointManifest,
  TaskRequirementContract,
  PolicyRuleEval,
  PolicyCondition,
  CandidateTrace,
  RouteDecision,
  EndpointOverride,
  BuiltinDimension,
} from "./types";
export { BUILTIN_DIMENSIONS } from "./types";
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/routing/
git commit -m "feat: add routing type definitions (EP-INF-001 Phase 2)"
```

---

## Task 5: Scoring Function — TDD

**Files:**
- Create: `apps/web/lib/routing/scoring.test.ts`
- Create: `apps/web/lib/routing/scoring.ts`

- [ ] **Step 1: Write failing tests for `computeFitness`**

Create `apps/web/lib/routing/scoring.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeFitness, normalizeWeights } from "./scoring";
import type { EndpointManifest, TaskRequirementContract } from "./types";

// ── Fixtures ──

const sonnet: EndpointManifest = {
  id: "ep-sonnet",
  providerId: "anthropic",
  name: "Anthropic Sonnet",
  endpointType: "llm",
  status: "active",
  sensitivityClearance: ["public", "internal", "confidential"],
  supportsToolUse: true,
  supportsStructuredOutput: true,
  supportsStreaming: true,
  maxContextTokens: 200000,
  maxOutputTokens: 8192,
  modelRestrictions: [],
  reasoning: 88,
  codegen: 91,
  toolFidelity: 85,
  instructionFollowing: 88,
  structuredOutput: 82,
  conversational: 85,
  contextRetention: 80,
  customScores: {},
  avgLatencyMs: 1200,
  recentFailureRate: 0.02,
  costPerInputMToken: 3.0,
  costPerOutputMToken: 15.0,
  profileSource: "seed",
  profileConfidence: "low",
  retiredAt: null,
};

const llama: EndpointManifest = {
  ...sonnet,
  id: "ep-llama",
  providerId: "ollama",
  name: "Ollama Llama 3.1",
  reasoning: 65,
  codegen: 65,
  toolFidelity: 40,
  instructionFollowing: 70,
  structuredOutput: 35,
  conversational: 70,
  contextRetention: 55,
  costPerInputMToken: null,
  costPerOutputMToken: null,
  recentFailureRate: 0,
};

const haiku: EndpointManifest = {
  ...sonnet,
  id: "ep-haiku",
  providerId: "anthropic-subscription",
  name: "Anthropic Haiku",
  status: "degraded" as const,
  reasoning: 42,
  codegen: 42,
  toolFidelity: 55,
  instructionFollowing: 55,
  structuredOutput: 50,
  conversational: 60,
  contextRetention: 45,
  costPerInputMToken: 0.8,
  costPerOutputMToken: 4.0,
};

const codeGenReq: TaskRequirementContract = {
  taskType: "code-gen",
  description: "Generate code",
  selectionRationale: "Requires tool support and prefers strong code generation",
  requiredCapabilities: { supportsToolUse: true },
  preferredMinScores: { codegen: 75, instructionFollowing: 60 },
  preferCheap: false,
};

const greetingReq: TaskRequirementContract = {
  taskType: "greeting",
  description: "Simple greeting",
  selectionRationale: "Simple dialog, prefer cheapest",
  requiredCapabilities: {},
  preferredMinScores: { conversational: 40 },
  preferCheap: true,
};

// ── Tests ──

describe("normalizeWeights", () => {
  it("normalizes preferred min scores to weights summing to 1", () => {
    const weights = normalizeWeights({ codegen: 75, instructionFollowing: 60 });
    expect(weights.codegen).toBeCloseTo(75 / 135, 5);
    expect(weights.instructionFollowing).toBeCloseTo(60 / 135, 5);
    const sum = Object.values(weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 5);
  });

  it("handles single dimension", () => {
    const weights = normalizeWeights({ reasoning: 80 });
    expect(weights.reasoning).toBe(1);
  });

  it("handles empty scores by returning empty object", () => {
    const weights = normalizeWeights({});
    expect(Object.keys(weights)).toHaveLength(0);
  });
});

describe("computeFitness", () => {
  it("scores sonnet higher than llama for code-gen (quality-first)", () => {
    const sonnetFitness = computeFitness(sonnet, codeGenReq, [sonnet, llama]);
    const llamaFitness = computeFitness(llama, codeGenReq, [sonnet, llama]);
    expect(sonnetFitness.fitness).toBeGreaterThan(llamaFitness.fitness);
  });

  it("applies 0.7x penalty for degraded endpoints", () => {
    const activeHaiku = { ...haiku, status: "active" as const };
    const activeFitness = computeFitness(activeHaiku, greetingReq, [activeHaiku]);
    const degradedFitness = computeFitness(haiku, greetingReq, [haiku]);
    expect(degradedFitness.fitness).toBeCloseTo(activeFitness.fitness * 0.7, 1);
  });

  it("includes cost factor when preferCheap is true", () => {
    // Llama has no cost (local) — should score higher on cost dimension
    const llamaFitness = computeFitness(llama, greetingReq, [sonnet, llama]);
    const sonnetFitness = computeFitness(sonnet, greetingReq, [sonnet, llama]);
    // With preferCheap and similar conversational scores, llama should win
    expect(llamaFitness.fitness).toBeGreaterThan(sonnetFitness.fitness);
  });

  it("returns dimension scores in the trace", () => {
    const result = computeFitness(sonnet, codeGenReq, [sonnet]);
    expect(result.dimensionScores).toHaveProperty("codegen");
    expect(result.dimensionScores).toHaveProperty("instructionFollowing");
    expect(result.dimensionScores.codegen).toBe(91);
  });

  it("only includes dimensions from the task requirement", () => {
    const result = computeFitness(sonnet, greetingReq, [sonnet]);
    expect(Object.keys(result.dimensionScores)).toEqual(["conversational"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd apps/web && npx vitest run lib/routing/scoring.test.ts
```

Expected: FAIL — module `./scoring` not found.

- [ ] **Step 3: Implement scoring.ts**

Create `apps/web/lib/routing/scoring.ts`:

```typescript
/**
 * EP-INF-001: Fitness scoring for the routing pipeline.
 * Pure functions — no DB access, no side effects.
 */
import type { EndpointManifest, TaskRequirementContract, BuiltinDimension } from "./types";
import { BUILTIN_DIMENSIONS } from "./types";

const STATUS_MULTIPLIER: Record<string, number> = {
  active: 1.0,
  degraded: 0.7,
};

const COST_QUALITY_SPLIT = { quality: 0.6, cost: 0.4 };

export interface FitnessResult {
  fitness: number;
  dimensionScores: Record<string, number>;
}

/**
 * Normalize preferred min scores into weights that sum to 1.
 * A dimension with preferred 80 gets proportionally more weight than one with 40.
 */
export function normalizeWeights(
  preferredMinScores: Record<string, number>,
): Record<string, number> {
  const total = Object.values(preferredMinScores).reduce((a, b) => a + b, 0);
  if (total === 0) return {};
  const result: Record<string, number> = {};
  for (const [dim, score] of Object.entries(preferredMinScores)) {
    result[dim] = score / total;
  }
  return result;
}

/**
 * Get the endpoint's score for a dimension — checks built-in fields first,
 * then customScores.
 */
function getDimensionScore(endpoint: EndpointManifest, dimension: string): number {
  if (BUILTIN_DIMENSIONS.includes(dimension as BuiltinDimension)) {
    return endpoint[dimension as BuiltinDimension];
  }
  return endpoint.customScores[dimension] ?? 0;
}

/**
 * Compute the fitness score for one endpoint against a task requirement.
 * Returns the score and per-dimension breakdown for the trace.
 */
export function computeFitness(
  endpoint: EndpointManifest,
  requirement: TaskRequirementContract,
  allEndpoints: EndpointManifest[],
): FitnessResult {
  const weights = normalizeWeights(requirement.preferredMinScores);
  const dimensionScores: Record<string, number> = {};

  // Weighted quality score
  let qualityFitness = 0;
  for (const [dim, weight] of Object.entries(weights)) {
    const score = getDimensionScore(endpoint, dim);
    dimensionScores[dim] = score;
    qualityFitness += score * weight;
  }

  let fitness: number;

  if (requirement.preferCheap) {
    // Blend quality and cost
    const maxCost = Math.max(
      ...allEndpoints
        .map((e) => e.costPerOutputMToken)
        .filter((c): c is number => c !== null && c > 0),
      0.01, // avoid division by zero
    );
    const endpointCost = endpoint.costPerOutputMToken ?? 0;
    const costFactor = (1 - endpointCost / maxCost) * 100;
    fitness =
      COST_QUALITY_SPLIT.quality * qualityFitness +
      COST_QUALITY_SPLIT.cost * costFactor;
  } else {
    fitness = qualityFitness;
  }

  // Status multiplier
  const multiplier = STATUS_MULTIPLIER[endpoint.status] ?? 0;
  fitness *= multiplier;

  return { fitness, dimensionScores };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd apps/web && npx vitest run lib/routing/scoring.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/routing/scoring.ts apps/web/lib/routing/scoring.test.ts
git commit -m "feat: implement routing fitness scoring with TDD (EP-INF-001 Phase 3)"
```

---

## Task 6: Routing Pipeline — TDD

**Files:**
- Create: `apps/web/lib/routing/pipeline.test.ts`
- Create: `apps/web/lib/routing/pipeline.ts`

- [ ] **Step 1: Write failing tests for the pipeline**

Create `apps/web/lib/routing/pipeline.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { filterByPolicy, filterHard, routeEndpoint } from "./pipeline";
import type {
  EndpointManifest,
  TaskRequirementContract,
  PolicyRuleEval,
  SensitivityLevel,
  EndpointOverride,
} from "./types";

// ── Fixtures ──

const makeEndpoint = (overrides: Partial<EndpointManifest>): EndpointManifest => ({
  id: "ep-default",
  providerId: "test",
  name: "Test Endpoint",
  endpointType: "llm",
  status: "active",
  sensitivityClearance: ["public", "internal", "confidential", "restricted"],
  supportsToolUse: true,
  supportsStructuredOutput: true,
  supportsStreaming: true,
  maxContextTokens: 128000,
  maxOutputTokens: 4096,
  modelRestrictions: [],
  reasoning: 70,
  codegen: 70,
  toolFidelity: 70,
  instructionFollowing: 70,
  structuredOutput: 70,
  conversational: 70,
  contextRetention: 70,
  customScores: {},
  avgLatencyMs: 500,
  recentFailureRate: 0,
  costPerInputMToken: 3.0,
  costPerOutputMToken: 15.0,
  profileSource: "seed",
  profileConfidence: "low",
  retiredAt: null,
  ...overrides,
});

const sonnet = makeEndpoint({
  id: "ep-sonnet",
  providerId: "anthropic",
  name: "Sonnet",
  reasoning: 88,
  codegen: 91,
  toolFidelity: 85,
});

const llama = makeEndpoint({
  id: "ep-llama",
  providerId: "ollama",
  name: "Llama",
  sensitivityClearance: ["public", "internal", "confidential", "restricted"],
  reasoning: 55,
  codegen: 50,
  toolFidelity: 40,
  supportsToolUse: true,
  costPerOutputMToken: null,
});

const noTools = makeEndpoint({
  id: "ep-no-tools",
  providerId: "basic-llm",
  name: "No Tools",
  supportsToolUse: false,
  toolFidelity: 0,
});

const retired = makeEndpoint({
  id: "ep-retired",
  providerId: "old-provider",
  name: "Retired",
  retiredAt: new Date("2026-01-01"),
});

const codeGenReq: TaskRequirementContract = {
  taskType: "code-gen",
  description: "Generate code",
  selectionRationale: "Requires tool support",
  requiredCapabilities: { supportsToolUse: true },
  preferredMinScores: { codegen: 75, instructionFollowing: 60 },
  preferCheap: false,
};

const greetingReq: TaskRequirementContract = {
  taskType: "greeting",
  description: "Simple greeting",
  selectionRationale: "Simple dialog",
  requiredCapabilities: {},
  preferredMinScores: { conversational: 40 },
  preferCheap: true,
};

// ── Hard Filter Tests ──

describe("filterHard", () => {
  it("excludes inactive endpoints", () => {
    const disabled = makeEndpoint({ id: "disabled", status: "disabled" });
    const result = filterHard([sonnet, disabled], codeGenReq, "internal");
    expect(result.eligible.map((e) => e.id)).toEqual(["ep-sonnet"]);
    expect(result.excluded).toHaveLength(1);
    expect(result.excluded[0].excludedReason).toContain("status");
  });

  it("excludes endpoints without required sensitivity clearance", () => {
    const publicOnly = makeEndpoint({
      id: "public-only",
      sensitivityClearance: ["public"],
    });
    const result = filterHard([sonnet, publicOnly], codeGenReq, "confidential");
    expect(result.eligible.map((e) => e.id)).toEqual(["ep-sonnet"]);
    expect(result.excluded[0].excludedReason).toContain("sensitivity");
  });

  it("excludes endpoints missing required capabilities", () => {
    const result = filterHard([sonnet, noTools], codeGenReq, "public");
    expect(result.eligible.map((e) => e.id)).toEqual(["ep-sonnet"]);
    expect(result.excluded[0].excludedReason).toContain("tool support");
  });

  it("excludes retired endpoints", () => {
    const result = filterHard([sonnet, retired], codeGenReq, "public");
    expect(result.eligible.map((e) => e.id)).toEqual(["ep-sonnet"]);
    expect(result.excluded[0].excludedReason).toContain("retired");
  });

  it("allows degraded endpoints through", () => {
    const degraded = makeEndpoint({ id: "degraded", status: "degraded" });
    const result = filterHard([degraded], greetingReq, "public");
    expect(result.eligible).toHaveLength(1);
  });
});

// ── Policy Filter Tests ──

describe("filterByPolicy", () => {
  it("excludes endpoints matching policy rule", () => {
    const rule: PolicyRuleEval = {
      id: "rule-1",
      name: "No cloud for confidential",
      description: "Keep confidential data local",
      condition: {
        field: "providerId",
        operator: "equals",
        value: "anthropic",
      },
    };
    const result = filterByPolicy([sonnet, llama], [rule]);
    expect(result.eligible.map((e) => e.id)).toEqual(["ep-llama"]);
    expect(result.applied).toContain("No cloud for confidential");
  });

  it("passes all endpoints when no rules match", () => {
    const rule: PolicyRuleEval = {
      id: "rule-1",
      name: "Block old-provider",
      description: "test",
      condition: {
        field: "providerId",
        operator: "equals",
        value: "old-provider",
      },
    };
    const result = filterByPolicy([sonnet, llama], [rule]);
    expect(result.eligible).toHaveLength(2);
  });
});

// ── Full Pipeline Tests ──

describe("routeEndpoint", () => {
  it("selects the best endpoint for code-gen", () => {
    const decision = routeEndpoint(
      [sonnet, llama, noTools],
      codeGenReq,
      "internal",
      [],
      [],
    );
    expect(decision.selectedEndpoint).toBe("ep-sonnet");
    expect(decision.reason).toContain("Sonnet");
    expect(decision.reason).toContain("code-gen");
    expect(decision.excludedCount).toBeGreaterThan(0);
  });

  it("returns null when no endpoints survive filtering", () => {
    const decision = routeEndpoint(
      [noTools],
      codeGenReq,
      "internal",
      [],
      [],
    );
    expect(decision.selectedEndpoint).toBeNull();
    expect(decision.reason).toContain("No eligible");
  });

  it("produces a fallback chain", () => {
    const decision = routeEndpoint(
      [sonnet, llama],
      codeGenReq,
      "internal",
      [],
      [],
    );
    expect(decision.fallbackChain.length).toBeGreaterThan(0);
    expect(decision.fallbackChain[0]).toBe("ep-llama");
  });

  it("respects pinned override", () => {
    const overrides: EndpointOverride[] = [
      { endpointId: "ep-llama", taskType: "code-gen", pinned: true, blocked: false },
    ];
    const decision = routeEndpoint(
      [sonnet, llama],
      codeGenReq,
      "internal",
      [],
      overrides,
    );
    expect(decision.selectedEndpoint).toBe("ep-llama");
    expect(decision.reason).toContain("Pinned");
  });

  it("respects blocked override", () => {
    const overrides: EndpointOverride[] = [
      { endpointId: "ep-sonnet", taskType: "code-gen", pinned: false, blocked: true },
    ];
    const decision = routeEndpoint(
      [sonnet, llama],
      codeGenReq,
      "internal",
      [],
      overrides,
    );
    expect(decision.selectedEndpoint).toBe("ep-llama");
  });

  it("includes policy rules applied in the decision", () => {
    const rule: PolicyRuleEval = {
      id: "rule-1",
      name: "Block anthropic",
      description: "test",
      condition: { field: "providerId", operator: "equals", value: "anthropic" },
    };
    const decision = routeEndpoint(
      [sonnet, llama],
      codeGenReq,
      "internal",
      [rule],
      [],
    );
    expect(decision.policyRulesApplied).toContain("Block anthropic");
    expect(decision.selectedEndpoint).toBe("ep-llama");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd apps/web && npx vitest run lib/routing/pipeline.test.ts
```

Expected: FAIL — module `./pipeline` not found.

- [ ] **Step 3: Implement pipeline.ts**

Create `apps/web/lib/routing/pipeline.ts`:

```typescript
/**
 * EP-INF-001: The routing pipeline — single composable function.
 * Pure functions — no DB access, no side effects.
 *
 * Pipeline: overrides → policyFilter → hardFilter → score → rank → select → explain
 */
import type {
  EndpointManifest,
  TaskRequirementContract,
  PolicyRuleEval,
  PolicyCondition,
  SensitivityLevel,
  CandidateTrace,
  RouteDecision,
  EndpointOverride,
} from "./types";
import { computeFitness } from "./scoring";

// ── Stage 0: Policy Filter ──

export function filterByPolicy(
  endpoints: EndpointManifest[],
  rules: PolicyRuleEval[],
): { eligible: EndpointManifest[]; excluded: CandidateTrace[]; applied: string[] } {
  const excluded: CandidateTrace[] = [];
  const applied: string[] = [];
  let eligible = [...endpoints];

  for (const rule of rules) {
    const beforeIds = new Set(eligible.map((e) => e.id));
    eligible = eligible.filter((ep) => !matchesCondition(ep, rule.condition));
    const afterIds = new Set(eligible.map((e) => e.id));

    // Find endpoints that were removed by this specific rule
    const removedByRule = [...beforeIds].filter((id) => !afterIds.has(id));
    if (removedByRule.length > 0) {
      applied.push(rule.name);
      for (const id of removedByRule) {
        const ep = endpoints.find((e) => e.id === id)!;
        excluded.push({
          endpointId: ep.id,
          endpointName: ep.name,
          fitnessScore: 0,
          dimensionScores: {},
          costPerOutputMToken: ep.costPerOutputMToken,
          excluded: true,
          excludedReason: `excluded by policy: ${rule.name}`,
        });
      }
    }
  }

  return { eligible, excluded, applied };
}

function matchesCondition(ep: EndpointManifest, condition: PolicyCondition): boolean {
  const fieldValue = ep[condition.field];
  switch (condition.operator) {
    case "equals":
      return fieldValue === condition.value;
    case "not_equals":
      return fieldValue !== condition.value;
    case "includes":
      return Array.isArray(fieldValue) && Array.isArray(condition.value)
        ? condition.value.some((v) => (fieldValue as string[]).includes(v))
        : Array.isArray(fieldValue) && (fieldValue as string[]).includes(condition.value as string);
    case "not_includes":
      return Array.isArray(fieldValue)
        ? !(fieldValue as string[]).includes(condition.value as string)
        : true;
    default:
      return false;
  }
}

// ── Stage 1: Hard Filter ──

export function filterHard(
  endpoints: EndpointManifest[],
  requirement: TaskRequirementContract,
  sensitivity: SensitivityLevel,
): { eligible: EndpointManifest[]; excluded: CandidateTrace[] } {
  const eligible: EndpointManifest[] = [];
  const excluded: CandidateTrace[] = [];

  for (const ep of endpoints) {
    const reason = getExclusionReason(ep, requirement, sensitivity);
    if (reason) {
      excluded.push({
        endpointId: ep.id,
        endpointName: ep.name,
        fitnessScore: 0,
        dimensionScores: {},
        costPerOutputMToken: ep.costPerOutputMToken,
        excluded: true,
        excludedReason: reason,
      });
    } else {
      eligible.push(ep);
    }
  }

  return { eligible, excluded };
}

function getExclusionReason(
  ep: EndpointManifest,
  req: TaskRequirementContract,
  sensitivity: SensitivityLevel,
): string | null {
  if (ep.status !== "active" && ep.status !== "degraded") {
    return `excluded: status is ${ep.status}`;
  }
  if (ep.retiredAt) {
    return "excluded: endpoint retired";
  }
  if (!ep.sensitivityClearance.includes(sensitivity)) {
    return `excluded: sensitivity clearance insufficient for ${sensitivity} data`;
  }
  if (req.requiredCapabilities.supportsToolUse && !ep.supportsToolUse) {
    return "excluded: no tool support";
  }
  if (req.requiredCapabilities.supportsStructuredOutput && !ep.supportsStructuredOutput) {
    return "excluded: no structured output support";
  }
  if (req.requiredCapabilities.supportsStreaming && !ep.supportsStreaming) {
    return "excluded: no streaming support";
  }
  if (
    req.requiredCapabilities.minContextTokens &&
    ep.maxContextTokens !== null &&
    ep.maxContextTokens < req.requiredCapabilities.minContextTokens
  ) {
    return `excluded: context window too small (${ep.maxContextTokens} < ${req.requiredCapabilities.minContextTokens})`;
  }
  if (
    req.maxLatencyMs &&
    ep.avgLatencyMs !== null &&
    ep.avgLatencyMs > req.maxLatencyMs
  ) {
    return `excluded: average latency ${Math.round(ep.avgLatencyMs)}ms exceeds ceiling ${req.maxLatencyMs}ms`;
  }
  // Note: modelRestrictions check is deferred — enforcement happens at registration
  // time (seed script validates modelId against modelRestrictions). Runtime check
  // will be added when ModelProvider gains a modelId field (Phase 4+).
  return null;
}

// ── Full Pipeline ──

export function routeEndpoint(
  endpoints: EndpointManifest[],
  requirement: TaskRequirementContract,
  sensitivity: SensitivityLevel,
  policyRules: PolicyRuleEval[],
  overrides: EndpointOverride[],
): RouteDecision {
  const timestamp = new Date();

  // Check for pinned override
  const pinned = overrides.find(
    (o) => o.taskType === requirement.taskType && o.pinned,
  );
  if (pinned) {
    const pinnedEp = endpoints.find((e) => e.id === pinned.endpointId);
    if (pinnedEp) {
      return {
        selectedEndpoint: pinnedEp.id,
        reason: `Pinned: ${pinnedEp.name} is pinned for ${requirement.taskType} tasks`,
        fitnessScore: 0,
        fallbackChain: [],
        candidates: endpoints.map((e) => ({
          endpointId: e.id,
          endpointName: e.name,
          fitnessScore: 0,
          dimensionScores: {},
          costPerOutputMToken: e.costPerOutputMToken,
          excluded: e.id !== pinnedEp.id,
          excludedReason: e.id !== pinnedEp.id ? "pinned override active" : undefined,
        })),
        excludedCount: endpoints.length - 1,
        excludedReasons: ["pinned override active"],
        policyRulesApplied: [],
        taskType: requirement.taskType,
        sensitivity,
        timestamp,
      };
    }
  }

  // Apply blocked overrides — remove blocked endpoints
  const blocked = new Set(
    overrides
      .filter((o) => o.taskType === requirement.taskType && o.blocked)
      .map((o) => o.endpointId),
  );
  let pool = endpoints.filter((e) => !blocked.has(e.id));
  const blockedTraces: CandidateTrace[] = endpoints
    .filter((e) => blocked.has(e.id))
    .map((e) => ({
      endpointId: e.id,
      endpointName: e.name,
      fitnessScore: 0,
      dimensionScores: {},
      costPerOutputMToken: e.costPerOutputMToken,
      excluded: true,
      excludedReason: "blocked by override",
    }));

  // Stage 0: Policy filter
  const policyResult = filterByPolicy(pool, policyRules);
  pool = policyResult.eligible;

  // Stage 1: Hard filter
  const hardResult = filterHard(pool, requirement, sensitivity);
  const eligible = hardResult.eligible;

  // All excluded traces
  const allExcluded = [...blockedTraces, ...policyResult.excluded, ...hardResult.excluded];

  if (eligible.length === 0) {
    return {
      selectedEndpoint: null,
      reason: `No eligible endpoints for ${requirement.taskType} task. ${allExcluded.length} endpoint(s) excluded.`,
      fitnessScore: 0,
      fallbackChain: [],
      candidates: allExcluded,
      excludedCount: allExcluded.length,
      excludedReasons: [...new Set(allExcluded.map((e) => e.excludedReason!))],
      policyRulesApplied: policyResult.applied,
      taskType: requirement.taskType,
      sensitivity,
      timestamp,
    };
  }

  // Stage 2 & 3: Score and rank
  const scored = eligible
    .map((ep) => {
      const { fitness, dimensionScores } = computeFitness(ep, requirement, eligible);
      return {
        endpoint: ep,
        trace: {
          endpointId: ep.id,
          endpointName: ep.name,
          fitnessScore: Math.round(fitness * 10) / 10,
          dimensionScores,
          costPerOutputMToken: ep.costPerOutputMToken,
          excluded: false,
        } satisfies CandidateTrace,
        fitness,
      };
    })
    .sort((a, b) => {
      // Primary: fitness descending
      if (Math.abs(a.fitness - b.fitness) > 0.1) return b.fitness - a.fitness;
      // Tiebreaker 1: lower cost
      const aCost = a.endpoint.costPerOutputMToken ?? 0;
      const bCost = b.endpoint.costPerOutputMToken ?? 0;
      if (aCost !== bCost) return aCost - bCost;
      // Tiebreaker 2: lower failure rate
      if (a.endpoint.recentFailureRate !== b.endpoint.recentFailureRate) {
        return a.endpoint.recentFailureRate - b.endpoint.recentFailureRate;
      }
      // Tiebreaker 3: lower latency
      const aLat = a.endpoint.avgLatencyMs ?? Infinity;
      const bLat = b.endpoint.avgLatencyMs ?? Infinity;
      return aLat - bLat;
    });

  // Stage 4: Select & explain
  const winner = scored[0];
  const fallbackChain = scored.slice(1, 4).map((s) => s.endpoint.id);

  const allCandidates = [
    ...scored.map((s) => s.trace),
    ...allExcluded,
  ];

  const dimSummary = Object.entries(winner.trace.dimensionScores)
    .map(([dim, score]) => `${dim}: ${score}`)
    .join(", ");

  const reason = [
    `Selected ${winner.endpoint.name} (${winner.endpoint.providerId}) for ${requirement.taskType} task:`,
    `best fitness ${winner.trace.fitnessScore}.`,
    dimSummary ? `Scores: ${dimSummary}.` : "",
    requirement.selectionRationale + ".",
    allExcluded.length > 0
      ? `${allExcluded.length} endpoint(s) excluded (${[...new Set(allExcluded.map((e) => e.excludedReason))].join("; ")}).`
      : "",
    `${scored.length} candidate(s) scored.`,
  ]
    .filter(Boolean)
    .join(" ");

  return {
    selectedEndpoint: winner.endpoint.id,
    reason,
    fitnessScore: winner.trace.fitnessScore,
    fallbackChain,
    candidates: allCandidates,
    excludedCount: allExcluded.length,
    excludedReasons: [...new Set(allExcluded.map((e) => e.excludedReason!))],
    policyRulesApplied: policyResult.applied,
    taskType: requirement.taskType,
    sensitivity,
    timestamp,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd apps/web && npx vitest run lib/routing/pipeline.test.ts
```

Expected: All tests PASS.

- [ ] **Step 5: Update barrel export**

Add to `apps/web/lib/routing/index.ts`:

```typescript
export { routeEndpoint, filterHard, filterByPolicy } from "./pipeline";
export { computeFitness, normalizeWeights } from "./scoring";
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/routing/
git commit -m "feat: implement routing pipeline with TDD — filter, score, rank, select (EP-INF-001 Phase 3)"
```

---

## Task 7: Explain Function

**Files:**
- Create: `apps/web/lib/routing/explain.ts`

- [ ] **Step 1: Create the explain module**

Create `apps/web/lib/routing/explain.ts`:

```typescript
/**
 * EP-INF-001: Build human-readable explanation strings from routing decisions.
 * These are the strings a compliance officer reads — not internal IDs.
 */
import type { RouteDecision } from "./types";

/**
 * Format a RouteDecision.reason for display to non-technical users.
 * Strips internal IDs and uses plain language.
 */
export function formatDecisionForUser(decision: RouteDecision): string {
  if (!decision.selectedEndpoint) {
    return `No AI model was available for this ${decision.taskType} task. ${decision.excludedCount} model(s) were considered but none met the requirements.`;
  }

  const winner = decision.candidates.find(
    (c) => c.endpointId === decision.selectedEndpoint && !c.excluded,
  );
  if (!winner) return decision.reason;

  const parts: string[] = [];

  parts.push(
    `Model '${winner.endpointName}' was selected for your ${decision.taskType} task.`,
  );

  if (Object.keys(winner.dimensionScores).length > 0) {
    const scores = Object.entries(winner.dimensionScores)
      .map(([dim, score]) => `${formatDimensionName(dim)}: ${score}/100`)
      .join(", ");
    parts.push(`It scored ${scores}.`);
  }

  if (decision.policyRulesApplied.length > 0) {
    parts.push(
      `Policy rule(s) applied: ${decision.policyRulesApplied.join(", ")}.`,
    );
  }

  if (decision.excludedCount > 0) {
    parts.push(
      `${decision.excludedCount} other model(s) were excluded.`,
    );
  }

  const scored = decision.candidates.filter((c) => !c.excluded).length;
  if (scored > 1) {
    parts.push(`${scored} models were evaluated in total.`);
  }

  return parts.join(" ");
}

function formatDimensionName(dim: string): string {
  const names: Record<string, string> = {
    reasoning: "Reasoning",
    codegen: "Code Generation",
    toolFidelity: "Tool Calling",
    instructionFollowing: "Instruction Following",
    structuredOutput: "Structured Output",
    conversational: "Conversational",
    contextRetention: "Context Retention",
  };
  return names[dim] ?? dim;
}
```

- [ ] **Step 2: Add to barrel export**

Add to `apps/web/lib/routing/index.ts`:

```typescript
export { formatDecisionForUser } from "./explain";
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/routing/explain.ts apps/web/lib/routing/index.ts
git commit -m "feat: add human-readable routing explanation formatter (EP-INF-001 Phase 3)"
```

---

## Task 8: Database Loader

**Files:**
- Create: `apps/web/lib/routing/loader.ts`

- [ ] **Step 1: Create the loader module**

Create `apps/web/lib/routing/loader.ts`:

```typescript
/**
 * EP-INF-001: Load routing data from the database.
 * Converts Prisma rows into the routing pipeline's type system.
 */
import { prisma } from "@dpf/db";
import type {
  EndpointManifest,
  TaskRequirementContract,
  PolicyRuleEval,
  EndpointOverride,
  SensitivityLevel,
} from "./types";

/**
 * Load all active/degraded endpoints as EndpointManifest objects.
 */
export async function loadEndpointManifests(): Promise<EndpointManifest[]> {
  const providers = await prisma.modelProvider.findMany({
    where: {
      status: { in: ["active", "degraded"] },
      endpointType: "llm",
      retiredAt: null,
    },
  });

  return providers.map((p) => ({
    id: p.providerId,
    providerId: p.providerId,
    name: p.name,
    endpointType: p.endpointType,
    status: p.status as EndpointManifest["status"],
    sensitivityClearance: p.sensitivityClearance as SensitivityLevel[],
    supportsToolUse: p.supportsToolUse,
    supportsStructuredOutput: p.supportsStructuredOutput,
    supportsStreaming: p.supportsStreaming,
    maxContextTokens: p.maxContextTokens,
    maxOutputTokens: p.maxOutputTokens,
    modelRestrictions: p.modelRestrictions,
    reasoning: p.reasoning,
    codegen: p.codegen,
    toolFidelity: p.toolFidelity,
    instructionFollowing: p.instructionFollowing,
    structuredOutput: p.structuredOutput,
    conversational: p.conversational,
    contextRetention: p.contextRetention,
    customScores: (p.customScores as Record<string, number>) ?? {},
    avgLatencyMs: p.avgLatencyMs,
    recentFailureRate: p.recentFailureRate,
    costPerInputMToken: p.costPerInputMToken,
    costPerOutputMToken: p.costPerOutputMToken,
    profileSource: p.profileSource as EndpointManifest["profileSource"],
    profileConfidence: p.profileConfidence as EndpointManifest["profileConfidence"],
    retiredAt: p.retiredAt,
  }));
}

/**
 * Load a task requirement by task type.
 * Falls back to a permissive default if the task type isn't registered.
 */
export async function loadTaskRequirement(
  taskType: string,
): Promise<TaskRequirementContract> {
  const req = await prisma.taskRequirement.findUnique({
    where: { taskType },
  });

  if (req) {
    return {
      taskType: req.taskType,
      description: req.description,
      selectionRationale: req.selectionRationale,
      requiredCapabilities: req.requiredCapabilities as TaskRequirementContract["requiredCapabilities"],
      preferredMinScores: req.preferredMinScores as Record<string, number>,
      maxLatencyMs: req.maxLatencyMs ?? undefined,
      preferCheap: req.preferCheap,
    };
  }

  // Default for unknown task types — no hard requirements, prefer conversational
  return {
    taskType,
    description: `Unregistered task type: ${taskType}`,
    selectionRationale: "No specific requirements — using general-purpose routing",
    requiredCapabilities: {},
    preferredMinScores: { conversational: 40, reasoning: 40 },
    preferCheap: false,
  };
}

/**
 * Load active policy rules.
 */
export async function loadPolicyRules(): Promise<PolicyRuleEval[]> {
  const now = new Date();
  const rules = await prisma.policyRule.findMany({
    where: {
      effectiveFrom: { lte: now },
      OR: [
        { effectiveUntil: null },
        { effectiveUntil: { gt: now } },
      ],
    },
  });

  return rules.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    condition: r.condition as PolicyRuleEval["condition"],
  }));
}

/**
 * Load pinned/blocked overrides for a task type.
 */
export async function loadOverrides(taskType: string): Promise<EndpointOverride[]> {
  const perf = await prisma.endpointTaskPerformance.findMany({
    where: {
      taskType,
      OR: [{ pinned: true }, { blocked: true }],
    },
    select: {
      endpointId: true,
      taskType: true,
      pinned: true,
      blocked: true,
    },
  });

  return perf.map((p) => ({
    endpointId: p.endpointId,
    taskType: p.taskType,
    pinned: p.pinned,
    blocked: p.blocked,
  }));
}

/**
 * Persist a RouteDecision to the audit log.
 */
export async function persistRouteDecision(
  decision: import("./types").RouteDecision,
  agentMessageId?: string,
  shadowMode = false,
): Promise<string> {
  const record = await prisma.routeDecisionLog.create({
    data: {
      agentMessageId: agentMessageId ?? null,
      selectedEndpointId: decision.selectedEndpoint ?? "none",
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

- [ ] **Step 2: Add to barrel export**

Add to `apps/web/lib/routing/index.ts`:

```typescript
export {
  loadEndpointManifests,
  loadTaskRequirement,
  loadPolicyRules,
  loadOverrides,
  persistRouteDecision,
} from "./loader";
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/lib/routing/loader.ts apps/web/lib/routing/index.ts
git commit -m "feat: add routing data loader and decision persistence (EP-INF-001 Phase 3)"
```

---

## Task 9: Feature Flag & Shadow Mode Integration

**Files:**
- Modify: `apps/web/lib/feature-flags.ts`
- Modify: `apps/web/lib/actions/agent-coworker.ts`

- [ ] **Step 1: Read current feature-flags.ts**

Read `apps/web/lib/feature-flags.ts` to understand the existing pattern.

- [ ] **Step 2: Add USE_MANIFEST_ROUTER flag**

Add to `apps/web/lib/feature-flags.ts`, following the existing pattern for `isUnifiedCoworkerEnabled`:

```typescript
export async function isManifestRouterEnabled(): Promise<boolean> {
  const config = await prisma.platformConfig.findUnique({
    where: { key: "USE_MANIFEST_ROUTER" },
  });
  const val = config?.value as { enabled?: boolean } | null;
  return val?.enabled === true;
}
```

- [ ] **Step 3: Read agent-coworker.ts to find the insertion point**

Read `apps/web/lib/actions/agent-coworker.ts` and identify where the unified coworker path classifies tasks and calls `routeWithPerformance`. The shadow mode integration goes alongside this — running the new router and logging its decision, without changing which endpoint actually serves the request.

- [ ] **Step 4: Add shadow mode routing call**

In `agent-coworker.ts`, inside the `if (classification.taskType !== "unknown" && classification.confidence >= 0.5)` block (around line 456), **after** `routeCtx` is defined at line 459, add the shadow mode block. This placement ensures both `classification` and `routeCtx` are in scope, and only runs for confident classifications (avoiding noise from unknown/low-confidence tasks):

```typescript
      // ── EP-INF-001: Shadow mode — new manifest-based router ──
      if (await isManifestRouterEnabled()) {
        try {
          const [manifests, taskReq, policies, epOverrides] = await Promise.all([
            loadEndpointManifests(),
            loadTaskRequirement(classification.taskType),
            loadPolicyRules(),
            loadOverrides(classification.taskType),
          ]);
          const manifestDecision = routeEndpoint(
            manifests,
            taskReq,
            routeCtx.sensitivity,
            policies,
            epOverrides,
          );
          // Log the shadow decision — does not affect actual routing
          await persistRouteDecision(manifestDecision, undefined, true);
          console.log(
            `[EP-INF-001 shadow] ${classification.taskType}: ${manifestDecision.reason}`,
          );
        } catch (err) {
          console.error("[EP-INF-001 shadow] routing error:", err);
        }
      }
```

Add the necessary imports at the top of the file:

```typescript
import { isManifestRouterEnabled } from "@/lib/feature-flags";
import {
  loadEndpointManifests,
  loadTaskRequirement,
  loadPolicyRules,
  loadOverrides,
  routeEndpoint,
  persistRouteDecision,
} from "@/lib/routing";
```

- [ ] **Step 5: Run the test suite to verify nothing is broken**

Run:
```bash
cd apps/web && npx vitest run
```

Expected: All existing tests pass. The shadow mode code only runs when the feature flag is enabled, which defaults to disabled.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/feature-flags.ts apps/web/lib/actions/agent-coworker.ts
git commit -m "feat: add manifest router shadow mode behind USE_MANIFEST_ROUTER flag (EP-INF-001 Phase 3)"
```

---

## Task 10: Run Full Test Suite & Verify

**Files:** None (verification only)

- [ ] **Step 1: Run all routing tests**

Run:
```bash
cd apps/web && npx vitest run lib/routing/
```

Expected: All tests in `scoring.test.ts` and `pipeline.test.ts` pass.

- [ ] **Step 2: Run all existing tests to verify no regressions**

Run:
```bash
cd apps/web && npx vitest run
```

Expected: All existing tests pass. No regressions.

- [ ] **Step 3: Verify the build compiles**

Run:
```bash
cd apps/web && npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 4: Verify database state**

Run:
```bash
DATABASE_URL="postgresql://dpf:dpf_dev@localhost:5432/dpf" npx tsx -e "
const { prisma } = require('./packages/db/src/client');
async function main() {
  const providerCount = await prisma.modelProvider.count({ where: { profileSource: 'seed' } });
  const taskReqCount = await prisma.taskRequirement.count();
  const routeLogCount = await prisma.routeDecisionLog.count();
  console.log('Seeded providers:', providerCount);
  console.log('Task requirements:', taskReqCount);
  console.log('Route decision logs:', routeLogCount, '(should be 0 — shadow mode not yet active)');
  await prisma.\$disconnect();
}
main();
"
```

Expected: Seeded providers > 0, task requirements = 9, route decision logs = 0.

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git status
# If any uncommitted changes:
git add -A && git commit -m "fix: address test/build issues from EP-INF-001 Phase 1-3 implementation"
```

---

## Summary

After completing these 10 tasks, the platform will have:

1. **Schema** — `ModelProvider` extended with 7 capability dimensions, hard constraint flags, operational metrics, and provenance fields
2. **Seed data** — All existing endpoints profiled with realistic capability scores
3. **Task requirements** — 9 built-in task types with explicit requirement contracts in the database
4. **New tables** — `TaskRequirement`, `PolicyRule`, `RouteDecisionLog`, `CustomEvalDimension`
5. **Routing pipeline** — Pure `routeEndpoint` function: policy filter → hard filter → score → rank → select → explain
6. **Shadow mode** — New router runs alongside legacy behind `USE_MANIFEST_ROUTER` flag, logging decisions for comparison
7. **21 tests** — Scoring (8: weights + fitness) + Pipeline (13: hard filter + policy filter + full routing with overrides and policy rules)

The legacy routing system (`callWithFailover`, `getProviderPriority`, etc.) continues to handle all real traffic unchanged. The new router's shadow decisions can be reviewed in the `RouteDecisionLog` table to validate correctness before Phase 4 (cut over).
