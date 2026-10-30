import type { ToolDefinition } from "@/lib/mcp-tool-types";
import { narrowInitiativeReviewTools, type InitiativeReviewBinding } from "@/lib/mcp-task-review-contract";
import { immutablePageReaderForArtifact } from "./terminal-tool-policy";
import { ReassessmentExecutionError } from "@/lib/routing/reassessment-execution-scope";

export type AutonomousWorkUserContext = {
  userId?: string;
  platformRole: string | null;
  isSuperuser: boolean;
};

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
  /** Server-owned admitted binding. Narrows already-authorized tools before runtime probes. */
  restrictedReviewBinding?: InitiativeReviewBinding;
  /** Server-owned finite CE preparation; resolves only its registered readers without ambient runtime probes. */
  restrictedEngagementBinding?: import("../coworker-service-catalog/engagement-task-binding").EngagementTaskBinding;
  /** Current server-resolved scheduled commission; never copied from model arguments. */
  scheduledReportingMode?: "read-only-history";
  taskRunId?: string;
  threadId?: string;
  roomAuthorizedGrants?: readonly string[] | null;
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
  const normallyAuthorized = await getAvailableTools(input.userContext, {
    mode: input.mode,
    externalAccessEnabled: input.externalAccessEnabled,
    unifiedMode: input.unifiedMode,
    agentId: input.agentId,
    additionalGrants: COWORKER_AUTHORIZED_SURFACE_BASELINE_GRANTS,
    ...(input.roomAuthorizedGrants ? { roomAuthorizedGrants: input.roomAuthorizedGrants } : {}),
  });

  const { isScheduledReportingRead } = await import("@/lib/operate/scheduled-jobs/scheduled-reporting-contract");
  const reportingUserId = input.userContext.userId;
  if (input.taskRunId && !reportingUserId) throw new Error("Scheduled reporting requires its authenticated owner.");
  const reporting = input.taskRunId && reportingUserId ? await (await import("@/lib/operate/scheduled-jobs/scheduled-reporting-authority"))
    .resolveScheduledReportingContext(reportingUserId, { taskRunId: input.taskRunId, threadId: input.threadId, agentId: input.agentId }) : null;
  if (input.taskRunId && input.scheduledReportingMode && reporting?.mode !== input.scheduledReportingMode) {
    throw new Error("Scheduled reporting requires its current persisted commission.");
  }
  const authorized = (reporting?.mode ?? input.scheduledReportingMode) === "read-only-history"
    ? normallyAuthorized.filter(isScheduledReportingRead) : normallyAuthorized;

  if (input.restrictedEngagementBinding) {
    const { parseEngagementTaskBinding, ENGAGEMENT_READ_TOOLS } = await import("../coworker-service-catalog/engagement-task-binding");
    const binding = parseEngagementTaskBinding(input.restrictedEngagementBinding), names = new Set(input.requiredToolNames ?? []);
    if (!binding?.presentAssessment || names.size !== ENGAGEMENT_READ_TOOLS.length
      || ENGAGEMENT_READ_TOOLS.some(name => !names.has(name) || !authorized.some(tool => tool.name === name))) {
      throw new Error("engagement-present-tool-surface-unavailable");
    }
    const tools = authorized.filter(tool => names.has(tool.name));
    return { tools, toolsForProvider: toolsToOpenAIFormat(tools), deferredTools: [] };
  }
  if (input.restrictedReviewBinding) {
    const binding = input.restrictedReviewBinding;
    const names = [immutablePageReaderForArtifact(binding.artifactRef), binding.writerToolName];
    const requested = new Set(input.requiredToolNames ?? []);
    if (requested.size !== 2 || names.some(name => !requested.has(name) || !authorized.some(tool => tool.name === name))) {
      throw new ReassessmentExecutionError("reassessment-tool-surface-unavailable", "The exact reader and writer must both be normally authorized; auxiliary tools cannot join this surface.");
    }
    return narrowInitiativeReviewTools({ tools: authorized, toolsForProvider: toolsToOpenAIFormat(authorized), deferredTools: [] },
      names, binding, input.intentQuery);
  }

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
      REQUIRED_TOOL_PIN_CAPACITY,
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
      ]),
      // BI-EC82C48B: the run's required tools rank ABOVE the generic surface
      // inside the cap. They used to share tier 0 with routeDomainToolNames and
      // every AUTHORIZED_SURFACE_TOOL_NAME, so when that set alone exceeded the
      // cap the writer competed with the surface on intent relevance and could
      // lose — and narrowInitiativeReviewTools then filtered the attached set to
      // required names only, handing the model zero tools.
      requiredNames: new Set((input.requiredToolNames ?? []).slice(0, REQUIRED_TOOL_PIN_CAPACITY)),
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

