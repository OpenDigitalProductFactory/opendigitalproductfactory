// Tests for the Pseudo-User Contract screen_* view-command tool family
// (BI-DF6079E9 + BI-0F9C291C envelope writes). Verifies:
//
//   1. Each handler returns success: true with the expected event payload
//      under data.event when called with valid args.
//   2. Each handler returns success: false with a clear error message when
//      required args or required context are missing.
//   3. Grant resolution: each tool requires the spec'd coworker_screen_*
//      grant (cross-referenced in agent-grants.test.ts; smoke-checked here).
//   4. screen_propose_action writes a CoworkerActionEnvelope row at
//      proposal time (the BI-0F9C291C part 3 wiring) and surfaces the
//      generated envelopeId in the event payload.
//
// The handlers do not emit SSE events yet — that plumbing is a follow-on
// (the second half of BI-DF6079E9). Returning the event payload
// structurally is what makes the surface testable today; the chat handler
// will pipe data.event into /api/agent/stream when it's wired.

import { beforeEach, describe, expect, it, vi } from "vitest";

const envelopeCreateMock = vi.hoisted(() => vi.fn());

vi.mock("@dpf/db", () => ({
  prisma: {
    coworkerActionEnvelope: {
      create: (...args: unknown[]) => envelopeCreateMock(...args),
    },
    // featureBuild.findUnique is touched by executeTool's build-context
    // hint when context.featureBuildId is set; tests in this file never
    // pass featureBuildId, so this stub is just defensive belt-and-braces.
    featureBuild: { findUnique: async () => null },
  },
}));

import { executeTool } from "./mcp-tools";
import { isToolAllowedByGrants } from "./tak/agent-grants";

const userId = "user-test";

async function call(
  tool: string,
  params: Record<string, unknown> = {},
  context?: { agentId?: string; threadId?: string; routeContext?: string; featureBuildId?: string },
) {
  return executeTool(tool, params, userId, context);
}

beforeEach(() => {
  envelopeCreateMock.mockReset();
});

describe("screen_describe + screen_get_state — read-only discovery", () => {
  it("screen_describe returns success and a describe_requested event", async () => {
    const r = await call("screen_describe");
    expect(r.success).toBe(true);
    expect(r.data?.event).toMatchObject({ type: "screen:describe_requested" });
  });

  it("screen_get_state returns success and a state_requested event", async () => {
    const r = await call("screen_get_state");
    expect(r.success).toBe(true);
    expect(r.data?.event).toMatchObject({ type: "screen:state_requested" });
  });

  it("both require coworker_screen_read", () => {
    expect(isToolAllowedByGrants("screen_describe", ["coworker_screen_read"])).toBe(true);
    expect(isToolAllowedByGrants("screen_get_state", ["coworker_screen_read"])).toBe(true);
    expect(isToolAllowedByGrants("screen_describe", ["coworker_screen_drive"])).toBe(false);
    expect(isToolAllowedByGrants("screen_get_state", [])).toBe(false);
  });
});

describe("screen_select_entity", () => {
  it("dispatches with valid args", async () => {
    const r = await call("screen_select_entity", { selectionId: "build", entityId: "FB-X" });
    expect(r.success).toBe(true);
    expect(r.data?.event).toEqual({
      type: "screen:select_entity",
      payload: { selectionId: "build", entityId: "FB-X" },
    });
  });

  it("rejects empty selectionId", async () => {
    const r = await call("screen_select_entity", { selectionId: "", entityId: "FB-X" });
    expect(r.success).toBe(false);
    expect(r.error).toBe("missing_args");
  });

  it("rejects empty entityId", async () => {
    const r = await call("screen_select_entity", { selectionId: "build", entityId: "" });
    expect(r.success).toBe(false);
  });

  it("requires coworker_screen_drive", () => {
    expect(isToolAllowedByGrants("screen_select_entity", ["coworker_screen_drive"])).toBe(true);
    expect(isToolAllowedByGrants("screen_select_entity", ["coworker_screen_read"])).toBe(false);
  });
});

