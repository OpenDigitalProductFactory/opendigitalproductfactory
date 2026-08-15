import type { SurfaceMode, SurfacePrincipalContext } from "@dpf/types";

import { can, type CapabilityKey } from "@/lib/permissions";
import {
  expandGrants,
  getAgentToolGrantsAsync,
  isToolAllowedByGrants,
  TOOL_TO_GRANTS,
} from "@/lib/tak/agent-grants";
import type { ToolDefinition, ToolExecutionContext, ToolResult } from "@/lib/mcp-tools";
import type { ToolPack, ToolPackHandler } from "../tool-pack";

const MODE_VALUES: SurfaceMode[] = [
  "browser", "headless", "workroom", "scheduled", "background", "external", "mobile",
];

const surfaceRegistry = () => import("@/lib/coworker/authorized-surface-registry");

const definitions: ToolDefinition[] = [
  {
    name: "surface_list",
    description: "List relevant Authorized Surfaces available to the current human+coworker principal and route/workroom/task context. Use this instead of guessing what a page or silent workroom surface contains.",
    inputSchema: { type: "object", properties: {
      mode: { type: "string", enum: MODE_VALUES },
      taskIntent: { type: "string" }, workroomType: { type: "string" }, resourceType: { type: "string" },
    }, required: [] },
    requiredCapability: "view_platform", sideEffect: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "surface_open",
    description: "Open a principal-bound Authorized Surface session by stable surface identity or route/task/workroom/mobile entry point. Returns a compact semantic summary, revision, and only currently authorized actions.",
    inputSchema: { type: "object", properties: {
      surfaceId: { type: "string" }, route: { type: "string" }, taskIntent: { type: "string" },
      workroomType: { type: "string" }, resourceType: { type: "string" }, mobileViewId: { type: "string" },
      mode: { type: "string", enum: MODE_VALUES }, locale: { type: "string" }, timezone: { type: "string" },
      workspaceId: { type: "string" }, workroomId: { type: "string" }, resourceIds: { type: "array", items: { type: "string" } },
    }, required: [] },
    requiredCapability: "view_platform", sideEffect: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "surface_snapshot",
    description: "Read the current authorized semantic graph for an open surface session. Values are typed and provenance-tagged; secrets/passwords are never returned.",
    inputSchema: { type: "object", properties: {
      sessionId: { type: "string" },
      sinceRevision: { type: "string", description: "Return a bounded semantic delta from this known revision when available." },
    }, required: ["sessionId"] },
    requiredCapability: "view_platform", sideEffect: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "surface_query",
    description: "Query nodes/actions in an open semantic surface by accessible text or node kind. This reaches authorized virtualized/headless state even when no DOM row is mounted.",
    inputSchema: { type: "object", properties: {
      sessionId: { type: "string" }, text: { type: "string" }, kind: { type: "string" },
      limit: { type: "number", minimum: 1, maximum: 100 },
      cursor: { type: "string", description: "Opaque continuation returned by the preceding surface_query page." },
    }, required: ["sessionId"] },
    requiredCapability: "view_platform", sideEffect: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "surface_act",
    description: "Apply a compiled UI-local transition or execute a governed domain action on an open Authorized Surface. Requires the expected revision; persistent effects re-enter ordinary MCP capability, coworker-grant, token, AuthorityBinding, confirmation, kernel, and audit controls.",
    inputSchema: { type: "object", properties: {
      sessionId: { type: "string" }, actionId: { type: "string" }, expectedRevision: { type: "string" },
      args: { type: "object" }, idempotencyKey: { type: "string" },
    }, required: ["sessionId", "actionId", "expectedRevision"] },
    requiredCapability: "view_platform", executionMode: "immediate", sideEffect: true,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "surface_close",
    description: "Close a principal-bound Authorized Surface session and release its virtual client state.",
    inputSchema: { type: "object", properties: { sessionId: { type: "string" } }, required: ["sessionId"] },
    requiredCapability: "view_platform", sideEffect: false,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

function asString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function mode(params: Record<string, unknown>, context?: ToolExecutionContext): SurfaceMode {
  if (context?.authorizedSurfaceContext?.mode) return context.authorizedSurfaceContext.mode;
  const requested = asString(params, "mode") as SurfaceMode | undefined;
  if (requested && MODE_VALUES.includes(requested)) return requested;
  if (asString(params, "workroomType")) return "workroom";
  if (context?.routeContext) return "browser";
  return context?.apiTokenId ? "external" : "headless";
}

function tokenAllows(
  toolName: string,
  tool: ToolDefinition,
  context: ToolExecutionContext,
): boolean {
  if (!context.apiTokenId) return true;
  const required = TOOL_TO_GRANTS[toolName];
  if (!required) return false;
  const expanded = expandGrants(context.tokenGrantScopes ?? []);
  if (!required.some((grant) => expanded.includes(grant))) return false;
  const requiredScope = required.some((grant) => grant.startsWith("admin_"))
    ? "admin"
    : tool.sideEffect ? "write" : "read";
  if (requiredScope === "read") return true;
  if (requiredScope === "write") return context.tokenScope === "write" || context.tokenScope === "admin";
  return context.tokenScope === "admin";
}

async function authorizedToolNames(context: ToolExecutionContext): Promise<Set<string>> {
  if (!context.agentId || !context.userContext) return new Set();
  const [{ PLATFORM_TOOLS }, grants] = await Promise.all([
    import("@/lib/mcp-tools"),
    getAgentToolGrantsAsync(context.agentId),
  ]);
  return new Set(PLATFORM_TOOLS.filter((tool) => {
    const userAllowed = !tool.requiredCapability
      || can(context.userContext!, tool.requiredCapability as CapabilityKey);
    return userAllowed
      && isToolAllowedByGrants(tool.name, grants)
      && tokenAllows(tool.name, tool, context);
  }).map((tool) => tool.name));
}

async function principalContext(
  params: Record<string, unknown>,
  userId: string,
  context?: ToolExecutionContext,
): Promise<SurfacePrincipalContext | null> {
  if (!context?.agentId || !context.userContext) return null;
  const authorized = await authorizedToolNames(context);
  const server = context.authorizedSurfaceContext;
  const { createServerSurfaceContext } = await surfaceRegistry();
  return createServerSurfaceContext({
    delegatingUserId: userId,
    actingAgentId: context.agentId,
    mode: mode(params, context),
    locale: server?.locale ?? asString(params, "locale") ?? "en-US",
    timezone: server?.timezone ?? asString(params, "timezone") ?? "UTC",
    route: server?.route ?? context.routeContext ?? asString(params, "route"),
    workContext: {
      workspaceId: server?.workspaceId ?? asString(params, "workspaceId"),
      workroomId: server?.workroomId ?? asString(params, "workroomId"),
      workroomType: server?.workroomType ?? asString(params, "workroomType"),
      resourceType: server?.resourceType ?? asString(params, "resourceType"),
      taskIntent: server?.taskIntent ?? asString(params, "taskIntent"),
      resourceIds: server?.resourceIds ?? (Array.isArray(params["resourceIds"])
        ? params["resourceIds"].filter((item): item is string => typeof item === "string")
        : undefined),
    },
  }, {
    authorizedToolNames: authorized,
    governedDispatch: context.governedDispatch
      ? async (toolName, toolParams, invocation) => context.governedDispatch!(toolName, toolParams, invocation)
      : undefined,
  });
}

function denied(): ToolResult {
  return { success: false, error: "surface_not_authorized", message: "Authorized Surfaces require a governed acting coworker and delegating user context." };
}

function resultData(value: unknown): ToolResult {
  const failed = value as { ok?: boolean; code?: string; message?: string };
  if (failed.ok === false) return { success: false, error: failed.code, message: failed.message ?? failed.code ?? "Surface operation failed", data: value as Record<string, unknown> };
  return { success: true, message: "Authorized Surface operation completed.", data: value as Record<string, unknown> };
}

const handlers: Record<string, ToolPackHandler> = {
  surface_list: async (params, userId, context) => {
    const principal = await principalContext(params, userId, context);
    if (!principal) return denied();
    const { authorizedSurfaceRuntime } = await surfaceRegistry();
    const surfaces = await authorizedSurfaceRuntime.list(principal);
    return { success: true, message: `${surfaces.length} relevant authorized surface(s) available.`, data: { surfaces } };
  },
  surface_open: async (params, userId, context) => {
    const principal = await principalContext(params, userId, context);
    if (!principal) return denied();
    const { authorizedSurfaceRuntime } = await surfaceRegistry();
    return resultData(await authorizedSurfaceRuntime.open({
      context: principal,
      selector: {
        surfaceId: asString(params, "surfaceId"),
        route: context?.authorizedSurfaceContext?.route ?? context?.routeContext ?? asString(params, "route"),
        taskIntent: context?.authorizedSurfaceContext?.taskIntent ?? asString(params, "taskIntent"),
        workroomType: context?.authorizedSurfaceContext?.workroomType ?? asString(params, "workroomType"),
        resourceType: context?.authorizedSurfaceContext?.resourceType ?? asString(params, "resourceType"),
        mobileViewId: asString(params, "mobileViewId"),
      },
    }));
  },
  surface_snapshot: async (params, userId, context) => {
    if (!context?.agentId) return denied();
    const { authorizedSurfaceRuntime } = await surfaceRegistry();
    return resultData(await authorizedSurfaceRuntime.snapshot({
      sessionId: asString(params, "sessionId") ?? "",
      caller: { delegatingUserId: userId, actingAgentId: context.agentId },
      sinceRevision: asString(params, "sinceRevision"),
    }));
  },
  surface_query: async (params, userId, context) => {
    if (!context?.agentId) return denied();
    const { authorizedSurfaceRuntime } = await surfaceRegistry();
    return resultData(await authorizedSurfaceRuntime.query({
      sessionId: asString(params, "sessionId") ?? "",
      caller: { delegatingUserId: userId, actingAgentId: context.agentId },
      text: asString(params, "text"),
      kind: asString(params, "kind"),
      limit: typeof params["limit"] === "number" ? params["limit"] : undefined,
      cursor: asString(params, "cursor"),
    }));
  },
  surface_act: async (params, userId, context) => {
    if (!context?.agentId) return denied();
    const { authorizedSurfaceRuntime } = await surfaceRegistry();
    return resultData(await authorizedSurfaceRuntime.act({
      sessionId: asString(params, "sessionId") ?? "",
      caller: { delegatingUserId: userId, actingAgentId: context.agentId },
      actionId: asString(params, "actionId") ?? "",
      expectedRevision: asString(params, "expectedRevision") ?? "",
      args: params["args"] && typeof params["args"] === "object" && !Array.isArray(params["args"])
        ? params["args"] as Record<string, unknown>
        : {},
      idempotencyKey: asString(params, "idempotencyKey"),
    }));
  },
  surface_close: async (params, userId, context) => {
    if (!context?.agentId) return denied();
    const { authorizedSurfaceRuntime } = await surfaceRegistry();
    const closed = await authorizedSurfaceRuntime.close(
      asString(params, "sessionId") ?? "",
      { delegatingUserId: userId, actingAgentId: context.agentId },
    );
    return { success: closed, message: closed ? "Authorized Surface session closed." : "Surface session was unavailable or not owned by this principal.", ...(closed ? {} : { error: "surface_not_authorized" }) };
  },
};

export const surfacePack: ToolPack = {
  packId: "authorized-surface",
  definitions,
  handlers,
  grants: {
    surface_list: ["coworker_screen_read"],
    surface_open: ["coworker_screen_read"],
    surface_snapshot: ["coworker_screen_read"],
    surface_query: ["coworker_screen_read"],
    surface_act: ["coworker_screen_drive"],
    surface_close: ["coworker_screen_read"],
  },
};
