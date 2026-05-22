import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}));

vi.mock("@dpf/db", () => ({
  prisma: {
    bomDocument: { findFirst: vi.fn() },
    assuranceFinding: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/assurance/bom-trigger", () => ({
  queueBuildBomGeneration: vi.fn(),
}));

vi.mock("@/lib/assurance/scan-trigger", () => ({
  queueBuildAssuranceScan: vi.fn(),
}));

vi.mock("@/lib/assurance/finding-actions", () => ({
  updateAssuranceFindingStatus: vi.fn(),
  createBacklogItemFromFinding: vi.fn(),
}));

import { prisma } from "@dpf/db";
import { auth } from "@/lib/auth";
import { queueBuildBomGeneration } from "@/lib/assurance/bom-trigger";
import { queueBuildAssuranceScan } from "@/lib/assurance/scan-trigger";
import {
  createBacklogItemFromFinding,
  updateAssuranceFindingStatus,
} from "@/lib/assurance/finding-actions";
import {
  getBuildBomSummary,
  requestBacklogFromAssuranceFinding,
  requestBuildAssuranceScan,
  requestBuildBomGeneration,
  setAssuranceFindingStatus,
} from "./assurance";

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

const authorizedSession = {
  user: { id: "user-1", platformRole: "HR-000", isSuperuser: false },
} as never;

describe("assurance actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queues BOM generation for an authorized platform user", async () => {
    vi.mocked(auth).mockResolvedValue(authorizedSession);
    vi.mocked(queueBuildBomGeneration).mockResolvedValue({ ids: ["evt-1"] } as never);

    await expect(requestBuildBomGeneration("BUILD-1")).resolves.toEqual({ queued: true });

    expect(queueBuildBomGeneration).toHaveBeenCalledWith({
      buildId: "BUILD-1",
      requestedByUserId: "user-1",
    });
  });

  it("queues an assurance scan for an authorized platform user", async () => {
    vi.mocked(auth).mockResolvedValue(authorizedSession);
    vi.mocked(queueBuildAssuranceScan).mockResolvedValue({ ids: ["evt-2"] } as never);

    await expect(requestBuildAssuranceScan("BUILD-1")).resolves.toEqual({ queued: true });

    expect(queueBuildAssuranceScan).toHaveBeenCalledWith({
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

  it("forwards finding status updates with the authenticated user id", async () => {
    vi.mocked(auth).mockResolvedValue(authorizedSession);
    vi.mocked(updateAssuranceFindingStatus).mockResolvedValue({
      findingKey: "finding-key-1",
      previousStatus: "open",
      status: "resolved",
    });

    const result = await setAssuranceFindingStatus({
      findingKey: "finding-key-1",
      status: "resolved",
      reason: "Patched",
    });

    expect(result.status).toBe("resolved");
    expect(updateAssuranceFindingStatus).toHaveBeenCalledWith(prisma, expect.objectContaining({
      findingKey: "finding-key-1",
      status: "resolved",
      reason: "Patched",
      userId: "user-1",
    }));
  });

  it("creates a backlog item from a finding for the authenticated user", async () => {
    vi.mocked(auth).mockResolvedValue(authorizedSession);
    vi.mocked(createBacklogItemFromFinding).mockResolvedValue({
      findingKey: "finding-key-1",
      backlogItemId: "BI-NEW",
      epicCuid: "epic-cuid",
      alreadyLinked: false,
    });

    const result = await requestBacklogFromAssuranceFinding("finding-key-1");

    expect(result.backlogItemId).toBe("BI-NEW");
    expect(createBacklogItemFromFinding).toHaveBeenCalledWith(prisma, expect.objectContaining({
      findingKey: "finding-key-1",
      userId: "user-1",
    }));
  });
});
