import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

const mocks = vi.hoisted(() => ({
  requireCapability: vi.fn(),
  prisma: {
    featureBuild: { findUnique: vi.fn(), update: vi.fn() },
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
});
