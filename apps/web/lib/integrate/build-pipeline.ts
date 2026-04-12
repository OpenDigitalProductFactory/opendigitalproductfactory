// apps/web/lib/build-pipeline.ts
// Checkpoint-based build execution pipeline.
// Replaces the fire-and-forget autoExecuteBuild with resumable step checkpoints.

import {
  type BuildExecutionState,
  type BuildExecStep,
  STEP_ORDER,
  MAX_RETRIES,
  RETRY_DELAYS_MS,
} from "./build-exec-types";
import type { AgentEvent } from "@/lib/agent-event-bus";

// ─── Pure State Functions (testable) ─────────────────────────────────────────

/**
 * Determines the step at which to resume execution.
 * - null state → start from "pending"
 * - failed state with failedAt → retry from the failed step
 * - in-progress state → advance to next step
 */
export function getResumeStep(state: BuildExecutionState | null): BuildExecStep {
  if (!state) return "pending";
  if (state.step === "failed" && state.failedAt) {
    return state.failedAt as BuildExecStep;
  }
  const next = nextStep(state.step);
  return next ?? state.step;
}

/**
 * Returns true if the step has remaining retry budget.
 */
export function shouldRetry(step: BuildExecStep, currentRetryCount: number): boolean {
  const max = MAX_RETRIES[step] ?? 0;
  return currentRetryCount < max;
}

/**
 * Returns the step that follows `step` in STEP_ORDER, or null if there is none.
 */
export function nextStep(step: BuildExecStep): BuildExecStep | null {
  const idx = STEP_ORDER.indexOf(step);
  if (idx === -1 || idx >= STEP_ORDER.length - 1) return null;
  return STEP_ORDER[idx + 1]!;
}

/**
 * Builds a failed execution state from a current state and error details.
 */
export function buildFailedState(
  current: BuildExecutionState,
  failedAt: string,
  error: string,
): BuildExecutionState {
  return { ...current, step: "failed", failedAt, error };
}

// ─── Pipeline Orchestration ───────────────────────────────────────────────────

/**
 * Runs the checkpoint-based build pipeline.
 * Each step updates a persisted checkpoint so the pipeline is resumable.
 * Uses lazy imports on all step implementations to avoid circular dependencies.
 */
export async function runBuildPipeline(params: {
  buildId: string;
  existingState: BuildExecutionState | null;
  updateState: (state: BuildExecutionState) => Promise<void>;
  emit: (event: AgentEvent) => void;
}): Promise<BuildExecutionState> {
  const { buildId, existingState, updateState, emit } = params;

  const resumeStep = getResumeStep(existingState);

  // Build the slice of STEP_ORDER we still need to execute.
  const resumeIdx = STEP_ORDER.indexOf(resumeStep);
  const stepsToRun = resumeIdx === -1 ? STEP_ORDER : STEP_ORDER.slice(resumeIdx);

  let state: BuildExecutionState = existingState ?? {
    step: "pending",
    retryCount: 0,
    startedAt: new Date().toISOString(),
  };

  for (const step of stepsToRun) {
    // Skip terminal steps — these are not executable.
    if (step === "complete" || step === "failed") break;

    emit({ type: "phase:change", buildId, phase: step });

    let attempt = 0;
    const maxAttempts = (MAX_RETRIES[step] ?? 0) + 1;

    while (attempt < maxAttempts) {
      try {
        state = await executeStep(step, buildId, state);
        // Checkpoint the completed step.
        const advanced = nextStep(step);
        state = { ...state, step: advanced ?? step, retryCount: 0 };
        await updateState(state);
        break; // step succeeded — move on
      } catch (err) {
        attempt++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        if (attempt < maxAttempts) {
          const delay = RETRY_DELAYS_MS[attempt - 1] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1]!;
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
        } else {
          // All retries exhausted — persist failure.
          const failed = buildFailedState(state, step, errorMsg);
          await updateState(failed);
          return failed;
        }
      }
    }
  }

  const complete: BuildExecutionState = {
    ...state,
    step: "complete",
    completedAt: new Date().toISOString(),
  };
  await updateState(complete);
  emit({ type: "phase:change", buildId, phase: "complete" });
  return complete;
}

// ─── Step Dispatcher ──────────────────────────────────────────────────────────

