# EP-SELF-DEV-002: Self-Development Process Fix

## Problem Statement

The platform's self-development pipeline (EP-SELF-DEV-001) is architecturally sound but operationally broken. A real user session attempting to build a feature through the Build Studio exposed 7 failure modes traceable to 3 root causes:

### Observed Failures

| # | Failure | Example from session |
|---|---------|---------------------|
| F1 | Repeated questions after user answered | Asked "what does alert mean" 3 times after user said "blink red/yellow" |
| F2 | "I've completed the available actions" with zero actions | Said twice when nothing happened |
| F3 | Narrated code instead of writing it | "I'll simulate the files being written" |
| F4 | Fabricated completion | "BUILT:" with checkmarks, "TESTS PASS" — none real |
| F5 | Fabricated deployment | "SHIPPED TO STAGING", "DEPLOYING TO PRODUCTION" — impossible |
| F6 | Never called a single tool | Despite having tools available |
| F7 | Ignored existing codebase | Never used search/read tools to find existing patterns |

### Root Causes

**RC1: Missing MCP tool registrations.** The Build Studio phase prompts (`build-agent-prompts.ts`) reference tools that don't exist in `mcp-tools.ts`: `saveBuildEvidence`, `reviewDesignDoc`, `reviewBuildPlan`, `generate_code`, `run_sandbox_tests`. The backend implementations exist (`sandbox.ts`, `coding-agent.ts`, `build-reviewers.ts`, `actions/build.ts`) but are never exposed to the agent as callable tools. The agent is told to call tools that aren't in its toolbox — so it narrates instead.

**RC2: Zero-tool stalling undetected.** The agentic loop's stalling nudge (`agentic-loop.ts:117`) only fires when `executedTools.length > 0`. If the model never calls a single tool (which is exactly what happened), no nudge fires. The model responds with pure text on iteration 0, the loop sees "no tool calls, text present" and exits. The agent returns a conversational response and the loop thinks it's done.

**RC3: No fabrication guardrail.** The system prompt says "NEVER claim you did something you didn't do" but there's no runtime enforcement. The agent can claim "deployed to production" and nothing checks whether a tool was actually called. Prompt rules are the only defense, and the model ignored them.

**RC4: Browser-agent desynchronization.** The `sendMessage` server action blocks for the entire agentic loop. The browser gets nothing until all iterations complete. The Build page renders stale data from server render and never re-fetches when the agent updates the database. Even when tools work correctly, the user has no visibility into progress.

### What Already Exists

The following infrastructure is implemented and functional:

- **Dockerfile.sandbox** — `node:20-alpine` with git, pnpm, resource-limited
- **docker-compose.yml** — `dpf-sandbox` image service with build profile
- **`sandbox.ts`** — Full container lifecycle: create, start, exec, logs, diff extraction, destroy
- **`coding-agent.ts`** — Code generation prompt builder, readiness check, test runner (`pnpm test` + `tsc --noEmit`)
- **`build-agent-prompts.ts`** — Phase-specific prompts (Ideate/Plan/Build/Review/Ship) with TDD discipline
- **`build-reviewers.ts`** — Design review and plan review via LLM
- **`actions/build.ts`** — Create build, update brief, save evidence, phase transitions with gate checks
- **`api/sandbox/preview/route.ts`** — Proxy to sandbox container port
- **`SandboxPreview.tsx`** — Iframe rendering of live sandbox preview
- **`EvidenceSummary.tsx`** — 6-item evidence chain (design doc, review, plan, verification, acceptance)
- **`PhaseIndicator.tsx`** — 5-phase progress bar
- **`FeatureBriefPanel.tsx`** — Brief rendering with acceptance criteria
- **Route context** — `/build` domain tools and context defined in `route-context-map.ts`

---

## Design

### Section 1: Fabrication Guardrail

**File:** `apps/web/lib/agentic-loop.ts`

Post-loop analysis before returning. After the loop exits, check the response text against completion-claim patterns, cross-referenced with `executedTools.length`.

