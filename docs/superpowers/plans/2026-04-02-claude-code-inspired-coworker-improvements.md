# Claude Code-Inspired Coworker Improvements

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Apply architectural patterns from the Claude Code source leak (March 2026) to improve DPF's AI Coworker — specifically cross-phase memory, frustration detection, and dynamic tool descriptions.

**Architecture:** Four independent improvements to the existing agentic loop and prompt assembly pipeline. No new DB tables — the `PhaseHandoff` model already exists (added in EP-BUILD-HANDOFF). Changes are confined to `apps/web/lib/tak/` (agentic loop), `apps/web/lib/integrate/` (build agent prompts, build data), and `apps/web/lib/mcp-tools.ts` (tool definition + executor).

**Tech Stack:** TypeScript, Prisma, Next.js server actions

**Reference:** Claude Code leak analysis — 512K lines of TypeScript revealed via npm sourcemap in v2.1.88. Key patterns: MEMORY.md two-tier memory, frustration regex set, dynamic tool description adjustment, sub-agent fork model. See sources at bottom.

## Context: What Claude Code Does vs What DPF Does Today

| Capability | Claude Code | DPF Today | Gap |
|-----------|------------|-----------|-----|
| Cross-phase memory | MEMORY.md index + topic files + autoDream consolidation | `PhaseHandoff` relational model exists in schema with rich fields (`summary`, `decisionsMade`, `openIssues`, `userPreferences`, `evidenceDigest`, `gateResult`, `toolsUsed`, `iterationCount`). But: no tool writes to it, no prompt reads from it, no phase prompt instructs the agent to use it. | DB schema is ready; the tool, prompt injection, and prompt instructions are all missing |
| Frustration detection | ~20 frustration regex patterns, phase-aware nudging | `COMPLETION_CLAIM_PATTERN` (14 verbs) + `NARRATION_PATTERN` (7 phrases); `shouldNudge()` checks iteration count + response length | No detection of apology loops, hedging, or "I'm unable to" spirals; nudge message is generic (not phase-aware) |
| Dynamic tool descriptions | Tool descriptions adjusted based on what agent has already tried in session | Static tool descriptions from `mcp-tools.ts`; no session awareness | Agent sees same tool descriptions even after failing with a tool 3 times |
| Contribution mode awareness | N/A (Claude Code is a CLI, not a platform) | `contributionMode` only injected during ship phase (`feature-build-data.ts:196`). Ideate/plan/build/review agents are blind to it. | Agent in `contribute_all` mode can't flag proprietary designs early |

## Existing Schema: `PhaseHandoff` Model

The DB model already exists at `packages/db/prisma/schema.prisma:2154`:

```prisma
model PhaseHandoff {
  id               String   @id @default(cuid())
  buildId          String
  fromPhase        String
  toPhase          String
  fromAgentId      String
  toAgentId        String
  summary          String   /// 2-3 sentence plain language summary
  decisionsMade    String[] @default([])
  openIssues       String[] @default([])
  userPreferences  String[] @default([])
  evidenceFields   String[] @default([]) /// e.g., ["designDoc", "designReview"]
  evidenceDigest   Json     @default("{}") /// One-line summary per evidence field
  gateResult       Json     @default("{}") /// Gate check that allowed advancement
  tokenBudgetUsed  Int      @default(0)
  toolsUsed        String[] @default([])
  iterationCount   Int      @default(0)
  createdAt        DateTime @default(now())
  build            FeatureBuild @relation(fields: [buildId], references: [buildId])
  @@index([buildId])
}
```

**No migration needed.** The model and relation (`FeatureBuild.phaseHandoffs`) already exist.

---

## Improvement 1: Cross-Phase Memory (Handoff Tool + Prompt Injection)

### Task 1: Add `save_phase_handoff` tool definition and executor

**Files:**
- Modify: `apps/web/lib/mcp-tools.ts` (tool definition after `save_build_notes` ~line 326, executor after `save_build_notes` case ~line 1746)

