# Orchestrated Task Routing & Trusted AI Kernel

**Date:** 2026-03-16
**Status:** Draft
**Author:** Mark Bodman (CEO) + Claude (design partner)
**Depends on:** `docs/superpowers/specs/2026-03-16-unified-mcp-coworker-design.md` (Phase 1-2 implemented)

## Problem Statement

The unified MCP coworker architecture (Phase 1-2) established a single AI coworker identity with MCP endpoint routing. However, every message still goes to the same provider tier regardless of task complexity. This creates two problems:

1. **Cost inefficiency** — simple tasks (status queries, greetings, summarization) consume the same expensive model as complex reasoning. There is no mechanism to route cheap work to cheap models.
2. **No performance visibility** — there is no systematic way to know which provider/model is good at which type of work. Provider selection is static configuration based on assumptions, not demonstrated results. Prior manual testing was frustrating and inconclusive.

## Design Summary

Replace static provider selection with **performance-driven task routing** where endpoints earn trust through demonstrated results. An orchestrator evaluates sub-agent work asynchronously, building a live performance profile per endpoint per task type. Routing decisions use these profiles to find the cheapest endpoint that delivers acceptable quality. Instructions injected into sub-agent prompts scale with competency — heavy guidance for unproven endpoints, minimal for proven ones.

### Foundational Principle: Trusted AI Kernel

Trust is earned by results, not granted by configuration. Every AI workforce member starts untrusted and graduates through demonstrated competency — the same way a human employee earns responsibility over time.

**Three trust guarantees:**

1. **Instruction integrity** — the orchestrator controls what instructions reach sub-agents. Instructions are part of the endpoint's development record, not external input that can be tampered with. Bad instructions produce bad results, which the evaluation catches and triggers corrective action.

2. **Authority separation** — trust determines what work an endpoint GETS (task routing). The HR role system determines what an endpoint can DO (capability permissions). These are independent. A highly trusted summarization model still can't execute side-effecting tools if the employee's HR role doesn't authorize it. Trust never escalates permissions.

3. **Dual evaluation** — no single signal determines trust. The orchestrator provides automated, consistent grading. The human provides authoritative, contextual judgment. Both feed the same performance profile. An endpoint can't game one evaluator because the other catches it.

### Key Principles

- **Performance data is the classifier** — evaluation history drives routing, not static configuration or heuristic rules alone
- **Cost pressure is systemic** — the `quality / cost` ratio means cheaper endpoints that perform well always win. The system naturally migrates work downward.
- **Instructions internalize over time** — endpoints start with heavy guidance (Learning), graduate to minimal instructions (Innate) as they prove competency. Like a human learning to walk — hard at first, then innate.
- **Human judgment is the ultimate signal** — orchestrator grades are automated and consistent; human feedback is authoritative and contextual. Both feed the same profile.
- **Async evaluation, never blocking** — the user gets their response immediately. Grading happens fire-and-forget, same pattern as the existing observer.

---

## Section 1: Orchestrated Task Routing Flow

### The Six-Step Pipeline

```
user message arrives
  ↓
1. CLASSIFY — determine task type from message + conversation context
     Heuristic classifier (pattern matching, zero LLM cost)
     Returns: { taskType, confidence }
     If confidence < threshold → taskType = "unknown" → route to primary
  ↓
2. ROUTE — select endpoint using performance data + sensitivity + cost
     If performance data exists: best quality-to-cost ratio wins
     If cold start (no evaluations): fall back to static manifest capabilityTier
     Always respects sensitivity clearance and HR authority
  ↓
3. INSTRUCT — inject task-specific instructions into the sub-agent's prompt
     Instruction intensity scales inversely with performance confidence
     Learning phase: detailed, prescriptive instructions
     Practicing phase: moderate guidance
     Innate phase: minimal or no task-specific instructions
  ↓
4. EXECUTE — call the selected endpoint with assembled prompt + instructions
  ↓
5. DELIVER — response goes to user immediately (never blocked by evaluation)
  ↓
6. EVALUATE (async, fire-and-forget) — orchestrator grades the response
     Performance profile updated
     Human feedback cascades back when next message arrives
     Observer pipeline picks up quality issues
```

Steps 1-5 are synchronous. Step 6 is asynchronous — identical pattern to the existing `observeConversation()` hook.

### Orchestrator Role

The orchestrator is the highest-tier endpoint cleared for the page's sensitivity level. It does NOT handle user messages directly (unless the classifier determines the task requires deep-thinker tier). Its jobs:

- Evaluate sub-agent responses (async)
- Manage instruction development per endpoint × task type
- Process human feedback signals
- Generate workforce quality findings for the observer pipeline

### Routing Algorithm (Extended)

The existing `routeTask()` in `agent-router.ts` filters by sensitivity × capability × cost. The extension adds performance-weighted ranking:

