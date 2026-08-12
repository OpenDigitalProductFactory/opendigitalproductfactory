import type {
  SurfaceActionDefinition,
  SurfacePrincipalContext,
} from "@dpf/types";

import { getDiscoveryOperationsViewModel } from "@/lib/discovery-operations-view-model";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

import { compileSurfaceDefinitions, surfaceContractDigest } from "./authorized-surface-compiler";
import { observeAuthorizedSurface } from "./authorized-surface-observability";
import { createAuthorizedSurfaceRuntime, type SurfaceDomainActionResult } from "./authorized-surface-runtime";
import {
  DISCOVERY_OPERATIONS_LOADER_ID,
  DISCOVERY_OPERATIONS_SURFACE,
  projectDiscoveryOperationsSurface,
} from "./surfaces/discovery-operations-surface";

export const ALL_SURFACE_DEFINITIONS = [DISCOVERY_OPERATIONS_SURFACE] as const;

const loaders = new Map([
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

type ServerSurfaceContext = SurfacePrincipalContext & {
  [AUTHORIZED_TOOL_NAMES]: ReadonlySet<string>;
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
  },
): SurfacePrincipalContext {
  const serverContext = { ...context } as ServerSurfaceContext;
  Object.defineProperties(serverContext, {
    [AUTHORIZED_TOOL_NAMES]: { value: authority.authorizedToolNames, enumerable: false },
    [GOVERNED_DISPATCH]: { value: authority.governedDispatch, enumerable: false },
  });
  return serverContext;
}

function serverContext(context: SurfacePrincipalContext): ServerSurfaceContext {
  return context as ServerSurfaceContext;
}

export const authorizedSurfaceRuntime = createAuthorizedSurfaceRuntime({
  catalog: AUTHORIZED_SURFACE_CATALOG,
  loaders,
  authorizeSurface: async () => true,
  authorizeAction: async (context, action) =>
    action.actionClass === "ui-local"
    || (!!action.tool && serverContext(context)[AUTHORIZED_TOOL_NAMES]?.has(action.tool)),
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