- [ ] **Step 1: Add tool definition**
  After the `save_build_notes` definition block (~line 326, before the Build Studio Lifecycle Tools comment), add:
  ```typescript
  // ─── Phase Handoff Tool (Claude Code-inspired cross-phase memory) ────────
  {
    name: "save_phase_handoff",
    description: "Save a structured handoff briefing for the next phase. Call this as your LAST action before a phase transition.",
    inputSchema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "2-3 sentence plain-language summary of what was accomplished in this phase" },
        decisionsMade: { type: "array", items: { type: "string" }, description: "Key decisions made and why" },
        openIssues: { type: "array", items: { type: "string" }, description: "Unresolved issues or risks carried to next phase" },
        userPreferences: { type: "array", items: { type: "string" }, description: "User preferences or constraints expressed during this phase" },
      },
      required: ["summary"],
    },
    requiredCapability: "view_platform",
    executionMode: "immediate",
    sideEffect: true,
    buildPhases: ["ideate", "plan", "build", "review"],
  },
  ```

- [ ] **Step 2: Add `getNextPhase` helper**
  Near the top of the executor section (before the `switch` statement in `executeTool`), or as a module-level utility, add:
  ```typescript
  function getNextPhase(current: string): string {
    const order = ["ideate", "plan", "build", "review", "ship"];
    const idx = order.indexOf(current);
    return idx >= 0 && idx < order.length - 1 ? order[idx + 1]! : "complete";
  }
  ```

- [ ] **Step 3: Add executor case**
  After the `save_build_notes` case block (~line 1746), add:
  ```typescript
  case "save_phase_handoff": {
    const latestBuild = await prisma.featureBuild.findFirst({
      where: { createdById: userId, phase: { notIn: ["complete", "failed"] } },
      orderBy: { updatedAt: "desc" },
      select: { buildId: true, phase: true },
    });
    if (!latestBuild) return { success: false, error: "No active build", message: "No active build found" };

    // Write to the existing PhaseHandoff relational model (schema line 2154)
    const toPhase = getNextPhase(latestBuild.phase);
    await prisma.phaseHandoff.create({
      data: {
        buildId: latestBuild.buildId,
        fromPhase: latestBuild.phase,
        toPhase,
        fromAgentId: context?.agentId ?? "unknown",
        toAgentId: "pending", // Resolved when the next phase starts
        summary: String(params["summary"] ?? ""),
        decisionsMade: Array.isArray(params["decisionsMade"]) ? (params["decisionsMade"] as string[]).map(String) : [],
        openIssues: Array.isArray(params["openIssues"]) ? (params["openIssues"] as string[]).map(String) : [],
        userPreferences: Array.isArray(params["userPreferences"]) ? (params["userPreferences"] as string[]).map(String) : [],
        evidenceFields: [], // Populated separately by saveBuildEvidence
        evidenceDigest: {},
        gateResult: {},
      },
    });

    return { success: true, message: `Phase handoff saved: ${latestBuild.phase} → ${toPhase}` };
  }
  ```

- [ ] **Step 4: Commit**
  ```
  feat(tools): add save_phase_handoff tool using existing PhaseHandoff model
  ```

---

### Task 2: Inject handoff context into build phase prompts

**Files:**
- Modify: `apps/web/lib/explore/feature-build-data.ts` (~line 180, add `phaseHandoffs` to query)
- Modify: `apps/web/lib/integrate/build-agent-prompts.ts` (`BuildContext` type ~line 329, `getBuildContextSection()` ~line 339)

- [ ] **Step 1: Load phaseHandoffs in the build data query**
  In `apps/web/lib/explore/feature-build-data.ts`, in the `getFeatureBuildForContext` function's Prisma query (~line 179), change from `select` to include the relation. Add after the existing `select` block:
  ```typescript
  // In the findUnique call, add include for phase handoffs:
  include: {
    phaseHandoffs: {
      orderBy: { createdAt: "asc" },
      select: {
        fromPhase: true,
        toPhase: true,
        summary: true,
        decisionsMade: true,
        openIssues: true,
        userPreferences: true,
      },
    },
  },
  ```
  Note: You'll need to restructure the query to use `include` with the relation alongside the existing `select` fields. The simplest approach is to convert the `select` to include the fields you need plus the `phaseHandoffs` relation.

- [ ] **Step 2: Pass handoffs through to BuildContext**
  In the return statement of `getFeatureBuildForContext` (~line 204), add:
  ```typescript
  phaseHandoffs: r.phaseHandoffs ?? [],
  ```

