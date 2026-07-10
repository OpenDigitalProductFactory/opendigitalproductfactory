import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  prisma: {
    coworkerActionEnvelope: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@dpf/db", () => db);

const manifests = vi.hoisted(() => ({
  findManifestForRoute: vi.fn(),
}));
vi.mock("@/lib/coworker/manifests/index", () => manifests);

const envelopeActions = vi.hoisted(() => ({
  markEnvelopeExecuted: vi.fn(),
  markEnvelopeFailed: vi.fn(),
}));
vi.mock("@/lib/coworker/envelope-actions", () => envelopeActions);

const mcpTools = vi.hoisted(() => ({
  executeTool: vi.fn(),
}));
vi.mock("@/lib/mcp-tools", () => mcpTools);

import { screenPack } from "./screen-pack";
import { isToolAllowedByGrants } from "@/lib/tak/agent-grants";

beforeEach(() => {
  vi.clearAllMocks();
  envelopeActions.markEnvelopeExecuted.mockResolvedValue({ ok: true });
  envelopeActions.markEnvelopeFailed.mockResolvedValue({ ok: true });
});

const EXPECTED_TOOLS = [
  "screen_describe",
  "screen_get_state",
  "screen_select_entity",
  "screen_navigate",
  "screen_open_panel",
  "screen_close_panel",
  "screen_focus_field",
  "screen_set_input",
  "screen_scroll_to",
  "screen_propose_action",
  "screen_dispatch_action",
];

describe("screen pack — registration", () => {
  it("exposes exactly the eleven view-command tools", () => {
    const names = screenPack.definitions.map((d) => d.name).sort();
    expect(names).toEqual([...EXPECTED_TOOLS].sort());
    for (const name of EXPECTED_TOOLS) {
      expect(screenPack.handlers[name]).toBeTypeOf("function");
    }
  });

  it("mirrors the TOOL_TO_GRANTS gating for every tool", () => {
    expect(screenPack.grants).toEqual({
      screen_describe: ["coworker_screen_read"],
      screen_get_state: ["coworker_screen_read"],
      screen_scroll_to: ["coworker_screen_read"],
      screen_select_entity: ["coworker_screen_drive"],
      screen_navigate: ["coworker_screen_drive"],
      screen_open_panel: ["coworker_screen_drive"],
      screen_close_panel: ["coworker_screen_drive"],
      screen_focus_field: ["coworker_screen_drive"],
      screen_propose_action: ["coworker_screen_drive"],
      screen_dispatch_action: ["coworker_screen_drive"],
      screen_set_input: ["coworker_screen_fill"],
    });
    // The gating source agrees with the co-located mirror.
    expect(isToolAllowedByGrants("screen_describe", ["coworker_screen_read"])).toBe(true);
    expect(isToolAllowedByGrants("screen_navigate", ["coworker_screen_drive"])).toBe(true);
    expect(isToolAllowedByGrants("screen_set_input", ["coworker_screen_fill"])).toBe(true);
    expect(isToolAllowedByGrants("screen_navigate", ["coworker_screen_read"])).toBe(false);
  });

  it("keeps tool descriptions provenance-free (no BI/phase/source-path leakage)", () => {
    for (const def of screenPack.definitions) {
      expect(def.description).not.toMatch(/BI-|Phase \d|apps\/web|EP-/);
    }
  });
});

describe("screen pack — handler envelopes", () => {
  it("screen_describe echoes the routeContext into a describe_requested event", async () => {
    const result = await screenPack.handlers.screen_describe!({}, "user-1", {
      routeContext: "/build",
    });
    expect(result.success).toBe(true);
    expect(result.message).toContain("/build");
    expect((result.data as { event: { type: string } }).event.type).toBe(
      "screen:describe_requested",
    );
  });

  it("screen_select_entity rejects missing args and dispatches when present", async () => {
    const bad = await screenPack.handlers.screen_select_entity!({ selectionId: "build" }, "user-1");
    expect(bad.success).toBe(false);
    expect(bad.error).toBe("missing_args");

    const ok = await screenPack.handlers.screen_select_entity!(
      { selectionId: "build", entityId: "FB-1" },
      "user-1",
    );
    expect(ok.success).toBe(true);
    expect((ok.data as { event: { payload: unknown } }).event.payload).toEqual({
      selectionId: "build",
      entityId: "FB-1",
    });
  });

  it("screen_open_panel and screen_close_panel emit the matching event types", async () => {
    const open = await screenPack.handlers.screen_open_panel!({ panelId: "drawer" }, "user-1");
    expect((open.data as { event: { type: string } }).event.type).toBe("screen:open_panel");
    const close = await screenPack.handlers.screen_close_panel!({ panelId: "drawer" }, "user-1");
    expect((close.data as { event: { type: string } }).event.type).toBe("screen:close_panel");
  });

  it("screen_set_input requires a value key and carries it through", async () => {
    const missing = await screenPack.handlers.screen_set_input!(
      { formId: "f", fieldId: "x" },
      "user-1",
    );
    expect(missing.success).toBe(false);

    const ok = await screenPack.handlers.screen_set_input!(
      { formId: "f", fieldId: "x", value: 42 },
      "user-1",
    );
    expect(ok.success).toBe(true);
    expect((ok.data as { event: { payload: { value: unknown } } }).event.payload.value).toBe(42);
  });

  it("screen_propose_action writes a CoworkerActionEnvelope and requires agent+thread context", async () => {
    const noCtx = await screenPack.handlers.screen_propose_action!(
      { manifestActionId: "act", rationale: "because" },
      "user-1",
      {},
    );
    expect(noCtx.success).toBe(false);
    expect(noCtx.error).toBe("missing_context");

    db.prisma.coworkerActionEnvelope.create.mockResolvedValue({ id: "ENV-1" });
    const ok = await screenPack.handlers.screen_propose_action!(
      { manifestActionId: "act", rationale: "because", args: { foo: 1 } },
      "user-1",
      { agentId: "AGT-1", threadId: "THR-1" },
    );
    expect(ok.success).toBe(true);
    expect(ok.entityId).toBe("ENV-1");
    expect(db.prisma.coworkerActionEnvelope.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          coworkerAgentId: "AGT-1",
          delegatingUserId: "user-1",
          threadId: "THR-1",
          manifestActionId: "act",
        }),
      }),
    );
  });

  it("screen_dispatch_action executes the approved envelope's underlying tool and finalises", async () => {
    db.prisma.coworkerActionEnvelope.findUnique.mockResolvedValue({
      id: "ENV-1",
      status: "approved",
      manifestActionId: "act",
      argsJson: { foo: 1 },
      delegatingUserId: "user-9",
    });
    manifests.findManifestForRoute.mockReturnValue({
      surfaceId: "build",
      domainActions: [{ actionId: "act", tool: "create_backlog_item" }],
    });
    mcpTools.executeTool.mockResolvedValue({ success: true, message: "done" });

    const result = await screenPack.handlers.screen_dispatch_action!(
      { envelopeId: "ENV-1" },
      "user-1",
      { routeContext: "/build" },
    );

    expect(result.success).toBe(true);
    expect(mcpTools.executeTool).toHaveBeenCalledWith(
      "create_backlog_item",
      { foo: 1 },
      "user-9",
      { routeContext: "/build" },
    );
    expect(envelopeActions.markEnvelopeExecuted).toHaveBeenCalledWith("ENV-1");
  });

  it("screen_dispatch_action refuses a non-approved envelope", async () => {
    db.prisma.coworkerActionEnvelope.findUnique.mockResolvedValue({
      id: "ENV-2",
      status: "proposed",
    });
    const result = await screenPack.handlers.screen_dispatch_action!(
      { envelopeId: "ENV-2" },
      "user-1",
      { routeContext: "/build" },
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe("envelope_not_approved");
    expect(mcpTools.executeTool).not.toHaveBeenCalled();
  });
});
