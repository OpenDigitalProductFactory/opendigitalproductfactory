// apps/web/lib/integrate/build-orchestrator.ts
// Build Process Orchestrator: plan parsing, dependency-aware parallel dispatch,
// result synthesis, and process-defined communication.
// EP-BUILD-ORCHESTRATOR — "Do what Claude Code does"

import { prisma } from "@dpf/db";
import { runAgenticLoop, type AgenticResult } from "@/lib/agentic-loop";
import { agentEventBus, type AgentEvent } from "@/lib/agent-event-bus";
import { getAvailableTools, toolsToOpenAIFormat } from "@/lib/mcp-tools";
import { getBuildContextSection } from "@/lib/integrate/build-agent-prompts";
import {
  buildDependencyGraph,
  type AssignedTask,
} from "./task-dependency-graph";
import {
  buildSpecialistPrompt,
  SPECIALIST_AGENT_IDS,
  SPECIALIST_MODEL_REQS,
  SPECIALIST_TOOLS,
} from "./specialist-prompts";
import type { SpecialistRole } from "./task-dependency-graph";
import type { BuildPlanDoc } from "@/lib/explore/feature-build-types";
import { dispatchCodexTask, type CodexResult } from "./codex-dispatch";
import { dispatchClaudeTask, type ClaudeResult } from "./claude-dispatch";
import { getBuildStudioConfig } from "./build-studio-config";

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_DURATION_ORCHESTRATOR_MS = 2_400_000; // 40 minutes — tasks average 2 min, 14-task builds need ~30 min
const MAX_SPECIALIST_RETRIES = 2;

// ─── Communication Templates ────────────────────────────────────────────────

const ROLE_LABELS: Record<SpecialistRole, string> = {
  "data-architect": "Data Architect",
  "software-engineer": "Software Engineer",
  "frontend-engineer": "Frontend Engineer",
  "qa-engineer": "QA",
};

export function formatPhaseMessage(role: SpecialistRole, outcome: string): string {
  return `${ROLE_LABELS[role]} complete: ${outcome}`;
}

export type BuildSummary = {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  specialistSummaries: Array<{ role: SpecialistRole; taskTitle: string; outcome: string; status: SpecialistOutcome }>;
};

/**
 * Sanitize raw Codex CLI / agentic loop output for user display.
 * Strips leaked system prompt fragments, internal instructions, and
 * token usage lines — extracts only the meaningful result summary.
 */
function sanitizeSpecialistOutput(raw: string): string {
  // Common system prompt fragments that leak through Codex CLI output
  const NOISE_PATTERNS = [
    // Codex CLI stderr banner (captured when 2>&1 was used; safety net)
    /Reading (?:additional )?(?:input|prompt) from stdin\.{0,3}\s*/gi,
    /OpenAI Codex v[\d.]+[^]*?(?=\n\n|codex\n|user\n)/gi,
    /^-{4,}$/gm,
    /^workdir:.*$/gm,
    /^model:.*$/gm,
    /^provider:.*$/gm,
    /^approval:.*$/gm,
    /^sandbox:.*$/gm,
    /^reasoning (?:effort|summaries):.*$/gm,
    /^session id:.*$/gm,
    /^user$/gm,
    /^codex$/gm,
    /^warning:.*bubblewrap.*$/gmi,
    // System prompt fragments that leak through
    /You are a (?:data architect|software engineer|frontend engineer|QA engineer)[^]*?(?=\n\n|\n[A-Z])/gi,
    /HEURISTICS:[\s\S]*?(?=\n\n[A-Z]|\n---|\n\n$)/gi,
    /--- Running Spec[\s\S]*/gi,
    /Decomposition:.*$/gm,
    /Test-driven thinking:.*$/gm,
    /Pattern reuse:.*$/gm,
    /Key (?:files|patterns):[\s\S]*?(?=\n\n|\n[A-Z])/gi,
    /Validate with:.*$/gm,
    /After changes:.*$/gm,
    /Then:?\s*pnpm.*$/gm,
    /pnpm --filter.*$/gm,
    /MAX \d+ SHORT SENTENCES.*$/gm,
    /Never mention internal IDs.*$/gm,
    /Lead the user through the phases.*$/gm,
    /→ Review → Ship.*$/gm,
    /tokens used[\s\S]*$/gi,
  ];

  let cleaned = raw;
  for (const pat of NOISE_PATTERNS) {
    cleaned = cleaned.replace(pat, "");
  }
  // Collapse multiple blank lines and trim
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();

  // If cleaning left almost nothing, fall back to last meaningful line
  if (cleaned.length < 10 && raw.length > 10) {
    const lines = raw.split("\n").filter(l => l.trim().length > 5);
    cleaned = lines[lines.length - 1] ?? "Completed";
  }

  return cleaned;
}

