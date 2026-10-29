import { beforeEach, expect, it, vi } from "vitest";
const guard = vi.hoisted(() => vi.fn());
const evidencePreflight = vi.hoisted(() => vi.fn());
vi.mock("./mcp-task-review-recovery", () => ({ reviewRecoveryToolRefusal: guard }));
vi.mock("./mcp/packs/initiative-readiness-pack", () => ({ preflightInitiativeEvidence: evidencePreflight }));
import { defaultGovernedToolPreflight } from "./mcp-governed-execute-preflight";
const event = { toolName: "record_initiative_evidence", rawParams: {}, userId: "human", userContext: { platformRole: "developer", isSuperuser: false },
  source: "agentic-loop" as const, context: { taskRunId: "TR-ORIGINAL", apiTokenId: "current-token" } };
beforeEach(() => { vi.resetAllMocks(); guard.mockResolvedValue(null); evidencePreflight.mockResolvedValue(null); });
it("rejects missing artifact provenance before the owner can be asked to approve", async () => {
  const refusal = { success: false, error: "ARTIFACT_AUTHOR_REQUIRED", message: "Artifact author provenance is unavailable." };
  evidencePreflight.mockResolvedValue(refusal);
  const room = vi.fn().mockResolvedValue(null);
  expect(await defaultGovernedToolPreflight(event, room)).toEqual(refusal);
  expect(evidencePreflight).toHaveBeenCalledWith(event.rawParams, event.userId, event.context);
});
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
it.each(["record_initiative_evidence", "record_semantic_review_exemption"])("defers %s approval-completion checks so the existing approval can close as failed", async toolName => {
  const room = vi.fn();
  expect(await defaultGovernedToolPreflight({ ...event, toolName, context: { ...event.context, callerClient: "approval-completion" } }, room)).toBeNull();
  expect(guard).not.toHaveBeenCalled(); expect(room).not.toHaveBeenCalled();
});
it("rejects an already-expired exact exception before requesting human approval", async () => {
  const rawParams = { capsuleId: "WC-FIXTURE", sourceHeadSha: "a".repeat(40), baseTreeHash: "b".repeat(40),
    headTreeHash: "c".repeat(40), diffDigest: "d".repeat(64), reason: "Bounded diagnostic for an expired exact request.",
    expiresAt: new Date(Date.now() - 1000).toISOString(), verificationEvidenceId: "CI-FIXTURE",
    clientAssessmentActivityId: "REVIEW-FIXTURE", reviewBasis: "operator-accepted-client-assessment" };
  const result = await defaultGovernedToolPreflight({ ...event, toolName: "record_semantic_review_exemption", rawParams }, vi.fn().mockResolvedValue(null));
  expect(result).toMatchObject({ success: false, error: "review_exemption_refused" });
  expect(result?.message).toMatch(/fresh exact request/i);
});