- [ ] **Step 3: Update BuildContext type**
  In `apps/web/lib/integrate/build-agent-prompts.ts`, add to the `BuildContext` type (~line 329):
  ```typescript
  phaseHandoffs?: Array<{
    fromPhase: string;
    toPhase: string;
    summary: string;
    decisionsMade: string[];
    openIssues: string[];
    userPreferences: string[];
  }>;
  ```

- [ ] **Step 4: Add handoff rendering in getBuildContextSection**
  In `getBuildContextSection()`, after the plan injection block (~line 366, before the phase prompt injection), add:
  ```typescript
  // Cross-phase memory: inject handoff briefings from previous phases
  // Inspired by Claude Code's MEMORY.md two-tier memory pattern
  if (ctx.phaseHandoffs && ctx.phaseHandoffs.length > 0) {
    lines.push("");
    lines.push("--- Briefing from Previous Phases ---");
    for (const h of ctx.phaseHandoffs) {
      lines.push(`[${h.fromPhase} → ${h.toPhase}] ${h.summary}`);
      if (h.decisionsMade.length > 0) lines.push(`  Decisions: ${h.decisionsMade.join("; ")}`);
      if (h.openIssues.length > 0) lines.push(`  Open issues: ${h.openIssues.join("; ")}`);
      if (h.userPreferences.length > 0) lines.push(`  User preferences: ${h.userPreferences.join("; ")}`);
    }
    lines.push("Use this briefing to understand WHY decisions were made. Do not re-litigate settled decisions unless the user asks.");
  }
  ```

- [ ] **Step 5: Commit**
  ```
  feat(build): inject cross-phase handoff briefings into agent system prompts
  ```

---

### Task 3: Add handoff instructions to phase prompts

**Files:**
- Modify: `apps/web/lib/integrate/build-agent-prompts.ts` (PHASE_PROMPTS for ideate, plan, build, review)

- [ ] **Step 1: Add handoff instruction to ideate prompt**
  At the end of the `ideate` PHASE_PROMPTS entry (before the closing backtick), add:
  ```
  BEFORE PHASE TRANSITION: When the user approves the design and you're ready to move to plan phase, call save_phase_handoff with:
  - summary: What was designed and the core approach
  - decisionsMade: Key design decisions and the reasoning behind each
  - openIssues: Any unresolved questions or risks
  - userPreferences: Any constraints or preferences the user expressed
  This briefing will be injected into the plan agent's context so it understands WHY you made these choices.
  ```

- [ ] **Step 2: Add handoff instruction to plan prompt**
  At the end of the `plan` PHASE_PROMPTS entry, add:
  ```
  BEFORE PHASE TRANSITION: When the plan is approved, call save_phase_handoff with:
  - summary: The implementation approach and key architectural choices
  - decisionsMade: Architecture decisions, technology choices, and why alternatives were rejected
  - openIssues: Implementation risks or unknowns
  - userPreferences: User constraints on approach, complexity, or timeline
  ```

- [ ] **Step 3: Add handoff instruction to build prompt**
  At the end of the `build` PHASE_PROMPTS entry (before the closing backtick), add:
  ```
  BEFORE PHASE TRANSITION: When all tasks are complete and verified, call save_phase_handoff with:
  - summary: What was built and any deviations from the plan
  - decisionsMade: Any implementation decisions that differed from the plan, and why
  - openIssues: Known limitations, edge cases not covered, or areas needing attention in review
  - userPreferences: Any mid-build feedback or direction changes from the user
  ```

- [ ] **Step 4: Add handoff instruction to review prompt**
  At the end of the `review` PHASE_PROMPTS entry, add:
  ```
  BEFORE PHASE TRANSITION: When all gates pass and the user approves, call save_phase_handoff with:
  - summary: Test results, quality gate outcomes, and readiness assessment
  - decisionsMade: Any review-phase decisions (e.g., accepted known issues, deferred fixes)
  - openIssues: Issues accepted for post-ship follow-up
  - userPreferences: User's deployment preferences or timing constraints
  ```

- [ ] **Step 5: Commit**
  ```
  feat(prompts): instruct agents to save handoff briefings at phase transitions
  ```

