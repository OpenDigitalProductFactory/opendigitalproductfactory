import { beforeEach, describe, expect, it, vi } from "vitest";

const current = vi.hoisted(() => ({ grants: ["admin_read", "admin_write"], context: vi.fn(), snapshot: vi.fn(), query: vi.fn(), act: vi.fn(), close: vi.fn() }));
vi.mock("@/lib/tak/agent-grants", async original => ({ ...await original<typeof import("@/lib/tak/agent-grants")>(), getAgentToolGrantsAsync: async () => current.grants }));
vi.mock("@/lib/mcp-tools", () => ({ PLATFORM_TOOLS: [
  { name: "read_platform_funding_setup", requiredCapability: "manage_platform", sideEffect: false },
  { name: "confirm_platform_funding_owner", requiredCapability: "manage_platform", sideEffect: true },
] }));
vi.mock("@/lib/coworker/authorized-surface-registry", () => ({ createServerSurfaceContext: current.context,
  authorizedSurfaceRuntime: { snapshot: current.snapshot, query: current.query, act: current.act, close: current.close } }));

import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";
import type { ToolExecutionContext } from "@/lib/mcp-tool-types";
import { roomAuthorizesTool } from "@/lib/work-management/room-turn-authority";

import { surfacePack } from "./surface-pack";

beforeEach(() => {
  vi.clearAllMocks(); current.grants = ["admin_read", "admin_write"];
  current.context.mockImplementation((context, authority) => Object.assign(context, { testAuthority: authority }));
  for (const operation of [current.snapshot, current.query, current.act]) operation.mockResolvedValue({ ok: true });
  current.close.mockResolvedValue(true);
});

const NAMES = [
  "surface_list",
  "surface_open",
  "surface_snapshot",
  "surface_query",
  "surface_act",
  "surface_close",
];

function requestContext(authorizedGrants: readonly string[] | null): ToolExecutionContext {
  return {
    agentId: "assistant", userContext: { platformRole: "HR-000", isSuperuser: true },
    governedSource: "external-jsonrpc", apiTokenId: "current-token", tokenScope: "admin",
    tokenGrantScopes: ["admin_read", "admin_write"],
    governedRoomAuthority: () => authorizedGrants === null ? null : {
      workroomId: "WC-RESTRICTED", collaborationShape: null, workShapeKey: null,
      authorizedGrants, actionBoundary: "preauthorized", participantRoles: ["executor"], memberOfRoom: true,
    },
  };
}

