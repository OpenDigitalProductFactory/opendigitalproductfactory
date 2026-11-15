import type {
  SurfaceActionDefinition,
  SurfaceDefinition,
  SurfacePrincipalContext,
} from "@dpf/types";
import { prisma } from "@dpf/db";

import { getDiscoveryOperationsViewModel } from "@/lib/discovery-operations-view-model";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";
import { currentUserContext } from "@/lib/govern/current-user-context";
import { can } from "@/lib/govern/permissions";
import { FINANCE_EXPENSE_GUIDANCE_ID, FINANCE_EXPENSE_GUIDANCE_LOADER, FINANCE_EXPENSE_GUIDANCE_ROUTES,
  FINANCE_EXPENSE_GUIDANCE_SURFACE, projectExpenseWorkflowGuidance } from "./surfaces/finance-expense-guidance-surface";

import { compileSurfaceDefinitions, surfaceContractDigest } from "./authorized-surface-compiler";
import { observeAuthorizedSurface } from "./authorized-surface-observability";
import { createAuthorizedSurfaceRuntime, type SurfaceDomainActionResult } from "./authorized-surface-runtime";
import {
  DISCOVERY_OPERATIONS_LOADER_ID,
  DISCOVERY_OPERATIONS_SURFACE,
  projectDiscoveryOperationsSurface,
} from "./surfaces/discovery-operations-surface";

import { getResponseFeedback } from "@/lib/routing/response-feedback";
import { RESPONSE_FEEDBACK_LOADER_ID, RESPONSE_FEEDBACK_SURFACE, projectResponseFeedbackSurface } from "./surfaces/response-feedback-surface";
import { readPlatformFundingSetup } from "@/lib/portfolio/platform-funding-setup";
import { PLATFORM_FUNDING_SETUP_ID, PLATFORM_FUNDING_SETUP_LOADER_ID, PLATFORM_FUNDING_SETUP_SURFACE,
  fundingSetupCanConfirm, projectPlatformFundingSetupSurface } from "./surfaces/platform-funding-setup-surface";

export const ALL_SURFACE_DEFINITIONS = [DISCOVERY_OPERATIONS_SURFACE, RESPONSE_FEEDBACK_SURFACE, FINANCE_EXPENSE_GUIDANCE_SURFACE, PLATFORM_FUNDING_SETUP_SURFACE] as const;

const loaders = new Map([
  [PLATFORM_FUNDING_SETUP_LOADER_ID, async (context: SurfacePrincipalContext) => projectPlatformFundingSetupSurface(await loadFundingSetup(context))],
  [FINANCE_EXPENSE_GUIDANCE_LOADER, async (context: SurfacePrincipalContext) => projectExpenseWorkflowGuidance(context.locale)],
  [RESPONSE_FEEDBACK_LOADER_ID, async (context: SurfacePrincipalContext) => {
    const ids = context.workContext?.resourceIds;
    if (!serverContext(context)[AUTHORIZED_TOOL_NAMES]?.has("get_response_feedback")
      || context.workContext?.resourceType !== "agent-message" || ids?.length !== 1
      || !ids[0]?.trim() || !context.actingAgentId?.trim()) throw new Error("forbidden");
    return projectResponseFeedbackSurface(await getResponseFeedback(ids[0], {
      userId: context.delegatingUserId, agentId: context.actingAgentId,
    }));
  }],
  [DISCOVERY_OPERATIONS_LOADER_ID, async (context: SurfacePrincipalContext) => {
    const model = await getDiscoveryOperationsViewModel({
      includeConnections: serverContext(context)[AUTHORIZED_TOOL_NAMES]?.has("list_discovery_connections") ?? false,
    });
    return projectDiscoveryOperationsSurface({
      productsLinked: model.products.length,
      needsReview: model.triageQueues.metrics.total,
      latestRun: model.latestRun
        ? {
            runKey: model.latestRun.runKey,
            status: model.latestRun.status,
            itemCount: model.latestRun.itemCount,
            relationshipCount: model.latestRun.relationshipCount,
          }
        : null,
      openIssues: model.openIssues.reduce<Array<{ issueType: string; count: number }>>((issues, issue) => {
        const existing = issues.find((candidate) => candidate.issueType === issue.issueType);
        if (existing) existing.count += 1;
        else issues.push({ issueType: issue.issueType, count: 1 });
        return issues;
      }, []),
      detectedGateway: model.detectedGateway,
      connections: model.connections,
    });
  }],
]);