/**
 * Dispatches to the correct step handler.
 *
 * Pipeline order:
 *   pending → sandbox_created → workspace_initialized → db_ready
 *   → deps_installed → code_generated → tests_run → complete
 *
 * workspace_initialized comes BEFORE db_ready because prisma migrate deploy
 * needs the prisma/ directory to exist inside the container.
 */
async function executeStep(
  step: BuildExecStep,
  buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  switch (step) {
    case "pending":              return stepCreateSandbox(buildId, state);
    case "sandbox_created":      return stepInitWorkspace(buildId, state);
    case "workspace_initialized":return stepInitDb(buildId, state);
    case "db_ready":             return stepInstallDeps(buildId, state);
    case "deps_installed":       return stepGenerateCode(buildId, state);
    case "code_generated":       return stepRunTests(buildId, state);
    case "tests_run":            return stepComplete(buildId, state);
    default:                     return state;
  }
}

// ─── Individual Step Implementations ─────────────────────────────────────────

async function stepCreateSandbox(
  buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  const { isSandboxAvailable, startBuildBranch } = await import("./sandbox/build-branch");

  const available = await isSandboxAvailable();
  if (!available) {
    throw new Error("Sandbox container (dpf-sandbox-1) is not running. Start it with: docker compose up -d sandbox");
  }

  const containerId = process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1";
  const hostPort = Number(process.env.SANDBOX_PORT ?? "3035");

  await startBuildBranch(buildId);

  return { ...state, containerId, hostPort };
}

async function stepInitWorkspace(
  buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  const { copySourceAndBaseline } = await import("./sandbox/sandbox-workspace");
  await copySourceAndBaseline(state.containerId!, buildId);
  return state;
}

async function stepInitDb(
  buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  const {
    waitForSandboxDb,
    waitForSandboxNeo4j,
    waitForSandboxQdrant,
    seedSandboxDb,
  } = await import("./sandbox/sandbox-db");
  const { execInSandbox } = await import("./sandbox/sandbox");

  // Pool sandboxes use a shared sandbox-postgres managed by compose.
  // Per-build DB containers are only created for dynamic sandboxes.
  const dbContainer = state.dbContainerId ?? "dpf-sandbox-postgres-1";
  const neo4jContainer = state.neo4jContainerId ?? "dpf-neo4j-1";
  const qdrantContainer = state.qdrantContainerId ?? "dpf-qdrant-1";

  // Wait for databases to become ready in parallel.
  await Promise.all([
    waitForSandboxDb(dbContainer),
    waitForSandboxNeo4j(neo4jContainer),
    waitForSandboxQdrant(qdrantContainer),
  ]);

  // Run prisma migrate deploy inside the sandbox container.
  // The sandbox has DATABASE_URL pointing to its own postgres.
  await execInSandbox(
    state.containerId!,
    "cd /workspace && pnpm --filter @dpf/db exec prisma migrate deploy",
  );

  // Seed sandbox DB with a copy of production data.
  const productionDbContainer =
    process.env.DPF_PRODUCTION_DB_CONTAINER ?? "dpf-postgres-1";
  await seedSandboxDb(productionDbContainer, dbContainer);

  return state;
}

async function stepInstallDeps(
  _buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  const { installDepsAndStart } = await import("./sandbox/sandbox-workspace");
  await installDepsAndStart(state.containerId!);
  return state;
}

