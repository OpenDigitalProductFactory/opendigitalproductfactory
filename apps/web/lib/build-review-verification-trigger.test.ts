import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/queue/inngest-client", () => ({
  inngest: { send: vi.fn() },
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("@/lib/agent-event-bus", () => ({
  agentEventBus: { emit: vi.fn() },
}));

vi.mock("@/lib/build/build-artifact-provenance", () => ({
  saveBuildArtifactRevisionWithDb: vi.fn(),
}));

import { inngest } from "@/lib/queue/inngest-client";
import { prisma } from "@dpf/db";
import { agentEventBus } from "@/lib/agent-event-bus";
import { saveBuildArtifactRevisionWithDb } from "@/lib/build/build-artifact-provenance";
import { queueBuildReviewVerification } from "./build-review-verification-trigger";

describe("queueBuildReviewVerification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dispatches the inngest event on the happy path and does not touch the build", async () => {
    vi.mocked(inngest.send).mockResolvedValue({ ids: ["evt-1"] } as never);

    await queueBuildReviewVerification("FB-OK-001");

    expect(inngest.send).toHaveBeenCalledWith({
      name: "build/review.verify",
      data: { buildId: "FB-OK-001" },
    });
    expect(saveBuildArtifactRevisionWithDb).not.toHaveBeenCalled();
    expect(prisma.featureBuild.update).not.toHaveBeenCalled();
    expect(agentEventBus.emit).not.toHaveBeenCalled();
  });

  it("marks the build failed with a synthetic step when enqueue throws", async () => {
    vi.mocked(inngest.send).mockRejectedValue(
      new Error("getaddrinfo ENOTFOUND inngest"),
    );
    vi.mocked(prisma.featureBuild.findUnique).mockResolvedValue({
      threadId: "thread-abc",
    } as never);

    await queueBuildReviewVerification("FB-FAIL-001");

    expect(saveBuildArtifactRevisionWithDb).toHaveBeenCalledTimes(1);
    const persistCall = vi.mocked(saveBuildArtifactRevisionWithDb).mock.calls[0]![1];
    expect(persistCall.buildId).toBe("FB-FAIL-001");
    expect(persistCall.field).toBe("uxTestResults");
    const steps = persistCall.value as Array<{ step: string; passed: boolean; error: string }>;
    expect(steps).toHaveLength(1);
    expect(steps[0]!.passed).toBe(false);
    expect(steps[0]!.step).toBe("Queue verification job");
    expect(steps[0]!.error).toContain("Inngest queue unavailable");
    expect(steps[0]!.error).toContain("ENOTFOUND inngest");

    expect(prisma.featureBuild.update).toHaveBeenCalledWith({
      where: { buildId: "FB-FAIL-001" },
      data: { uxVerificationStatus: "failed" },
    });

    expect(agentEventBus.emit).toHaveBeenCalledWith("thread-abc", {
      type: "verification:complete",
      buildId: "FB-FAIL-001",
      passed: 0,
      total: 1,
      status: "failed",
    });
  });

  it("still marks failed when the build has no threadId, without emitting", async () => {
    vi.mocked(inngest.send).mockRejectedValue(new Error("boom"));
    vi.mocked(prisma.featureBuild.findUnique).mockResolvedValue({
      threadId: null,
    } as never);

    await queueBuildReviewVerification("FB-NOTHREAD-001");

    expect(prisma.featureBuild.update).toHaveBeenCalledWith({
      where: { buildId: "FB-NOTHREAD-001" },
      data: { uxVerificationStatus: "failed" },
    });
    expect(agentEventBus.emit).not.toHaveBeenCalled();
  });

  it("swallows persistence failure so the originating call does not crash", async () => {
    vi.mocked(inngest.send).mockRejectedValue(new Error("queue down"));
    vi.mocked(prisma.featureBuild.findUnique).mockRejectedValue(
      new Error("db unreachable"),
    );

    await expect(queueBuildReviewVerification("FB-DB-DOWN-001")).resolves.toBeUndefined();
  });
});
