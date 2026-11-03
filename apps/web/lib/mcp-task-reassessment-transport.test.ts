import { beforeEach, expect, it, vi } from "vitest";
const guard = vi.hoisted(() => vi.fn());
vi.mock("./mcp-task-review-recovery", () => ({ reviewRecoveryToolRefusal: guard }));
import { reviewTaskTransportRefusal } from "./mcp-task-reassessment-transport";
import type { ResolvedMcpTransportAuth } from "./mcp/transport-auth";

const executionFence = { schemaVersion: 1 as const, reservation: "original", dispatchClaim: "claim",
  authorityDigest: null, requestDigest: "a".repeat(64) };
const token = { tokenId: "signed-session", userId: "owner", agentId: "reviewer", scopes: [],
  capability: "write", scope: "write", source: "session-jwt", taskRunId: "TR-ORIGINAL", taskExecutionFence: executionFence } satisfies ResolvedMcpTransportAuth;
beforeEach(() => { vi.resetAllMocks(); guard.mockResolvedValue(null); });

it.each(["tools/list", "tools/call", "tasks/submit", "tasks/cancel", "tasks/list"])("fences %s before its alternate transport handler", async method => {
  const refusal = { success: false, error: "review_execution_authority_refused", message: "Held." };
  guard.mockResolvedValue(refusal);
  expect(await reviewTaskTransportRefusal({ token, method, params: { taskId: "TR-OTHER", taskExecutionFence: {} } })).toBe(refusal);
  expect(guard).toHaveBeenCalledWith({ taskRunId: "TR-ORIGINAL", userId: "owner", apiTokenId: "signed-session",
    actingAgentId: "reviewer", executionFence });
});
it.each(["tasks/get", "tasks/result"])("preserves existing exact-owner %s readback without authorizing execution", async method => {
  expect(await reviewTaskTransportRefusal({ token, method, params: { taskId: "TR-ORIGINAL" } })).toBeNull();
  expect(guard).not.toHaveBeenCalled();
  await reviewTaskTransportRefusal({ token, method, params: { taskId: "TR-OTHER" } });
  expect(guard).toHaveBeenCalledOnce();
});
it("retains normal current callback dispatch after the shared authority check", async () => {
  expect(await reviewTaskTransportRefusal({ token, method: "tools/call" })).toBeNull();
  expect(guard).toHaveBeenCalledOnce();
});
it.each(["initialize", "notifications/initialized", "ping"])("permits the effect-free %s handshake", async method => {
  expect(await reviewTaskTransportRefusal({ token, method })).toBeNull();
  expect(guard).not.toHaveBeenCalled();
});
it("preserves unbound operator transport semantics", async () => {
  expect(await reviewTaskTransportRefusal({ token: { ...token, taskRunId: null }, method: "tasks/submit" })).toBeNull();
  expect(guard).not.toHaveBeenCalled();
});