export function formatBuildCompleteMessage(summary: BuildSummary): string {
  const { completedTasks, totalTasks, failedTasks } = summary;
  const hasBlocked = summary.specialistSummaries.some(s => s.status === "BLOCKED" || s.status === "NEEDS_CONTEXT");

  // Group tasks by status
  const done = summary.specialistSummaries.filter(s => s.status === "DONE");
  const concerns = summary.specialistSummaries.filter(s => s.status === "DONE_WITH_CONCERNS");
  const blocked = summary.specialistSummaries.filter(s => s.status === "BLOCKED" || s.status === "NEEDS_CONTEXT");

  const parts: string[] = [];

  // Header
  if (hasBlocked || failedTasks > 0) {
    parts.push(`Build needs attention — ${completedTasks} of ${totalTasks} tasks completed, ${failedTasks} need review.`);
  } else if (concerns.length > 0) {
    parts.push(`Build completed with ${concerns.length} item${concerns.length > 1 ? "s" : ""} to review (${completedTasks}/${totalTasks} tasks done).`);
  } else {
    parts.push(`Build completed successfully — all ${totalTasks} tasks done.`);
  }

  // Completed tasks (concise list)
  if (done.length > 0) {
    parts.push("\nCompleted:");
    for (const s of done) {
      parts.push(`  - ${s.taskTitle}`);
    }
  }

  // Concerns (show task title + sanitized detail)
  if (concerns.length > 0) {
    parts.push("\nNeeds review:");
    for (const s of concerns) {
      const detail = sanitizeSpecialistOutput(s.outcome);
      parts.push(`  - ${s.taskTitle}${detail && detail !== s.taskTitle ? ` — ${detail.slice(0, 120)}` : ""}`);
    }
  }

  // Blocked
  if (blocked.length > 0) {
    parts.push("\nBlocked:");
    for (const s of blocked) {
      const detail = sanitizeSpecialistOutput(s.outcome);
      parts.push(`  - ${s.taskTitle}${detail ? ` — ${detail.slice(0, 120)}` : ""}`);
    }
  }

  // Call to action
  if (hasBlocked || failedTasks > 0) {
    parts.push("\nSome tasks need attention before proceeding.");
  } else if (concerns.length > 0) {
    parts.push("\nReady for review?");
  } else {
    parts.push("\nReady for review?");
  }

  return parts.join("\n");
}

// ─── Specialist Outcome Protocol (Superpowers-inspired) ────────────────────
// Structured status codes for specialist results. Replaces boolean success
// with a 4-status protocol that enables smarter orchestration decisions.

export type SpecialistOutcome =
  | "DONE"                // Task completed successfully
  | "DONE_WITH_CONCERNS"  // Task completed but flagged issues for review
  | "BLOCKED"             // Task cannot proceed — needs human or dependency resolution
  | "NEEDS_CONTEXT";      // Task needs additional information from orchestrator

/** Error patterns that indicate infrastructure issues vs. task-level failures. */
export const INFRA_ERROR_PATTERNS = [
  "sandbox not running", "sandbox initialization failed", "all sandbox slots",
  "sandbox container not found", "no sandbox", "could not initialize sandbox",
];
export const MISSING_PREREQUISITE_PATTERNS = [
  "not found in schema", "file not found", "no model named",
];

