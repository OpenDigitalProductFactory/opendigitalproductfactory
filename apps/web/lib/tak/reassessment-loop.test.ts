import { beforeEach, describe, expect, it, vi } from "vitest";
const scope = vi.hoisted(() => ({ active: true, plan: vi.fn(), tool: vi.fn() }));
vi.mock("../routing/reassessment-execution-scope", async load => ({
  ...await load<typeof import("../routing/reassessment-execution-scope")>(),
  assertReassessmentActive: () => scope.active ? { binding: { writerToolName: "writer" }, qualification: {
    providerId: "provider", modelId: "model", executionPlan: { providerId: "provider", modelId: "model" },
  } } : null,
  assertReassessmentPlan: scope.plan, assertReassessmentToolCall: scope.tool,
}));
import { assertRestrictedReassessmentTurn, restrictedReassessmentLoop, restrictedReassessmentToolCall, rethrowRestrictedReassessmentError } from "./reassessment-loop";
import { ReassessmentExecutionError } from "../routing/reassessment-execution-scope";
import type { RunAgenticLoopParams } from "./agentic-loop";
const input: RunAgenticLoopParams = { userId: "human", agentId: "reviewer", taskRunId: "TR-FIXTURE", threadId: "thread", routeContext: "/review",
  systemPrompt: "Review", chatHistory: [], sensitivity: "internal",
  taskExecutionFence: { schemaVersion: 1, reservation: null, dispatchClaim: null, authorityDigest: null, requestDigest: "a".repeat(64) },
  tools: ["read_source_at_version", "writer"].map(name => ({ name, description: name, inputSchema: {}, requiredCapability: null,
    executionMode: "immediate", sideEffect: false })), toolsForProvider: [{ type: "function" }, { type: "function" }] };
beforeEach(() => { vi.clearAllMocks(); scope.active = true; scope.tool.mockImplementation(value => value.params); });
describe("restricted core-loop guard", () => {
  it("requires the actual captured actor/fence and complete provider surface on entry", () => {
    expect(restrictedReassessmentLoop(input)).toBe(true);
    expect(scope.tool).toHaveBeenCalledWith(expect.objectContaining({ userId: "human", agentId: "reviewer",
      taskRunId: "TR-FIXTURE", executionFence: input.taskExecutionFence, toolName: "read_source_at_version" }));
    expect(scope.plan).toHaveBeenCalledWith(expect.objectContaining({ tools: input.toolsForProvider }));
  });
  it.each([
    { enableExecutionPlan: true }, { proposeSideEffects: true }, { deferredTools: [{ name: "load_tools" }] },
    { tools: [{ name: "read_source_at_version" }, { name: "load_tools" }] },
    { tools: [{ name: "writer" }, { name: "writer" }] },
  ])("rejects auxiliary or changed loop composition %j before dispatch", patch => {
    expect(() => restrictedReassessmentLoop({ ...input, ...patch } as RunAgenticLoopParams)).toThrow(/composition|restricted/i);
    expect(scope.plan).not.toHaveBeenCalled();
  });
  it("refuses an escaped turn or tool callback instead of becoming ordinary when ALS is missing", () => {
    scope.active = false;
    expect(() => assertRestrictedReassessmentTurn(true, input.toolsForProvider)).toThrow(/context-missing/);
    expect(() => restrictedReassessmentToolCall(true, input, { id: "reader", name: "read_source_at_version", arguments: {} })).toThrow(/context-missing/);
    expect(scope.plan).not.toHaveBeenCalled(); expect(scope.tool).not.toHaveBeenCalled();
  });
  it("passes the bound actual tool identity before loop-intrinsic interception", () => {
    const call = { id: "read", name: "read_source_at_version", arguments: { maxChars: 100 } };
    expect(restrictedReassessmentToolCall(true, input, call)).toEqual(call);
    expect(scope.tool).toHaveBeenCalledWith({ toolName: call.name, params: call.arguments,
      userId: input.userId, agentId: input.agentId, taskRunId: input.taskRunId, executionFence: input.taskExecutionFence });
  });
  it("preserves the exact typed hold while ordinary errors retain their existing handlers", () => {
    const error = new ReassessmentExecutionError("reassessment-capture-incomplete");
    expect(() => rethrowRestrictedReassessmentError(true, error)).toThrow(error);
    expect(() => rethrowRestrictedReassessmentError(false, error)).not.toThrow();
    expect(() => rethrowRestrictedReassessmentError(true, Error("ordinary"))).not.toThrow();
  });
  it("does not inspect or alter an ordinary loop or tool call", () => {
    scope.active = false; const call = { id: "ordinary", name: "ordinary_tool", arguments: {} };
    expect(restrictedReassessmentLoop(input)).toBe(false);
    expect(restrictedReassessmentToolCall(false, input, call)).toBe(call);
    assertRestrictedReassessmentTurn(false, input.toolsForProvider);
    expect(scope.plan).not.toHaveBeenCalled(); expect(scope.tool).not.toHaveBeenCalled();
  });
});
