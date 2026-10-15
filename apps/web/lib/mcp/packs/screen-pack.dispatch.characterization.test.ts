// GPP Phase 2 PR-H characterization (BI-69415B68): screen_dispatch_action,
// pinned in the shape production reaches it. Every production path into this
// handler passes the reference monitor (agentic loop, MCP routes), so the
// handler context always carries `governedSource`, `userContext` and the
// monitor's `governedDispatch`. Written against the direct executeTool
// recursion BEFORE the site moved behind the monitor, and required to pass
// unchanged after: same returned value, same envelope finalisation, same
// acting user, agent and route for the underlying tool.
import { beforeEach, describe, expect, it, vi } from "vitest";

const envelopeFindUniqueMock = vi.hoisted(() => vi.fn());
const envelopeUpdateMock = vi.hoisted(() => vi.fn());

vi.mock("@dpf/db", () => ({
  prisma: {
    coworkerActionEnvelope: {
      create: vi.fn(),
      findUnique: (...args: unknown[]) => envelopeFindUniqueMock(...args),
      update: (...args: unknown[]) => envelopeUpdateMock(...args),
    },
    featureBuild: { findUnique: async () => null },
  },
}));

import { executeTool } from "@/lib/mcp-tools";
import type { ToolExecutionContext, ToolResult } from "@/lib/mcp-tool-types";
import { ALL_MANIFESTS } from "@/lib/coworker/manifests";
import type { ScreenManifest } from "@/lib/coworker/screen-manifest-types";

const owner = "u-owner";

function manifest(actionId: string, tool: string): ScreenManifest {
  return {
    surfaceId: "test-surface",
    routePattern: "/test",
    label: "Test",
    selections: [],
    navigations: [],
    panels: [],
    forms: [],
    domainActions: [{ actionId, tool, label: "A", invoke: async () => {} }],
    destructiveActions: [],
  };
}

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    id: "env-1",
    coworkerAgentId: "AGT-X",
    delegatingUserId: owner,
    threadId: "thread-1",
    chatMessageId: null,
    manifestActionId: "describe-here",
    argsJson: {},
    rationale: "test",
    status: "approved",
    createdAt: new Date(),
    resolvedAt: null,
    ...overrides,
  };
}

/**
 * The monitor's nested dispatch, as governedExecuteTool supplies it: it runs
 * the nested tool under the OUTER call's user, and its executor forwards the
 * same handler context fields it forwarded to the outer call (userContext,
 * governedSource, governedDispatch, route, agent, thread, token scope). It
 * returns the tool result plus a `governance` block, and reports a throwing
 * handler as a `tool_threw` result.
 */
const dispatched: Array<{ toolName: string; params: Record<string, unknown> }> = [];
function monitorShapedContext(callerUserId: string): ToolExecutionContext {
  const context: ToolExecutionContext = {
    routeContext: "/test",
    agentId: "AGT-X",
    threadId: "thread-1",
    governedSource: "agentic-loop",
    userContext: { platformRole: "HR-000", isSuperuser: false },
    governedDispatch: async (toolName: string, params: Record<string, unknown>) => {
      dispatched.push({ toolName, params });
      let result: ToolResult;
      try {
        result = await executeTool(toolName, params, callerUserId, context);
      } catch (err) {
        result = { success: false, error: "tool_threw", message: `${toolName} threw: ${(err as Error).message}` };
      }
      return { ...result, governance: { durationMs: 1 } } as ToolResult;
    },
  };
  return context;
}

async function dispatch(callerUserId: string = owner) {
  return executeTool("screen_dispatch_action", { envelopeId: "env-1" }, callerUserId, monitorShapedContext(callerUserId));
}

async function withManifest<T>(m: ScreenManifest, fn: () => Promise<T>): Promise<T> {
  ALL_MANIFESTS.push(m);
  try {
    return await fn();
  } finally {
    ALL_MANIFESTS.splice(ALL_MANIFESTS.indexOf(m), 1);
  }
}

beforeEach(() => {
  envelopeFindUniqueMock.mockReset();
  envelopeUpdateMock.mockReset();
  dispatched.length = 0;
  ALL_MANIFESTS.length = 0;
});

describe("screen_dispatch_action — characterization in the monitor-shaped context", () => {
  it("production today: no manifest is registered, so dispatch stops at no_manifest before any underlying tool runs", async () => {
    envelopeFindUniqueMock.mockResolvedValue(envelope());
    const r = await dispatch();
    expect(r).toMatchObject({ success: false, error: "no_manifest" });
    expect(dispatched).toEqual([]);
    expect(envelopeUpdateMock).not.toHaveBeenCalled();
  });

  it("an approved envelope runs its manifest tool for the delegating user and is marked executed", async () => {
    envelopeFindUniqueMock.mockResolvedValue(envelope());
    envelopeUpdateMock.mockResolvedValue({ ...envelope(), status: "executed", resolvedAt: new Date() });

    const r = await withManifest(manifest("describe-here", "screen_describe"), () => dispatch());

    expect(r).toEqual({
      success: true,
      entityId: "env-1",
      message: expect.stringMatching(/^Envelope env-1 executed \(screen_describe\): /),
      data: {
        event: {
          type: "screen:action_dispatched",
          payload: { envelopeId: "env-1", tool: "screen_describe", manifestActionId: "describe-here", ok: true },
        },
        toolResult: {
          success: true,
          message: expect.any(String),
          data: {
            compatibilityFallback: "surface_not_found",
            event: { type: "screen:describe_requested", payload: { routeContext: "/test" } },
          },
        },
      },
    });
    expect(envelopeUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "env-1" }, data: expect.objectContaining({ status: "executed" }) }),
    );
  });

  it("a structured tool failure marks the envelope failed and propagates the tool's response", async () => {
    envelopeFindUniqueMock.mockResolvedValue(envelope({ manifestActionId: "bad" }));
    envelopeUpdateMock.mockResolvedValue({ ...envelope(), status: "failed", resolvedAt: new Date() });

    const r = await withManifest(manifest("bad", "screen_select_entity"), () => dispatch());

    expect(r).toEqual({
      success: false,
      entityId: "env-1",
      message: expect.stringMatching(/^Envelope env-1 dispatch reported failure \(screen_select_entity\): /),
      data: {
        event: {
          type: "screen:action_dispatched",
          payload: { envelopeId: "env-1", tool: "screen_select_entity", manifestActionId: "bad", ok: false },
        },
        toolResult: { success: false, error: "missing_args", message: expect.any(String) },
      },
    });
    expect(envelopeUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "env-1" }, data: expect.objectContaining({ status: "failed" }) }),
    );
  });

  it("passes the envelope's stored arguments to the underlying tool", async () => {
    envelopeFindUniqueMock.mockResolvedValue(envelope({
      manifestActionId: "pick",
      argsJson: { selectionId: "build", entityId: "FB-1" },
    }));
    envelopeUpdateMock.mockResolvedValue({ ...envelope(), status: "executed", resolvedAt: new Date() });

    const r = await withManifest(manifest("pick", "screen_select_entity"), () => dispatch());

    expect(r.success).toBe(true);
    expect((r.data as { toolResult: ToolResult }).toolResult).toEqual({
      success: true,
      message: expect.any(String),
      data: { event: { type: "screen:select_entity", payload: { selectionId: "build", entityId: "FB-1" } } },
    });
  });
});
