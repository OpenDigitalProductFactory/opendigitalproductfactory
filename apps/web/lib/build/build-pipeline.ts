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
import { getErrorMessage } from "@/lib/shared/get-error-message";

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
  // Strip completedAt so a previous success cannot leave the appearance of a
  // completed-yet-failed checkpoint. The recovery surfaces (retryBuildExecution,
  // workflow-action selection) rely on step alone to discriminate states.
  const { completedAt: _omitCompletedAt, ...rest } = current;
  void _omitCompletedAt;
  return { ...rest, step: "failed", failedAt, error };
}

// ─── Pipeline Orchestration ───────────────────────────────────────────────────

/**
 * Runs the checkpoint-based build pipeline.
 * Each step updates a persisted checkpoint so the pipeline is resumable.
 * Uses lazy imports on all step implementations to avoid circular dependencies.
 */
export async function runBuildPipeline(params: {
  buildId: string;
  /** Business taskRunId for BI-4ab6be39 heartbeat emission. Optional — older
   * call sites may not have one in scope; the pipeline degrades gracefully
   * (no heartbeat = watchdog flags after the build-phase threshold). */
  taskRunId?: string;
  existingState: BuildExecutionState | null;
  updateState: (state: BuildExecutionState) => Promise<void>;
  emit: (event: AgentEvent) => void;
}): Promise<BuildExecutionState> {
  const { buildId, taskRunId, existingState, updateState, emit } = params;

  // Self-heal: if a prior run reached "complete" with an empty diff capture
  // (the pre-fix stepComplete was a no-op and stranded any build whose agent
  // committed work inside the sandbox), re-arm the pipeline to re-run the
  // capture step. Without this, builds created before the fix landed would
  // stay blocked at the PR #850 gate forever because the orchestration loop
  // immediately breaks when state.step === "complete".
  let effectiveExistingState = existingState;
  if (existingState?.step === "complete") {
    const { prisma } = await import("@dpf/db");
    const fbRow = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { diffPatch: true },
    });
    const hasNoCapture = !fbRow?.diffPatch || fbRow.diffPatch.length === 0;
    if (hasNoCapture) {
      if (!existingState.containerId) {
        // BI-79176815: detection must not depend on the container, or the one
        // case that needs healing is the one case that cannot be detected.
        console.warn(
          `[build-pipeline] ${JSON.stringify(buildId)} is "complete" with an empty diffPatch and has NO sandbox container — its changes cannot be recovered by rewinding. The work may still exist on its build branch.`,
        );
      } else {
        console.log(
          `[build-pipeline] self-heal: ${JSON.stringify(buildId)} is "complete" but has empty diffPatch — rewinding to re-run stepComplete capture`,
        );
      }
      // Rewind to "code_generated" ONLY when a container still exists.
      // getResumeStep then advances to "tests_run" and the loop dispatches
      // stepComplete (the diff/commit capture step) without re-running
      // stepRunTests or earlier sandbox setup. The capture is idempotent.
      // Without a container the rewind cannot capture anything and would only
      // drive stepComplete into its throw, so leave the state alone and let
      // the warning above stand as the record.
      if (existingState.containerId) {
        effectiveExistingState = {
          ...existingState,
          step: "code_generated",
          retryCount: 0,
        };
      }
    }
  }

  const resumeStep = getResumeStep(effectiveExistingState);

  // Build the slice of STEP_ORDER we still need to execute.
  const resumeIdx = STEP_ORDER.indexOf(resumeStep);
  const stepsToRun = resumeIdx === -1 ? STEP_ORDER : STEP_ORDER.slice(resumeIdx);

  let state: BuildExecutionState = effectiveExistingState ?? {
    step: "pending",
    retryCount: 0,
    startedAt: new Date().toISOString(),
  };

  // Persist the initial "pending" checkpoint before entering the step loop.
  // This closes a race window where the DB has buildExecState content
  // (e.g. sourceCurrency from recordBuildSourceCurrency) but no `step` field
  // — which is indistinguishable from a portal-restart-killed stall.
  // Without this write, the UI correctly shows "Reset Build" for a stalled run
  // but also incorrectly shows it during a legitimately in-flight first step.
  // Guarded to new/stalled-at-pending runs only; resumes already have a valid step.
  if (state.step == null) {
    state = {
      ...state,
      step: "pending",
      retryCount: state.retryCount ?? 0,
      startedAt: state.startedAt ?? new Date().toISOString(),
    };
    await updateState(state);
  }

  try {
    for (const step of stepsToRun) {
      // Skip terminal steps — these are not executable.
      if (step === "complete" || step === "failed") break;

      emit({ type: "phase:change", buildId, phase: step });

      let attempt = 0;
      const maxAttempts = (MAX_RETRIES[step] ?? 0) + 1;

      while (attempt < maxAttempts) {
        try {
          // BI-e299d4d3 — wrap the slow step with withHeartbeatTicker.
          // executeStep can take 5-30 minutes (code generation, test runs,
          // sandbox spin-up). The post-step heartbeat below covers transition
          // boundaries but not the in-flight step itself. The ticker keeps
          // heartbeats flowing at (heartbeatTimeoutSeconds / 3) cadence so the
          // watchdog doesn't false-positive on legitimately slow steps.
          if (taskRunId) {
            const { withHeartbeatTicker } = await import("@/lib/observability/heartbeat");
            state = await withHeartbeatTicker(taskRunId, () => executeStep(step, buildId, state, emit));
          } else {
            state = await executeStep(step, buildId, state, emit);
          }
          // Checkpoint the completed step.
          const advanced = nextStep(step);
          state = { ...state, step: advanced ?? step, retryCount: 0 };
          await updateState(state);
          // BI-4ab6be39 — heartbeat at the step-transition boundary (only
          // when a taskRunId was provided by the caller). Belt-and-braces
          // alongside the in-step ticker above.
          if (taskRunId) {
            const { heartbeat } = await import("@/lib/observability/heartbeat");
            await heartbeat(taskRunId);
          }
          break; // step succeeded — move on
        } catch (err) {
          attempt++;
          let errorMsg = getErrorMessage(err);
          const { getAutonomousPlaybookMode } = await import(
            "@/lib/build/build-studio-config"
          );
          if (getAutonomousPlaybookMode() !== "off") {
            const {
              classifyAutonomousBuildFailure,
              decideAutonomousRecovery,
              initialAutonomousRecoveryState,
            } = await import("@/lib/build/autonomous-recovery-policy");
            const failureClass = classifyAutonomousBuildFailure({
              message: errorMsg,
              step,
            });
            const recovery = decideAutonomousRecovery({
              failureClass,
              state: state.autonomousRecovery
                ?? initialAutonomousRecoveryState(),
            });
            state = {
              ...state,
              autonomousRecovery: recovery.state,
              retryCount: attempt,
            };
            await updateState(state);
            if (failureClass === "sandbox-drift") {
              errorMsg = `blocked_sandbox_drift: ${errorMsg}`;
            }
            if (recovery.terminal) {
              const failed = buildFailedState(state, step, errorMsg);
              await updateState(failed);
              return failed;
            }
          }
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

    // Strip error/failedAt so a successful resume after a prior failure does
    // not retain stale failure breadcrumbs on the final completed checkpoint.
    const { error: _omitError, failedAt: _omitFailedAt, ...stateWithoutFailureFields } = state;
    void _omitError;
    void _omitFailedAt;
    const complete: BuildExecutionState = {
      ...stateWithoutFailureFields,
      step: "complete",
      completedAt: new Date().toISOString(),
    };
    await updateState(complete);
    emit({ type: "phase:change", buildId, phase: "complete" });
    return complete;
  } finally {
    // Always release the sandbox slot — whether the pipeline succeeded, failed,
    // or threw unexpectedly. releaseSandbox is a no-op if this build never
    // acquired a slot (e.g. failed before stepCreateSandbox ran).
    const { releaseSandbox } = await import("./sandbox/sandbox-pool");
    await releaseSandbox(buildId).catch((err) =>
      console.error("[build-pipeline] Failed to release sandbox slot:", { buildId }, err),
    );
  }
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
 *
 * Exported for the durable execution path (BI-89030C9B Phase 1) — the
 * Inngest function runs each step as its own journaled step.run via
 * build-execute-helpers.runPipelineStepDurable.
 */
export async function executeStep(
  step: BuildExecStep,
  buildId: string,
  state: BuildExecutionState,
  emit: (event: import("@/lib/agent-event-bus").AgentEvent) => void,
): Promise<BuildExecutionState> {
  switch (step) {
    case "pending":              return stepCreateSandbox(buildId, state, emit);
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
  emit: (event: import("@/lib/agent-event-bus").AgentEvent) => void,
): Promise<BuildExecutionState> {
  const { isSandboxAvailable, startBuildBranch } = await import("./sandbox/build-branch");
  const { waitForSandboxSlot } = await import("./sandbox/sandbox-pool");

  const available = await isSandboxAvailable();
  if (!available) {
    throw new Error("Sandbox container is not running. Start it with: docker compose up -d sandbox");
  }

  // Acquire a slot from the pool — waits up to 30 min if all slots are busy.
  // Emits "slot_queued" progress events so Build Studio shows a waiting state
  // rather than appearing stuck at "Pending".
  const slot = await waitForSandboxSlot(buildId, "system", {
    pollIntervalMs: 30_000,
    timeoutMs: 1_800_000,
    onWaiting: (attempt) => {
      console.log("[build-pipeline] waiting for sandbox slot:", { buildId, attempt });
      emit({ type: "phase:change", buildId, phase: "slot_queued" as import("@/lib/build-exec-types").BuildExecStep });
    },
  });

  const sourceCurrency = await startBuildBranch(buildId);

  return { ...state, containerId: slot.containerId, hostPort: slot.port, sourceCurrency };
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
    seedSandboxDb,
  } = await import("./sandbox/sandbox-db");
  const { execInSandbox } = await import("./sandbox/sandbox");

  // Pool sandboxes use a shared sandbox-postgres managed by compose.
  // Per-build DB containers are only created for dynamic sandboxes.
  // BET-5 (BI-28D31FB7): Postgres only — Neo4j/Qdrant sidecars retired.
  const dbContainer = state.dbContainerId ?? "dpf-sandbox-postgres-1";

  await waitForSandboxDb(dbContainer);

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
  buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  const { installDepsAndStart } = await import("./sandbox/sandbox-workspace");
  await installDepsAndStart(state.containerId!);

  // Preflight the test toolchain. The shared pool sandbox reuses node_modules
  // across builds; a stale/partial install makes vitest fail to LOAD (rolldown
  // native-binding error, vitest-not-found) and surfaces later as a confusing
  // parse error on a valid file — the FB-69231490 stall. Heal it here so the
  // sandbox is sound for every subsequent command (run_sandbox_command,
  // run_sandbox_tests, the QA specialist). If it cannot be healed, fail LOUD
  // with the structured diagnosis rather than proceeding to an opaque failure.
  const { ensureSandboxToolchainHealthy } = await import("./sandbox/sandbox-toolchain-health");
  const health = await ensureSandboxToolchainHealthy(state.containerId!);
  if (health.restored) {
    const { prisma } = await import("@dpf/db");
    await prisma.buildActivity.create({
      data: {
        buildId,
        tool: "sandbox:toolchain-restored",
        summary: `Sandbox toolchain was unloadable (${health.signature ?? "unknown"}); auto-restored node_modules before verification.`,
      },
    }).catch(() => {});
  }
  if (!health.healthy) {
    throw new Error(
      `Sandbox toolchain is not loadable${health.signature ? ` (${health.signature})` : ""}: ` +
      `${health.diagnosis ?? "vitest could not be loaded after a clean reinstall."} ` +
      `This is sandbox state, not a code defect — recover the sandbox before retrying.`,
    );
  }
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

  // Pre-resolve the brand design system for the build-phase agent.
  // readBrandContext prefers the structured Organization.designSystem,
  // falls back to any storefront's legacy markdown blob.
  let designSystem: string | undefined;
  try {
    const { readBrandContext } = await import("@/lib/brand/read");
    const ctx = await readBrandContext({});
    if (ctx.structured) {
      const s = ctx.structured;
      designSystem = `Brand: ${s.identity.name}\nPrimary color: ${s.palette.primary}\nBody font: ${s.typography.families.sans}\nConfidence: ${(s.confidence.overall * 100).toFixed(0)}%\n---\n${JSON.stringify(s, null, 2).slice(0, 3000)}`;
    } else if (ctx.legacyMarkdown) {
      designSystem = ctx.legacyMarkdown;
    }
  } catch { /* non-fatal */ }

  // Right-sizing matrix: read processSize from plan.processSize (written
  // at promote time) so the build phase prompt reflects the BI's declared
  // effortSize. Default "medium" preserves today's behavior for builds
  // promoted before plan.processSize existed.
  const processSize = (plan["processSize"] as string | undefined) ?? "medium";

  // Prospective CI gate constraints for the plan's intended files
  // (BI-121DC3A3): derived from the same registries CI enforces, injected
  // BEFORE generation so the agent designs within the ratchets/trailers
  // instead of discovering them at push time. Advisory and non-fatal.
  let gateContext: string | undefined;
  try {
    const { plannedChangesFromPlan, computeGateContextMarkdown } = await import("./gate-context-bridge");
    gateContext = (await computeGateContextMarkdown(plannedChangesFromPlan(plan))) ?? undefined;
  } catch { /* advisory — never block the build phase */ }

  // Build the system prompt with build context (same as the coworker uses)
  const buildContext = await getBuildContextSection({
    buildId,
    phase: "build",
    kind: build.kind as import("@/lib/feature-build-types").FeatureBuildKind,
    size: processSize as import("@/lib/feature-build-types").BuildProcessSize,
    title: brief?.title ?? "Feature",
    brief,
    portfolioId: build.portfolioId,
    plan,
    designSystem,
    gateContext,
  });
  // BI-CE93E314: the lead sentence is the brief; buildContext is build state,
  // i.e. the turn's DATA, and stays undeclared.
  const buildLead = "You are an AI coworker building a feature in the sandbox.";
  const systemPrompt = `${buildLead}\n${buildContext}`;

  // Get sandbox tools — scoped to build phase only.
  // Filtering by buildPhases: ["build"] gives the agent the file-editing surface
  // (read_sandbox_file, edit_sandbox_file, write_sandbox_file, run_sandbox_command,
  // run_sandbox_tests, search_sandbox, list_sandbox_files, saveBuildEvidence, …)
  // without overwhelming it with the 100+ tool surface used by the full coworker.
  //
  // Tools with no buildPhases tag (null/undefined) are platform-wide utilities
  // that are safe to include regardless of phase.
  const adminContext = { userId: "system", platformRole: "HR-000", isSuperuser: true } as Parameters<typeof getAvailableTools>[0];
  const allTools = await getAvailableTools(adminContext, { mode: "act", unifiedMode: true });
  const tools = allTools.filter(
    (t) => !t.buildPhases || t.buildPhases.includes("build"),
  );
  const toolsForProvider = toolsToOpenAIFormat(tools);
  console.log("[build-pipeline] stepGenerateCode:", { buildId, tools: tools.length, allTools: allTools.length });

  // Build the initial message from the brief
  const userMessage = [
    `Build the following feature in the sandbox:`,
    `Title: ${brief?.title ?? build.title ?? buildId}`,
    `Description: ${brief?.description ?? build.description ?? "(no description provided)"}`,
    ``,
    `Acceptance Criteria:`,
    ...(Array.isArray(brief?.acceptanceCriteria) ? brief.acceptanceCriteria.map((c: string, i: number) => `${i + 1}. ${c}`) : [`(none specified)`]),
    ``,
    `Follow the approved implementation plan. Start by searching the codebase for existing patterns, then generate new files and edit existing ones as needed. Run tests when done.`,
  ].join("\n");

  // Find or create a thread for progress tracking
  const thread = await prisma.agentThread.findFirst({
    where: { contextKey: `/build/${buildId}` },
    select: { id: true },
  });
  const threadId = thread?.id ?? `build-pipeline-${buildId}`;

  // Local-LLM build path: when the configured dispatch engine is opencode, run
  // the build through the opencode CLI runner instead of runAgenticLoop. The
  // agentic loop relies on the model's API tool-calling (requireTools), which a
  // local model can't do reliably — it fails with "No AI model that supports
  // tools is active." opencode is exactly the runner built to bridge that: it
  // parses the local model's native <function=…> tool format itself and drives
  // the read-edit-write loop in the sandbox. Gated on provider === "opencode"
  // so installs with a frontier CLI/provider keep the existing agentic path.
  const { getBuildStudioConfig, isQualityFirstRightsizingEnabled, getBuildGoldenTrianglePosture } =
    await import("./build-studio-config");
  const { getModelTier, deriveDeliverableSensitivity } = await import("@/lib/explore/build-process-matrix");
  // EP-MODEL-TIER-ROUTING: route this build's codegen to the model tier it
  // deserves — local (opencode) for the trivial tail, the configured robust
  // (frontier) engine otherwise. Inert unless DPF_BUILD_MODEL_TIER_ROUTING is
  // enabled; falls back to local when no robust engine is configured.
  //
  // EP-QUALITY-RIGHTSIZING (§4.1–4.3): when DPF_BUILD_QUALITY_FIRST_RIGHTSIZING is
  // on, the build's golden-triangle dial — the per-build plan override, else the
  // global default (pinned to Quality) — compiles, FLOORED by the deliverable's
  // derived sensitivity, into the model tier (P2 composes the compiler with P1's
  // risk axis; Cost/Speed cannot discount a sensitive deliverable below its floor).
  // Off-flag → plain size-based routing (byte-identical).
  let modelTier: "local" | "robust";
  if (await isQualityFirstRightsizingEnabled()) {
    const { resolveBuildSizing, coerceBuildPosture } = await import("@/lib/explore/build-rightsizing-dial");
    const riskPosture = await prisma.businessContext
      .findFirst({ select: { riskPosture: true } })
      .then((r) => r?.riskPosture ?? null)
      .catch(() => null);
    const sensitivityText = [
      brief?.title,
      brief?.description,
      build.title,
      build.description,
      ...(Array.isArray(brief?.acceptanceCriteria) ? brief.acceptanceCriteria : []),
    ]
      .filter(Boolean)
      .join(" ");
    const sensitivity = deriveDeliverableSensitivity(
      { text: sensitivityText, workType: build.kind },
      riskPosture,
    );
    const posture =
      coerceBuildPosture(plan["goldenTrianglePosture"]) ?? (await getBuildGoldenTrianglePosture());
    const resolved = resolveBuildSizing({ type: build.kind, size: processSize, posture, sensitivity });
    modelTier = resolved.modelTier;
    console.log("[build-pipeline] golden-triangle dial:", {
      buildId,
      processSize,
      sensitivity,
      preset: posture.preset,
      modelTier,
      review: resolved.policy.reviewIntensity,
    });
  } else {
    modelTier = getModelTier(build.kind, processSize);
  }
  const dispatchConfig = await getBuildStudioConfig({ modelTier });
  if (dispatchConfig.provider === "opencode") {
    const { dispatchOpencodeTask } = await import("./opencode-dispatch");
    const ocTask: import("./task-dependency-graph").AssignedTask = {
      taskIndex: 0,
      title: brief?.title ?? build.title ?? buildId,
      specialist: "software-engineer",
      files: [],
      task: {
        title: brief?.title ?? build.title ?? buildId,
        testFirst: "",
        implement: userMessage,
        verify: Array.isArray(brief?.acceptanceCriteria) ? brief.acceptanceCriteria.join("; ") : "",
      },
    };
    const oc = await dispatchOpencodeTask({
      task: ocTask,
      buildId,
      buildContext,
      model: dispatchConfig.opencodeModel,
      providerId: dispatchConfig.opencodeProviderId,
      onProgress: (message) => {
        if (thread?.id) {
          agentEventBus.emit(thread.id, { type: "orchestrator:task_progress", buildId, taskTitle: ocTask.title, message });
        }
      },
    });
    const ocToolNames = oc.executedTools.map((t) => t.name);
    await prisma.featureBuild.update({
      where: { buildId },
      data: {
        taskResults: {
          agenticResult: oc.content.slice(0, 5000),
          toolsExecuted: ocToolNames,
          // opencode emits write/edit tool events for file changes.
          filesChanged: ocToolNames.filter((n) => n === "write" || n === "edit").length,
          ranTests: false,
          providerId: dispatchConfig.opencodeProviderId || "local",
          modelId: dispatchConfig.opencodeModel || "local",
        } as unknown as import("@dpf/db").Prisma.InputJsonValue,
      },
    });
    if (!oc.success) {
      throw new Error(`opencode build dispatch failed: ${oc.content.slice(0, 300)}`);
    }
    return state;
  }

  // Run the agentic loop — this gives us iterative tool use with the full
  // read-edit-test-fix workflow instead of single-shot code generation
  const result = await runAgenticLoop({
    systemPromptInstructionSpans: [buildLead],
    chatHistory: [{ role: "user", content: userMessage }],
    systemPrompt,
    sensitivity: "development", // code clearance; payload screening still applies
    tools,
    toolsForProvider,
    userId: "system",
    routeContext: `/build/${buildId}`,
    agentId: "build-architect",
    threadId,
    // Use "analysis" routing so the request goes to the Anthropic API (Claude),
    // which supports proper function/tool calling in the agentic loop.
    // "code_generation" routes to Codex CLI which dispatches single-shot prompts
    // and cannot call the sandbox file-editing tools iteratively.
    taskType: "analysis",
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

  // Scope verification to the build's changed files so the feature's own tests
  // gate the build and their output isn't truncated behind the full suite.
  let changedFiles: string[] = [];
  try {
    const { getSandboxStateForBuild } = await import("@/lib/build/sandbox-state");
    const sandboxState = await getSandboxStateForBuild(buildId);
    changedFiles = sandboxState?.sourceDiffstat.map((entry) => entry.path) ?? [];
  } catch (err) {
    console.warn("[stepRunTests] could not resolve changed files for scoping:", (err as Error)?.message);
  }

  // Run verification in the build's working dir: its own worktree when isolation
  // is on, else /workspace (default — byte-identical). BI-98B723C0 Phase 2c.
  const { resolveBuildWorkdir } = await import("./sandbox/build-branch");
  const results = await runSandboxTests(state.containerId!, {
    changedFiles,
    workdir: resolveBuildWorkdir(buildId),
  });
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
  buildId: string,
  state: BuildExecutionState,
): Promise<BuildExecutionState> {
  // Capture the sandbox's releasable diff and commit hashes onto the
  // FeatureBuild row so downstream gates (build→review, review→ship, the
  // contribution flow, the release decision panel) see the work the agent
  // actually did. Before this step ran inside the pipeline, the pipeline
  // would mark itself "complete" with a 5-commit branch in the sandbox but
  // diffPatch=NULL and gitCommitHashes=[] in the DB — and PR #850's gate
  // would then reject the build for "no releasable source changes."
  // No container means the diff CANNOT be captured. Returning state unchanged
  // here advanced the build to "complete" with diffPatch/diffSummary/
  // gitCommitHashes all empty and NOTHING logged (BI-79176815) — so a build
  // that really did change code was indistinguishable from one that changed
  // nothing, and the owner-facing review surface had no evidence to show.
  //
  // Throw instead, matching stepCreateSandbox above ("Sandbox container is not
  // running"): the orchestration loop's retry/recovery path then sees a failed
  // step rather than a silent success. Every other best-effort branch in this
  // function warns; this one used to be the only one that said nothing at all.
  if (!state.containerId) {
    throw new Error(
      `Cannot capture the build diff: no sandbox container for ${buildId}. `
      + "The work may exist on the build branch but cannot be recorded, so this "
      + "step fails rather than completing the build with an empty result.",
    );
  }

  const { prisma } = await import("@dpf/db");
  const { extractDiff, execInSandbox, listSandboxCommitsAheadOfBase } = await import(
    "./sandbox/sandbox"
  );
  const { getClientIdentity, resolveBuildWorkdir, buildSandboxCommitInFlightWorkCommand } =
    await import("./sandbox/build-branch");

  const identity = await getClientIdentity();
  const baseRef = identity.clientBranch;
  // Extract the diff from the build's working dir: its own worktree when
  // isolation is on, else /workspace (default — byte-identical). BI-98B723C0 2c.
  const buildWorkdir = resolveBuildWorkdir(buildId);

  // BI-53C14D19: the per-task coding agents WRITE files into the working tree
  // but do not COMMIT them, so listSandboxCommitsAheadOfBase() below would
  // capture 0 commits and the build would strand at deploy/ship with "no
  // releasable source changes" (working tree dirty) — the generated code sat
  // uncommitted and was lost on the next branch scrub. Commit any in-flight
  // task output onto the build branch here, before capture. Best-effort and
  // build/-branch-scoped (the helper no-ops off a build/ branch and excludes
  // generated artifacts), so a no-op or failure never blocks completion.
  await execInSandbox(
    state.containerId,
    buildSandboxCommitInFlightWorkCommand(buildWorkdir),
  ).catch((err: unknown) => {
    console.warn(
      "[build-pipeline] pre-capture in-flight commit failed (best-effort):",
      (err as Error)?.message,
    );
  });

  const [fullDiff, commitHashes] = await Promise.all([
    extractDiff(state.containerId, { baseRef, workspace: buildWorkdir }),
    listSandboxCommitsAheadOfBase(state.containerId, baseRef, buildWorkdir),
  ]);

  // Branch-start currency is stale once task output is committed.
  const { refreshCommittedSourceCurrency } = await import("./sandbox/refresh-source-currency");
  const sourceCurrency = await refreshCommittedSourceCurrency({
    workspace: buildWorkdir,
    targetRef: baseRef,
    exec: (command) => execInSandbox(state.containerId!, command),
  });
  // BI-D93CF6C0 — generate the plain-language change narrative (Band 2 of the
  // overseer layer) from the goal + plan + diff. Best-effort: a null result just
  // falls back to the raw diffSummary dive-in, so this never blocks completion.
  let changeNarrative:
    | import("@/lib/feature-build-types").BuildChangeNarrative
    | null = null;
  try {
    const buildRow = await prisma.featureBuild.findUnique({
      where: { buildId },
      select: { title: true, designDoc: true, buildPlan: true },
    });
    if (buildRow) {
      const designDoc = buildRow.designDoc as
        | { problemStatement?: string; proposedApproach?: string }
        | null;
      const { generateChangeNarrative } = await import("./change-narrative");
      changeNarrative = await generateChangeNarrative({
        title: buildRow.title,
        goal: designDoc?.problemStatement ?? designDoc?.proposedApproach ?? null,
        planText: buildRow.buildPlan ? JSON.stringify(buildRow.buildPlan) : null,
        diff: fullDiff,
      });
    }
  } catch (err) {
    console.warn(
      "[build-pipeline] change-narrative generation skipped:",
      (err as Error)?.message,
    );
  }

  await prisma.featureBuild.update({
    where: { buildId },
    data: {
      diffPatch: fullDiff,
      diffSummary: fullDiff.slice(0, 500),
      gitCommitHashes: commitHashes,
      ...(changeNarrative
        ? {
            changeNarrative:
              changeNarrative as unknown as import("@dpf/db").Prisma.InputJsonValue,
          }
        : {}),
    },
  });

  console.log(
    `[build-pipeline] stepComplete: captured ${fullDiff.length} bytes diff + ${commitHashes.length} commits for ${JSON.stringify(buildId)}`,
  );

  return { ...state, sourceCurrency };
}
