import { afterEach, describe, expect, it, vi } from "vitest";
import { _setGovernanceForTests, governedExecuteTool } from "./mcp-governed-execute";

afterEach(() => _setGovernanceForTests({ executeTool: null, toolExecutionCreate: null }));

describe("trusted execution identity forwarding", () => {
  it.each([true, false])("forwards only server context when captured=%s", async (captured) => {
    const taskExecutionFence = { schemaVersion: 1 as const, reservation: "admitted", dispatchClaim: "dispatch", authorityDigest: null, requestDigest: "9".repeat(64) };
    const execute = vi.fn(async (_name: string, _params: unknown, _userId: string, _context: unknown) => ({ success: true, message: "Read completed." }));
    _setGovernanceForTests({ executeTool: execute as never,
      toolExecutionCreate: vi.fn(async () => ({ id: "audit" })) as never });
    await governedExecuteTool({ toolName: "query_backlog", rawParams: { taskExecutionFence: { ...taskExecutionFence, reservation: "forged" } },
      userId: "user", userContext: { platformRole: "ceo", isSuperuser: true }, source: "rest",
      context: { taskRunId: "task", ...(captured ? { taskExecutionFence } : {}) } });
    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[3]).toMatchObject({ taskRunId: "task" });
    expect((execute.mock.calls[0]?.[3] as Record<string, unknown>)?.taskExecutionFence).toEqual(captured ? taskExecutionFence : undefined);
  });
});