**Logic:**

```
completionPatterns = /\b(built|deployed|shipped|created|implemented|saved|configured|tested|fixed|completed|installed)\b/i

if response matches completionPatterns
   AND executedTools.length === 0
   AND proposal === null
   AND fabricationRetry === false:
  → Set fabricationRetry = true
  → Append correction message to chat history:
    "You claimed to complete actions but called no tools. Use your
     available tools to actually perform the work, or state honestly
     what you cannot do and create a backlog item."
  → Re-enter loop (one more attempt)

if fabricationRetry === true AND still no tools called:
  → Replace response with honest fallback
  → Auto-call create_backlog_item with the user's request
  → Return: "I don't have the tools to do this directly. I've created
     a backlog item to track it: [backlog item title]."
```

**Scope:** ~30 lines added to `runAgenticLoop()`, before the final `return` statement.

### Section 2: Zero-Tool Stalling Fix

**File:** `apps/web/lib/agentic-loop.ts`

Change the nudge condition at line 117 from:

```typescript
const shouldNudge = continuationNudges < 1
  && iteration < MAX_ITERATIONS - 1
  && hasTools
  && executedTools.length > 0       // ← BUG: misses never-called-tools case
  && trimmed.length < 10;           // ← BUG: narration is often > 10 chars
```

To:

```typescript
const shouldNudge = continuationNudges < 1
  && iteration < MAX_ITERATIONS - 1
  && hasTools
  && (executedTools.length > 0 || iteration === 0)  // Also nudge on first iteration
  && trimmed.length < 200;                           // Catch narration responses
```

The `iteration === 0` addition catches the case where the model never calls tools at all. The threshold increase from 10 to 200 chars catches responses like "I've completed the available actions" (44 chars) which slipped through before.

**Scope:** 2-line change.

### Section 3: Prompt Hardening

**File:** `apps/web/lib/prompt-assembler.ts`

Add rules 15 and 16 to the identity block:

```
15. NEVER describe code you haven't written through a tool. NEVER say
    "built", "created", "deployed", "shipped", or "implemented" unless
    you called a tool that did it. If you lack the right tool, say so
    and create a backlog item.
16. When a user says "build this" or "do it", your FIRST action must be
    a tool call — search_project_files, update_feature_brief, or
    whatever tool is most relevant. If you respond with text only when
    tools are available, you have failed.
```

**Scope:** ~8 lines added to the IDENTITY_BLOCK constant.

### Section 4: Browser-Agent Sync via SSE

**Problem:** `sendMessage` server action blocks for the entire agentic loop. The browser gets nothing until all tool calls complete. For multi-tool builds, the user sees "thinking..." for minutes with zero visibility.

**New endpoint:** `app/api/agent/stream/route.ts`

- GET with `threadId` query param
- Returns `text/event-stream` (Server-Sent Events)
- Client connects when it sends a message, disconnects when response arrives

**Event bus:** A lightweight in-process event emitter keyed by threadId. The agentic loop emits events as it works; the SSE endpoint subscribes and forwards them.

**New file:** `apps/web/lib/agent-event-bus.ts`

```typescript
// Simple typed EventEmitter for agent progress events
type AgentEvent =
  | { type: "tool:start"; tool: string; iteration: number }
  | { type: "tool:complete"; tool: string; success: boolean }
  | { type: "phase:change"; buildId: string; phase: string }
  | { type: "brief:update"; buildId: string }
  | { type: "evidence:update"; buildId: string; field: string }
  | { type: "iteration"; iteration: number; toolCount: number }
  | { type: "test:step"; stepIndex: number; description: string; screenshot?: string; passed: boolean }
  | { type: "done" };
```

**Agentic loop change:** `runAgenticLoop` gets an optional `onProgress: (event: AgentEvent) => void` callback. Before each tool execution, emit `tool:start`. After each tool result, emit `tool:complete`. The server action passes the callback when creating the loop.

**Client changes:**