/** Classify a specialist's result into a structured outcome. Works with AgenticResult, CodexResult, and ClaudeResult. */
export function classifyOutcome(result: AgenticResult | CodexResult | ClaudeResult, role: SpecialistRole): SpecialistOutcome {
  const content = result.content.toLowerCase();

  // For CodexResult: success is determined by Codex CLI exit code
  if ("durationMs" in result && !("providerId" in result)) {
    // CodexResult path
    if (!result.success) {
      if (content.includes("timed out")) return "BLOCKED";
      if (content.includes("error") || content.includes("failed")) return "DONE_WITH_CONCERNS";
      return "BLOCKED";
    }
    // Codex succeeded — check content for concerns
    if (content.includes("error") || content.includes("failed") || content.includes("warning")) {
      return "DONE_WITH_CONCERNS";
    }
    return "DONE";
  }

  // AgenticResult path (original logic)
  const agenticResult = result as AgenticResult;
  const calledBuildTools = agenticResult.executedTools.some(t =>
    t.name !== "read_sandbox_file" && t.name !== "search_sandbox" && t.name !== "list_sandbox_files" && t.name !== "describe_model"
  );
  const hasErrors = agenticResult.executedTools.some(t => !t.result.success);
  const isQA = role === "qa-engineer";

  const toolErrors = agenticResult.executedTools
    .filter(t => !t.result.success)
    .map(t => (t.result.error ?? "").toLowerCase());
  const hasInfraError = toolErrors.some(err =>
    INFRA_ERROR_PATTERNS.some(pat => err.includes(pat))
  );
  if (hasInfraError) return "BLOCKED";

  const hasMissingPrereq = toolErrors.some(err =>
    MISSING_PREREQUISITE_PATTERNS.some(pat => err.includes(pat))
  );
  if (hasMissingPrereq && !calledBuildTools) return "BLOCKED";

  if (content.includes("blocked") || content.includes("cannot proceed") || content.includes("missing prerequisite")) {
    return "BLOCKED";
  }
  if (content.includes("need more information") || content.includes("please clarify") || content.includes("which ")) {
    return "NEEDS_CONTEXT";
  }
  if (isQA && calledBuildTools) {
    return hasErrors ? "DONE_WITH_CONCERNS" : "DONE";
  }
  if (calledBuildTools && !hasErrors) return "DONE";
  if (calledBuildTools && hasErrors) return "DONE_WITH_CONCERNS";
  return "BLOCKED";
}

// ─── Task Resume Logic ─────────────────────────────────────────────────────

/** Stored task result shape from saveBuildEvidence("taskResults", ...) */
export type StoredTaskResult = {
  title: string;
  specialist: string;
  outcome: string;
  durationMs?: number;
};

/**
 * Determine which tasks can be skipped based on prior stored results.
 * Returns a Set of task titles that completed successfully (DONE or DONE_WITH_CONCERNS).
 */
export function getCompletedTaskTitles(
  storedTasks: StoredTaskResult[] | undefined | null,
): Set<string> {
  const completed = new Set<string>();
  if (!storedTasks?.length) return completed;
  for (const t of storedTasks) {
    if (t.outcome === "DONE" || t.outcome === "DONE_WITH_CONCERNS") {
      completed.add(t.title);
    }
  }
  return completed;
}

/**
 * Build a prior results summary string from stored task results,
 * providing downstream context for tasks that depend on completed work.
 */
export function buildStoredResultsSummary(
  storedTasks: StoredTaskResult[] | undefined | null,
): string {
  if (!storedTasks?.length) return "";
  let summary = "";
  for (const t of storedTasks) {
    if (t.outcome === "DONE" || t.outcome === "DONE_WITH_CONCERNS") {
      summary += `\n${t.specialist} [${t.outcome}] (${t.title}): completed in prior run`;
    }
  }
  return summary;
}

// ─── Specialist Dispatch ────────────────────────────────────────────────────

type SpecialistResult = {
  task: AssignedTask;
  result: AgenticResult | CodexResult | ClaudeResult;
  outcome: SpecialistOutcome;
  success: boolean;
  retries: number;
};