export const AUTHORIZED_SURFACE_CATALOG = compileSurfaceDefinitions(
  ALL_SURFACE_DEFINITIONS,
  {
    toolNames: new Set(Object.keys(TOOL_TO_GRANTS)),
    loaderIds: new Set(loaders.keys()),
  },
);

const AUTHORIZED_TOOL_NAMES = Symbol("authorized-surface-tool-names");
const GOVERNED_DISPATCH = Symbol("authorized-surface-governed-dispatch");
const CURRENT_TOOL_AUTHORITY = Symbol("authorized-surface-current-tool-authority");

export type CurrentSurfaceToolAuthority = (
  toolName: string,
  principal: Pick<SurfacePrincipalContext, "delegatingUserId" | "actingAgentId">,
) => Promise<boolean>;

type ServerSurfaceContext = SurfacePrincipalContext & {
  [AUTHORIZED_TOOL_NAMES]: ReadonlySet<string>;
  [CURRENT_TOOL_AUTHORITY]?: CurrentSurfaceToolAuthority;
  [GOVERNED_DISPATCH]?: (
    toolName: string,
    params: Record<string, unknown>,
    invocation: { surfaceId: string; sessionId: string; revision: string; actionId: string },
  ) => Promise<SurfaceDomainActionResult>;
};

export function createServerSurfaceContext(
  context: SurfacePrincipalContext,
  authority: {
    authorizedToolNames: ReadonlySet<string>;
    governedDispatch?: ServerSurfaceContext[typeof GOVERNED_DISPATCH];
    /** Server-owned proof for the current request, never the original opening
     * request. Implement with the canonical current grant/token intersection. */
    currentToolAuthority?: CurrentSurfaceToolAuthority;
  },
): SurfacePrincipalContext {
  const serverContext = { ...context } as ServerSurfaceContext;
  Object.defineProperties(serverContext, {
    [AUTHORIZED_TOOL_NAMES]: { value: authority.authorizedToolNames, enumerable: false },
    [GOVERNED_DISPATCH]: { value: authority.governedDispatch, enumerable: false },
    [CURRENT_TOOL_AUTHORITY]: { value: authority.currentToolAuthority, enumerable: false },
  });
  return serverContext;
}

function serverContext(context: SurfacePrincipalContext): ServerSurfaceContext {
  return context as ServerSurfaceContext;
}

async function fundingSetupAuthorized(context: SurfacePrincipalContext): Promise<boolean> {
  if (!context.actingAgentId?.trim() || !serverContext(context)[AUTHORIZED_TOOL_NAMES]?.has("read_platform_funding_setup")) return false;
  const human = await currentUserContext(context.delegatingUserId);
  return !!human && can(human, "manage_platform") && await currentToolAuthorized(context, "read_platform_funding_setup");
}

async function currentToolAuthorized(context: SurfacePrincipalContext, toolName: string): Promise<boolean> {
  const proof = serverContext(context)[CURRENT_TOOL_AUTHORITY];
  if (!proof) return false;
  try {
    return await proof(toolName, { delegatingUserId: context.delegatingUserId, actingAgentId: context.actingAgentId }) === true;
  } catch { return false; }
}

