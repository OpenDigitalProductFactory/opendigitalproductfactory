import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    externalEvidenceRecord: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { recordExternalEvidence } from "./external-evidence";

const mockPrisma = prisma as any;

describe("external evidence", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes a normalized external evidence record", async () => {
    mockPrisma.externalEvidenceRecord.create.mockResolvedValue({
      id: "evidence-1",
      routeContext: "/admin",
      operationType: "branding_analysis",
      target: "https://jackjackspack.org/",
      provider: "public_fetch",
      resultSummary: "Derived branding proposal",
    });

    await recordExternalEvidence({
      actorUserId: "user-1",
      routeContext: "/admin",
      operationType: "branding_analysis",
      target: "https://jackjackspack.org/",
      provider: "public_fetch",
      resultSummary: "Derived branding proposal",
      details: {
        companyName: "Jack Jack's Pack",
      },
    });

    expect(mockPrisma.externalEvidenceRecord.create).toHaveBeenCalledWith({
      data: {
        actorUserId: "user-1",
        routeContext: "/admin",
        operationType: "branding_analysis",
        target: "https://jackjackspack.org/",
        provider: "public_fetch",
        resultSummary: "Derived branding proposal",
        details: {
          companyName: "Jack Jack's Pack",
        },
      },
    });
  });

  it("writes optional build and task links for external development evidence", async () => {
    mockPrisma.externalEvidenceRecord.create.mockResolvedValue({ id: "evidence-2" });

    await recordExternalEvidence({
      actorUserId: "user-1",
      routeContext: "/build",
      operationType: "external_development_handoff",
      target: "codex-session-1",
      provider: "codex",
      resultSummary: "Local integration passed.",
      buildId: "FB-123",
      taskRunId: "TR-123",
      details: { commits: ["abc123"] },
    });

    expect(mockPrisma.externalEvidenceRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        buildId: "FB-123",
        taskRunId: "TR-123",
      }),
    });
  });
});