```
eligible = filterEligible(endpoints, { sensitivity, minCapabilityTier, requiredTags })

for each eligible endpoint:
  perf = lookupPerformance(endpoint.endpointId, taskType)
  if perf exists and perf.evaluationCount >= MIN_EVALUATIONS:
    score = perf.avgEffectiveScore / COST_ORDER[endpoint.costBand]
  else:
    score = TIER_ORDER[endpoint.capabilityTier] / COST_ORDER[endpoint.costBand]  // cold start

rank by score descending → select top
```

Where `avgEffectiveScore` blends orchestrator and human scores:
- If human scores exist: `0.6 * avgHumanScore + 0.4 * avgOrchestratorScore`
- If only orchestrator scores: `avgOrchestratorScore`

Human feedback is weighted higher because it's the authoritative signal.

### Fallback Behavior

- **Unknown task type** → route to primary (highest-tier). Conservative default.
- **No eligible endpoint for task type** → route to primary.
- **Primary endpoint unavailable** → existing failover logic in `callWithFailover()`.

---

## Section 2: Performance Profile & Evaluation Data Model

### EndpointTaskPerformance (one row per endpoint × task type)

```
EndpointTaskPerformance {
  id                      String    @id @default(cuid())
  endpointId              String    // FK to ModelProvider.providerId
  taskType                String    // "reasoning", "summarization", etc.

  // Scores
  evaluationCount         Int       @default(0)
  avgOrchestratorScore    Float     @default(0)    // 1-5
  avgHumanScore           Float?                   // 1-5, null until human feedback exists
  successRate             Float     @default(0)    // % of evaluations scoring >= 3

  // Instruction development
  currentInstructions     String?                  // task-specific instructions for this endpoint
  instructionPhase        String    @default("learning")  // "learning" | "practicing" | "innate"

  // Operational
  avgLatencyMs            Float     @default(0)
  avgTokensUsed           Float     @default(0)
  lastEvaluatedAt         DateTime?
  lastInstructionUpdateAt DateTime?

  // Composite unique
  @@unique([endpointId, taskType])
}
```

### TaskEvaluation (one row per graded response)

```
TaskEvaluation {
  id                  String    @id @default(cuid())
  threadId            String
  endpointId          String
  taskType            String
  qualityScore        Float     // 1-5, from orchestrator
  humanScore          Float?    // 1-5, from human feedback (nullable)
  taskContext          String    // short summary: what was asked (~100 chars)
  evaluationNotes     String?   // orchestrator's brief assessment (~200 chars)
  routeContext        String    // which page
  createdAt           DateTime  @default(now())
}
```

### Instruction Phase Transitions

| Transition | Condition | Action |
|---|---|---|
| Learning → Practicing | `evaluationCount >= 10 AND avgOrchestratorScore >= 3.5` | Reduce instruction detail |
| Practicing → Innate | `evaluationCount >= 50 AND avgOrchestratorScore >= 4.0 AND successRate >= 0.90` | Minimal/no instructions |
| Any → Learning (regression) | Rolling 5-evaluation avg < 3.0 | Refresh instructions, increase detail |

Thresholds are configurable on the Workforce admin page. Transitions happen automatically — the orchestrator doesn't decide them, the data does.

### Instruction Lifecycle

Instructions live ON the endpoint's performance profile for a given task type. They are part of the workforce member's development record.

- **Learning phase:** Detailed, prescriptive. Example for summarization: "You are handling a summarization task. Be concise — 3-5 bullet points maximum. Focus on key facts and decisions. Do not add your own analysis or recommendations. Do not include internal system details."
- **Practicing phase:** Lighter. Example: "Summarize concisely. Focus on key points."
- **Innate phase:** Minimal or empty. The endpoint has proven it knows the pattern.

When an endpoint regresses, instructions are refreshed from the task type's default template (see Section 5) and the endpoint re-enters Learning.

### Human Feedback Integration

The human's response to the sub-agent's output is the ultimate quality signal:

- **Positive signals** (inferred by observer): user continues naturally, asks follow-up questions, says thanks, no corrections
- **Negative signals** (inferred by observer): user corrects, rephrases the same question, expresses frustration (leverages existing `user_friction` detection patterns)
- **Explicit feedback** (if UI element added later): thumbs up/down overrides inferred signals

When the human's next message arrives, the observer analyzes the conversation pair (AI response + human follow-up) and infers a `humanScore`. This updates the same `EndpointTaskPerformance` record, blending with the orchestrator's score.

---

## Section 3: Observer Integration & Feedback Loop

### Extended Observer Pipeline

The existing observer fires after every message in `agent-coworker.ts` (5 call sites, fire-and-forget). The pipeline is extended with two new stages:

