# Orchestrated Task Routing — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement performance-driven task routing where endpoints earn trust through demonstrated results, with an orchestrator that grades sub-agent work asynchronously and a human feedback loop.

**Architecture:** Pre-call heuristic classifier determines task type → performance-weighted router selects cheapest viable endpoint → sub-agent handles the request → async orchestrator evaluates the response → performance profile updates → instruction development adjusts over time. Hooks into existing observer pipeline as a parallel evaluation branch.

**Tech Stack:** Next.js, Prisma (PostgreSQL), TypeScript, Vitest

**Spec:** `docs/superpowers/specs/2026-03-16-orchestrated-task-routing-design.md`

---

## Chunk 1: Schema & Data Model

Add EndpointTaskPerformance, TaskEvaluation tables, and routing metadata columns on AgentMessage.

### Task 1.1: Add EndpointTaskPerformance and TaskEvaluation models

**Files:**
- Modify: `packages/db/prisma/schema.prisma`

- [ ] **Step 1: Add EndpointTaskPerformance model**

```prisma
model EndpointTaskPerformance {
  id                      String    @id @default(cuid())
  endpointId              String
  taskType                String

  // Scores
  evaluationCount         Int       @default(0)
  successCount            Int       @default(0)
  avgOrchestratorScore    Float     @default(0)
  avgHumanScore           Float?
  recentScores            Float[]   @default([])

  // Instruction development
  currentInstructions     String?
  instructionPhase        String    @default("learning")

  // Manual overrides
  pinned                  Boolean   @default(false)
  blocked                 Boolean   @default(false)

  // Operational
  avgLatencyMs            Float     @default(0)
  avgTokensUsed           Float     @default(0)
  lastEvaluatedAt         DateTime?
  lastInstructionUpdateAt DateTime?

  @@unique([endpointId, taskType])
}
```

- [ ] **Step 2: Add TaskEvaluation model**

```prisma
model TaskEvaluation {
  id                  String    @id @default(cuid())
  threadId            String
  endpointId          String
  taskType            String
  qualityScore        Float?
  humanScore          Float?
  taskContext          String
  evaluationNotes     String?
  routeContext        String
  createdAt           DateTime  @default(now())

  @@index([endpointId, taskType, createdAt])
  @@index([threadId])
}
```

- [ ] **Step 3: Add routing metadata to AgentMessage**

Add two nullable columns to the existing AgentMessage model:

```prisma
model AgentMessage {
  // ... existing fields ...
  taskType            String?
  routedEndpointId    String?
}
```

- [ ] **Step 4: Run prisma migration**

```bash
cd packages/db && npx prisma migrate dev --name add-task-routing-models
```

If interactive migration fails, create the SQL manually following existing migration conventions, then run `npx prisma generate`.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/
git commit -m "schema: add EndpointTaskPerformance, TaskEvaluation, and AgentMessage routing fields"
```

---

## Chunk 2: Task Type Registry & Classifier

Define the task type vocabulary and the heuristic classifier that routes work.

### Task 2.1: Create task type registry

**Files:**
- Create: `apps/web/lib/task-types.ts`

- [ ] **Step 1: Define TaskTypeDefinition type and TASK_TYPES constant**

```typescript
import type { CapabilityTier } from "./agent-router-types";

export type TaskTypeDefinition = {
  id: string;
  description: string;
  heuristicPatterns: RegExp[];
  minCapabilityTier: CapabilityTier;
  defaultInstructions: string;
  evaluationTokenLimit: number;
};

