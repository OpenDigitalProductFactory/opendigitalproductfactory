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
  specialistSummaries: Array<{ role: SpecialistRole; outcome: string }>;
};

export function formatBuildCompleteMessage(summary: BuildSummary): string {
  const status = `${summary.completedTasks}/${summary.totalTasks} tasks done`;
  const failNote = summary.failedTasks > 0 ? `, ${summary.failedTasks} failed` : "";
  const outcomes = summary.specialistSummaries
    .map(s => `- ${ROLE_LABELS[s.role]}: ${s.outcome}`)
    .join("\n");

  if (summary.failedTasks > 0) {
    return `Build incomplete. ${status}${failNote}.\n${outcomes}\n\nSome tasks need attention before proceeding.`;
  }
  return `Build complete. ${status}.\n${outcomes}\n\nReady for review?`;
}

// ─── Specialist Dispatch ────────────────────────────────────────────────────

type SpecialistResult = {
  task: AssignedTask;
  result: AgenticResult;
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
      onProgress: (event: AgentEvent) => agentEventBus.emit(parentThreadId, event),
    });

    // Check if specialist succeeded — heuristic: no frustration exit, tools were called
    const calledBuildTools = lastResult.executedTools.some(t =>
      t.name !== "read_sandbox_file" && t.name !== "search_sandbox" && t.name !== "list_sandbox_files"
    );
    const hasErrors = lastResult.executedTools.some(t => !t.result.success);
    const isQA = role === "qa-engineer"; // QA success = ran tests, regardless of test outcome

    if ((calledBuildTools && !hasErrors) || isQA) {
      return { task, result: lastResult, success: true, retries: attempt };
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

  return { task, result: lastResult!, success: false, retries };
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
      const outcome = sr.success
        ? sr.result.content.slice(0, 300)
        : `FAILED after ${sr.retries} retries: ${sr.result.content.slice(0, 200)}`;

      // Emit completion event
      agentEventBus.emit(parentThreadId, {
        type: "orchestrator:task_complete",
        buildId,
        taskTitle: sr.task.title,
        specialist: roleLabel,
        outcome,
      });

      // Accumulate context for downstream specialists
      priorResultsSummary += `\n${roleLabel} (${sr.task.title}): ${outcome}`;
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
      outcome: r.success ? r.result.content.slice(0, 200) : `FAILED: ${r.result.content.slice(0, 150)}`,
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
