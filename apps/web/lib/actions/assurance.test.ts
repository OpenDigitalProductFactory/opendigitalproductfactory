import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    bomDocument: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/assurance/bom-trigger", () => ({
  queueBuildBomGeneration: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { queueBuildBomGeneration } from "@/lib/assurance/bom-trigger";
import { getBuildBomSummary, requestBuildBomGeneration } from "./assurance";

const emptyFindings = {
  total: 0,
  blocking: 0,
  bySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
  byKind: {},
};

const noScanner = {
  state: "needs-evaluation",
  approvedScannerCount: 0,
  scannerNames: [],
  reason: "no-approved-scanner",
};

describe("assurance actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues BOM generation for an authorized platform user", async () => {
    vi.mocked(auth).mockResolvedValue({
      user: { id: "user-1", platformRole: "HR-000", isSuperuser: false },
    } as never);
    vi.mocked(queueBuildBomGeneration).mockResolvedValue({ ids: ["evt-1"] } as never);

    await expect(requestBuildBomGeneration("BUILD-1")).resolves.toEqual({ queued: true });

    expect(queueBuildBomGeneration).toHaveBeenCalledWith({
      buildId: "BUILD-1",
      requestedByUserId: "user-1",
    });
  });

  it("rejects unauthenticated callers", async () => {
    vi.mocked(auth).mockResolvedValue(null as never);

    await expect(requestBuildBomGeneration("BUILD-1")).rejects.toThrow("Unauthorized");
    expect(queueBuildBomGeneration).not.toHaveBeenCalled();
  });

  it("normalizes build summary read failures to a missing state", async () => {
    vi.mocked(prisma.bomDocument.findFirst).mockRejectedValue(new Error("db down"));

    await expect(getBuildBomSummary("BUILD-1")).resolves.toEqual({
      state: "missing",
      document: null,
      counts: { components: 0, models: 0 },
      findings: emptyFindings,
      scanner: noScanner,
    });
  });
});