describe("screen_navigate", () => {
  it("dispatches a bare route", async () => {
    const r = await call("screen_navigate", { route: "/build" });
    expect(r.success).toBe(true);
    expect(r.data?.event).toEqual({ type: "screen:navigate", payload: { route: "/build" } });
  });

  it("forwards params when provided as a plain object", async () => {
    const r = await call("screen_navigate", { route: "/build", params: { buildId: "FB-X" } });
    expect(r.success).toBe(true);
    expect(r.data?.event).toEqual({
      type: "screen:navigate",
      payload: { route: "/build", params: { buildId: "FB-X" } },
    });
  });

  it("ignores non-object params (model artifact)", async () => {
    const r = await call("screen_navigate", { route: "/x", params: "string-not-object" });
    expect(r.success).toBe(true);
    expect(r.data?.event).toEqual({ type: "screen:navigate", payload: { route: "/x" } });
  });

  it("rejects empty route", async () => {
    const r = await call("screen_navigate", { route: "" });
    expect(r.success).toBe(false);
  });
});

describe("screen_open_panel + screen_close_panel", () => {
  it("open dispatches a screen:open_panel event", async () => {
    const r = await call("screen_open_panel", { panelId: "design-doc" });
    expect(r.success).toBe(true);
    expect(r.data?.event).toEqual({ type: "screen:open_panel", payload: { panelId: "design-doc" } });
  });

  it("close dispatches a screen:close_panel event", async () => {
    const r = await call("screen_close_panel", { panelId: "plan" });
    expect(r.success).toBe(true);
    expect(r.data?.event).toEqual({ type: "screen:close_panel", payload: { panelId: "plan" } });
  });

  it("both reject empty panelId", async () => {
    expect((await call("screen_open_panel", { panelId: "" })).success).toBe(false);
    expect((await call("screen_close_panel", { panelId: "" })).success).toBe(false);
  });
});

describe("screen_focus_field", () => {
  it("dispatches with valid form + field", async () => {
    const r = await call("screen_focus_field", { formId: "design-doc-form", fieldId: "title" });
    expect(r.success).toBe(true);
    expect(r.data?.event).toEqual({
      type: "screen:focus_field",
      payload: { formId: "design-doc-form", fieldId: "title" },
    });
  });

  it("rejects when either field is missing", async () => {
    expect((await call("screen_focus_field", { formId: "x" })).success).toBe(false);
    expect((await call("screen_focus_field", { fieldId: "y" })).success).toBe(false);
  });
});

describe("screen_set_input", () => {
  it("dispatches a string value", async () => {
    const r = await call("screen_set_input", { formId: "f", fieldId: "title", value: "Hello" });
    expect(r.success).toBe(true);
    expect(r.data?.event).toEqual({
      type: "screen:set_input",
      payload: { formId: "f", fieldId: "title", value: "Hello" },
    });
  });

  it("dispatches a falsy value (zero, false, empty string) — they are valid inputs", async () => {
    expect((await call("screen_set_input", { formId: "f", fieldId: "n", value: 0 })).success).toBe(true);
    expect((await call("screen_set_input", { formId: "f", fieldId: "b", value: false })).success).toBe(true);
    expect((await call("screen_set_input", { formId: "f", fieldId: "s", value: "" })).success).toBe(true);
  });

  it("rejects when value is absent (not just falsy)", async () => {
    const r = await call("screen_set_input", { formId: "f", fieldId: "g" });
    expect(r.success).toBe(false);
    expect(r.error).toBe("missing_args");
  });

  it("requires the dedicated coworker_screen_fill grant — not satisfied by coworker_screen_drive", () => {
    expect(isToolAllowedByGrants("screen_set_input", ["coworker_screen_fill"])).toBe(true);
    expect(isToolAllowedByGrants("screen_set_input", ["coworker_screen_drive"])).toBe(false);
    expect(isToolAllowedByGrants("screen_set_input", ["coworker_screen_read"])).toBe(false);
  });
});

describe("screen_scroll_to — read-class per POLA review", () => {
  it("dispatches with valid anchor", async () => {
    const r = await call("screen_scroll_to", { anchor: "evidence-panel" });
    expect(r.success).toBe(true);
    expect(r.data?.event).toEqual({ type: "screen:scroll_to", payload: { anchor: "evidence-panel" } });
  });

  it("satisfies coworker_screen_read, not coworker_screen_drive", () => {
    expect(isToolAllowedByGrants("screen_scroll_to", ["coworker_screen_read"])).toBe(true);
    expect(isToolAllowedByGrants("screen_scroll_to", ["coworker_screen_drive"])).toBe(false);
  });
});

