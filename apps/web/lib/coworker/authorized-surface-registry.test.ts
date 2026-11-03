import { describe, expect, it, vi } from "vitest";
const feedback = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("@/lib/routing/response-feedback", () => ({ getResponseFeedback: feedback.read }));

import { PLATFORM_TOOLS } from "@/lib/mcp-tools";
import { TOOL_TO_GRANTS } from "@/lib/tak/agent-grants";

import {
  ALL_SURFACE_DEFINITIONS,
  AUTHORIZED_SURFACE_CATALOG,
  authorizedSurfaceRuntime, createServerSurfaceContext,
} from "./authorized-surface-registry";

describe("Authorized Surface fleet conformance", () => {
  it("compiles every definition into one deterministic catalog with no executable/browser-only metadata", () => {
    expect(AUTHORIZED_SURFACE_CATALOG.definitions).toHaveLength(ALL_SURFACE_DEFINITIONS.length);
    expect(AUTHORIZED_SURFACE_CATALOG.digest).toMatch(/^[a-f0-9]{64}$/);
    for (const definition of ALL_SURFACE_DEFINITIONS) {
      expect(() => JSON.stringify(definition)).not.toThrow();
      expect(JSON.stringify(definition)).not.toMatch(/\b(window|document|HTMLElement|onClick)\b/);
    }
  });

  it("requires every persistent surface action to bind a real side-effect tool with grant metadata", () => {
    const tools = new Map(PLATFORM_TOOLS.map((tool) => [tool.name, tool]));
    for (const definition of ALL_SURFACE_DEFINITIONS) {
      for (const action of definition.actions.filter((candidate) => candidate.actionClass === "domain")) {
        expect(action.tool, `${definition.surfaceId}:${action.actionId}`).toBeTruthy();
        expect(tools.get(action.tool!)?.sideEffect, action.tool).toBe(true);
        expect(TOOL_TO_GRANTS[action.tool!], action.tool).toBeDefined();
      }
    }
  });

  it("keeps stable surface/node/action ids unique across the fleet", () => {
    const surfaceIds = new Set<string>();
    for (const definition of ALL_SURFACE_DEFINITIONS) {
      expect(surfaceIds.has(definition.surfaceId)).toBe(false);
      surfaceIds.add(definition.surfaceId);
      expect(new Set(definition.nodes.map((node) => node.nodeId)).size).toBe(definition.nodes.length);
      expect(new Set(definition.actions.map((action) => action.actionId)).size).toBe(definition.actions.length);
    }
  });
});

describe("response feedback registered resource parity", () => {
  const raw = { delegatingUserId: "u1", actingAgentId: "AGT-1", mode: "external" as const, locale: "en-US", timezone: "UTC",
    workContext: { resourceType: "agent-message", resourceIds: ["m1"] } };
  it("refuses a surface-only reader before accessing feedback", async () => {
    feedback.read.mockClear();
    const context = createServerSurfaceContext(raw, { authorizedToolNames: new Set(["surface_open"]) });
    const result = await authorizedSurfaceRuntime.open({ context, selector: { surfaceId: "coworker.response-feedback" } });
    expect(result).toMatchObject({ ok: false, code: "surface_not_authorized" });
    expect(feedback.read).not.toHaveBeenCalled();
  });
  it("loads the same domain DTO and binds fixed disposition arguments through governed dispatch", async () => {
    feedback.read.mockResolvedValue({ messageId: "m1", available: true, unavailableReason: null, value: null, source: null, actorLabel: null, acceptedAt: null, revision: 4, canWrite: true });
    const dispatch = vi.fn(async () => ({ success: true, message: "Saved." }));
    const context = createServerSurfaceContext(raw, { authorizedToolNames: new Set(["get_response_feedback", "record_response_feedback"]), governedDispatch: dispatch });
    const opened = await authorizedSurfaceRuntime.open({ context, selector: { resourceType: "agent-message" } });
    expect(opened.ok).toBe(true); if (!opened.ok) return;
    expect(feedback.read).toHaveBeenCalledWith("m1", { userId: "u1", agentId: "AGT-1" });
    const result = await authorizedSurfaceRuntime.act({ sessionId: opened.session.sessionId, caller: raw, expectedRevision: opened.session.revision,
      actionId: "feedback.revise", args: { messageId: "forged", expectedRevision: 999, value: true, source: "human" } });
    expect(result.ok).toBe(true);
    expect(dispatch).toHaveBeenCalledWith("record_response_feedback", { messageId: "m1", expectedRevision: 4, value: false }, expect.objectContaining({ actionId: "feedback.revise" }));
  });
});