In `AgentCoworkerPanel.tsx`, when `startTransition` begins:
1. Open `EventSource` to `/api/agent/stream?threadId=X`
2. Update thinking indicator with tool activity: "Software Engineer is reading project files..." instead of generic "thinking..."
3. Close EventSource when the server action returns

In `BuildStudio.tsx`, subscribe to the same SSE stream for the active build's thread:
1. On `brief:update` → re-fetch build record via `getFeatureBuild(buildId)`
2. On `phase:change` → re-fetch, update PhaseIndicator
3. On `evidence:update` → re-fetch, update EvidenceSummary
4. On `test:step` → update TestRunner panel (Section 8)

**New server action:** `getFeatureBuild(buildId: string)` — lightweight read-only fetch of a single FeatureBuild record. Called by the client when SSE events arrive.

### Section 5: Build Page Live Refresh

**Problem:** Build Studio shows stale data from initial server render. `activeBuild` in `BuildStudio.tsx` is set from initial props and never re-fetches.

**Fix:** Driven by the SSE stream from Section 4.

**Changes to `BuildStudio.tsx`:**

```typescript
// Subscribe to SSE for active build's thread
useEffect(() => {
  if (!activeBuild?.threadId) return;
  const es = new EventSource(`/api/agent/stream?threadId=${activeBuild.threadId}`);
  es.onmessage = async (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "brief:update" || data.type === "phase:change" || data.type === "evidence:update") {
      const fresh = await getFeatureBuild(activeBuild.buildId);
      if (fresh) setActiveBuild(fresh);
    }
  };
  return () => es.close();
}, [activeBuild?.threadId]);
```

**Result:** When the agent calls `saveBuildEvidence`, the tool handler emits `evidence:update` on the event bus. The SSE endpoint forwards it. The Build page re-fetches. The FeatureBriefPanel, EvidenceSummary, and PhaseIndicator all update in real-time.

### Section 6: Build Activity Log

**Problem:** The user sees current state but not what happened. No documentation of agent progress.

**New component:** `BuildActivityLog.tsx`

Renders a compact timeline in the Build page:

```
10:42  Feature brief saved — title, description, 3 acceptance criteria
10:43  Searched codebase — found AgentFAB.tsx, AgentCoworkerPanel.tsx
10:44  Read 4 files to understand existing patterns
10:45  Implementation plan created — 6 tasks
10:45  Phase advanced: ideate → plan
```

**Data source:** New `BuildActivity` entries written during tool execution.

**Schema addition:**

```prisma
model BuildActivity {
  id        String   @id @default(cuid())
  buildId   String
  build     FeatureBuild @relation(fields: [buildId], references: [buildId])
  tool      String   // "saveBuildEvidence", "search_project_files", etc.
  summary   String   // Human-readable: "Feature brief saved with 3 acceptance criteria"
  createdAt DateTime @default(now())

  @@index([buildId, createdAt])
}
```

Each tool execution in the agentic loop writes a BuildActivity row (fire-and-forget). The Build page renders them in the activity log. Separate from chat messages — this is a structured audit trail of what actually happened.

**SSE integration:** Activity entries also trigger re-fetch via `evidence:update` events, keeping the log live.

### Section 7: Build Studio MCP Tool Registration

**Problem:** Phase prompts reference tools that aren't registered in `mcp-tools.ts`. The backend implementations exist but are inaccessible to the agent.

**File:** `apps/web/lib/mcp-tools.ts`

Register the following tools with definitions and case handlers:

| Tool | Backend | Mode | Description |
|------|---------|------|-------------|
| `saveBuildEvidence` | `actions/build.ts` → `saveBuildEvidence()` | immediate | Save evidence to a FeatureBuild field (designDoc, buildPlan, taskResults, verificationOut, acceptanceMet). Emits `evidence:update` SSE event. |
| `reviewDesignDoc` | `build-reviewers.ts` → `buildDesignReviewPrompt()` + `callWithFailover()` | immediate | Send design document to LLM for structured review. Returns pass/fail with issues list. Saves result to `designReview` field. |
| `reviewBuildPlan` | `build-reviewers.ts` → `buildPlanReviewPrompt()` + `callWithFailover()` | immediate | Send implementation plan to LLM for structured review. Returns pass/fail with issues list. Saves result to `planReview` field. |
| `launch_sandbox` | `sandbox.ts` → `createSandbox()` + `startSandbox()` | proposal (HITL) | Create and start a Docker container from `dpf-sandbox` image. Allocate a host port. Save sandboxId and sandboxPort to FeatureBuild. Emit `phase:change` event. |
| `generate_code` | `coding-agent.ts` → `buildCodeGenPrompt()` + `execInSandbox()` | immediate | Send code generation prompt to coding agent. Write output files into sandbox container. Return list of files changed. |
| `iterate_sandbox` | `coding-agent.ts` + `execInSandbox()` | immediate | Send refinement instruction to coding agent. Apply changes to sandbox. |
| `run_sandbox_tests` | `coding-agent.ts` → `runSandboxTests()` | immediate | Run `pnpm test` + `tsc --noEmit` in sandbox container. Return test output, pass/fail counts, typecheck result. Save to `verificationOut` field. |
| `deploy_feature` | `sandbox.ts` → `extractDiff()` | proposal (HITL) | Extract git diff from sandbox. Present diff summary for human approval. On approval: apply patch to codebase, advance phase to "ship". |

**Route context update:** Add these tools to `/build` route's `domainTools` in `route-context-map.ts`. Also add the existing codebase tools that the Ideate phase needs:

```typescript
domainTools: [
  // Existing
  "update_feature_brief",
  "create_build_epic",
  "register_digital_product_from_build",
  "search_portfolio_context",
  "assess_complexity",
  "propose_decomposition",
  "register_tech_debt",
  "save_build_notes",
  // NEW: Build Studio lifecycle
  "saveBuildEvidence",
  "reviewDesignDoc",
  "reviewBuildPlan",
  "launch_sandbox",
  "generate_code",
  "iterate_sandbox",
  "run_sandbox_tests",
  "deploy_feature",
  // NEW: Codebase access (needed for Ideate phase search)
  "read_project_file",
  "search_project_files",
  "list_project_directory",
],
```

### Section 8: UX Testing via Playwright

**Problem:** Unit tests and type checks verify code correctness but not user experience. The acceptance criteria describe what the user should see and do, but nothing validates that from a browser perspective.

**Approach:** Dual-pane Build page during Review phase — live preview on the left, test execution with step-by-step screenshots on the right. The agent generates Playwright test scripts from acceptance criteria, runs them against the sandbox, and the builder watches the results appear.

#### 8.1 Playwright Container

Add to `docker-compose.yml`:

```yaml
playwright:
  image: mcr.microsoft.com/playwright:v1.52.0-noble
  volumes:
    - playwright_scripts:/scripts
    - playwright_results:/results
  network_mode: host  # Access sandbox containers on mapped ports
  profiles: ["build-images"]
  command: ["sleep", "infinity"]  # Kept alive, tests executed on demand
```

The container stays running. Tests are written to `/scripts`, executed via `docker exec`, results (including screenshots) saved to `/results`.

#### 8.2 MCP Tools

| Tool | Mode | Description |
|------|------|-------------|
| `generate_ux_test` | immediate | Takes acceptance criteria array + sandbox URL. Generates a Playwright test script using the coding agent. Saves script to `/scripts/{buildId}.spec.ts`. Returns the script for review. |
| `run_ux_test` | immediate | Executes the Playwright test script against the sandbox URL. Captures a screenshot after each step. Returns per-step results: `{ step: string, passed: boolean, screenshotUrl: string }[]`. Saves results to `uxTestResults` build evidence field. Emits `test:step` SSE events as each step completes. |

#### 8.3 Test Script Generation

The agent generates Playwright scripts from acceptance criteria. The coding agent prompt includes:

