import { beforeEach, describe, expect, it, vi } from "vitest";

// EP-UNIFIED-TRACKING Phase 0 / BI-4196AB21 — record_external_development_evidence
// must validate that the caller owns the supplied buildId before writing an
// ExternalEvidenceRecord. Access model is owner-only (createdById === userId),
// mirroring resolveActiveBuildId.

const mockPrisma = {
  featureBuild: {
    findUnique: vi.fn(),
  },
  externalEvidenceRecord: {
    create: vi.fn(),
    update: vi.fn(),
  },
  workroom: {
    findMany: vi.fn(async () => []),
    findFirst: vi.fn(async () => null),
  },
};

vi.mock("@dpf/db", () => ({
  DISCOVERY_TRIAGE_AGENT_ID: "AGT-DISCOVERY",
  prisma: mockPrisma,
}));

vi.mock("@/lib/identity/principal-linking", () => ({
  ensureAgentPrincipalIdentity: vi.fn(async () => ({ id: "principal-agent" })),
  syncUserPrincipal: vi.fn(async () => ({ id: "principal-user" })),
}));

const baseParams = {
  provider: "claude",
  externalSessionId: "sess-1",
  summary: "Implemented the ownership guard",
  routeContext: "cli",
};

describe("record_external_development_evidence — build ownership guard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.externalEvidenceRecord.create.mockResolvedValue({
      id: "EV-1",
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
    });
  });

  it("rejects a buildId owned by a different user and does not write", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      buildId: "FB-OTHER",
      createdById: "user-2",
    });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "record_external_development_evidence",
      { ...baseParams, buildId: "FB-OTHER" },
      "user-1",
    );

    expect(result.success).toBe(false);
    expect(result.error).toBe("forbidden");
    expect(mockPrisma.externalEvidenceRecord.create).not.toHaveBeenCalled();
  });

  it("allows a non-existent buildId (dangling, not a security risk) and writes", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue(null);

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "record_external_development_evidence",
      { ...baseParams, buildId: "FB-GHOST" },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.externalEvidenceRecord.create).toHaveBeenCalledTimes(1);
  });

  it("writes when the supplied buildId is owned by the caller", async () => {
    mockPrisma.featureBuild.findUnique.mockResolvedValue({
      buildId: "FB-MINE",
      createdById: "user-1",
    });

    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "record_external_development_evidence",
      { ...baseParams, buildId: "FB-MINE" },
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.externalEvidenceRecord.create).toHaveBeenCalledTimes(1);
  });

  it("writes without an ownership lookup when no buildId is supplied", async () => {
    const { executeTool } = await import("@/lib/mcp-tools");
    const result = await executeTool(
      "record_external_development_evidence",
      baseParams,
      "user-1",
    );

    expect(result.success).toBe(true);
    expect(mockPrisma.featureBuild.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.externalEvidenceRecord.create).toHaveBeenCalledTimes(1);
  });
});