function refreshSurfaceContext(stored: SurfacePrincipalContext, current: SurfacePrincipalContext | undefined, definition: SurfaceDefinition): SurfacePrincipalContext | null {
  if (!current) return definition.surfaceId === PLATFORM_FUNDING_SETUP_ID ? null : stored;
  if (stored.delegatingUserId !== current.delegatingUserId || stored.actingAgentId !== current.actingAgentId) return null;
  const authority = serverContext(current);
  if (!authority[AUTHORIZED_TOOL_NAMES] || (definition.surfaceId === PLATFORM_FUNDING_SETUP_ID && !authority[CURRENT_TOOL_AUTHORITY])) return null;
  // Keep the admitted route/work context. Only fresh server-private authority
  // and dispatch can replace their original counterparts; raw caller fields
  // cannot redirect this session or provide a token-proof callback.
  return createServerSurfaceContext(stored, {
    authorizedToolNames: authority[AUTHORIZED_TOOL_NAMES],
    governedDispatch: authority[GOVERNED_DISPATCH],
    currentToolAuthority: authority[CURRENT_TOOL_AUTHORITY],
  });
}

async function loadFundingSetup(context: SurfacePrincipalContext) {
  // Recheck before loading, as well as at surface admission. Raw surface args
  // never select another user or act as tool/role authority.
  if (!await fundingSetupAuthorized(context)) return { ok: false as const, error: "funding-setup-not-authorized" };
  return readPlatformFundingSetup(prisma, { userId: context.delegatingUserId });
}

export const authorizedSurfaceRuntime = createAuthorizedSurfaceRuntime({
  catalog: AUTHORIZED_SURFACE_CATALOG,
  loaders,
  refreshContext: refreshSurfaceContext,
  authorizeSurface: async (context, definition) => {
    if (definition.surfaceId === PLATFORM_FUNDING_SETUP_ID) return fundingSetupAuthorized(context);
    if (definition.surfaceId === FINANCE_EXPENSE_GUIDANCE_ID) {
      const human = await currentUserContext(context.delegatingUserId);
      return !!human && can(human, "view_finance") && !!context.actingAgentId?.trim()
        && FINANCE_EXPENSE_GUIDANCE_ROUTES.some(route => route === context.route);
    }
    return definition.surfaceId !== RESPONSE_FEEDBACK_SURFACE.surfaceId
    || (serverContext(context)[AUTHORIZED_TOOL_NAMES]?.has("get_response_feedback") === true
      && context.workContext?.resourceType === "agent-message" && context.workContext.resourceIds?.length === 1
      && !!context.workContext.resourceIds[0]?.trim() && !!context.actingAgentId?.trim());
  },
  authorizeAction: async (context, action) => {
    if (PLATFORM_FUNDING_SETUP_SURFACE.actions.some(({ actionId }) => actionId === action.actionId)) {
      if (!await fundingSetupAuthorized(context)) return false;
      if (action.actionClass === "domain" && (!action.tool || !serverContext(context)[AUTHORIZED_TOOL_NAMES]?.has(action.tool)
        || !await currentToolAuthorized(context, action.tool))) return false;
      if (["platform-funding-confirm", "platform-funding-organization", "platform-funding-reason", "platform-funding-attestation"].includes(action.actionId)) {
        // Node visibility/disabled metadata is not action authority. Current
        // ownership must still permit initial setup before even dispatching the
        // existing writer, which separately verifies digest and human approval.
        return fundingSetupCanConfirm(await loadFundingSetup(context));
      }
      return true;
    }
    return action.actionClass === "ui-local"
      || (!!action.tool && serverContext(context)[AUTHORIZED_TOOL_NAMES]?.has(action.tool));
  },
  authorityDigest: async (context) => surfaceContractDigest({
    organizationId: context.organizationId,
    delegatingUserId: context.delegatingUserId,
    actingAgentId: context.actingAgentId,
    mode: context.mode,
    workContext: context.workContext,
    route: context.route,
    authorizedToolNames: [...(serverContext(context)[AUTHORIZED_TOOL_NAMES] ?? [])].sort(),
  }),
  executeDomainAction: async (
    action: SurfaceActionDefinition,
    params: Record<string, unknown>,
    context: SurfacePrincipalContext,
    invocation,
  ) => {
    if (!action.tool) return { success: false, message: "Surface action has no governed tool binding." };
    const dispatch = serverContext(context)[GOVERNED_DISPATCH];
    if (!dispatch) return { success: false, message: "Governed surface action dispatch is unavailable in this execution mode." };
    return dispatch(action.tool, params, invocation);
  },
  observe: observeAuthorizedSurface,
});