async function dispatchSpecialist(params: {
  task: AssignedTask;
  userId: string;
  platformRole: string | null;
  isSuperuser: boolean;
  buildId: string;
  buildContext: string;
  parentThreadId: string;
  priorResults?: string;
  sessionId?: string;
}): Promise<SpecialistResult> {
  const { task, userId, platformRole, isSuperuser, buildId, buildContext, parentThreadId, priorResults, sessionId } = params;
  const role = task.specialist;

  // Emit dispatch event
  agentEventBus.emit(parentThreadId, {
    type: "orchestrator:task_dispatched",
    buildId,
    taskTitle: task.title,
    specialist: ROLE_LABELS[role],
  });

  // ─── CLI dispatch path: Codex or Claude Code running inside the sandbox ──
  const config = await getBuildStudioConfig();

  if (config.provider === "codex" || config.provider === "claude") {
    const cliResult = config.provider === "claude"
      ? await dispatchClaudeTask({ task, buildId, buildContext, priorResults, providerId: config.claudeProviderId, model: config.claudeModel, sessionId })
      : await dispatchCodexTask({ task, buildId, buildContext, priorResults, providerId: config.codexProviderId, model: config.codexModel });

    const outcome = classifyOutcome(cliResult, role);

    agentEventBus.emit(parentThreadId, {
      type: "orchestrator:task_complete",
      buildId,
      taskTitle: task.title,
      specialist: ROLE_LABELS[role],
      outcome: cliResult.success ? "DONE" : "BLOCKED",
    });

    return {
      task,
      result: cliResult,
      outcome,
      success: outcome === "DONE" || outcome === "DONE_WITH_CONCERNS",
      retries: 0,
    };
  }

  // ─── Agentic loop path (legacy fallback) ─────────────────────────────────
  const agentId = SPECIALIST_AGENT_IDS[role];
  const modelReqs = SPECIALIST_MODEL_REQS[role];
  const allowedToolNames = new Set(SPECIALIST_TOOLS[role]);

  const thread = await prisma.agentThread.upsert({
    where: { userId_contextKey: { userId, contextKey: `build:${buildId}:${role}:${task.taskIndex}` } },
    update: {},
    create: { userId, contextKey: `build:${buildId}:${role}:${task.taskIndex}` },
  });

  const userContext = { userId, platformRole, isSuperuser };
  const allTools = await getAvailableTools(userContext, { mode: "act", agentId });
  const scopedTools = allTools.filter(t => allowedToolNames.has(t.name));
  const toolsForProvider = toolsToOpenAIFormat(scopedTools);

  const systemPrompt = buildSpecialistPrompt({
    role,
    taskDescription: `Task: ${task.title}\n\nFiles to work on:\n${task.files.map(f => `- ${f.path} (${f.action}): ${f.purpose}`).join("\n") || "See task description for details."}`,
    buildContext,
    priorResults,
  });

  let lastResult: AgenticResult | null = null;
  let retries = 0;

  for (let attempt = 0; attempt <= MAX_SPECIALIST_RETRIES; attempt++) {
    const taskPrompt = attempt === 0
      ? task.task.implement || task.title
      : `RETRY (attempt ${attempt + 1}): The previous attempt had issues:\n${lastResult?.content?.slice(0, 500) ?? "Unknown error"}\n\nTry a different approach. Original task: ${task.task.implement || task.title}`;

    lastResult = await runAgenticLoop({
      chatHistory: [{ role: "user", content: taskPrompt }],
      systemPrompt,
      sensitivity: "internal",
      tools: scopedTools,
      toolsForProvider,
      userId,
      routeContext: "/build",
      agentId,
      threadId: thread.id,
      modelRequirements: modelReqs,
      requireTools: true,
      onProgress: (event: AgentEvent) => agentEventBus.emit(parentThreadId, event),
    });

    const outcome = classifyOutcome(lastResult, role);

    if (outcome === "DONE" || outcome === "DONE_WITH_CONCERNS") {
      return { task, result: lastResult, outcome, success: true, retries: attempt };
    }

    retries = attempt + 1;
    if (attempt < MAX_SPECIALIST_RETRIES) {
      agentEventBus.emit(parentThreadId, {
        type: "orchestrator:specialist_retry",
        buildId,
        specialist: ROLE_LABELS[role],
        reason: lastResult.content.slice(0, 200),
        attempt: attempt + 1,
      });
    }
  }

  const finalOutcome = classifyOutcome(lastResult!, role);
  return { task, result: lastResult!, outcome: finalOutcome, success: false, retries };
}

