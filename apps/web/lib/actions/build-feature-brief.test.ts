import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  prisma: {
    featureBuild: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    businessBuildBrief: { upsert: vi.fn() },
    organization: { findFirst: vi.fn() },
    $transaction: vi.fn(),
  },
}));

vi.mock("@/lib/actions/shared/guards", () => ({
  requireCapability: mocks.requireCapability,
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));

import { updateFeatureBrief } from "./build-feature-brief";

const brief = {
  title: "Improve Build Studio intake",
  description: "Build Studio should save a governed feature brief.",
  portfolioContext: "Build Studio",
  targetRoles: ["Operations lead"],
  inputs: ["Reviewed plan"],
  dataNeeds: "Business outcome and evidence",
  acceptanceCriteria: ["The build owner can save the brief."],
};

describe("updateFeatureBrief (BI-7175C7DB)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCapability.mockResolvedValue({ userId: "session-owner" });
    mocks.prisma.featureBuild.findUnique.mockResolvedValue({
      id: "feature-build-row-1",
      buildId: "FB-123",
      title: brief.title,
      createdById: "session-owner",
      phase: "ideate",
    });
    mocks.prisma.organization.findFirst.mockResolvedValue({ id: "org-1" });
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma));
  });

  it("uses the HTTP-session actor when no governed actor is supplied", async () => {
    await updateFeatureBrief("FB-123", brief);

    expect(mocks.requireCapability).toHaveBeenCalledWith("view_platform");
    expect(mocks.prisma.featureBuild.update).toHaveBeenCalledWith({
      where: { buildId: "FB-123" },
      data: { brief },
    });
  });

  it("uses an explicit governed actor without requiring an HTTP session", async () => {
    mocks.requireCapability.mockRejectedValue(new Error("Unauthorized"));
    mocks.prisma.featureBuild.findUnique.mockResolvedValue({
      id: "feature-build-row-1",
      buildId: "FB-123",
      title: brief.title,
      createdById: "mcp-actor-1",
      phase: "ideate",
    });

    await updateFeatureBrief("FB-123", brief, { actorUserId: "mcp-actor-1" });

    expect(mocks.requireCapability).not.toHaveBeenCalled();
    expect(mocks.prisma.featureBuild.update).toHaveBeenCalled();
  });

  it("keeps the build-owner check for an explicit governed actor", async () => {
    await expect(
      updateFeatureBrief("FB-123", brief, { actorUserId: "different-actor" }),
    ).rejects.toThrow("Forbidden");

    expect(mocks.requireCapability).not.toHaveBeenCalled();
    expect(mocks.prisma.featureBuild.update).not.toHaveBeenCalled();
  });

  it("uses an explicit async facade from the use-server build action module", () => {
    const buildActionSource = readFileSync(
      new URL("./build.ts", import.meta.url),
      "utf8",
    );

    expect(buildActionSource).not.toMatch(
      /export\s*\{\s*updateFeatureBrief\s*\}\s*from/,
    );
    expect(buildActionSource).toMatch(
      /export\s+async\s+function\s+updateFeatureBrief\s*\(/,
    );
  });

  it.each(["phase", "source version"])("preserves a concurrent %s change at the write boundary", async (changed) => {
    // The row was valid when read; another worker changes it during the
    // organization lookup. Only the conditional mutation can detect this race.
    const expectedUpdatedAt = "2026-11-11T04:00:00.000Z";
    const current = { phase: "ideate", updatedAt: new Date(expectedUpdatedAt) };
    mocks.prisma.featureBuild.updateMany.mockImplementationOnce(async ({ where }) => ({
      count: where.phase === current.phase && where.updatedAt.getTime() === current.updatedAt.getTime() ? 1 : 0,
    }));
    mocks.prisma.organization.findFirst.mockImplementationOnce(async () => {
      if (changed === "phase") current.phase = "plan";
      else current.updatedAt = new Date("2026-11-11T04:01:00.000Z");
      return { id: "org-1" };
    });
    await expect(updateFeatureBrief("FB-123", brief, {
      actorUserId: "session-owner", expectedUpdatedAt,
    })).rejects.toThrow(/changed/i);
    expect(mocks.prisma.featureBuild.update).not.toHaveBeenCalled();
    expect(mocks.prisma.businessBuildBrief.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.featureBuild.updateMany).toHaveBeenCalledWith({
      where: { buildId: "FB-123", createdById: "session-owner", phase: "ideate",
        abandonedAt: null, updatedAt: new Date(expectedUpdatedAt) },
      data: { brief },
    });
  });

  it("saves a matching guarded diagnosis and its business brief together", async () => {
    mocks.prisma.featureBuild.updateMany.mockResolvedValueOnce({ count: 1 });
    await updateFeatureBrief("FB-123", brief, { expectedUpdatedAt: "2026-11-11T04:00:00.000Z" });
    expect(mocks.prisma.businessBuildBrief.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.featureBuild.update).not.toHaveBeenCalled();
  });
});
