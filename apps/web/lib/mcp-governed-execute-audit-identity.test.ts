import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";
import * as mcpTools from "./mcp-tools";

const userContext = { platformRole: "ceo", isSuperuser: true };
const call = () => governedExecuteTool({ toolName: "query_backlog", rawParams: {},
  userId: "audit-identity-user", userContext, source: "rest" });
let execute: ReturnType<typeof vi.fn>;
let createAudit: ReturnType<typeof vi.fn>;

beforeEach(() => {
  execute = vi.fn(async () => ({ success: true, message: "read completed" }));
  createAudit = vi.fn(async () => ({ id: "persisted-execution-1" }));
  _setGovernanceForTests({
    executeTool: execute as never,
    toolExecutionCreate: createAudit as never,
  });
});
afterEach(() => {
  _setGovernanceForTests({ executeTool: null, toolExecutionCreate: null });
  vi.restoreAllMocks();
});

describe("governed result audit identity", () => {
  it("returns the actual persisted execution ID rather than a handler assertion", async () => {
    execute.mockResolvedValue({ success: true, message: "read completed",
      governance: { toolExecutionId: "handler-forged-id" } });
    expect(await call()).toMatchObject({ success: true,
      governance: { toolExecutionId: "persisted-execution-1" } });
  });

  it("does not invent an execution ID when audit persistence fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    createAudit.mockRejectedValue(new Error("audit unavailable"));
    const result = await call();
    expect(result.success).toBe(true);
    expect(result.governance).not.toHaveProperty("toolExecutionId");
  });

  it("keeps simultaneous identical reads bound to their own persisted IDs", async () => {
    let next = 0;
    createAudit.mockImplementation(async () => ({ id: `persisted-${++next}` }));
    const results = await Promise.all([call(), call()]);
    expect(results.map(result => (result.governance as Record<string, unknown>).toolExecutionId).sort())
      .toEqual(["persisted-1", "persisted-2"]);
  });
  it("projects room narrowing from the original governed authority rather than caller metadata", async () => {
    const catalog = vi.spyOn(mcpTools, "getAvailableTools").mockResolvedValue([]);
    execute.mockImplementation(async (_name, _params, _userId, context) => {
      await context.governedReadToolCatalog();
      return { success: true, message: "read completed" };
    });
    const result = await governedExecuteTool({ toolName: "query_backlog", rawParams: {}, userId: "audit-identity-user", userContext,
      source: "rest", context: { roomAuthority: { workroomId: "WC-ROOM", collaborationShape: null, workShapeKey: null,
        authorizedGrants: ["backlog_read"], actionBoundary: null, participantRoles: null, memberOfRoom: true } } });
    expect(execute).toHaveBeenCalledWith("query_backlog", {}, "audit-identity-user",
      expect.objectContaining({ governedReadToolCatalog: expect.any(Function), governedDispatch: expect.any(Function) }));
    expect(result.success).toBe(true);
    expect(catalog).toHaveBeenCalledWith(userContext, { mode: "advise", agentId: undefined, roomAuthorizedGrants: ["backlog_read"] });
  });
});