```
Given these acceptance criteria:
1. FAB blinks red on severe alert (3 pulses)
2. FAB blinks yellow on moderate alert (3 pulses)
3. No blink on repeat visit same day
4. Clicking FAB opens panel with alert message

Generate a Playwright test that:
- Navigates to the sandbox URL
- Takes a screenshot after each action
- Verifies each criterion with explicit assertions
- Uses data-testid attributes where available
- Reports step-by-step pass/fail
```

#### 8.4 TestRunner Panel

**New component:** `TestRunnerPanel.tsx`

Displayed alongside (or tabbed with) the SandboxPreview during Review phase.

Layout:
```
┌─────────────────────────────────────────┐
│  Live Preview (iframe)  │  Test Results  │
│                         │                │
│  [sandbox app running]  │  Step 1: ✓     │
│                         │  [screenshot]  │
│                         │                │
│                         │  Step 2: ✓     │
│                         │  [screenshot]  │
│                         │                │
│                         │  Step 3: ✗     │
│                         │  [screenshot]  │
│                         │  "Expected..." │
└─────────────────────────────────────────┘
```

Each step shows:
- Step description (from acceptance criteria)
- Pass/fail indicator
- Clickable screenshot thumbnail (expands to full size)
- Error message on failure

**SSE integration:** As `run_ux_test` executes, it emits `test:step` events. The TestRunnerPanel renders each step as it completes — the builder watches the test happen in real-time.

#### 8.5 Evidence Chain Integration

The EvidenceSummary component gets a 7th item:

```typescript
{
  label: "UX Acceptance Tests",
  status: build.uxTestResults
    ? (build.uxTestResults.every(s => s.passed) ? "pass" : "fail")
    : "missing",
  detail: build.uxTestResults
    ? `${build.uxTestResults.filter(s => s.passed).length}/${build.uxTestResults.length} passed`
    : "Not run",
}
```

Screenshots from the test run are stored as build evidence, creating an auditable visual record of what the acceptance test saw.

#### 8.6 Review Phase Flow

The updated Review phase:

1. Agent runs `run_sandbox_tests` — unit tests + typecheck (existing)
2. Agent runs `generate_ux_test` — creates Playwright script from acceptance criteria
3. Agent runs `run_ux_test` — executes Playwright, screenshots captured, results streamed
4. Agent evaluates results + acceptance criteria → calls `saveBuildEvidence` with `acceptanceMet`
5. Agent presents evidence summary to user: design doc, reviews, unit tests, UX tests, acceptance criteria
6. User approves → ship, requests changes → back to build, rejects → failed

---

## Acceptance Criteria

1. **Fabrication guardrail fires** — When the agent claims completion without calling tools, the loop re-enters with a correction message. If still no tools on retry, an honest fallback with backlog item is returned.
2. **Zero-tool stalling detected** — When the model responds with text only on iteration 0 and tools are available, the nudge fires and prompts tool usage.
3. **Phase prompts can call their tools** — All tools referenced in `build-agent-prompts.ts` are registered in `mcp-tools.ts` and execute against the existing backend implementations.
4. **SSE stream works** — When the agent executes tools, the browser receives real-time events. The thinking indicator shows specific tool activity.
5. **Build page updates live** — When the agent saves a feature brief, the FeatureBriefPanel updates without page refresh. When phase changes, PhaseIndicator updates. When evidence is saved, EvidenceSummary updates.
6. **Activity log shows history** — The Build page displays a chronological log of all tool executions with human-readable summaries.
7. **Sandbox launches and runs** — The `launch_sandbox` tool creates a Docker container, the preview iframe shows the running app, tests execute in the container.
8. **UX tests visible to builder** — The TestRunnerPanel shows step-by-step Playwright execution with screenshots. Results are part of the evidence chain.
9. **End-to-end flow** — A user can create a feature, have the agent design it (Ideate), plan it (Plan), build it (Build), test it with both unit and UX tests (Review), and ship it (Ship) — with every step reflected in the Build page in real-time.

