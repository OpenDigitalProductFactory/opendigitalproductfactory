import { randomUUID } from "crypto";
import { prisma } from "@dpf/db";
import type { Prisma } from "@dpf/db";
import type { MessageOrigin } from "@/lib/inference/data-screening/types";
import type { ChatMessage } from "@/lib/ai-inference";
import { resolveCoworkerReviewPattern } from "@/lib/golden-triangle/coworker-review";
import { reviewCoworkerDraft } from "@/lib/tak/coworker-inline-review";
import type { ToolDefinition, ToolResult } from "@/lib/mcp-tools";
import type { AgentEvent } from "@/lib/tak/agent-event-bus";
import type { ResolvedDelegatedPosture } from "@/lib/proactivity/delegated-posture";
import type { ProactivityPlan } from "@/lib/proactivity/proactivity-types";
import { admitRuntimeGuardedWork } from "@/lib/platform-runtime/work-admission";
import type { RouteSensitivity } from "@/lib/agent-sensitivity";
import type { SurfaceMode, SurfacePrincipalContext } from "@dpf/types";

/** Best-effort latest user-turn text, for the reviewer's context. */
function lastUserRequest(history: ChatMessage[]): string {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m && m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

export type AutonomousWorkTrigger =
  | "interactive"
  | "scheduled"
  | "external-mcp"
  | "build"
  | "deliberation"
  | "radar"
  | "system-recovery"
  | "capacity-continuity";

export type AutonomousWorkRunRef = {
  id: string;
  taskRunId: string;
  contextId: string | null;
};

export type AutonomousWorkUserContext = {
  userId?: string;
  platformRole: string | null;
  isSuperuser: boolean;
};

type AgentPromptInfo = {
  agentId?: string | null;
  systemPrompt: string;
  sensitivity?: RouteSensitivity | null;
  [key: string]: unknown;
};

export type AutonomousWorkRunInput = {
  trigger: AutonomousWorkTrigger;
  /** Server-derived public identity for idempotent external work. */
  taskRunId?: string;
  userId: string;
  agentId: string;
  routeContext: string;
  title: string;
  objective: string;
  prompt: string;
  threadId?: string | null;
  parentTaskRunId?: string | null;
  authorityScope?: string[];
  sourceRef?: {
    kind: string;
    id: string;
  };
  metadata?: Record<string, unknown>;
  proactivity?: ProactivityPlan;
  delegatedPosture?: ResolvedDelegatedPosture;
  /**
   * Server-owned authorization recheck executed inside the same transaction as
   * TaskRun creation. Never expose this callback through an MCP or browser
   * payload; it exists for authority lanes that must serialize alternate keys.
   */
  admissionGuard?: (tx: Prisma.TransactionClient) => Promise<void>;
  transactionIsolationLevel?: Prisma.TransactionIsolationLevel;
  /**
   * Closed deferred callers may commit their first user message in the same
   * transaction as the submitted TaskRun. This prevents an outbox-recoverable
   * row from existing without the immutable input needed by its worker.
   */
  deferredSubmission?: {
    content: string;
    metadata?: Record<string, unknown>;
    progressPayload?: Prisma.InputJsonValue;
  };
};

const TRIGGER_PREFIX: Record<AutonomousWorkTrigger, string> = {
  interactive: "CHAT",
  scheduled: "SCHED",
  "external-mcp": "MCP",
  build: "BUILD",
  deliberation: "DELIB",
  radar: "RADAR",
  "system-recovery": "RECOV",
  "capacity-continuity": "CAP",
};

function taskRunSourceForTrigger(trigger: AutonomousWorkTrigger): string {
  if (trigger === "interactive") return "coworker";
  if (trigger === "build") return "build";
  if (trigger === "deliberation") return "skill";
  return "proactive";
}

function initialStatusForTrigger(trigger: AutonomousWorkTrigger): string {
  return trigger === "interactive" ? "submitted" : "working";
}

function createPublicTaskRunId(trigger: AutonomousWorkTrigger): string {
  return `TR-${TRIGGER_PREFIX[trigger]}-${randomUUID().slice(0, 8).toUpperCase()}`;
}

export async function createAutonomousWorkRun(
  input: AutonomousWorkRunInput,
): Promise<AutonomousWorkRunRef> {
  if (input.deferredSubmission && input.trigger !== "external-mcp") {
    throw new Error("Deferred submission is restricted to external MCP work.");
  }
  const threadId = input.threadId ?? null;
  const a2aMetadata = {
    trigger: input.trigger,
    ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
    ...(input.metadata ?? {}),
    ...(input.proactivity ? { proactivity: input.proactivity } : {}),
    ...(input.delegatedPosture ? { delegatedPosture: input.delegatedPosture } : {}),
  } as Prisma.InputJsonValue;

  return prisma.$transaction(async (tx) => {
    const source = taskRunSourceForTrigger(input.trigger);
    await admitRuntimeGuardedWork(tx as never, `task-run:${source}`);
    await input.admissionGuard?.(tx);
    const taskRun = await tx.taskRun.create({
      data: {
        taskRunId: input.taskRunId ?? createPublicTaskRunId(input.trigger),
        userId: input.userId,
        threadId,
        contextId: threadId,
        initiatingAgentId: input.agentId,
        currentAgentId: input.agentId,
        parentTaskRunId: input.parentTaskRunId ?? null,
        routeContext: input.routeContext,
        title: input.title,
        objective: input.objective.slice(0, 1000),
        source,
        status: input.deferredSubmission ? "submitted" : initialStatusForTrigger(input.trigger),
        authorityScope: input.authorityScope ?? [],
        a2aMetadata,
        ...(input.deferredSubmission?.progressPayload
          ? { progressPayload: input.deferredSubmission.progressPayload }
          : {}),
      },
      select: { id: true, taskRunId: true, contextId: true },
    });
    if (input.deferredSubmission) {
      await tx.taskMessage.create({
        data: {
          id: randomUUID(),
          messageId: `tm_${randomUUID()}`,
          taskRunId: taskRun.id,
          contextId: taskRun.contextId,
          role: "user",
          parts: [{ type: "message", text: input.deferredSubmission.content }],
          referenceTaskIds: [],
          ...(input.deferredSubmission.metadata
            ? { metadata: input.deferredSubmission.metadata as Prisma.InputJsonValue }
            : {}),
        },
      });
    }
    return taskRun;
  }, { isolationLevel: input.transactionIsolationLevel ?? "Serializable" });
}

export async function findCurrentAutonomousWorkRun(input: {
  userId: string;
  threadId: string;
}): Promise<{ taskRunId: string } | null> {
  return prisma.taskRun.findFirst({
    where: {
      userId: input.userId,
      threadId: input.threadId,
      archivedAt: null,
    },
    orderBy: [{ startedAt: "desc" }, { createdAt: "desc" }],
    select: { taskRunId: true },
  });
}

export async function resolveAutonomousWorkAgent(input: {
  agentId: string;
  routeContext: string;
  userContext: AutonomousWorkUserContext;
  /**
   * EP-COWORKER-LIFECYCLE Phase 3: the certification runner passes
   * "certification" to bypass the lifecycle gate — certifying is how a
   * draft/failed coworker earns activation, so gating it would deadlock.
   */
  purpose?: "autonomous" | "certification";
}): Promise<AgentPromptInfo> {
  // Lifecycle gate (Phase 3, BI-2C4056BF): scheduled tasks, spawned child
  // threads, and remote MCP task submission all resolve here — a draft or
  // retired coworker must not execute autonomous work.
  const { evaluateLifecycleGate } = await import("@/lib/coworker-lifecycle/lifecycle-gate");
  const verdict = await evaluateLifecycleGate(input.agentId, {
    purpose: input.purpose ?? "autonomous",
  });
  if (!verdict.allowed) {
    throw new Error(`COWORKER_NOT_SUMMONABLE: ${verdict.reason}`);
  }

  const { resolveAgentByIdWithPrompts, resolveAgentForRouteWithPrompts } = await import(
    "@/lib/tak/agent-routing-server"
  );
  const routedAgentInfo = await resolveAgentForRouteWithPrompts(
    input.routeContext,
    input.userContext,
  ) as AgentPromptInfo;

  if (routedAgentInfo.agentId === input.agentId) {
    return routedAgentInfo;
  }

  return resolveAgentByIdWithPrompts(input.agentId, input.userContext) as Promise<AgentPromptInfo>;
}

export async function resolveAutonomousWorkTools(input: {
  userContext: AutonomousWorkUserContext;
  agentId: string;
  mode?: "advise" | "act";
  externalAccessEnabled?: boolean;
  unifiedMode?: boolean;
  /** Route the autonomous work runs under; its declared domain tools are
   *  force-attached (tier 0), mirroring the interactive path (BI-B5C358B1). */
  routeContext?: string;
  /** The task objective/prompt. When present, tools are ranked by relevance to
   *  it within each priority tier so the attachment cap keeps the tools this
   *  run actually needs (BI-ACE1EBA4). */
  intentQuery?: string;
  /** Exact tools declared by a governed workflow packet. They remain subject to
   *  the normal user/agent grant filter above; this only keeps already-authorized
   *  schemas inside the attachment budget so the model never has to discover a
   *  known governed writer through the public marketplace. */
  requiredToolNames?: readonly string[];
}): Promise<{
  tools: ToolDefinition[];
  toolsForProvider: Array<Record<string, unknown>>;
  /** Authorized tools held back from the schema payload; still callable via the
   *  load_tools meta-tool. Empty when no budget applied (fail-open). */
  deferredTools: ToolDefinition[];
}> {
  const { getAvailableTools, toolsToOpenAIFormat } = await import("@/lib/mcp-tools");
  const { COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS } = await import(
    "@/lib/coworker/authorized-surface-coworker-contract"
  );
  const authorized = await getAvailableTools(input.userContext, {
    mode: input.mode,
    externalAccessEnabled: input.externalAccessEnabled,
    unifiedMode: input.unifiedMode,
    agentId: input.agentId,
    additionalGrants: COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS,
  });

  // BI-CAP-F2D39F8F: right-size the ATTACHMENT for autonomous runs with the
  // SAME budget the interactive path uses (coworker-tool-budget). A scheduled
  // coworker's grants expand to ~100+ tools (~30k+ tokens of schema), which can
  // never fit a budget local model's served window — every scheduled tick then
  // dies on admission/overflow (live repro: TR-SCHED-B7151A4C). Authority is
  // untouched: deferred tools stay authorized and loadable via load_tools.
  // Fail-open — any budget error falls back to the full authorized surface.
  try {
    const {
      selectCoworkerToolBudget,
      deriveCoworkerToolCap,
      LOAD_TOOLS_TOOL,
      LOAD_TOOLS_TOOL_NAME,
    } =
      await import("@/lib/actions/coworker-tool-budget");
    const { AUTHORIZED_SURFACE_TOOL_NAMES } = await import(
      "@/lib/coworker/authorized-surface-coworker-contract"
    );
    const { getAgentToolGrantsAsync } = await import("@/lib/tak/agent-grants");
    const { resolveLocalServingPosture } = await import(
      "@/lib/inference/local-model-context-reconcile"
    );
    const { resolveLocalToolFidelityCeiling } = await import("@/lib/routing/local-tool-fidelity");

    const [roleGrants, localPosture, measuredToolFidelityCeiling] = await Promise.all([
      getAgentToolGrantsAsync(input.agentId),
      resolveLocalServingPosture(),
      resolveLocalToolFidelityCeiling(),
    ]);
    const cap = deriveCoworkerToolCap(localPosture.servedContextTokens, {
      measuredToolFidelityCeiling,
      localPresence: localPosture.presence,
    });

    let routeDomainToolNames: string[] = [];
    if (input.routeContext) {
      const { resolveRouteContext } = await import("@/lib/tak/route-context-map");
      routeDomainToolNames = resolveRouteContext(input.routeContext).domainTools ?? [];
    }

    // When the surface will be deferred, load_tools is prepended below — reserve
    // its slot so the TOTAL (incl. load_tools) never exceeds the cap, which is
    // also the routing layer's local-fallback gate.
    const effectiveCap = authorized.length > cap ? Math.max(1, cap - 1) : cap;
    const { attached, deferred } = selectCoworkerToolBudget({
      tools: authorized,
      roleGrants,
      // BI-95D74DE9 — surface tools and the run's required tools take tier-0
      // PRIORITY within the cap, not exemption from it. As alwaysIncludeNames
      // they attached unconditionally, putting a floor of up to 11 under the
      // surface whatever the cap said, which exceeds what the routing gate will
      // run once a measured ceiling drops the cap below that. If a cap cannot
      // fit a run's required tools, the honest signal is a surface too small for
      // the run — not a surface the gate then refuses outright.
      pageActionNames: new Set([
        ...routeDomainToolNames,
        ...AUTHORIZED_SURFACE_TOOL_NAMES,
        ...(input.requiredToolNames ?? []).slice(0, 4),
      ]),
      alwaysIncludeNames: new Set([LOAD_TOOLS_TOOL_NAME]),
      cap: effectiveCap,
      intentQuery: input.intentQuery,
    });
    const tools = deferred.length > 0 ? [LOAD_TOOLS_TOOL, ...attached] : attached;
    if (deferred.length > 0) {
      console.log(
        `[autonomous-tool-budget] agent=${JSON.stringify(input.agentId)} authorized=${authorized.length} ` +
          `attached=${tools.length} deferred=${deferred.length} cap=${cap} localPresence=${localPosture.presence}`,
      );
    }
    return {
      tools,
      toolsForProvider: toolsToOpenAIFormat(tools),
      deferredTools: deferred,
    };
  } catch (err) {
    console.warn(
      "[autonomous-tool-budget] budget failed (fail-open to full surface):",
      err instanceof Error ? err.message : err,
    );
    return {
      tools: authorized,
      toolsForProvider: toolsToOpenAIFormat(authorized),
      deferredTools: [],
    };
  }
}

export async function executeAutonomousAgenticLoop(input: {
  systemPrompt: string;
  /** Instruction spans within `systemPrompt`, forwarded to routing (BI-463BE12A). */
  systemPromptInstructionSpans?: string[];
  /** What each entry of `chatHistory` is — labels only (BI-40EF7C44). */
  messageOrigins?: readonly MessageOrigin[];
  chatHistory: ChatMessage[];
  sensitivity: RouteSensitivity;
  tools: ToolDefinition[];
  toolsForProvider?: Array<Record<string, unknown>>;
  /** Authorized-but-not-attached tools forwarded to runAgenticLoop for on-demand
   *  load_tools. Empty/undefined for non-chat callers (behavior unchanged). */
  deferredTools?: ToolDefinition[];
  userId: string;
  routeContext: string;
  agentId: string;
  threadId: string;
  taskRunId?: string | null;
  taskType?: string;
  /** EP-27FD96BC · P1 — unified per-turn effort warrant, forwarded to the loop. */
  effortWarrant?: import("@/lib/tak/effort-warrant").EffortWarrant;
  /** Evidence-first bounded workflow for an immutable initiative review. */
  terminalToolPolicy?: import("@/lib/tak/terminal-tool-policy").TerminalToolPolicy;
  agentDisplayName?: string;
  buildPhase?: string | null;
  featureBuildId?: string | null;
  modelRequirements?: Record<string, unknown>;
  apiTokenId?: string | null;
  tokenScope?: "read" | "write" | "admin";
  /**
   * Governed Hermes learning Slice 1: when the user message invokes a specific
   * coworker skill (via the canonical `Use the <id> skill.` marker), the
   * caller threads its skillId through here so subsequent ToolExecution rows
   * can be attributed to the active skill.
   */
  activeSkillId?: string | null;
  /**
   * Pre-allocated AgentMessage id for the assistant turn this loop is
   * producing. Threaded through to AdapterRunTelemetry so badge / cost-rollup
   * queries can join telemetry rows to the resulting AgentMessage row even
   * though the row itself is persisted by the caller after the loop returns.
   */
  agentMessageId?: string | null;
  /**
   * Distinguish autonomous phase execution from interactive chat. Forwarded
   * to runAgenticLoop. Defaults to "autonomous" to preserve prior behavior;
   * interactive chat callers (agent-coworker sendMessage) must pass "chat"
   * so Operator Contract guards do not false-positive on conversational
   * replies. See agentic-loop.ts param doc.
   */
  interactionMode?: "chat" | "autonomous";
  /** Optional renderer-neutral surface identity for workroom/resource/task
   * callers. Route-only browser and background callers are derived by default. */
  surfaceContext?: {
    mode?: SurfaceMode;
    locale?: string;
    timezone?: string;
    organizationId?: string;
    workContext?: SurfacePrincipalContext["workContext"];
  };
  /** BI-80532D5C — divert side-effecting non-artifact tool calls to proposals
   *  (propose boundary). Forwarded verbatim to runAgenticLoop. */
  proposeSideEffects?: boolean;
  onProgress?: (event: AgentEvent) => void;
}) {
  const { runAgenticLoop } = await import("@/lib/tak/agentic-loop");
  const { withInferenceOrigin } = await import("@/lib/inference/inference-admission");

  // Capture before-run timestamp so the post-run reflection trigger only
  // considers PlatformIssueReport rows this run produced.
  const startedAt = new Date();

  // BI-744D583B (EP-COMPETENCE-FLYWHEEL): ground the AUTONOMOUS path in
  // profession (WSID) corpus. The interactive chat path injects the corpus into
  // its own prompt assembly upstream and passes interactionMode "chat"; every
  // autonomous caller (dispatcher child threads, scheduled self-tasks, remote
  // MCP task submission) reaches this single seam with a pre-assembled prompt
  // that never carried the corpus — so a build-lane coworker worked without its
  // craft knowledge. Gate on !== "chat" so chat is never double-injected. Total
  // + fail-open: on any error the original prompt is used unchanged.
  let systemPrompt = input.systemPrompt;
  // Instruction spans are computed by the CALLER from the persona, before the
  // groundings below append to the prompt. AUTHORIZED_SURFACE_PROMPT is listed
  // as INSTRUCTION by the provenance design, but it is appended here — after
  // the caller computed its spans — so it landed in the data remainder and was
  // screened as payload (BI-D9D661ED). Collect it and declare it.
  const groundedInstructionSpans: string[] = [];
  if (input.interactionMode !== "chat") {
    const { groundPromptWithProfessionCorpus, defaultProfessionGroundingDeps } = await import(
      "@/lib/tak/profession-grounding"
    );
    const grounding = await groundPromptWithProfessionCorpus(
      {
        systemPrompt,
        agentId: input.agentId,
        query: lastUserRequest(input.chatHistory),
        routeContext: input.routeContext,
      },
      defaultProfessionGroundingDeps,
    ).catch(() => ({ systemPrompt, grounded: false }));
    // The profession corpus is deliberately NOT declared instruction: the
    // ratified provenance design lists retrieved corpus content as DATA, since
    // a corpus can carry real values. Only statically-authored platform
    // instruction is labelled here.
    systemPrompt = grounding.systemPrompt;
  }

  // Authorized Surface Contract: prehydrate the current semantic UX at the one
  // seam shared by chat, workroom, scheduled, background, and external turns.
  // This makes page truth available even when the selected model cannot call
  // tools. The runtime applies the same principal/action authorization first;
  // failures and uncovered routes leave the original prompt unchanged.
  const { groundPromptWithAuthorizedSurface } = await import(
    "@/lib/coworker/authorized-surface-prompt-grounding"
  );
  const authorizedToolNames = new Set([
    ...input.tools.map((tool) => tool.name),
    ...(input.deferredTools ?? []).map((tool) => tool.name),
  ]);
  const surfaceGrounding = await groundPromptWithAuthorizedSurface({
    systemPrompt,
    context: {
      delegatingUserId: input.userId,
      actingAgentId: input.agentId,
      mode: input.surfaceContext?.mode ?? (input.interactionMode === "chat" ? "browser" : "background"),
      locale: input.surfaceContext?.locale ?? "en-US",
      timezone: input.surfaceContext?.timezone ?? "UTC",
      route: input.routeContext,
      ...(input.surfaceContext?.organizationId ? { organizationId: input.surfaceContext.organizationId } : {}),
      ...(input.surfaceContext?.workContext ? { workContext: input.surfaceContext.workContext } : {}),
    },
    authorizedToolNames,
  }).catch(() => ({ systemPrompt, grounded: false as const }));
  systemPrompt = surfaceGrounding.systemPrompt;
  if ("instructionBlock" in surfaceGrounding && surfaceGrounding.instructionBlock) {
    groundedInstructionSpans.push(surfaceGrounding.instructionBlock);
  }
  const { isAuthorizedSurfaceGuidanceRequest } = await import(
    "@/lib/coworker/authorized-surface-prompt-grounding"
  );
  const surfaceGuidanceOnly = surfaceGrounding.grounded
    && isAuthorizedSurfaceGuidanceRequest(lastUserRequest(input.chatHistory));
  const authorizedGuidanceHighlights = "guidanceHighlights" in surfaceGrounding
    ? surfaceGrounding.guidanceHighlights ?? []
    : [];
  const toolsForProvider = surfaceGuidanceOnly ? undefined : input.toolsForProvider;

  // This is the single seam both interactive chat (interactionMode "chat") and
  // autonomous work (scheduled self-tasks, build phases, system tasks) flow
  // through. Tag the inference origin here so the admission gate in callProvider
  // gives human turns priority over background work on a shared engine. Chat →
  // interactive; everything else → autonomous (matching the "autonomous" default).
  const inferenceOrigin = input.interactionMode === "chat" ? "interactive" : "autonomous";

  let result: Awaited<ReturnType<typeof runAgenticLoop>>;
  try {
    result = await withInferenceOrigin(inferenceOrigin, () =>
      runAgenticLoop({
        systemPrompt,
        systemPromptInstructionSpans: [
          ...(input.systemPromptInstructionSpans ?? []),
          ...groundedInstructionSpans,
        ],
        chatHistory: input.chatHistory,
        messageOrigins: input.messageOrigins,
        sensitivity: input.sensitivity,
        tools: input.tools,
        toolsForProvider,
        deferredTools: input.deferredTools,
        userId: input.userId,
        routeContext: input.routeContext,
        agentId: input.agentId,
        threadId: input.threadId,
        taskRunId: input.taskRunId,
        apiTokenId: input.apiTokenId,
        tokenScope: input.tokenScope,
        taskType: input.taskType,
        effortWarrant: input.effortWarrant,
        terminalToolPolicy: input.terminalToolPolicy,
        agentDisplayName: input.agentDisplayName,
        buildPhase: input.buildPhase,
        featureBuildId: input.featureBuildId,
        activeSkillId: input.activeSkillId ?? null,
        agentMessageId: input.agentMessageId ?? null,
        interactionMode: input.interactionMode,
        proposeSideEffects: input.proposeSideEffects ?? false,
        allowToolFreeInference: surfaceGuidanceOnly,
        ...(input.modelRequirements ? { modelRequirements: input.modelRequirements } : {}),
        onProgress: input.onProgress,
      }),
    );
  } finally {
    const { closeAuthorizedSurfacePromptGrounding } = await import(
      "@/lib/coworker/authorized-surface-prompt-grounding"
    );
    await closeAuthorizedSurfacePromptGrounding(
      "sessionId" in surfaceGrounding ? surfaceGrounding.sessionId : undefined,
      {
        delegatingUserId: input.userId,
        actingAgentId: input.agentId,
      },
    );
  }

  // EP-GOLDEN-TRIANGLE: leverage the rigor ladder. This is the SINGLE seam for both
  // chat and autonomous coworker turns. When the coworker's posture sits high on
  // Quality/effort, run one deliberation pass over the draft before it's returned —
  // a "review" (critique → improve) or a "debate" (steelman for/against → synthesize),
  // per the compiled posture. Fail-open (original draft on any error); skipped for
  // proposals and for Balanced/low postures. (The full multi-agent deliberation
  // engine — minutes-long, build-artifact-coupled — stays the build-phase mechanism;
  // this is the synchronous, output-revising leverage for coworker turns.)
  if (result.content && !result.proposal) {
    try {
      const pattern = await resolveCoworkerReviewPattern(input.agentId);
      if (pattern === "review" || pattern === "debate") {
        const verdict = await reviewCoworkerDraft({
          userRequest: lastUserRequest(input.chatHistory),
          draft: result.content,
          sensitivity: input.sensitivity,
          pattern,
        });
        if (verdict.revised) result.content = verdict.content;
      }
    } catch (err) {
      console.warn("[golden-triangle] coworker deliberation (unified seam) failed (fail-open):", err);
    }
  }

  // Prompt instructions are advisory; exact UX labels are contractual. A
  // model can answer correctly in substance while paraphrasing away a field
  // or composite action. Enforce the authorization-filtered surface summary
  // after any deliberation pass so the final response cannot lose those facts.
  if (surfaceGuidanceOnly && result.content) {
    const { enforceAuthorizedSurfaceGuidanceCoverage } = await import(
      "@/lib/coworker/authorized-surface-prompt-grounding"
    );
    result.content = enforceAuthorizedSurfaceGuidanceCoverage(
      result.content,
      authorizedGuidanceHighlights,
    );
  }

  // Governed Hermes learning Slice 2: fire-and-forget reflection trigger.
  // Inspects PlatformIssueReport rows produced during this run and emits
  // self-assessment + capability-need + ImprovementSignal evidence per row.
  // The trigger has its own three-layer loop guard (source check, depth
  // guard, signal-layer dedupe) — see reflection-triggers.ts. Void-style
  // so a slow reflection cannot delay the user response.
  void (async () => {
    try {
      const { processRuntimeIssueReflection } = await import(
        "@/lib/tak/reflection-triggers"
      );
      await processRuntimeIssueReflection({
        taskRunId: input.taskRunId ?? null,
        userId: input.userId,
        agentId: input.agentId,
        threadId: input.threadId,
        routeContext: input.routeContext,
        since: startedAt,
      });
    } catch (err) {
      console.warn(
        "[reflection-triggers] post-run hook failed:",
        err instanceof Error ? err.message : err,
      );
    }
  })();

  // Governed adaptive playbooks foundation: observe repeated work patterns
  // after the run and emit evidence-backed capability needs. This is
  // observability/proposal only; it must never mutate prompts, skills, grants,
  // model routes, or Work Case state.
  void (async () => {
    try {
      const { observeWorkPatternsAfterRun } = await import(
        "@/lib/tak/pattern-observer-service"
      );
      const foundationResult = await observeWorkPatternsAfterRun({
        taskRunId: input.taskRunId ?? null,
        userId: input.userId,
        agentId: input.agentId,
        threadId: input.threadId,
        routeContext: input.routeContext,
        since: startedAt,
      });
      if (
        foundationResult.skippedReason !== "reflection-loop-guard" &&
        foundationResult.skippedReason !== "missing-task-run"
      ) {
        const { observeCoworkerPatterns } = await import(
          "@/lib/tak/pattern-observer/observer"
        );
        await observeCoworkerPatterns({
          agentId: input.agentId,
          routeContext: input.routeContext,
          since: startedAt,
          toolSurface: input.toolsForProvider ?? input.tools,
        });
      }
    } catch (err) {
      console.warn(
        "[pattern-observer] post-run hook failed:",
        err instanceof Error ? err.message : err,
      );
    }
  })();

  return { ...result, authoritativeSurfaceEvidence: surfaceGuidanceOnly };
}

export async function executeAutonomousWorkTool(input: {
  toolName: string;
  args: Record<string, unknown>;
  userId: string;
  userContext: AutonomousWorkUserContext;
  routeContext: string;
  agentId: string;
  threadId: string;
  taskRunId: string;
  apiTokenId?: string | null;
  tokenScope?: "read" | "write" | "admin";
  externalAccessEnabled?: boolean;
}): Promise<ToolResult> {
  const { governedExecuteTool } = await import("@/lib/mcp-governed-execute");

  return governedExecuteTool({
    toolName: input.toolName,
    rawParams: input.args,
    userId: input.userId,
    userContext: input.userContext,
    source: "agentic-loop",
    context: {
      routeContext: input.routeContext,
      agentId: input.agentId,
      threadId: input.threadId,
      taskRunId: input.taskRunId,
      apiTokenId: input.apiTokenId ?? undefined,
      tokenScope: input.tokenScope,
      externalAccessEnabled: input.externalAccessEnabled,
    },
  });
}
