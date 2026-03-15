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
});
