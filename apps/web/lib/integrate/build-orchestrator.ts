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

// ─── Constants ──────────────────────────────────────────────────────────────

const MAX_DURATION_ORCHESTRATOR_MS = 1_200_000; // 20 minutes
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
  specialistSummaries: Array<{ role: SpecialistRole; outcome: string; status: SpecialistOutcome }>;
};

export function formatBuildCompleteMessage(summary: BuildSummary): string {
  const status = `${summary.completedTasks}/${summary.totalTasks} tasks done`;
  const failNote = summary.failedTasks > 0 ? `, ${summary.failedTasks} failed` : "";
  const hasConcerns = summary.specialistSummaries.some(s => s.status === "DONE_WITH_CONCERNS");
  const hasBlocked = summary.specialistSummaries.some(s => s.status === "BLOCKED" || s.status === "NEEDS_CONTEXT");
  const outcomes = summary.specialistSummaries
    .map(s => `- ${ROLE_LABELS[s.role]} [${s.status}]: ${s.outcome}`)
    .join("\n");

  if (hasBlocked || summary.failedTasks > 0) {
    return `Build incomplete. ${status}${failNote}.\n${outcomes}\n\nSome tasks need attention before proceeding.`;
  }
  if (hasConcerns) {
    return `Build complete with concerns. ${status}.\n${outcomes}\n\nReview flagged concerns before proceeding.`;
  }
  return `Build complete. ${status}.\n${outcomes}\n\nReady for review?`;
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

/** Classify a specialist's agentic result into a structured outcome. */
export function classifyOutcome(result: AgenticResult, role: SpecialistRole): SpecialistOutcome {
  const content = result.content.toLowerCase();
  const calledBuildTools = result.executedTools.some(t =>
    t.name !== "read_sandbox_file" && t.name !== "search_sandbox" && t.name !== "list_sandbox_files" && t.name !== "describe_model"
  );
  const hasErrors = result.executedTools.some(t => !t.result.success);
  const isQA = role === "qa-engineer";

  // Check tool errors for infrastructure blockers (sandbox down, slots exhausted)
  const toolErrors = result.executedTools
    .filter(t => !t.result.success)
    .map(t => (t.result.error ?? "").toLowerCase());
  const hasInfraError = toolErrors.some(err =>
    INFRA_ERROR_PATTERNS.some(pat => err.includes(pat))
  );
  if (hasInfraError) return "BLOCKED";

  // Check for missing prerequisites (model/file doesn't exist yet)
  // Only classify as BLOCKED if ALL tool calls failed with prerequisite errors
  // (the agent couldn't find what it needed and made no successful mutations)
  const hasMissingPrereq = toolErrors.some(err =>
    MISSING_PREREQUISITE_PATTERNS.some(pat => err.includes(pat))
  );
  if (hasMissingPrereq && !calledBuildTools) return "BLOCKED";

  // Blocked: explicit blocker signals or no tools called (stalled)
  if (content.includes("blocked") || content.includes("cannot proceed") || content.includes("missing prerequisite")) {
    return "BLOCKED";
  }

  // Needs context: agent asked for more info
  if (content.includes("need more information") || content.includes("please clarify") || content.includes("which ")) {
    return "NEEDS_CONTEXT";
  }

  // QA always counts as done (test results are informational)
  if (isQA && calledBuildTools) {
    return hasErrors ? "DONE_WITH_CONCERNS" : "DONE";
  }

  // Build tools called with no errors = done
  if (calledBuildTools && !hasErrors) {
    return "DONE";
  }

  // Build tools called but some errors = concerns
  if (calledBuildTools && hasErrors) {
    return "DONE_WITH_CONCERNS";
  }

  // No build tools called = blocked (stalled agent)
  return "BLOCKED";
}

// ─── Specialist Dispatch ────────────────────────────────────────────────────

type SpecialistResult = {
  task: AssignedTask;
  result: AgenticResult;
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
}): Promise<SpecialistResult> {
  const { task, userId, platformRole, isSuperuser, buildId, buildContext, parentThreadId, priorResults } = params;
  const role = task.specialist;
  const agentId = SPECIALIST_AGENT_IDS[role];
  const modelReqs = SPECIALIST_MODEL_REQS[role];
  const allowedToolNames = new Set(SPECIALIST_TOOLS[role]);

  // Create isolated thread — upsert guards against re-trigger on the same build
  const thread = await prisma.agentThread.upsert({
    where: { userId_contextKey: { userId, contextKey: `build:${buildId}:${role}:${task.taskIndex}` } },
    update: {},
    create: { userId, contextKey: `build:${buildId}:${role}:${task.taskIndex}` },
  });

  // Get tools scoped to this specialist's allowed set.
  // UserContext shape: { userId, platformRole, isSuperuser } — see lib/govern/permissions.ts
  const userContext = { userId, platformRole, isSuperuser };
  const allTools = await getAvailableTools(
    userContext,
    { mode: "act", agentId },
  );
  const scopedTools = allTools.filter(t => allowedToolNames.has(t.name));
  const toolsForProvider = toolsToOpenAIFormat(scopedTools);

  // Build the specialist's system prompt
  const systemPrompt = buildSpecialistPrompt({
    role,
    taskDescription: `Task: ${task.title}\n\nFiles to work on:\n${task.files.map(f => `- ${f.path} (${f.action}): ${f.purpose}`).join("\n") || "See task description for details."}`,
    buildContext,
    priorResults,
  });

  // Dispatch with retries
  let lastResult: AgenticResult | null = null;
  let retries = 0;

  for (let attempt = 0; attempt <= MAX_SPECIALIST_RETRIES; attempt++) {
    const taskPrompt = attempt === 0
      ? task.task.implement || task.title
      : `RETRY (attempt ${attempt + 1}): The previous attempt had issues:\n${lastResult?.content?.slice(0, 500) ?? "Unknown error"}\n\nTry a different approach. Original task: ${task.task.implement || task.title}`;

    // Emit dispatch event
    agentEventBus.emit(parentThreadId, {
      type: "orchestrator:task_dispatched",
      buildId,
      taskTitle: task.title,
      specialist: ROLE_LABELS[role],
    });

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

    // Classify outcome using structured protocol
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

  // Build dependency graph from plan
  const phases = buildDependencyGraph(
    plan.fileStructure ?? [],
    plan.tasks ?? [],
  );

  const totalTasks = phases.reduce((sum, p) => sum + p.tasks.length, 0);

  // Emit build started
  const specialists = [...new Set(phases.flatMap(p => p.tasks.map(t => ROLE_LABELS[t.specialist])))];
  agentEventBus.emit(parentThreadId, {
    type: "orchestrator:build_started",
    buildId,
    taskCount: totalTasks,
    specialists,
  });

  // Execute phases sequentially; tasks within a phase run in parallel
  const allResults: SpecialistResult[] = [];
  let priorResultsSummary = "";

  for (const phase of phases) {
    // Timeout check
    if (Date.now() - startTime > MAX_DURATION_ORCHESTRATOR_MS) {
      console.warn(`[orchestrator] hit MAX_DURATION (${MAX_DURATION_ORCHESTRATOR_MS}ms). Reporting partial results.`);
      break;
    }

    // Dispatch all tasks in this phase in parallel
    const phaseResults = await Promise.all(
      phase.tasks.map(task =>
        dispatchSpecialist({
          task,
          userId,
          platformRole,
          isSuperuser,
          buildId,
          buildContext,
          parentThreadId,
          priorResults: priorResultsSummary || undefined,
        })
      ),
    );

    // Collect results and build prior context for next phase
    for (const sr of phaseResults) {
      allResults.push(sr);

      const roleLabel = ROLE_LABELS[sr.task.specialist];
      const outcomeText = sr.outcome === "DONE"
        ? sr.result.content.slice(0, 300)
        : sr.outcome === "DONE_WITH_CONCERNS"
          ? `[CONCERNS] ${sr.result.content.slice(0, 280)}`
          : sr.outcome === "NEEDS_CONTEXT"
            ? `[NEEDS_CONTEXT] ${sr.result.content.slice(0, 270)}`
            : `[BLOCKED] after ${sr.retries} retries: ${sr.result.content.slice(0, 250)}`;

      // Emit completion event with structured outcome
      agentEventBus.emit(parentThreadId, {
        type: "orchestrator:task_complete",
        buildId,
        taskTitle: sr.task.title,
        specialist: roleLabel,
        outcome: outcomeText,
        status: sr.outcome,
      });

      // Accumulate context for downstream specialists (include status for awareness)
      priorResultsSummary += `\n${roleLabel} [${sr.outcome}] (${sr.task.title}): ${outcomeText}`;
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

  // Synthesize final result
  const completedTasks = allResults.filter(r => r.success).length;
  const failedTasks = allResults.filter(r => !r.success).length;
  const totalInputTokens = allResults.reduce((sum, r) => sum + r.result.totalInputTokens, 0);
  const totalOutputTokens = allResults.reduce((sum, r) => sum + r.result.totalOutputTokens, 0);

  const summary: BuildSummary = {
    totalTasks,
    completedTasks,
    failedTasks,
    specialistSummaries: allResults.map(r => ({
      role: r.task.specialist,
      status: r.outcome,
      outcome: r.outcome === "DONE"
        ? r.result.content.slice(0, 200)
        : r.outcome === "DONE_WITH_CONCERNS"
          ? `Completed with concerns: ${r.result.content.slice(0, 180)}`
          : r.outcome === "NEEDS_CONTEXT"
            ? `Needs context: ${r.result.content.slice(0, 180)}`
            : `Blocked: ${r.result.content.slice(0, 180)}`,
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