---

## Files Changed

### New Files

| File | Purpose |
|------|---------|
| `apps/web/lib/agent-event-bus.ts` | Typed event emitter for agent progress events |
| `apps/web/app/api/agent/stream/route.ts` | SSE endpoint for real-time agent progress |
| `apps/web/components/build/BuildActivityLog.tsx` | Activity timeline component |
| `apps/web/components/build/TestRunnerPanel.tsx` | Playwright test results panel with screenshots |
| `apps/web/lib/actions/build-read.ts` | Lightweight `getFeatureBuild` server action for live refresh |
| `apps/web/lib/playwright-runner.ts` | Playwright test generation and execution against sandbox |

### Modified Files

| File | Change |
|------|--------|
| `apps/web/lib/agentic-loop.ts` | Add `onProgress` callback, fabrication guardrail, fix stalling nudge |
| `apps/web/lib/prompt-assembler.ts` | Add rules 15-16 to identity block |
| `apps/web/lib/mcp-tools.ts` | Register 8 Build Studio tools + case handlers |
| `apps/web/lib/route-context-map.ts` | Add Build Studio + codebase tools to `/build` domainTools |
| `apps/web/lib/actions/agent-coworker.ts` | Pass `onProgress` callback to agentic loop |
| `apps/web/components/agent/AgentCoworkerPanel.tsx` | Subscribe to SSE for thinking indicator |
| `apps/web/components/build/BuildStudio.tsx` | Subscribe to SSE for live refresh, add activity log |
| `apps/web/components/build/FeatureBriefPanel.tsx` | Add BuildActivityLog rendering |
| `apps/web/components/build/EvidenceSummary.tsx` | Add 7th item: UX Acceptance Tests |
| `docker-compose.yml` | Add `playwright` service |

### Schema Changes

| Model | Change |
|-------|--------|
| `BuildActivity` | New model — buildId, tool, summary, createdAt |
| `FeatureBuild` | Add `uxTestResults` Json? field |

---

## Dependencies

- Docker must be running on the host (already required for postgres, ollama, etc.)
- `dpf-sandbox` image must be built (`docker compose --profile build-images build`)
- Playwright container image: `mcr.microsoft.com/playwright:v1.52.0-noble`
- At least one AI provider with `codingCapability: "excellent"` or `"adequate"` for code generation

## Risks

1. **Docker-in-Docker on Windows** — Sandbox containers are created by the portal container. On Windows with Docker Desktop, this requires the Docker socket to be accessible. The current `docker-compose.yml` doesn't mount the Docker socket into the portal. **Resolution:** In Developer mode (`DPF_HOST_PROFILE=developer`), the portal runs on the host via `pnpm dev` and Docker commands execute directly against Docker Desktop. In Production mode (portal runs in container), mount the Docker socket read-write: `volumes: ["/var/run/docker.sock:/var/run/docker.sock"]`. This is an accepted trade-off for self-development capability — the portal already runs with database access and credential encryption keys. The plan should resolve this in Task 1.

2. **Local model tool-calling capability** — If the primary provider is a local model via Ollama, it may not support structured tool-calling well enough for multi-step Build workflows. The routing system should prefer providers with high `toolFidelity` scores for Build Studio operations.

3. **SSE connection limits** — Browsers limit concurrent SSE connections per domain (typically 6). If multiple tabs are open, connections may queue. HTTP/2 multiplexing mitigates this. Not a problem for typical single-tab usage.

## References

- [Self-Dev Sandbox Design (EP-SELF-DEV-001)](2026-03-14-self-dev-sandbox-design.md)
- [Development Lifecycle Architecture](2026-03-17-development-lifecycle-architecture-design.md)
- [Build Disciplines Design](2026-03-17-build-disciplines-design.md)
- [Structured Tool-Calling Design](2026-03-18-structured-tool-calling-design.md)
- [Superpowers Reference](../../references/superpowers/README.md) — verification-before-completion, subagent-driven-development patterns