describe("screen_propose_action — writes a CoworkerActionEnvelope row (BI-0F9C291C part 3)", () => {
  const goodCtx = { agentId: "AGT-BUILD-SE", threadId: "thread-1" };

  it("writes an envelope row and surfaces the generated envelopeId in the event payload", async () => {
    envelopeCreateMock.mockResolvedValue({ id: "env-abc" });

    const r = await call(
      "screen_propose_action",
      {
        manifestActionId: "save-design-doc",
        args: { buildId: "FB-X" },
        rationale: "User asked to save the design doc.",
      },
      goodCtx,
    );

    expect(r.success).toBe(true);
    expect(r.entityId).toBe("env-abc");
    expect(envelopeCreateMock).toHaveBeenCalledTimes(1);
    expect(envelopeCreateMock).toHaveBeenCalledWith({
      data: {
        coworkerAgentId: "AGT-BUILD-SE",
        delegatingUserId: userId,
        threadId: "thread-1",
        manifestActionId: "save-design-doc",
        argsJson: { buildId: "FB-X" },
        rationale: "User asked to save the design doc.",
      },
    });
    expect(r.data?.event).toEqual({
      type: "screen:action_proposed",
      payload: {
        envelopeId: "env-abc",
        manifestActionId: "save-design-doc",
        rationale: "User asked to save the design doc.",
        args: { buildId: "FB-X" },
        coworkerAgentId: "AGT-BUILD-SE",
        delegatingUserId: userId,
      },
    });
  });

  it("defaults args to {} when omitted (still writes the row)", async () => {
    envelopeCreateMock.mockResolvedValue({ id: "env-def" });
    const r = await call(
      "screen_propose_action",
      { manifestActionId: "x", rationale: "y" },
      goodCtx,
    );
    expect(r.success).toBe(true);
    expect((envelopeCreateMock.mock.calls[0]?.[0] as { data: { argsJson: unknown } }).data.argsJson).toEqual({});
  });

  it("rejects missing manifestActionId or rationale BEFORE touching the DB", async () => {
    expect((await call("screen_propose_action", { manifestActionId: "", rationale: "x" }, goodCtx)).success).toBe(false);
    expect((await call("screen_propose_action", { manifestActionId: "x", rationale: "" }, goodCtx)).success).toBe(false);
    expect(envelopeCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when agentId is missing from execution context", async () => {
    const r = await call(
      "screen_propose_action",
      { manifestActionId: "x", rationale: "y" },
      { threadId: "thread-1" }, // no agentId
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("missing_context");
    expect(r.message).toMatch(/agentId/);
    expect(envelopeCreateMock).not.toHaveBeenCalled();
  });

  it("rejects when threadId is missing from execution context", async () => {
    const r = await call(
      "screen_propose_action",
      { manifestActionId: "x", rationale: "y" },
      { agentId: "AGT-X" }, // no threadId
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("missing_context");
    expect(r.message).toMatch(/threadId/);
    expect(envelopeCreateMock).not.toHaveBeenCalled();
  });

  it("returns envelope_create_failed when the DB write throws", async () => {
    envelopeCreateMock.mockRejectedValue(new Error("connection refused"));
    const r = await call(
      "screen_propose_action",
      { manifestActionId: "x", rationale: "y" },
      goodCtx,
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("envelope_create_failed");
    expect(r.message).toMatch(/connection refused/);
  });

  it("requires coworker_screen_drive", () => {
    expect(isToolAllowedByGrants("screen_propose_action", ["coworker_screen_drive"])).toBe(true);
    expect(isToolAllowedByGrants("screen_propose_action", ["coworker_screen_read"])).toBe(false);
  });
});

describe("screen_dispatch_action — still a stub (BI-0F9C291C follow-on)", () => {
  it("dispatches with valid envelopeId and carries the follow-on note", async () => {
    const r = await call("screen_dispatch_action", { envelopeId: "env-123" });
    expect(r.success).toBe(true);
    expect(r.data?.event).toEqual({
      type: "screen:dispatch_requested",
      payload: { envelopeId: "env-123" },
    });
    expect(r.data?.note).toMatch(/BI-0F9C291C/);
  });

  it("rejects empty envelopeId", async () => {
    expect((await call("screen_dispatch_action", { envelopeId: "" })).success).toBe(false);
  });

  it("requires coworker_screen_drive", () => {
    expect(isToolAllowedByGrants("screen_dispatch_action", ["coworker_screen_drive"])).toBe(true);
    expect(isToolAllowedByGrants("screen_dispatch_action", ["coworker_screen_read"])).toBe(false);
  });
});