---

## Improvement 2: Enhanced Frustration Detection

### Task 4: Add frustration detection to agentic loop

**Files:**
- Modify: `apps/web/lib/tak/agentic-loop.ts`

- [ ] **Step 1: Add FRUSTRATION_PATTERN constant**
  After `NARRATION_PATTERN` (~line 27), add:
  ```typescript
  // Frustration patterns: agent is spinning, apologizing, or hedging instead of acting.
  // Inspired by Claude Code's ~20 frustration regexes (March 2026 source leak).
  // Only checked in the no-tool-calls branch, so this won't fire when the agent
  // is actively using tools and reporting on results.
  const FRUSTRATION_PATTERN = /(?:I (?:apologize|cannot|can't|am unable|don't have (?:access|the ability))|(?:unfortunately|regrettably),? I|I'm (?:not able|having (?:trouble|difficulty)|sorry)|(?:beyond|outside) my (?:capabilities|ability)|I (?:don't|do not) (?:currently )?have (?:a |the )?(?:tool|capability|access|ability)|I (?:was|am) unable to)/i;
  ```
  Note: Deliberately excludes "let me try again", "there seems to be an issue", and "I keep running into" — these are legitimate status updates during iterative fix cycles, not frustration signals. Only includes clear apology/hedging/inability phrases.

- [ ] **Step 2: Export for testing**
  Update the existing exports to include `FRUSTRATION_PATTERN`:
  ```typescript
  export { FRUSTRATION_PATTERN };
  ```

- [ ] **Step 3: Add frustration counter to loop state**
  After `let fabricationRetried = false;` (~line 198), add:
  ```typescript
  let frustrationCount = 0;
  ```

- [ ] **Step 4: Add frustration detection in the no-tool-calls branch**
  In the no-tool-calls branch, AFTER the fabrication guardrail check (~line 348) and BEFORE the final `finalContent` / return block (~line 354). Gate it so frustration detection only fires when fabrication detection did NOT fire (they check different failure modes):
  ```typescript
  // Frustration guardrail: agent is apologizing/hedging instead of acting.
  // Only fires when fabrication detection didn't already handle it.
  if (!fabricationRetried && frustrationCount < 3 && FRUSTRATION_PATTERN.test(trimmed) && !result.toolsStripped) {
    frustrationCount++;
    console.warn(`[agentic-loop] frustration detected (${frustrationCount}/3): ${trimmed.slice(0, 100)}`);
    if (frustrationCount >= 3) {
      // 3 strikes — break and be honest with the user
      return {
        content: trimmed + "\n\nI've been struggling with this. Let me be direct about what's not working so you can help me get unstuck.",
        providerId: result.providerId,
        modelId: result.modelId,
        downgraded: result.downgraded,
        downgradeMessage: result.downgradeMessage,
        totalInputTokens,
        totalOutputTokens,
        executedTools,
        proposal: null,
      };
    }
    // Phase-aware nudge: suggest tools specific to what the agent should be doing
    const phaseTools = getPhaseSpecificNudge(executedTools);
    messages = [
      ...messages,
      { role: "assistant" as const, content: result.content },
      {
        role: "user" as const,
        content: `STOP apologizing and hedging. You have tools — use them. ${phaseTools} If a previous tool call failed, try a DIFFERENT approach. Do not repeat the same failing call.`,
      },
    ];
    continue;
  }
  ```

- [ ] **Step 5: Add `getPhaseSpecificNudge` helper**
  Add above the `runAgenticLoop` function:
  ```typescript
  /** Generate a phase-aware nudge based on which tools have been used so far. */
  function getPhaseSpecificNudge(executedTools: Array<{ name: string }>): string {
    const usedNames = new Set(executedTools.map(t => t.name));

    // If sandbox tools were used, we're likely in build phase
    if (usedNames.has("launch_sandbox") || usedNames.has("generate_code") || usedNames.has("write_sandbox_file")) {
      if (!usedNames.has("run_sandbox_tests")) return "Try run_sandbox_tests to verify your work, or read_sandbox_file to check what exists.";
      return "Try run_sandbox_command to debug, or edit_sandbox_file to fix the issue.";
    }

    // If search/read tools were used, we're likely in ideate
    if (usedNames.has("search_project_files") || usedNames.has("read_project_file")) {
      return "Call saveBuildEvidence with field 'designDoc' to save your design.";
    }

    // If evidence tools were used, we're likely in plan/review
    if (usedNames.has("saveBuildEvidence") || usedNames.has("reviewDesignDoc")) {
      return "Call reviewBuildPlan to review the plan, or saveBuildEvidence to save your progress.";
    }

    // Deploy/ship tools
    if (usedNames.has("deploy_feature") || usedNames.has("check_deployment_windows")) {
      return "Call execute_promotion or schedule_promotion to complete deployment.";
    }

    // Generic fallback
    return "Check your available tools and call the most relevant one now.";
  }
  ```

