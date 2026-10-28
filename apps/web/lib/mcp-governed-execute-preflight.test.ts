import { beforeEach, expect, it, vi } from "vitest";
const guard = vi.hoisted(() => vi.fn());
vi.mock("./mcp-task-review-recovery", () => ({ reviewRecoveryToolRefusal: guard }));
import { defaultGovernedToolPreflight } from "./mcp-governed-execute-preflight";
const event = { toolName: "record_initiative_evidence", rawParams: {}, userId: "human", userContext: { platformRole: "developer", isSuperuser: false },
  source: "agentic-loop" as const, context: { taskRunId: "TR-ORIGINAL", apiTokenId: "current-token" } };
beforeEach(() => { vi.resetAllMocks(); guard.mockResolvedValue(null); });
it("checks transferred authority before room checks or approval", async () => {
  const refusal = { success: false, error: "review_execution_authority_refused" };
  guard.mockResolvedValue(refusal); const room = vi.fn();
  expect(await defaultGovernedToolPreflight(event, room)).toEqual(refusal);
  expect(guard).toHaveBeenCalledWith({ taskRunId: "TR-ORIGINAL", apiTokenId: "current-token", userId: "human" });
  expect(room).not.toHaveBeenCalled();
});
it("preserves room admission after a successful current-authority check", async () => {
  const room = vi.fn(async () => ({ success: false, error: "workroom_access_denied", message: "Room access changed." }));
  expect(await defaultGovernedToolPreflight(event, room)).toMatchObject({ success: false, error: "workroom_access_denied" });
  expect(room).toHaveBeenCalledOnce();
});
it("forwards the authenticated actor and captured generation", async () => {
  const executionFence = { schemaVersion: 1 as const, reservation: "original", dispatchClaim: null, authorityDigest: null, requestDigest: "a".repeat(64) };
  await defaultGovernedToolPreflight({ ...event, context: { ...event.context, agentId: "reviewer", taskExecutionFence: executionFence } }, vi.fn());
  expect(guard).toHaveBeenCalledWith(expect.objectContaining({ actingAgentId: "reviewer", executionFence }));
});
it("defers approval-completion checks to execution so the existing approval can close as failed", async () => {
  const room = vi.fn();
  expect(await defaultGovernedToolPreflight({ ...event, context: { ...event.context, callerClient: "approval-completion" } }, room)).toBeNull();
  expect(guard).not.toHaveBeenCalled(); expect(room).not.toHaveBeenCalled();
});