```
message → observeConversation() [fire-and-forget]
  → analyzeConversation()           [EXISTING — regex pattern → findings]
  → evaluateResponse()              [NEW — orchestrator grades sub-agent work]
  → updatePerformanceProfile()      [NEW — scores flow into EndpointTaskPerformance]
  → triageAndFile()                 [EXISTING — findings + low scores → BacklogItems]
```

### evaluateResponse()

Fires asynchronously after every sub-agent response. Sends a compact evaluation prompt to the orchestrator endpoint:

```
Given this user request and the AI response, score the response 1-5:
- Relevance: does it address what was asked?
- Completeness: does it fully answer?
- Accuracy: is the information correct?

User asked: {brief task context, ~100 tokens}
AI responded: {response, truncated to ~500 tokens}

Return JSON: { overall: N, notes: "one sentence" }
```

**Cost per evaluation:** ~200-300 tokens input + ~50 tokens output. At scale (100 evaluations/day), this is negligible compared to the primary inference costs.

**Skip conditions:**
- If the sub-agent IS the orchestrator (no self-evaluation)
- If the response is a system message (provider switch notification, etc.)
- If the response is empty or an error

### updatePerformanceProfile()

Takes the evaluation result and updates `EndpointTaskPerformance`:

1. Increment `evaluationCount`
2. Recalculate rolling `avgOrchestratorScore` (exponential moving average, decay factor 0.1)
3. Recalculate `successRate` (% of evaluations >= 3)
4. Check phase transition thresholds
5. If phase changes → log transition, adjust `currentInstructions`
6. Update `lastEvaluatedAt`

### New Observer Finding Types

| Finding Type | Trigger | Severity | Action |
|---|---|---|---|
| `endpoint_underperformance` | Rolling 5-eval avg < 3.0 for endpoint × task type | high | BacklogItem created, endpoint reverts to Learning |
| `instruction_regression` | Endpoint reverts from Practicing/Innate → Learning | medium | BacklogItem created, instructions refreshed |

These generate BacklogItems via the existing triage pipeline with `source: "process_observer"`.

---

## Section 4: Workforce Admin — Performance Dashboard

### Endpoint Detail View

When clicking into an endpoint on the Workforce page:

**Performance tab:**
- Trust badges per task type: Learning (yellow) / Practicing (blue) / Innate (green) with evaluation count
- Quality trend: simple sparkline or bar chart of scores over last 30 days
- Current instructions per task type (editable — admin can override anytime)
- Recent evaluations list: task context, orchestrator score, human score, notes, timestamp

**Cost pressure view (system-wide):**
- Cost distribution: % of tasks routed to each cost band this week
- Quality-to-cost ratio per endpoint: which endpoints deliver best value
- Migration opportunities: "phi3 scores 4.2 on summarization at free tier — consider shifting more summarization work from llama3"

### Manual Overrides

- **Pin** an endpoint to a task type (force routing regardless of score)
- **Block** an endpoint from a task type (never route there)
- **Reset** an endpoint's performance profile (wipe history, restart at Learning)
- **Edit** phase transition thresholds
- **Edit** current instructions for any endpoint × task type

---

## Section 5: Task Type Registry

### Core Task Types

| Task Type | Description | Heuristic Signals |
|---|---|---|
| `greeting` | Casual conversation, hellos, small talk | Short message, no question marks, greeting words |
| `status-query` | Asking about current state | "show me", "what's the status", "how many" |
| `summarization` | Condense information | "summarize", "key points", large context input |
| `reasoning` | Multi-step analysis, comparisons, trade-offs | "why", "compare", "should we", "what if" |
| `data-extraction` | Pull specific facts from context | "find", "list all", "extract", "which ones" |
| `code-gen` | Write or modify code | Code blocks in context, "write", "implement", "fix" |
| `web-search` | Find external information | "search for", "look up", "find online" |
| `creative` | Generate names, descriptions, copy | "suggest", "write a description", "come up with" |
| `tool-action` | Execute a platform action | Domain tool keywords (create, update, delete + domain nouns) |
| `unknown` | Can't classify with confidence | Falls through all heuristics → route to primary |

### Where Task Types Live

A `TASK_TYPES` constant in code — not a database table. These change rarely and are part of the system's core vocabulary. Each task type includes:

```typescript
type TaskTypeDefinition = {
  id: string;                    // "reasoning", "summarization", etc.
  description: string;           // human-readable
  heuristicPatterns: RegExp[];   // classification patterns
  minCapabilityTier: CapabilityTier;  // minimum tier for cold-start routing
  defaultInstructions: string;   // starting instructions for Learning phase endpoints
};
```

### Heuristic Classifier

```typescript
function classifyTask(
  message: string,
  conversationContext: string[],   // last 2-3 messages
): { taskType: string; confidence: number }
```

