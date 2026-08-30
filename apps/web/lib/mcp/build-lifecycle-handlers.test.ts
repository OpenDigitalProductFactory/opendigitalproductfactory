import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actionUpdateFeatureBrief: vi.fn(),
  findUnique: vi.fn(),
  resolveActiveBuildId: vi.fn(),
  updateBuildHappyPathState: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    featureBuild: { findUnique: mocks.findUnique },
  },
}));

vi.mock("@/lib/actions/build", () => ({
  updateFeatureBrief: mocks.actionUpdateFeatureBrief,
}));

vi.mock("@/lib/mcp/build-tool-helpers", () => ({
  extractBuildIdHint: vi.fn(() => undefined),
  logBuildActivity: vi.fn(),
  resolveActiveBuildId: mocks.resolveActiveBuildId,
  updateBuildHappyPathState: mocks.updateBuildHappyPathState,
}));

vi.mock("@/lib/build/build-entry-gate", () => ({
  enforceBuildInitiativeReadiness: vi.fn(),
}));

vi.mock("@/lib/build/ideate-build-resolution", () => ({
  resolveIdeateBuildForToolPure: vi.fn(),
}));

import { updateFeatureBrief } from "./build-lifecycle-handlers";
import { formatUpdateFeatureBriefError } from "./update-feature-brief-error";

describe("updateFeatureBrief (BI-7175C7DB)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveActiveBuildId.mockResolvedValue("FB-123");
    mocks.findUnique.mockResolvedValue({
      brief: null,
      title: "Existing title",
      description: "Existing description",
      phase: "ideate",
    });
    mocks.actionUpdateFeatureBrief.mockResolvedValue(undefined);
    mocks.updateBuildHappyPathState.mockResolvedValue(undefined);
  });

  it("passes the server-resolved MCP actor to the brief action", async () => {
    const result = await updateFeatureBrief({
      description: "Updated description",
      targetRoles: ["Shelter staff"],
      acceptanceCriteria: ["Staff can review the brief."],
    }, "mcp-actor-1");

    expect(result.success).toBe(true);
    expect(mocks.actionUpdateFeatureBrief).toHaveBeenCalledWith(
      "FB-123",
      expect.objectContaining({
        title: "Existing title",
        description: "Updated description",
        targetRoles: ["Shelter staff"],
      }),
      { actorUserId: "mcp-actor-1" },
    );
  });
});

describe("formatUpdateFeatureBriefError (BI-PIR-309fb74b / BI-PIR-f8c1640b)", () => {
  it("claims past-ideate only when the underlying error is the phase gate", () => {
    const r = formatUpdateFeatureBriefError(
      new Error("Brief can only be updated during Ideate phase"),
    );
    expect(r.message).toMatch(/past that phase/i);
    expect(r.message).toMatch(/Ideate phase/i);
  });

  it("does NOT claim past-ideate for validation failures (fixContext-only was misreported this way)", () => {
    const r = formatUpdateFeatureBriefError(new Error("title is required, description is required"));
    expect(r.message).not.toMatch(/past that phase/i);
    expect(r.message).toContain("title is required");
  });

  it("does NOT claim past-ideate for Forbidden", () => {
    const r = formatUpdateFeatureBriefError(new Error("Forbidden"));
    expect(r.message).not.toMatch(/past that phase/i);
    expect(r.message).toContain("Forbidden");
  });
});