export const TASK_TYPES: TaskTypeDefinition[] = [
  {
    id: "greeting",
    description: "Casual conversation, hellos, small talk",
    heuristicPatterns: [
      /^(hi|hello|hey|good\s*(morning|afternoon|evening)|thanks|thank you)\b/i,
      /^(how are you|what's up|howdy)\b/i,
    ],
    minCapabilityTier: "basic",
    defaultInstructions: "Respond warmly and briefly. Keep it to 1-2 sentences.",
    evaluationTokenLimit: 200,
  },
  {
    id: "status-query",
    description: "Asking about current state of things",
    heuristicPatterns: [
      /\b(show me|what('s| is) the (status|state|current))\b/i,
      /\b(how many|how much|list (all|the))\b/i,
      /\b(give me|tell me about) (the |a )?(overview|summary|status)\b/i,
    ],
    minCapabilityTier: "basic",
    defaultInstructions: "Answer with specific data from the page context. Use bullet points for multiple items. Be factual, not analytical.",
    evaluationTokenLimit: 500,
  },
  {
    id: "summarization",
    description: "Condense information",
    heuristicPatterns: [
      /\b(summarize|summary|key points|main (points|takeaways)|brief overview)\b/i,
      /\b(tldr|tl;dr|in (short|brief))\b/i,
    ],
    minCapabilityTier: "basic",
    defaultInstructions: "Be concise — 3-5 bullet points maximum. Focus on key facts and decisions. Do not add your own analysis or recommendations. Do not include internal system details.",
    evaluationTokenLimit: 500,
  },
  {
    id: "reasoning",
    description: "Multi-step analysis, comparisons, trade-offs",
    heuristicPatterns: [
      /\b(why|explain|analyze|compare|evaluate|assess|what if)\b/i,
      /\b(should (we|i)|pros and cons|trade.?offs|recommend)\b/i,
      /\b(what('s| is) the (best|right|better) (way|approach|option))\b/i,
    ],
    minCapabilityTier: "analytical",
    defaultInstructions: "Think through this step by step. Consider multiple perspectives. State your reasoning clearly. If you're uncertain, say so and explain why.",
    evaluationTokenLimit: 500,
  },
  {
    id: "data-extraction",
    description: "Pull specific facts from context",
    heuristicPatterns: [
      /\b(find|extract|pull|get|look up|which (ones|items))\b/i,
      /\b(filter|search for|where is|locate)\b/i,
    ],
    minCapabilityTier: "basic",
    defaultInstructions: "Extract exactly what was asked for. Present results clearly. If nothing matches, say so explicitly.",
    evaluationTokenLimit: 500,
  },
  {
    id: "code-gen",
    description: "Write or modify code",
    heuristicPatterns: [
      /\b(write|implement|create|build|code|fix|debug|refactor)\b.*\b(function|component|api|endpoint|test|class|module)\b/i,
      /```[\s\S]*```/,
      /\b(typescript|javascript|react|prisma|sql)\b/i,
    ],
    minCapabilityTier: "analytical",
    defaultInstructions: "Write clean, well-structured code following the project's existing patterns. Include error handling. Explain your approach briefly before the code.",
    evaluationTokenLimit: 1000,
  },
  {
    id: "web-search",
    description: "Find external information",
    heuristicPatterns: [
      /\b(search (for|the web)|look up|find online|google)\b/i,
      /\b(what is|who is|when did)\b.*\b(latest|recent|current)\b/i,
    ],
    minCapabilityTier: "basic",
    defaultInstructions: "Search for the requested information. Present results with sources. Distinguish facts from opinions.",
    evaluationTokenLimit: 500,
  },
  {
    id: "creative",
    description: "Generate names, descriptions, copy",
    heuristicPatterns: [
      /\b(suggest|come up with|generate|brainstorm|name|describe|write a)\b/i,
      /\b(creative|catchy|compelling|engaging)\b/i,
    ],
    minCapabilityTier: "routine",
    defaultInstructions: "Be creative but relevant. Offer 3-5 options when generating ideas. Keep suggestions practical and aligned with the platform context.",
    evaluationTokenLimit: 500,
  },
  {
    id: "tool-action",
    description: "Execute a platform action",
    heuristicPatterns: [
      /\b(create|update|delete|remove|add|change|set|modify)\b.*\b(item|product|backlog|epic|task|provider|user|role)\b/i,
      /\b(file|report|submit|register)\b.*\b(issue|bug|improvement|feedback)\b/i,
    ],
    minCapabilityTier: "routine",
    defaultInstructions: "Execute the requested action using the appropriate tool. Confirm what you did in 1-2 sentences. Do not narrate your plan — just do it.",
    evaluationTokenLimit: 300,
  },
];

/** Lookup a task type definition by id */
export function getTaskType(id: string): TaskTypeDefinition | undefined {
  return TASK_TYPES.find((t) => t.id === id);
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/task-types.ts
git commit -m "feat: add task type registry with default instructions"
```

### Task 2.2: Create heuristic task classifier with TDD

**Files:**
- Create: `apps/web/lib/task-classifier.ts`
- Create: `apps/web/lib/task-classifier.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, it, expect } from "vitest";
import { classifyTask } from "./task-classifier";

describe("classifyTask", () => {
  it("classifies greetings", () => {
    const result = classifyTask("Hello there!", []);
    expect(result.taskType).toBe("greeting");
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("classifies status queries", () => {
    const result = classifyTask("Show me the current backlog status", []);
    expect(result.taskType).toBe("status-query");
    expect(result.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("classifies summarization requests", () => {
    const result = classifyTask("Give me a summary of the key points", []);
    expect(result.taskType).toBe("summarization");
  });

  it("classifies reasoning tasks", () => {
    const result = classifyTask("Why should we choose approach A over B?", []);
    expect(result.taskType).toBe("reasoning");
  });

  it("classifies data extraction", () => {
    const result = classifyTask("Find all products in the retirement stage", []);
    expect(result.taskType).toBe("data-extraction");
  });

  it("classifies code generation", () => {
    const result = classifyTask("Write a function to validate email addresses in typescript", []);
    expect(result.taskType).toBe("code-gen");
  });

  it("classifies tool actions", () => {
    const result = classifyTask("Create a new backlog item for the auth feature", []);
    expect(result.taskType).toBe("tool-action");
  });

  it("classifies web search requests", () => {
    const result = classifyTask("Search for the latest GDPR compliance requirements", []);
    expect(result.taskType).toBe("web-search");
  });

  it("returns unknown with low confidence for ambiguous messages", () => {
    const result = classifyTask("ok", []);
    expect(result.taskType).toBe("unknown");
    expect(result.confidence).toBeLessThan(0.5);
  });

  it("returns unknown when no patterns match", () => {
    const result = classifyTask("xyz abc 123", []);
    expect(result.taskType).toBe("unknown");
  });

  it("uses conversation context for classification", () => {
    // A short reply to an ongoing reasoning conversation
    const result = classifyTask("What about option C?", [
      "We should compare the three deployment strategies",
      "Option A has lower cost but higher risk",
    ]);
    expect(result.taskType).toBe("reasoning");
  });

  it("high confidence when only one type matches clearly", () => {
    const result = classifyTask("Summarize the key points from the meeting", []);
    expect(result.confidence).toBe(0.8);
  });

  it("low confidence when multiple types match", () => {
    // "find" matches data-extraction, "compare" matches reasoning
    const result = classifyTask("Find and compare all products", []);
    expect(result.confidence).toBeLessThanOrEqual(0.5);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd apps/web && npx vitest run lib/task-classifier.test.ts
```
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement the classifier**

```typescript
import { TASK_TYPES } from "./task-types";

export type ClassificationResult = {
  taskType: string;
  confidence: number;
};

/**
 * Classify a user message into a task type using heuristic pattern matching.
 * Uses the message content + recent conversation context.
 * Returns { taskType, confidence } where confidence 0-1.
 * If confidence < 0.5, returns "unknown" → routes to primary endpoint.
 */
export function classifyTask(
  message: string,
  conversationContext: string[],
): ClassificationResult {
  const combinedText = [message, ...conversationContext.slice(0, 3)].join(" ");

  // Score each task type by pattern matches
  const scores: Array<{ id: string; matchCount: number; totalPatterns: number }> = [];

  for (const taskType of TASK_TYPES) {
    let matchCount = 0;
    for (const pattern of taskType.heuristicPatterns) {
      // Check against message first (primary signal)
      if (pattern.test(message)) {
        matchCount++;
      } else if (conversationContext.length > 0 && pattern.test(combinedText)) {
        // Context match counts as half
        matchCount += 0.5;
      }
    }
    if (matchCount > 0) {
      scores.push({ id: taskType.id, matchCount, totalPatterns: taskType.heuristicPatterns.length });
    }
  }

  // No matches at all
  if (scores.length === 0) {
    return { taskType: "unknown", confidence: 0 };
  }

  // Sort by match count descending
  scores.sort((a, b) => b.matchCount - a.matchCount);

  const top = scores[0]!;
  const second = scores[1];

  // Single clear winner
  if (scores.length === 1 || (second && top.matchCount > second.matchCount * 1.5)) {
    return { taskType: top.id, confidence: 0.8 };
  }

  // Ambiguous — multiple types match similarly
  if (second && top.matchCount <= second.matchCount * 1.5) {
    // If top has enough absolute matches, still use it but with lower confidence
    if (top.matchCount >= 2) {
      return { taskType: top.id, confidence: 0.4 };
    }
    return { taskType: "unknown", confidence: 0.3 };
  }

  return { taskType: top.id, confidence: top.matchCount / top.totalPatterns };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd apps/web && npx vitest run lib/task-classifier.test.ts
```
Expected: ALL PASS (some tests may need tuning — adjust patterns or test expectations to match the classifier behavior)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/task-classifier.ts apps/web/lib/task-classifier.test.ts
git commit -m "feat: heuristic task classifier with confidence scoring"
```

---

## Chunk 3: Performance-Weighted Router

Extend the existing AgentRouter with performance profile lookups and cost-aware scoring.

### Task 3.1: Add performance data loader

**Files:**
- Modify: `apps/web/lib/agent-router-data.ts`

- [ ] **Step 1: Add loadPerformanceProfiles function**

```typescript
import { prisma } from "@dpf/db";

export type PerformanceProfile = {
  endpointId: string;
  taskType: string;
  evaluationCount: number;
  avgOrchestratorScore: number;
  avgHumanScore: number | null;
  successCount: number;
  recentScores: number[];
  instructionPhase: string;
  currentInstructions: string | null;
  pinned: boolean;
  blocked: boolean;
};

/** Load performance profiles for a specific task type */
export async function loadPerformanceProfiles(taskType: string): Promise<PerformanceProfile[]> {
  const profiles = await prisma.endpointTaskPerformance.findMany({
    where: { taskType },
    select: {
      endpointId: true,
      taskType: true,
      evaluationCount: true,
      avgOrchestratorScore: true,
      avgHumanScore: true,
      successCount: true,
      recentScores: true,
      instructionPhase: true,
      currentInstructions: true,
      pinned: true,
      blocked: true,
    },
  });
  return profiles;
}

/** Ensure a performance profile exists (lazy creation) */
export async function ensurePerformanceProfile(
  endpointId: string,
  taskType: string,
  defaultInstructions: string,
): Promise<void> {
  await prisma.endpointTaskPerformance.upsert({
    where: { endpointId_taskType: { endpointId, taskType } },
    update: {},
    create: {
      endpointId,
      taskType,
      instructionPhase: "learning",
      currentInstructions: defaultInstructions,
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/agent-router-data.ts
git commit -m "feat: add performance profile loader and lazy creation"
```

### Task 3.2: Extend router with performance-weighted scoring (TDD)

**Files:**
- Modify: `apps/web/lib/agent-router.ts`
- Modify: `apps/web/lib/agent-router.test.ts`

- [ ] **Step 1: Fix COST_ORDER to avoid division-by-zero**

In `agent-router.ts`, change COST_ORDER from `{ "free": 0, ... }` to:

```typescript
const COST_WEIGHT: Record<CostBand, number> = {
  "free": 1,
  "low": 2,
  "medium": 3,
  "high": 4,
};
```

Update all references from `COST_ORDER` to `COST_WEIGHT` in `rankEndpoints`.

- [ ] **Step 2: Add routeWithPerformance function**

```typescript
import type { PerformanceProfile } from "./agent-router-data";

const MIN_EVALUATIONS = 5;

/** Compute effective quality score blending orchestrator and human feedback */
function avgEffectiveScore(perf: PerformanceProfile): number {
  if (perf.avgHumanScore !== null && perf.avgHumanScore > 0) {
    return 0.6 * perf.avgHumanScore + 0.4 * perf.avgOrchestratorScore;
  }
  return perf.avgOrchestratorScore;
}

/** Route with performance data — selects best quality/cost ratio endpoint */
export function routeWithPerformance(
  endpoints: EndpointCandidate[],
  profiles: PerformanceProfile[],
  request: TaskRequest & { taskType: string },
): RouteResult {
  const eligible = filterEligible(endpoints, request);
  if (eligible.length === 0) return null;

  const profileMap = new Map(profiles.map((p) => [p.endpointId, p]));

  // Apply pin/block overrides
  const pinned = eligible.find((ep) => profileMap.get(ep.endpointId)?.pinned);
  if (pinned) return { endpointId: pinned.endpointId, reason: "pinned" };

  const unblocked = eligible.filter((ep) => !profileMap.get(ep.endpointId)?.blocked);
  if (unblocked.length === 0) return null;

  // Score each endpoint
  const scored = unblocked.map((ep) => {
    const perf = profileMap.get(ep.endpointId);
    let score: number;
    if (perf && perf.evaluationCount >= MIN_EVALUATIONS) {
      const quality = avgEffectiveScore(perf);
      score = quality / COST_WEIGHT[ep.costBand];
    } else {
      score = TIER_ORDER[ep.capabilityTier] / COST_WEIGHT[ep.costBand];
    }
    return { ep, score };
  });

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tiebreakers: latency, failures, alphabetical
    const latDiff = (a.ep.avgLatencyMs ?? Infinity) - (b.ep.avgLatencyMs ?? Infinity);
    if (latDiff !== 0) return latDiff;
    const failDiff = (a.ep.recentFailures ?? 0) - (b.ep.recentFailures ?? 0);
    if (failDiff !== 0) return failDiff;
    return a.ep.endpointId.localeCompare(b.ep.endpointId);
  });

  const best = scored[0]!;
  return { endpointId: best.ep.endpointId, reason: `score=${best.score.toFixed(2)}` };
}
```

- [ ] **Step 3: Write tests for routeWithPerformance**

Add to `agent-router.test.ts`:

```typescript
import type { PerformanceProfile } from "./agent-router-data";

describe("routeWithPerformance", () => {
  const profiles: PerformanceProfile[] = [
    {
      endpointId: "ollama-llama",
      taskType: "summarization",
      evaluationCount: 20,
      avgOrchestratorScore: 4.0,
      avgHumanScore: null,
      successCount: 18,
      recentScores: [4, 4, 4, 3, 5],
      instructionPhase: "practicing",
      currentInstructions: null,
      pinned: false,
      blocked: false,
    },
    {
      endpointId: "ollama-phi",
      taskType: "summarization",
      evaluationCount: 15,
      avgOrchestratorScore: 3.5,
      avgHumanScore: null,
      successCount: 12,
      recentScores: [3, 4, 3, 4, 3],
      instructionPhase: "learning",
      currentInstructions: "Be concise",
      pinned: false,
      blocked: false,
    },
  ];

  it("selects endpoint with best quality/cost ratio", () => {
    // Both are free (cost weight 1). ollama-llama scores 4.0/1=4.0, ollama-phi scores 3.5/1=3.5
    const result = routeWithPerformance(ENDPOINTS, profiles, {
      sensitivity: "internal",
      minCapabilityTier: "basic",
      taskType: "summarization",
    });
    expect(result?.endpointId).toBe("ollama-llama");
  });

  it("respects pinned override", () => {
    const pinnedProfiles = profiles.map((p) =>
      p.endpointId === "ollama-phi" ? { ...p, pinned: true } : p,
    );
    const result = routeWithPerformance(ENDPOINTS, pinnedProfiles, {
      sensitivity: "internal",
      minCapabilityTier: "basic",
      taskType: "summarization",
    });
    expect(result?.endpointId).toBe("ollama-phi");
  });

  it("excludes blocked endpoints", () => {
    const blockedProfiles = profiles.map((p) =>
      p.endpointId === "ollama-llama" ? { ...p, blocked: true } : p,
    );
    const result = routeWithPerformance(ENDPOINTS, blockedProfiles, {
      sensitivity: "internal",
      minCapabilityTier: "basic",
      taskType: "summarization",
    });
    expect(result?.endpointId).toBe("ollama-phi");
  });

  it("falls back to capability tier for cold-start endpoints", () => {
    // No profiles — uses static tier scoring
    const result = routeWithPerformance(ENDPOINTS, [], {
      sensitivity: "internal",
      minCapabilityTier: "basic",
      taskType: "summarization",
    });
    // openrouter (deep-thinker=4/medium=3=1.33) vs ollama-llama (analytical=3/free=1=3.0)
    // ollama-llama wins on quality/cost
    expect(result?.endpointId).toBe("ollama-llama");
  });
});
```

- [ ] **Step 4: Run tests**

```bash
cd apps/web && npx vitest run lib/agent-router.test.ts
```
Expected: ALL PASS (existing 9 tests + new 4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/agent-router.ts apps/web/lib/agent-router.test.ts
git commit -m "feat: performance-weighted routing with pin/block and cost fix"
```

---

## Chunk 4: Orchestrator Evaluator

The async evaluation engine that grades sub-agent responses and updates performance profiles.

### Task 4.1: Create orchestrator evaluator

**Files:**
- Create: `apps/web/lib/orchestrator-evaluator.ts`

- [ ] **Step 1: Implement the evaluator**

```typescript
import { prisma } from "@dpf/db";
import { callWithFailover } from "./ai-provider-priority";
import { routePrimary } from "./agent-router";
import { loadEndpoints } from "./agent-router-data";
import { getTaskType } from "./task-types";
import type { SensitivityLevel } from "./agent-router-types";
import type { ChatMessage } from "./ai-inference";

const EVALUATION_TIMEOUT_MS = 10_000;
const MAX_CONCURRENT_EVALUATIONS = 3;
let activeEvaluations = 0;

type EvaluationInput = {
  threadId: string;
  endpointId: string;
  taskType: string;
  routeContext: string;
  sensitivity: SensitivityLevel;
  userMessage: string;
  aiResponse: string;
};

type EvaluationResult = {
  qualityScore: number;
  notes: string;
};

/**
 * Evaluate a sub-agent response asynchronously.
 * Fires and forgets — never blocks the user response.
 * Returns silently on any failure.
 */
export async function evaluateAndUpdateProfile(input: EvaluationInput): Promise<void> {
  // Concurrency gate
  if (activeEvaluations >= MAX_CONCURRENT_EVALUATIONS) return;
  activeEvaluations++;

  try {
    // Resolve orchestrator endpoint
    const endpoints = await loadEndpoints();
    const orchestratorRoute = routePrimary(endpoints, input.sensitivity);
    if (!orchestratorRoute) return;

    // Skip self-evaluation: if the sub-agent IS the orchestrator
    if (orchestratorRoute.endpointId === input.endpointId) {
      // Still create a TaskEvaluation record for human feedback to populate later
      await prisma.taskEvaluation.create({
        data: {
          threadId: input.threadId,
          endpointId: input.endpointId,
          taskType: input.taskType,
          qualityScore: null, // self-eval skipped
          taskContext: input.userMessage.slice(0, 100),
          routeContext: input.routeContext,
        },
      });
      return;
    }

    // Get evaluation token limit for this task type
    const taskTypeDef = getTaskType(input.taskType);
    const tokenLimit = taskTypeDef?.evaluationTokenLimit ?? 500;

    // Build evaluation prompt
    const truncatedResponse = input.aiResponse.slice(0, tokenLimit * 4); // rough char-to-token estimate
    const evalPrompt = `Score this AI response 1-5 on relevance, completeness, and accuracy.

User asked: ${input.userMessage.slice(0, 400)}

AI responded: ${truncatedResponse}

Return ONLY a JSON object: { "overall": N, "notes": "one sentence" }`;

    const messages: ChatMessage[] = [{ role: "user", content: evalPrompt }];

    // Call orchestrator with timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), EVALUATION_TIMEOUT_MS);

    let evalResult: EvaluationResult;
    try {
      const result = await callWithFailover(
        messages,
        "You are a quality evaluator. Return only JSON.",
        input.sensitivity,
        { modelRequirements: { preferredProviderId: orchestratorRoute.endpointId } },
      );
      clearTimeout(timeout);

      // Parse the JSON response
      const jsonMatch = result.content.match(/\{[^}]+\}/);
      if (!jsonMatch) return;
      const parsed = JSON.parse(jsonMatch[0]) as { overall?: number; notes?: string };
      if (typeof parsed.overall !== "number" || parsed.overall < 1 || parsed.overall > 5) return;
      evalResult = { qualityScore: parsed.overall, notes: parsed.notes ?? "" };
    } catch {
      clearTimeout(timeout);
      return; // Graceful degradation — silent drop
    }

    // Persist evaluation
    await prisma.taskEvaluation.create({
      data: {
        threadId: input.threadId,
        endpointId: input.endpointId,
        taskType: input.taskType,
        qualityScore: evalResult.qualityScore,
        taskContext: input.userMessage.slice(0, 100),
        evaluationNotes: evalResult.notes.slice(0, 200),
        routeContext: input.routeContext,
      },
    });

    // Update performance profile
    await updatePerformanceProfile(input.endpointId, input.taskType, evalResult.qualityScore);
  } catch (err) {
    console.error("[orchestrator-evaluator]", err);
  } finally {
    activeEvaluations--;
  }
}

const EMA_DECAY = 0.1;
const RECENT_WINDOW = 10;
const REGRESSION_THRESHOLD = 3.0;
const REGRESSION_WINDOW = 5;

async function updatePerformanceProfile(
  endpointId: string,
  taskType: string,
  score: number,
): Promise<void> {
  const profile = await prisma.endpointTaskPerformance.findUnique({
    where: { endpointId_taskType: { endpointId, taskType } },
  });
  if (!profile) return;

  // Update rolling averages
  const newCount = profile.evaluationCount + 1;
  const newAvg = profile.evaluationCount === 0
    ? score
    : profile.avgOrchestratorScore * (1 - EMA_DECAY) + score * EMA_DECAY;
  const newSuccessCount = score >= 3 ? profile.successCount + 1 : profile.successCount;

  // Update sliding window
  const recentScores = [...profile.recentScores, score];
  if (recentScores.length > RECENT_WINDOW) recentScores.shift();

  // Check for regression
  let newPhase = profile.instructionPhase;
  let newInstructions = profile.currentInstructions;

  if (recentScores.length >= REGRESSION_WINDOW) {
    const recentAvg = recentScores.slice(-REGRESSION_WINDOW).reduce((a, b) => a + b, 0) / REGRESSION_WINDOW;
    if (recentAvg < REGRESSION_THRESHOLD && profile.instructionPhase !== "learning") {
      newPhase = "learning";
      // Refresh instructions from task type defaults
      const taskTypeDef = getTaskType(taskType);
      newInstructions = taskTypeDef?.defaultInstructions ?? profile.currentInstructions;
    }
  }

  // Check for promotion
  if (newPhase === "learning" && newCount >= 10 && newAvg >= 3.5) {
    newPhase = "practicing";
  } else if (newPhase === "practicing" && newCount >= 50 && newAvg >= 4.0 && (newSuccessCount / newCount) >= 0.9) {
    newPhase = "innate";
    newInstructions = null; // Clear instructions — endpoint has proven competency
  }

  await prisma.endpointTaskPerformance.update({
    where: { endpointId_taskType: { endpointId, taskType } },
    data: {
      evaluationCount: newCount,
      avgOrchestratorScore: newAvg,
      successCount: newSuccessCount,
      recentScores,
      instructionPhase: newPhase,
      currentInstructions: newInstructions,
      lastEvaluatedAt: new Date(),
      ...(newPhase !== profile.instructionPhase ? { lastInstructionUpdateAt: new Date() } : {}),
    },
  });
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/lib/orchestrator-evaluator.ts
git commit -m "feat: orchestrator evaluator with async grading and phase transitions"
```

### Task 4.2: Extend observer pipeline with evaluation branch

**Files:**
- Modify: `apps/web/lib/process-observer-hook.ts`
- Modify: `apps/web/lib/process-observer.ts`

- [ ] **Step 1: Expand observeConversation signature**

Add optional routing metadata to `observeConversation`:

```typescript
export type RoutingMeta = {
  endpointId: string;
  taskType: string;
  sensitivity: string;
  userMessage: string;
  aiResponse: string;
};

export async function observeConversation(
  threadId: string,
  routeContext: string,
  routingMeta?: RoutingMeta,
): Promise<void> {
```

- [ ] **Step 2: Add parallel evaluation branch**

Inside `observeConversation`, after the existing sampling logic, add a parallel branch that ALWAYS fires when routingMeta is present:

```typescript
// BRANCH B: Performance evaluation (always fires, bypasses sampling)
if (routingMeta) {
  evaluateAndUpdateProfile({
    threadId,
    endpointId: routingMeta.endpointId,
    taskType: routingMeta.taskType,
    routeContext,
    sensitivity: routingMeta.sensitivity as SensitivityLevel,
    userMessage: routingMeta.userMessage,
    aiResponse: routingMeta.aiResponse,
  }).catch((err) => console.error("[orchestrator-evaluator]", err));
}

// BRANCH A: Existing analysis (respects sampling)
// ... existing code unchanged ...
```

Import `evaluateAndUpdateProfile` from `"./orchestrator-evaluator"` and `SensitivityLevel` from `"./agent-router-types"`.

- [ ] **Step 3: Add new finding types to process-observer.ts**

Add to the `FindingType` union type:

```typescript
export type FindingType =
  | "tool_failure"
  | "config_gap"
  | "agent_quality"
  | "user_friction"
  | "endpoint_underperformance"
  | "instruction_regression";
```

These finding types are generated by the `updatePerformanceProfile` function when regression occurs — they create BacklogItems via the existing triage pipeline in a future step.

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/process-observer-hook.ts apps/web/lib/process-observer.ts
git commit -m "feat: parallel evaluation branch in observer pipeline"
```

---

## Chunk 5: Integration — Wire Classifier + Router + Evaluator into sendMessage

Connect all the pieces into the sendMessage flow.

### Task 5.1: Wire pre-call classification and performance routing

**Files:**
- Modify: `apps/web/lib/actions/agent-coworker.ts`
- Modify: `apps/web/lib/prompt-assembler.ts`

- [ ] **Step 1: Add imports**

Add to `agent-coworker.ts`:
```typescript
import { classifyTask } from "@/lib/task-classifier";
import { getTaskType } from "@/lib/task-types";
import { routeWithPerformance } from "@/lib/agent-router";
import { loadEndpoints, loadPerformanceProfiles, ensurePerformanceProfile } from "@/lib/agent-router-data";
import type { RoutingMeta } from "@/lib/process-observer-hook";
```

- [ ] **Step 2: Add task classification and performance routing in sendMessage**

Inside `sendMessage()`, after the unified prompt is assembled (after line ~258) and before `callWithFailover` (line ~348), add the classification and routing logic:

```typescript
// Task classification and performance routing (unified mode only)
let routingMeta: RoutingMeta | undefined;
let resolvedEndpointId: string | undefined;
let taskTypeId: string = "unknown";

if (useUnified) {
  // Classify the task
  const recentContent = chatHistory.slice(-3).map((m) => m.content);
  const classification = classifyTask(trimmedContent, recentContent);
  taskTypeId = classification.taskType;

  // Performance-weighted routing
  if (classification.taskType !== "unknown" && classification.confidence >= 0.5) {
    const allEndpoints = await loadEndpoints();
    const profiles = await loadPerformanceProfiles(classification.taskType);
    const routeCtx = resolveRouteContext(input.routeContext);

    const perfRoute = routeWithPerformance(allEndpoints, profiles, {
      sensitivity: routeCtx.sensitivity,
      minCapabilityTier: getTaskType(classification.taskType)?.minCapabilityTier ?? "basic",
      requiredTags: [classification.taskType],
      taskType: classification.taskType,
    });

    if (perfRoute) {
      resolvedEndpointId = perfRoute.endpointId;

      // Ensure performance profile exists (lazy creation)
      const taskTypeDef = getTaskType(classification.taskType);
      if (taskTypeDef) {
        await ensurePerformanceProfile(perfRoute.endpointId, classification.taskType, taskTypeDef.defaultInstructions);
      }

      // Inject task-specific instructions into prompt (between domain and route data)
      const profile = profiles.find((p) => p.endpointId === perfRoute.endpointId);
      if (profile?.currentInstructions) {
        populatedPrompt += `\n\n--- TASK GUIDANCE ---\n${profile.currentInstructions}`;
      }
    }
  }

  // Apply resolved endpoint as preferred provider
  if (resolvedEndpointId) {
    modelReqs.preferredProviderId = resolvedEndpointId;
  }
}
```

- [ ] **Step 3: Persist routing metadata on AgentMessage**

Where the final agent message is created (line ~588-605), add the routing metadata:

```typescript
const agentMsg = await prisma.agentMessage.create({
  data: {
    threadId: input.threadId,
    role: "assistant",
    content: responseContent,
    agentId: agent.agentId,
    routeContext: input.routeContext,
    providerId: responseProviderId,
    taskType: useUnified ? taskTypeId : undefined,
    routedEndpointId: useUnified ? resolvedEndpointId : undefined,
  },
  // ... existing select ...
});
```

Apply the same pattern to all other agentMessage creation points (lines ~386, ~413, ~440).

- [ ] **Step 4: Pass routing metadata to observer**

At each `observeConversation` call site, pass the routing metadata:

```typescript
const meta: RoutingMeta | undefined = (useUnified && resolvedEndpointId) ? {
  endpointId: resolvedEndpointId,
  taskType: taskTypeId,
  sensitivity: resolveRouteContext(input.routeContext).sensitivity,
  userMessage: trimmedContent,
  aiResponse: responseContent,
} : undefined;

observeConversation(input.threadId, input.routeContext, meta).catch((err) =>
  console.error("[process-observer]", err),
);
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/actions/agent-coworker.ts
git commit -m "feat: wire task classification, performance routing, and evaluation into sendMessage"
```

---

## Chunk 6: Human Feedback Loop

Extend the observer to infer human satisfaction from conversation patterns.

### Task 6.1: Add human feedback inference

**Files:**
- Modify: `apps/web/lib/process-observer.ts`

- [ ] **Step 1: Add human feedback detection function**

```typescript
/** Infer human satisfaction score from conversation pair (AI response + human follow-up) */
export function inferHumanScore(
  aiMessage: ConversationMessage,
  humanFollowUp: ConversationMessage,
): number | null {
  const content = humanFollowUp.content.toLowerCase();

  // Positive signals → score 4
  if (/\b(thanks|thank you|great|perfect|exactly|awesome|helpful)\b/.test(content)) {
    return 4;
  }

  // Negative signals → score 1-2
  if (/\b(wrong|incorrect|no[,.]?\s*(that'?s|it'?s) not|you (missed|forgot|didn'?t))\b/.test(content)) {
    return 1;
  }

  // Rephrasing detection — if human repeats a very similar question → score 2
  // (Leverage existing repeated-message detection pattern from detectUserFriction)
  if (aiMessage.role === "assistant" && humanFollowUp.role === "user") {
    // Check if the human's message is similar to their previous message
    // (simplified: check if they're asking the same thing again)
    const isRephrasing = content.length > 20 && /\b(again|already asked|i said|i meant)\b/.test(content);
    if (isRephrasing) return 2;
  }

  // Neutral — no clear signal
  return null;
}
```

- [ ] **Step 2: Wire human feedback into observer**

In `process-observer-hook.ts`, within the evaluation branch, after the main analysis, add human feedback processing for the PREVIOUS assistant message:

```typescript
// After the main evaluation branch, check for human feedback on the prior AI response
if (transcript.length >= 2) {
  const lastHuman = transcript.filter((m) => m.role === "user").pop();
  const lastAssistant = transcript.filter((m) => m.role === "assistant").pop();
  if (lastHuman && lastAssistant) {
    const humanScore = inferHumanScore(lastAssistant, lastHuman);
    if (humanScore !== null) {
      // Update the prior evaluation's human score
      await prisma.taskEvaluation.updateMany({
        where: {
          threadId,
          endpointId: lastAssistant.routedEndpointId ?? undefined,
          humanScore: null, // only update if not already set
        },
        data: { humanScore },
      }).catch((err) => console.error("[human-feedback]", err));

      // Update the performance profile's avgHumanScore
      if (lastAssistant.routedEndpointId && lastAssistant.taskType) {
        await updateHumanScore(
          lastAssistant.routedEndpointId,
          lastAssistant.taskType,
          humanScore,
        ).catch((err) => console.error("[human-feedback-profile]", err));
      }
    }
  }
}
```

Note: `updateHumanScore` is a new function to add to `orchestrator-evaluator.ts` that updates `avgHumanScore` on `EndpointTaskPerformance` using the same EMA approach.

- [ ] **Step 3: Add updateHumanScore to orchestrator-evaluator.ts**

```typescript
export async function updateHumanScore(
  endpointId: string,
  taskType: string,
  score: number,
): Promise<void> {
  const profile = await prisma.endpointTaskPerformance.findUnique({
    where: { endpointId_taskType: { endpointId, taskType } },
  });
  if (!profile) return;

  const newHumanAvg = profile.avgHumanScore === null
    ? score
    : profile.avgHumanScore * (1 - EMA_DECAY) + score * EMA_DECAY;

  await prisma.endpointTaskPerformance.update({
    where: { endpointId_taskType: { endpointId, taskType } },
    data: { avgHumanScore: newHumanAvg },
  });
}
```

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/process-observer.ts apps/web/lib/process-observer-hook.ts apps/web/lib/orchestrator-evaluator.ts
git commit -m "feat: human feedback inference and score integration"
```

---

## Chunk 7: Verification

Run full test suite, fix any breakage.

### Task 7.1: Run full test suite and fix failures

**Files:**
- All test files in `apps/web/lib/`

- [ ] **Step 1: Run existing tests**

```bash
cd apps/web && npx vitest run
```

- [ ] **Step 2: Fix any failures**

Common expected failures:
- `agent-router.test.ts` — COST_ORDER renamed to COST_WEIGHT, existing tests may reference old constant
- `process-observer-hook.ts` tests — signature changed to accept optional routingMeta
- `agent-coworker` tests — sendMessage now uses more imports and routing logic

Update test mocks and expectations to match the new code.

- [ ] **Step 3: Verify feature flag off = old behavior**

With `USE_UNIFIED_COWORKER` set to `false`, the task classification and performance routing should be completely bypassed. The existing persona-based flow should work exactly as before.

- [ ] **Step 4: Commit fixes**

```bash
git add -A && git commit -m "fix: update tests for orchestrated task routing"
```