Pattern matching on the user's message + recent conversation context. No LLM call. Returns task type + confidence score (0-1). If confidence < 0.5, returns `{ taskType: "unknown", confidence: 0 }` → routes to primary.

### Connection to Endpoints

Each endpoint's `taskTags` (on the manifest, already in the schema) align with task type IDs. The router matches classified task type to endpoint tags. Performance scores are keyed by these same task type IDs.

---

## Section 6: System-Level Cost Pressure

Cost optimization is not a feature — it's a force that acts continuously on the system.

### How Cost Pressure Works

The routing score formula `quality / cost` inherently pushes work toward cheaper endpoints:

- An endpoint scoring 4.0 at "free" tier has a better ratio than one scoring 4.5 at "medium" tier
- The system naturally migrates work downward to the cheapest viable performer
- No explicit "prefer cheap" configuration needed — it's structural

### When New Endpoints Join

A new cheaper model (e.g., new Ollama model downloaded):

1. Registered on Workforce page with `capabilityTier` and `taskTags`
2. Starts in Learning phase — gets detailed instructions, heuristic-based routing
3. As evaluations accumulate, performance profile builds
4. If it scores well, the `quality / cost` ratio naturally pulls work toward it
5. Within days/weeks, routing has adjusted without admin intervention

### When Endpoints Degrade

- Rolling quality drops → regression to Learning → heavier instructions
- If still poor → `endpoint_underperformance` finding → BacklogItem for admin review
- Admin can block the endpoint from specific task types or reset its profile

### Weekly Review

The `TaskEvaluation` table provides enough detail for a weekly performance review:
- Filter by endpoint, task type, date range, or score
- Spot patterns: "phi3 drops below 3 on reasoning consistently"
- Compare: "llama3 vs phi3 on summarization this week"
- Act: adjust pinning, blocking, instructions, or thresholds

---

## Migration Strategy

### Phase 3a: Data Model & Classifier
- Add `EndpointTaskPerformance` and `TaskEvaluation` to Prisma schema
- Implement `TASK_TYPES` registry with heuristic classifier
- Seed default instructions for each task type
- Performance-weighted routing in `agent-router.ts`

### Phase 3b: Orchestrator Evaluation
- Implement `evaluateResponse()` — async orchestrator grading
- Implement `updatePerformanceProfile()` — score aggregation + phase transitions
- Hook into existing observer pipeline (`process-observer-hook.ts`)
- Add new finding types: `endpoint_underperformance`, `instruction_regression`

### Phase 3c: Instruction Development
- Implement instruction phase transitions (Learning → Practicing → Innate)
- Instruction injection into sub-agent prompt based on phase
- Regression detection and instruction refresh

### Phase 3d: Human Feedback Loop
- Extend observer to infer human satisfaction from conversation pairs
- Blend human scores into `EndpointTaskPerformance`
- Update routing to weight human feedback higher than orchestrator scores

### Phase 4: Workforce Admin Dashboard
- Endpoint performance tab with trust badges, trends, evaluations
- System-wide cost pressure view
- Manual overrides: pin, block, reset, edit instructions
- Phase threshold configuration

---

## Files Affected

| File | Change |
|------|--------|
| `packages/db/prisma/schema.prisma` | Add EndpointTaskPerformance and TaskEvaluation models |
| `apps/web/lib/task-classifier.ts` | NEW — heuristic task type classifier |
| `apps/web/lib/task-types.ts` | NEW — task type registry with default instructions |
| `apps/web/lib/agent-router.ts` | Extend with performance-weighted ranking |
| `apps/web/lib/agent-router-data.ts` | Load performance profiles alongside endpoints |
| `apps/web/lib/orchestrator-evaluator.ts` | NEW — async evaluation + profile update |
| `apps/web/lib/process-observer-hook.ts` | Extend pipeline with evaluateResponse + updatePerformanceProfile |
| `apps/web/lib/process-observer.ts` | Add endpoint_underperformance and instruction_regression finding types |
| `apps/web/lib/prompt-assembler.ts` | Inject task-specific instructions based on endpoint phase |
| `apps/web/lib/actions/agent-coworker.ts` | Pre-call classification + performance-aware routing |
| `apps/web/app/(protected)/platform/workforce/` | Performance dashboard UI |

---

## Future Connections

### Corporate Knowledge Memory
The trust model feeds the future knowledge memory epic. A trusted endpoint's high-scoring evaluations are higher-quality training signal for the memory system. The `TaskEvaluation` records (with task context, scores, and notes) are raw material for knowledge extraction.

### Trusted AI Kernel
This performance-driven trust system is a concrete implementation of the Trusted AI Kernel concept. The pattern extends beyond task routing — any AI capability in the platform can adopt the same lifecycle: onboard untrusted, earn trust through results, regress on poor performance. The `EndpointTaskPerformance` model is generalizable to any trust-bearing entity.
