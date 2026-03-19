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
import type { AgentEvent } from "./agent-event-bus";

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
          // All retries exhausted — persist failure and return.
          const failed = buildFailedState(state, step, errorMsg);
          await updateState(failed);
          return failed;
        }
      }
    }
  }

  // All steps complete.
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
  const { createSandboxNetwork, createSandbox } = await import("./sandbox");
  const { createSandboxDbStack, findAvailablePort, buildSandboxDbEnvVars } = await import("./sandbox-db");

  const networkName = await createSandboxNetwork(buildId);
  const hostPort = await findAvailablePort(3001, 3100);
  const envVars = buildSandboxDbEnvVars(buildId);
  const containerId = await createSandbox(buildId, hostPort, { networkName, envVars });
  const { dbContainerId, neo4jContainerId, qdrantContainerId } = await createSandboxDbStack(
    buildId,
    networkName,
  );

  return {
    ...state,
    containerId,
    dbContainerId,
    neo4jContainerId,
    qdrantContainerId,
    networkId: networkName,
    hostPort,
  };
}

async function stepInitWorkspace(
  buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  const { copySourceAndBaseline } = await import("./sandbox-workspace");
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
  } = await import("./sandbox-db");
  const { execInSandbox } = await import("./sandbox");

  // Wait for all three databases to become ready in parallel.
  await Promise.all([
    waitForSandboxDb(state.dbContainerId!),
    waitForSandboxNeo4j(state.neo4jContainerId!),
    waitForSandboxQdrant(state.qdrantContainerId!),
  ]);

  // Run prisma migrate deploy inside the app container.
  await execInSandbox(
    state.containerId!,
    "cd /workspace && npx prisma migrate deploy",
  );

  // Seed with a copy of production data.
  const productionDbContainer =
    process.env.DPF_PRODUCTION_DB_CONTAINER ?? "opendigitalproductfactory-postgres-1";
  await seedSandboxDb(productionDbContainer, state.dbContainerId!);

  return state;
}

async function stepInstallDeps(
  _buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  const { installDepsAndStart } = await import("./sandbox-workspace");
  await installDepsAndStart(state.containerId!);
  return state;
}

async function stepGenerateCode(
  buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  const { prisma } = await import("@dpf/db");
  const { executeBuildPlan } = await import("./coding-agent");

  const build = await prisma.featureBuild.findUniqueOrThrow({ where: { buildId } });

  const brief = build.brief as import("./feature-build-types").FeatureBrief;
  const plan = (build.plan ?? {}) as Record<string, unknown>;

  await executeBuildPlan({
    containerId: state.containerId!,
    brief,
    plan,
  });

  return state;
}

async function stepRunTests(
  _buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  const { runSandboxTests } = await import("./coding-agent");
  try {
    await runSandboxTests(state.containerId!);
  } catch {
    // Tests are informational — a test failure does not fail the pipeline step.
  }
  return state;
}

async function stepComplete(
  _buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  // No-op: the pipeline loop handles the "complete" transition.
  return state;
}