describe("Authorized Surface MCP pack", () => {
  it.each(["surface_snapshot", "surface_query", "surface_act"])("passes current request authority and dispatch for %s", async name => {
    const dispatch = vi.fn(async () => ({ success: true, message: "Current request" }));
    const requestContext = { agentId: "assistant", userContext: { platformRole: "HR-000", isSuperuser: true },
      governedSource: "external-jsonrpc" as const, apiTokenId: "current-token", tokenScope: "admin" as const,
      tokenGrantScopes: ["admin_read", "admin_write"], governedDispatch: dispatch, governedRoomAuthority: () => null };
    await surfacePack.handlers[name]!({ sessionId: "saved-session", actionId: "confirm", expectedRevision: "revision" }, "user-1", requestContext);
    const operation = name === "surface_snapshot" ? current.snapshot : name === "surface_query" ? current.query : current.act;
    const input = operation.mock.calls[0]?.[0];
    expect(input).toMatchObject({ context: { delegatingUserId: "user-1", actingAgentId: "assistant" } });
    const authority = input.context.testAuthority;
    expect(await authority.currentToolAuthority("read_platform_funding_setup", { delegatingUserId: "user-1", actingAgentId: "assistant" })).toBe(true);
    expect(await authority.currentToolAuthority("confirm_platform_funding_owner", { delegatingUserId: "user-1", actingAgentId: "other-assistant" })).toBe(false);
    await authority.governedDispatch("confirm_platform_funding_owner", { reason: "Exact operation" }, { surfaceId: "funding", sessionId: "saved-session", revision: "revision", actionId: "confirm" });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it("intersects current token and coworker grants in the fresh surface proof", async () => {
    await surfacePack.handlers.surface_snapshot!({ sessionId: "saved-session" }, "user-1", {
      agentId: "assistant", userContext: { platformRole: "HR-000", isSuperuser: true }, governedSource: "external-jsonrpc",
      apiTokenId: "current-read-token", tokenScope: "read", tokenGrantScopes: ["admin_read", "admin_write"],
      governedRoomAuthority: () => null,
    });
    const authority = current.snapshot.mock.calls[0]?.[0].context.testAuthority;
    const principal = { delegatingUserId: "user-1", actingAgentId: "assistant" };
    // Admin grant keys still require the coarse admin token tier.
    expect(await authority.currentToolAuthority("read_platform_funding_setup", principal)).toBe(false);
    current.grants = [];
    expect(await authority.currentToolAuthority("confirm_platform_funding_owner", principal)).toBe(false);
  });

  it.each([
    { label: "screen-only", grants: ["coworker_screen_read"], read: false, write: false },
    { label: "read-only", grants: ["coworker_screen_read", "admin_read"], read: true, write: false },
    { label: "read and write", grants: ["coworker_screen_read", "admin_read", "admin_write"], read: true, write: true },
    { label: "empty", grants: [], read: false, write: false },
    { label: "known unroomed", grants: null, read: true, write: true },
  ])("applies the canonical $label room limit to funding read and write proof", async ({ grants, read, write }) => {
    await surfacePack.handlers.surface_snapshot!({ sessionId: "saved-session" }, "user-1", requestContext(grants));
    const authority = current.snapshot.mock.calls[0]?.[0].context.testAuthority;
    const principal = { delegatingUserId: "user-1", actingAgentId: "assistant" };
    for (const [tool, allowed] of [["read_platform_funding_setup", read], ["confirm_platform_funding_owner", write]] as const) {
      expect(roomAuthorizesTool(tool, grants)).toBe(allowed);
      expect(authority.authorizedToolNames.has(tool)).toBe(allowed);
      expect(await authority.currentToolAuthority(tool, principal)).toBe(allowed);
    }
  });

  it("refuses funding proof when current room authority is unverified", async () => {
    const context = requestContext(null); delete context.governedRoomAuthority;
    await surfacePack.handlers.surface_snapshot!({ sessionId: "saved-session" }, "user-1", context);
    const authority = current.snapshot.mock.calls[0]?.[0].context.testAuthority;
    const principal = { delegatingUserId: "user-1", actingAgentId: "assistant" };
    expect(authority.authorizedToolNames.size).toBe(0);
    expect(await authority.currentToolAuthority("read_platform_funding_setup", principal)).toBe(false);
    expect(await authority.currentToolAuthority("confirm_platform_funding_owner", principal)).toBe(false);
  });

  it("rechecks the current server room restriction instead of retaining the opening grant set", async () => {
    const context = requestContext(["admin_read", "admin_write"]);
    await surfacePack.handlers.surface_act!({ sessionId: "saved-session" }, "user-1", context);
    const authority = current.act.mock.calls[0]?.[0].context.testAuthority;
    const principal = { delegatingUserId: "user-1", actingAgentId: "assistant" };
    context.governedRoomAuthority = requestContext(["admin_read"]).governedRoomAuthority;
    expect(await authority.currentToolAuthority("read_platform_funding_setup", principal)).toBe(true);
    expect(await authority.currentToolAuthority("confirm_platform_funding_owner", principal)).toBe(false);
    context.governedRoomAuthority = requestContext(["coworker_screen_read"]).governedRoomAuthority;
    expect(await authority.currentToolAuthority("read_platform_funding_setup", principal)).toBe(false);
  });

  it.each(["surface_snapshot", "surface_query", "surface_act"])("refuses %s without a governed current human context", async name => {
    expect(await surfacePack.handlers[name]!({ sessionId: "saved-session" }, "user-1", { agentId: "assistant" }))
      .toMatchObject({ success: false, error: "surface_not_authorized" });
    expect(current.snapshot).not.toHaveBeenCalled(); expect(current.query).not.toHaveBeenCalled(); expect(current.act).not.toHaveBeenCalled();
  });

  it("publishes exactly the compact generic protocol with matching handlers and grants", () => {
    expect(surfacePack.definitions.map((definition) => definition.name)).toEqual(NAMES);
    expect(Object.keys(surfacePack.handlers)).toEqual(NAMES);
    for (const name of NAMES) {
      expect(surfacePack.grants[name]).toBeDefined();
      expect(isToolAllowedByGrants(name, [...surfacePack.grants[name]!])).toBe(true);
    }
  });

  it("keeps read operations read-only and surface_act as the sole domain-effect operation", () => {
    for (const definition of surfacePack.definitions) {
      if (definition.name === "surface_act") {
        expect(definition.sideEffect).toBe(true);
        continue;
      }
      expect(definition.sideEffect).toBe(false);
      expect(definition.annotations?.readOnlyHint).toBe(true);
    }
  });

  it("fails closed when a caller has no acting coworker identity", async () => {
    const result = await surfacePack.handlers.surface_list({}, "user-1", {
      userContext: { platformRole: "HR-000", isSuperuser: true },
    });
    expect(result).toMatchObject({ success: false, error: "surface_not_authorized" });
  });
});