- [ ] **Step 6: Commit**
  ```
  feat(agentic-loop): add frustration detection with phase-aware nudging
  ```

---

## Improvement 3: Dynamic Tool Descriptions

### Task 5: Add session-aware tool description enrichment

**Files:**
- Modify: `apps/web/lib/tak/agentic-loop.ts`

- [ ] **Step 1: Add `enrichToolDescriptions` function**
  Add above `runAgenticLoop`:
  ```typescript
  /**
   * Annotate tool descriptions with session-aware hints based on what the agent
   * has already tried. Inspired by Claude Code's dynamic tool description system.
   * Mutates nothing — returns a new array.
   */
  function enrichToolDescriptions(
    toolsForProvider: Array<Record<string, unknown>>,
    executedTools: Array<{ name: string; args?: Record<string, unknown>; result: { success: boolean; error?: string } }>,
  ): Array<Record<string, unknown>> {
    if (executedTools.length === 0) return toolsForProvider;

    // Build failure map: tool name → last error (only for tools that LAST failed;
    // if a tool succeeded after failing, it's cleared from the map)
    const failures = new Map<string, string>();
    for (const t of executedTools) {
      if (!t.result.success && t.result.error) {
        failures.set(t.name, t.result.error.slice(0, 150));
      } else if (t.result.success) {
        failures.delete(t.name); // Tool recovered — clear the warning
      }
    }

    if (failures.size === 0) return toolsForProvider;

    return toolsForProvider.map((tool) => {
      const name = tool.name as string;
      const lastError = failures.get(name);
      if (!lastError) return tool;

      const desc = tool.description as string;
      return {
        ...tool,
        description: `${desc} [WARNING: This tool failed earlier in this session with: "${lastError}". Consider a different approach or different arguments.]`,
      };
    });
  }
  ```

- [ ] **Step 2: Wire it into the loop**
  Inside the `for` loop in `runAgenticLoop`, just before the `routeAndCall` invocation (~line 258), add:
  ```typescript
  // Dynamic tool descriptions: annotate tools that failed earlier in this session
  const enrichedRouteOptions = {
    ...routeOptions,
    ...(routeOptions.tools ? { tools: enrichToolDescriptions(routeOptions.tools as Array<Record<string, unknown>>, executedTools) } : {}),
  };
  ```
  Then change `routeAndCall(messages, systemPrompt, sensitivity, routeOptions)` to use `enrichedRouteOptions`:
  ```typescript
  const result = await routeAndCall(messages, systemPrompt, sensitivity, enrichedRouteOptions);
  ```

- [ ] **Step 3: Commit**
  ```
  feat(agentic-loop): add session-aware dynamic tool description enrichment
  ```

---

## Improvement 4: Contribution Mode Awareness in All Build Phases

### Task 6: Load and inject contribution mode for all phases

**Files:**
- Modify: `apps/web/lib/explore/feature-build-data.ts` (~line 195, remove ship-only guard)
- Modify: `apps/web/lib/integrate/build-agent-prompts.ts` (`getBuildContextSection()` ~line 370)

- [ ] **Step 1: Load contributionMode for all phases**
  In `apps/web/lib/explore/feature-build-data.ts`, change the ship-only guard at ~line 196:
  ```typescript
  // BEFORE (ship-only):
  // let contributionMode: string | undefined;
  // if (r.phase === "ship") {
  //   const devConfig = await prisma.platformDevConfig.findUnique({ ... });
  //   contributionMode = devConfig?.contributionMode ?? "selective";
  // }

  // AFTER (all phases):
  const devConfig = await prisma.platformDevConfig.findUnique({
    where: { id: "singleton" },
    select: { contributionMode: true },
  });
  const contributionMode = devConfig?.contributionMode ?? "selective";
  ```