async function stepGenerateCode(
  buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  const { prisma } = await import("@dpf/db");
  const { runAgenticLoop } = await import("@/lib/agentic-loop");
  const { getAvailableTools, toolsToOpenAIFormat } = await import("@/lib/mcp-tools");
  const { getBuildPhasePrompt, getBuildContextSection } = await import("./build-agent-prompts");
  const { agentEventBus } = await import("@/lib/agent-event-bus");

  const build = await prisma.featureBuild.findUniqueOrThrow({ where: { buildId } });

  const brief = build.brief as import("@/lib/feature-build-types").FeatureBrief;
  const plan = (build.plan ?? {}) as Record<string, unknown>;

  // Look up design system from storefront (if available)
  let designSystem: string | undefined;
  try {
    const storefront = await prisma.storefrontConfig.findFirst({
      select: { designSystem: true },
    });
    if (storefront?.designSystem) {
      designSystem = typeof storefront.designSystem === "string"
        ? storefront.designSystem
        : JSON.stringify(storefront.designSystem);
    }
  } catch { /* non-fatal */ }

  // Build the system prompt with build context (same as the coworker uses)
  const buildContext = await getBuildContextSection({
    buildId,
    phase: "build",
    title: brief?.title ?? "Feature",
    brief,
    portfolioId: build.portfolioId,
    plan,
    designSystem,
  });
  const systemPrompt = `You are an AI coworker building a feature in the sandbox.\n${buildContext}`;

  // Get sandbox tools — use a system-level context with full platform access
  const adminContext = { userId: "system", platformRole: "HR-000", isSuperuser: true } as Parameters<typeof getAvailableTools>[0];
  const tools = await getAvailableTools(adminContext, { mode: "act", unifiedMode: true });
  const toolsForProvider = toolsToOpenAIFormat(tools);

  // Build the initial message from the brief
  const userMessage = [
    `Build the following feature in the sandbox:`,
    `Title: ${brief.title}`,
    `Description: ${brief.description}`,
    ``,
    `Acceptance Criteria:`,
    ...(Array.isArray(brief.acceptanceCriteria) ? brief.acceptanceCriteria.map((c: string, i: number) => `${i + 1}. ${c}`) : []),
    ``,
    `Follow the approved implementation plan. Start by searching the codebase for existing patterns, then generate new files and edit existing ones as needed. Run tests when done.`,
  ].join("\n");

  // Find or create a thread for progress tracking
  const thread = await prisma.agentThread.findFirst({
    where: { contextKey: `/build/${buildId}` },
    select: { id: true },
  });
  const threadId = thread?.id ?? `build-pipeline-${buildId}`;

  // Run the agentic loop — this gives us iterative tool use with the full
  // read-edit-test-fix workflow instead of single-shot code generation
  const result = await runAgenticLoop({
    chatHistory: [{ role: "user", content: userMessage }],
    systemPrompt,
    sensitivity: "internal",
    tools,
    toolsForProvider,
    userId: "system",
    routeContext: `/build/${buildId}`,
    agentId: "build-architect",
    threadId,
    taskType: "code_generation",
    requireTools: true,
    onProgress: (event) => {
      if (thread?.id) agentEventBus.emit(thread.id, event);
    },
  });

  // Persist the agentic result summary
  const executedToolNames = result.executedTools.map(t => t.name);
  const filesChanged = executedToolNames.filter(n => n === "generate_code" || n === "edit_sandbox_file").length;
  const ranTests = executedToolNames.includes("run_sandbox_tests");

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      taskResults: {
        agenticResult: result.content.slice(0, 5000),
        toolsExecuted: executedToolNames,
        filesChanged,
        ranTests,
        providerId: result.providerId,
        modelId: result.modelId,
      } as unknown as import("@dpf/db").Prisma.InputJsonValue,
    },
  });

  return state;
}

async function stepRunTests(
  buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  const { prisma } = await import("@dpf/db");
  const { runSandboxTests, diagnoseTestFailures } = await import("./coding-agent");

  const results = await runSandboxTests(state.containerId!);
  const diagnosis = results.passed ? null : diagnoseTestFailures(results);

  // Persist test results to the build record.
  // Property names must match what the gate in feature-build-types.ts checks:
  //   testsFailed (number), typecheckPassed (lowercase c)
  const verificationData = {
    testsPassed: results.passed ? 1 : 0,
    testsFailed: results.passed ? 0 : 1,
    typecheckPassed: results.typeCheckPassed,
    testOutput: results.testOutput.slice(0, 5000),
    typeCheckOutput: results.typeCheckOutput.slice(0, 5000),
    ...(diagnosis ? { diagnosis: diagnosis.summary } : {}),
  };

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      verificationOut: verificationData as unknown as import("@dpf/db").Prisma.InputJsonValue,
    },
  });

  // Test failures are recorded but do not fail the pipeline step —
  // the agentic loop in stepGenerateCode should have already attempted fixes.
  // The review phase will evaluate whether failures are acceptable.
  return state;
}

async function stepComplete(
  _buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  // No-op: the pipeline loop handles the "complete" transition.
  return state;
}
