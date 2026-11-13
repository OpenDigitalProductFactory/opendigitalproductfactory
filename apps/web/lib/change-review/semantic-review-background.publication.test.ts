import { mocks, state } from "./semantic-review-background.test-fixtures";
import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { executePersistedSemanticReview } from "./semantic-review-background";
import { createSemanticReviewRequest } from "./semantic-review-request";
import { failureAnalysisFixture } from "./failure-analysis.test-fixtures";
import { publishFailureReadinessStatus } from "./failure-readiness-status";

const retained = vi.hoisted(() => ({ publish: vi.fn() }));
vi.mock("./semantic-review-publication", async (original) => ({
  ...(await original<typeof import("./semantic-review-publication")>()),
  publishRetainedReview: retained.publish,
}));

const HEAD = "c".repeat(40);
function bindPacketToCommit() {
  const digest = createHash("sha256").update("diff").digest("hex");
  state.packet = createSemanticReviewRequest({ surface: "external", authorSurface: "codex", artifactType: "code-change",
    title: "Review", artifact: "diff", changedFiles: ["a.ts"], verificationEvidence: "Tests passed",
    ...failureAnalysisFixture({ capsuleId: "WC-1", headTreeHash: "b".repeat(40), diffDigest: digest }),
    identity: { capsuleId: "WC-1", baseTreeHash: "a".repeat(40), headTreeHash: "b".repeat(40), diffDigest: digest,
      specialistIds: [], sourceHeadSha: HEAD },
  }, { userId: "user-1", agentId: null, apiTokenId: "token-1", authSource: "pat" });
  state.row.a2aMetadata = { gateKind: "semantic-review", gateKey: state.packet.gateKey, capsuleId: "WC-1" };
  state.row.progressPayload = { semanticReview: { schemaVersion: 1, requestDigest: state.packet.digest,
    deadlineAt: state.packet.deadlineAt, dispatchAttempt: 0 } };
  mocks.db.taskArtifact.findUnique.mockResolvedValue({ taskRunId: "run-row-1", parts: [{ kind: "data", data: state.packet }] });
  mocks.resolveFailureEvidence.mockResolvedValue(state.packet.input.resolvedFailureEvidence);
}

describe("completed review keeps its status publication (BI-2A8A8FC8)", () => {
  beforeEach(() => { retained.publish.mockReset(); });

  it("saves the publication obligation with the review, before any post is attempted", async () => {
    bindPacketToCommit();
    retained.publish.mockImplementation(async () => {
      const marker = (state.row.progressPayload as { semanticReview: { publication?: Record<string, unknown> } }).semanticReview.publication;
      expect(state.row.status).toBe("completed");
      expect(marker).toMatchObject({ state: "pending", attempts: 0, capsuleId: "WC-1", sourceHeadSha: HEAD, owner: "delivery-coordinator" });
      return { state: "pending", reason: "publication-transport-failed" };
    });
    const outcome = await executePersistedSemanticReview("TR-1");
    expect(retained.publish).toHaveBeenCalledExactlyOnceWith("TR-1");
    expect(outcome).toMatchObject({ status: "completed", publicationPending: true, publicationReason: "publication-transport-failed" });
    expect(state.providerCalls).toBe(1);
    expect(mocks.evidence).toHaveBeenCalledOnce();
    expect(publishFailureReadinessStatus).not.toHaveBeenCalled();
  });

  it("reports nothing pending once the retained post lands", async () => {
    bindPacketToCommit();
    retained.publish.mockResolvedValue({ state: "published", reason: null });
    const outcome = await executePersistedSemanticReview("TR-1");
    expect(outcome).not.toHaveProperty("publicationPending");
  });

  it("keeps the single direct attempt for a review not bound to a commit", async () => {
    vi.mocked(publishFailureReadinessStatus).mockRejectedValueOnce(new Error("no commit"));
    const outcome = await executePersistedSemanticReview("TR-1");
    expect(retained.publish).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ publicationPending: true });
    expect((state.row.progressPayload as { semanticReview: Record<string, unknown> }).semanticReview.publication).toBeUndefined();
  });
});