- [ ] **Step 2: Add phase-aware contribution mode prompt injection**
  In `apps/web/lib/integrate/build-agent-prompts.ts`, replace the existing ship-only injection (~lines 372-375):
  ```typescript
  // BEFORE:
  // if (ctx.phase === "ship" && ctx.contributionMode) {
  //   lines.push("");
  //   lines.push(`Platform contribution mode: ${ctx.contributionMode}`);
  // }

  // AFTER — contribution mode awareness for all phases:
  if (ctx.contributionMode) {
    lines.push("");
    if (ctx.phase === "ideate" || ctx.phase === "plan") {
      const modeExplain = ctx.contributionMode === "contribute_all"
        ? "contributions are sent upstream by default — flag any proprietary data models or trade secrets in your design"
        : ctx.contributionMode === "selective"
        ? "the user will be asked whether to contribute each feature"
        : "code stays local only — no upstream contribution";
      lines.push(`Platform contribution mode: ${ctx.contributionMode}. ${modeExplain}.`);
    } else {
      // build, review, ship — simple injection (ship prompt has its own detailed STEP 5 logic)
      lines.push(`Platform contribution mode: ${ctx.contributionMode}.`);
    }
  }
  ```

- [ ] **Step 3: Commit**
  ```
  feat(prompts): inject contribution mode awareness into all build phases
  ```

---

## Testing Strategy

All changes should be tested via the Build Studio UI manually (per feedback memory: manual testing preferred for AI Coworker).

### Verification Checklist

- [ ] Start a new feature build in ideate phase. Approve design. Verify `save_phase_handoff` is called and a `PhaseHandoff` row is created in the DB.
- [ ] Advance to plan phase. Verify the system prompt contains "--- Briefing from Previous Phases ---" with the ideate handoff summary, decisions, and open issues.
- [ ] Advance to build phase. Verify handoffs from both ideate and plan are visible in the system prompt.
- [ ] Trigger a frustration scenario (e.g., sandbox unavailable). Verify the agent gets a phase-aware nudge, not a generic one. Check console logs for `[agentic-loop] frustration detected`.
- [ ] Trigger 3 frustration detections. Verify the loop breaks with the honest "I've been struggling" message.
- [ ] Cause a tool failure (e.g., `generate_code` on existing file). On the next iteration, verify the tool description includes the `[WARNING: ...]` annotation. Verify the warning clears if the tool later succeeds.
- [ ] Verify contribution mode appears in ideate prompt for a `selective` or `contribute_all` mode install, with the appropriate guidance text.
- [ ] Verify that `fork_only` mode in ideate says "code stays local only."

## Dependency Order

```
Tasks 1-3 are sequential (tool def → prompt injection → prompt instructions).
Tasks 4-5 are independent of 1-3 and each other.
Task 6 is independent of all others.

Recommended execution:

  Parallel group 1: Tasks 4 + 5 + 6 (independent)
  Sequential group: Tasks 1 → 2 → 3 (depends on prior)
```

## Sources

- [Fortune — Anthropic leaks its own AI coding tool's source code](https://fortune.com/2026/03/31/anthropic-source-code-claude-code-data-leak-second-security-lapse-days-after-accidentally-revealing-mythos/)
- [The New Stack — Inside Claude Code's leaked source: swarms, daemons, and 44 features](https://thenewstack.io/claude-code-source-leak/)
- [Engineer's Codex — Diving into Claude Code's Source Code Leak](https://read.engineerscodex.com/p/diving-into-claude-codes-source-code)
- [WinBuzzer — Claude Code Source Leak Exposes Anti-Distillation Traps](https://winbuzzer.com/2026/04/01/claude-code-source-leak-anti-distillation-traps-undercover-mode-xcxwbn/)
- [Layer5 — The Claude Code Source Leak: 512,000 Lines](https://layer5.io/blog/engineering/the-claude-code-source-leak-512000-lines-a-missing-npmignore-and-the-fastest-growing-repo-in-github-history/)
