import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({
  prisma: {
    externalEvidenceRecord: {
      create: vi.fn(),
    },
    workroom: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@dpf/db";
import { recordExternalEvidence } from "./external-evidence";
import { recordExternalEvidenceInStore } from "@/lib/observability/external-evidence-store";

const mockPrisma = prisma as any;

describe("external evidence", () => {
  it("keeps evidence and capsule resolution within the supplied transaction", async () => {
    const transaction = {
      workroom: { findMany: vi.fn().mockResolvedValue([{ id: "room-transaction", executorKind: "codex" }]) },
      externalEvidenceRecord: { create: vi.fn().mockResolvedValue({ id: "evidence-transaction" }) },
    };
    await recordExternalEvidenceInStore({ actorUserId: "user-1", routeContext: "change-review",
      operationType: "semantic-change-review.receipt", target: "gate-1", provider: "reviewer",
      resultSummary: "Review complete", buildId: "build-1" }, transaction as never);
    expect(transaction.externalEvidenceRecord.create).toHaveBeenCalledWith({ data: expect.objectContaining({ workCapsuleId: "room-transaction" }) });
    expect(mockPrisma.externalEvidenceRecord.create).not.toHaveBeenCalled();
    expect(mockPrisma.workroom.findMany).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no capsule linked to any build (the buildId-resolve path is a no-op).
    mockPrisma.workroom.findMany.mockResolvedValue([]);
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

  it("resolves the capsule from buildId and inherits its executorKind when exactly one matches", async () => {
    mockPrisma.workroom.findMany.mockResolvedValue([
      { id: "WC-1", executorKind: "codex-desktop" },
    ]);
    mockPrisma.externalEvidenceRecord.create.mockResolvedValue({ id: "evidence-3" });

    await recordExternalEvidence({
      actorUserId: "user-1",
      routeContext: "/build",
      operationType: "external_development_handoff",
      target: "codex-session-2",
      provider: "codex",
      resultSummary: "Implemented feature.",
      buildId: "FB-777",
    });

    expect(mockPrisma.workroom.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { featureBuildId: "FB-777" }, take: 2 }),
    );
    expect(mockPrisma.externalEvidenceRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workCapsuleId: "WC-1",
        executorKind: "codex-desktop",
      }),
    });
  });

  it("leaves the capsule unset when more than one build match is ambiguous", async () => {
    mockPrisma.workroom.findMany.mockResolvedValue([
      { id: "WC-1", executorKind: "codex-desktop" },
      { id: "WC-2", executorKind: "claude-desktop" },
    ]);
    mockPrisma.externalEvidenceRecord.create.mockResolvedValue({ id: "evidence-4" });

    await recordExternalEvidence({
      actorUserId: "user-1",
      routeContext: "/build",
      operationType: "external_development_handoff",
      target: "codex-session-3",
      provider: "codex",
      resultSummary: "Ambiguous build.",
      buildId: "FB-DUP",
    });

    const call = mockPrisma.externalEvidenceRecord.create.mock.calls[0][0];
    expect(call.data).not.toHaveProperty("workCapsuleId");
    expect(call.data).not.toHaveProperty("executorKind");
  });

  it("persists an explicit capsule link and producer identity without re-resolving", async () => {
    mockPrisma.externalEvidenceRecord.create.mockResolvedValue({ id: "evidence-5" });

    await recordExternalEvidence({
      actorUserId: "user-1",
      routeContext: "/build",
      operationType: "external_development_handoff",
      target: "grok-session-1",
      provider: "grok",
      resultSummary: "Finished the handoff.",
      buildId: "FB-888",
      workCapsuleId: "WC-EXPLICIT",
      executorKind: "grok-desktop",
      recordedByPrincipalId: "principal-9",
      recordedByAgentId: "agent-9",
    });

    // Explicit workCapsuleId short-circuits the buildId resolution.
    expect(mockPrisma.workroom.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.externalEvidenceRecord.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        workCapsuleId: "WC-EXPLICIT",
        executorKind: "grok-desktop",
        recordedByPrincipalId: "principal-9",
        recordedByAgentId: "agent-9",
      }),
    });
  });
});