// ─── Orchestrator Main ──────────────────────────────────────────────────────

export type OrchestratorResult = {
  content: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  specialistResults: SpecialistResult[];
  totalInputTokens: number;
  totalOutputTokens: number;
};

/**
 * Run the Build Process Orchestrator.
 * Parses the approved plan, builds dependency graph, dispatches specialists
 * in parallel phases, synthesizes results.
 *
 * This is a DIRECT DISPATCH FUNCTION — not an agentic loop.
 * It calls runAgenticLoop for each specialist, not for itself.
 */
export async function runBuildOrchestrator(params: {
  buildId: string;
  plan: BuildPlanDoc;
  userId: string;
  platformRole: string | null;
  isSuperuser: boolean;
  parentThreadId: string;
  buildContext: string;
}): Promise<OrchestratorResult> {
  const { buildId, plan, userId, platformRole, isSuperuser, parentThreadId, buildContext } = params;
  const startTime = Date.now();

  // ─── Layer 2: Task checkpointing — resume from prior results ─────────────
  // Read previously completed task results from the FeatureBuild record.
  // Tasks with outcome DONE or DONE_WITH_CONCERNS are skipped on re-run.
  let completedTaskTitles = new Set<string>();
  let priorStoredResults: string = "";

  try {
    const build = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { taskResults: true },
    });
    const stored = build?.taskResults as {
      tasks?: StoredTaskResult[];
    } | null;

    completedTaskTitles = getCompletedTaskTitles(stored?.tasks);
    priorStoredResults = buildStoredResultsSummary(stored?.tasks);

    if (completedTaskTitles.size > 0) {
      console.log(`[orchestrator] Resuming build ${buildId}: ${completedTaskTitles.size} tasks already completed, will skip`);
    }
  } catch (err) {
    console.warn("[orchestrator] Could not read prior task results, starting fresh:", err);
  }

  // ─── Pre-flight check: verify CLI dispatch auth is available ─────────────
  // Catch missing OAuth tokens BEFORE dispatching 14 tasks that all fail with
  // the same auth error. One clear message is better than 14 cryptic ones.
  const preflightConfig = await getBuildStudioConfig();

  if (preflightConfig.provider === "codex" || preflightConfig.provider === "claude") {
    try {
      const { getDecryptedCredential } = await import("@/lib/inference/ai-provider-internals");
      const providerId = preflightConfig.provider === "claude"
        ? preflightConfig.claudeProviderId
        : preflightConfig.codexProviderId;
      const cred = await getDecryptedCredential(providerId);
      const hasAuth = preflightConfig.provider === "claude"
        ? !!(cred?.cachedToken || cred?.secretRef)
        : !!cred?.cachedToken;
      if (!hasAuth) {
        const label = preflightConfig.provider === "claude" ? "Claude / Anthropic" : "OpenAI / Codex";
        return {
          content: `Build cannot start — the ${label} provider "${providerId}" is not connected.\n\nGo to Admin > AI Workforce > External Services and configure credentials, or switch providers in Build Studio.`,
          totalTasks: 0, completedTasks: 0, failedTasks: 0,
          specialistResults: [], totalInputTokens: 0, totalOutputTokens: 0,
        };
      }
    } catch {
      return {
        content: "Build cannot start — could not verify AI provider credentials.\n\nGo to Admin > AI Workforce and ensure at least one code generation provider is connected.",
        totalTasks: 0, completedTasks: 0, failedTasks: 0,
        specialistResults: [], totalInputTokens: 0, totalOutputTokens: 0,
      };
    }
  }

  // Build dependency graph from plan
  const phases = buildDependencyGraph(
    plan.fileStructure ?? [],
    plan.tasks ?? [],
  );

  const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);

  // Emit build started (report resume status if applicable)
  const specialists = [...new Set(phases.flatMap(p => p.tasks.map(t => ROLE_LABELS[t.specialist])))];
  const pendingTaskCount = totalTasks - completedTaskTitles.size;
  agentEventBus.emit(parentThreadId, {
    type: "orchestrator:build_started",
    buildId,
    taskCount: totalTasks,
    specialists,
    ...(completedTaskTitles.size > 0 && {
      resuming: true,
      skippedTasks: completedTaskTitles.size,
      pendingTasks: pendingTaskCount,
    }),
  });

  // Execute phases sequentially; tasks within a phase run in parallel
  const allResults: SpecialistResult[] = [];
  let priorResultsSummary = priorStoredResults;

  // Layer 1: CLI session continuity — DISABLED for now.
  // Claude Code --session-id is single-use: one session per invocation.
  // Parallel tasks in the same phase all try to claim the same session → "already in use" error.
  // Proper session chaining (sequential between phases) is a future enhancement.
  // For now, each task gets its own fresh session. Context is passed via priorResults text.

  for (const phase of phases) {
    // Timeout check
    if (Date.now() - startTime > MAX_DURATION_ORCHESTRATOR_MS) {
      console.warn(`[orchestrator] hit MAX_DURATION (${MAX_DURATION_ORCHESTRATOR_MS}ms). Reporting partial results.`);
      break;
    }

    // Filter out already-completed tasks (Layer 2: resume)
    const pendingTasks = phase.tasks.filter(task => {
      if (completedTaskTitles.has(task.title)) {
        console.log(`[orchestrator] Skipping completed task: "${task.title}"`);
        agentEventBus.emit(parentThreadId, {
          type: "orchestrator:task_complete",
          buildId,
          taskTitle: task.title,
          specialist: ROLE_LABELS[task.specialist],
          outcome: "Skipped (completed in prior run)",
          status: "DONE",
        });
        return false;
      }
      return true;
    });

    // Skip phase entirely if all tasks are already done
    if (pendingTasks.length === 0) {
      continue;
    }

    // Dispatch pending tasks in this phase in parallel
    const phaseResults = await Promise.all(
      pendingTasks.map(task =>
        dispatchSpecialist({
          task,
          userId,
          platformRole,
          isSuperuser,
          buildId,
          buildContext,
          parentThreadId,
          priorResults: priorResultsSummary || undefined,
          // sessionId omitted — see Layer 1 comment above
        })
      ),
    );

    // Collect results and build prior context for next phase
    for (const sr of phaseResults) {
      allResults.push(sr);

      const roleLabel = ROLE_LABELS[sr.task.specialist];
      // Clean outcome for user-facing events; raw content stays in priorResultsSummary
      // for downstream specialists who need the technical detail.
      const cleanOutcome = sanitizeSpecialistOutput(sr.result.content.slice(0, 300));

      // Emit completion event with structured outcome
      agentEventBus.emit(parentThreadId, {
        type: "orchestrator:task_complete",
        buildId,
        taskTitle: sr.task.title,
        specialist: roleLabel,
        outcome: cleanOutcome,
        status: sr.outcome,
      });

      // Accumulate raw context for downstream specialists (they need the technical detail)
      priorResultsSummary += `\n${roleLabel} [${sr.outcome}] (${sr.task.title}): ${sr.result.content.slice(0, 300)}`;
    }

    // Emit phase summary
    const completed = allResults.filter(r => r.success).length;
    agentEventBus.emit(parentThreadId, {
      type: "orchestrator:phase_summary",
      buildId,
      completed,
      total: totalTasks,
      summary: `Phase ${phase.phaseIndex + 1} complete.`,
    });
  }

  // Save verification evidence and trigger phase advance (build → review)
  // The QA specialist's result contains test/typecheck output — persist it
  // so the phase gate can evaluate and auto-advance.
  const qaResult = allResults.find(r => r.task.specialist === "qa-engineer");
  if (qaResult) {
    try {
      const { executeTool } = await import("@/lib/mcp-tools");
      // Parse QA output for structured verification data
      const qaContent = qaResult.result.content;
      const typecheckPassed = !qaContent.toLowerCase().includes("typecheck: fail") && !qaContent.toLowerCase().includes("type error");
      const testsMatch = qaContent.match(/(\d+)\s*pass/i);
      const failsMatch = qaContent.match(/(\d+)\s*fail/i);
      await executeTool("saveBuildEvidence", {
        field: "verificationOut",
        value: {
          typecheckPassed,
          testsPassed: testsMatch ? parseInt(testsMatch[1]!) : 0,
          testsFailed: failsMatch ? parseInt(failsMatch[1]!) : 0,
          fullOutput: qaContent.slice(0, 2000),
          timestamp: new Date().toISOString(),
        },
      }, userId, { routeContext: "/build", agentId: "AGT-ORCH-300", threadId: parentThreadId });
    } catch (err) {
      console.error("[orchestrator] Failed to save verification evidence:", err);
    }
  }

  // Persist task results to the FeatureBuild so partial completions are recorded
  // and the phase gate can evaluate even after a timeout.
  // IMPORTANT: Merge newly dispatched results with previously completed (skipped) tasks
  // so a resume run doesn't overwrite prior successes with an empty list.
  try {
    const { executeTool } = await import("@/lib/mcp-tools");

    // Build combined task list: skipped tasks (from prior run) + newly dispatched tasks
    const newTaskResults = allResults.map(r => ({
      title: r.task.title,
      specialist: r.task.specialist,
      outcome: r.outcome,
      durationMs: "durationMs" in r.result ? r.result.durationMs : 0,
    }));
    const newTaskTitles = new Set(newTaskResults.map(t => t.title));

    // Re-read stored results to preserve skipped tasks
    let priorTasks: StoredTaskResult[] = [];
    try {
      const build = await prisma.featureBuild.findUnique({
        where: { buildId },
        select: { taskResults: true },
      });
      const stored = build?.taskResults as { tasks?: StoredTaskResult[] } | null;
      // Keep prior tasks that weren't re-dispatched this run
      priorTasks = (stored?.tasks ?? []).filter(t => !newTaskTitles.has(t.title));
    } catch { /* ignore — just save what we have */ }

    const mergedTasks = [...priorTasks, ...newTaskResults];
    const completedCount = mergedTasks.filter(t => t.outcome === "DONE" || t.outcome === "DONE_WITH_CONCERNS").length;

    await executeTool("saveBuildEvidence", {
      field: "taskResults",
      value: {
        completedTasks: completedCount,
        totalTasks,
        timedOut: Date.now() - startTime > MAX_DURATION_ORCHESTRATOR_MS,
        tasks: mergedTasks,
        timestamp: new Date().toISOString(),
      },
    }, userId, { routeContext: "/build", agentId: "AGT-ORCH-300", threadId: parentThreadId });
  } catch (err) {
    console.error("[orchestrator] Failed to save task results:", err);
  }

  // Synthesize final result (include skipped tasks in completed count)
  const completedTasks = allResults.filter(r => r.success).length + completedTaskTitles.size;
  const failedTasks = allResults.filter(r => !r.success).length;
  const totalInputTokens = allResults.reduce((sum, r) => sum + ("totalInputTokens" in r.result ? r.result.totalInputTokens : 0), 0);
  const totalOutputTokens = allResults.reduce((sum, r) => sum + ("totalOutputTokens" in r.result ? r.result.totalOutputTokens : 0), 0);

  const summary: BuildSummary = {
    totalTasks,
    completedTasks,
    failedTasks,
    specialistSummaries: allResults.map(r => ({
      role: r.task.specialist,
      taskTitle: r.task.title,
      status: r.outcome,
      outcome: sanitizeSpecialistOutput(r.result.content.slice(0, 300)),
    })),
  };

  return {
    content: formatBuildCompleteMessage(summary),
    totalTasks,
    completedTasks,
    failedTasks,
    specialistResults: allResults,
    totalInputTokens,
    totalOutputTokens,
  };
}
