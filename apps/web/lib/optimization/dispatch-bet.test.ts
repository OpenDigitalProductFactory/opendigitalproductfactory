// Tests for the consolidation-bet dispatch harness (BI-C350F8B0): eligible
// items promote through the governed core, ineligible items are reported
// with reasons, and the profession coworker is attributed.

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    agent: { findFirst: vi.fn() },
    platformDevConfig: { findUnique: vi.fn() },
    backlogItem: { findUnique: vi.fn() },
    featureBuild: { count: vi.fn() },
    $transaction: vi.fn(),
  },
  promoteBacklogItemToBuildDraft: vi.fn(),
  evaluateItemAdmission: vi.fn(),
  recordAdmissionOutcome: vi.fn(),
  dispatchIdeateForApprovedBuild: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/governed-backlog-tee-up", () => ({
  promoteBacklogItemToBuildDraft: mocks.promoteBacklogItemToBuildDraft,
}));
vi.mock("@/lib/build/investment-admission", async (importOriginal) => ({
  blocksStart: (await importOriginal<typeof import("@/lib/build/investment-admission")>()).blocksStart,
  evaluateItemAdmission: mocks.evaluateItemAdmission,
  recordAdmissionOutcome: mocks.recordAdmissionOutcome,
}));
vi.mock("@/lib/build/ideate-on-approval", () => ({
  dispatchIdeateForApprovedBuild: mocks.dispatchIdeateForApprovedBuild,
}));

import { dispatchConsolidationBet, resolveCoworkerForProfession } from "./dispatch-bet";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.platformDevConfig.findUnique.mockResolvedValue({ governedBacklogEnabled: true });
  mocks.prisma.featureBuild.count.mockResolvedValue(0);
  mocks.evaluateItemAdmission.mockResolvedValue({ verdict: "admit", reason: "fits" });
  mocks.prisma.$transaction.mockImplementation(async (fn: (tx: unknown) => unknown) => fn({}));
  mocks.prisma.agent.findFirst.mockResolvedValue({
    agentId: "AGT-SW-ENG",
    name: "Software Engineer",
    slugId: "build-software-engineer",
  });
});

describe("dispatchConsolidationBet", () => {
  it("rejects an unknown bet", async () => {
    const result = await dispatchConsolidationBet({ betKey: "BET-99", userId: "u1" });
    expect(result).toMatchObject({ error: "unknown_bet" });
  });

  it("promotes an open build-triaged item and attributes the profession coworker", async () => {
    // BET-11 has exactly one backlog item (BI-B72328D5).
    mocks.prisma.backlogItem.findUnique.mockResolvedValue({
      itemId: "BI-B72328D5",
      status: "open",
      triageOutcome: "build",
      activeBuildId: null,
    });
    mocks.promoteBacklogItemToBuildDraft.mockResolvedValue({
      kind: "success",
      build: { id: "row", buildId: "FB-123" },
      autoApprovedDispatchEligible: true,
    });

    const result = await dispatchConsolidationBet({ betKey: "BET-11", userId: "u1" });
    if ("error" in result) throw new Error("unexpected error result");

    expect(result.promoted).toEqual([
      { itemId: "BI-B72328D5", buildId: "FB-123", ideateDispatched: true },
    ]);
    expect(result.skipped).toEqual([]);
    expect(result.professionKey).toBe("software-engineer");
    expect(result.coworker?.agentId).toBe("AGT-SW-ENG");
    expect(mocks.promoteBacklogItemToBuildDraft).toHaveBeenCalledWith(
      expect.objectContaining({ itemId: "BI-B72328D5", userId: "u1", governedBacklogEnabled: true }),
    );
  });

  it("skips with reasons instead of silently dropping ineligible items", async () => {
    mocks.prisma.backlogItem.findUnique.mockResolvedValue({
      itemId: "BI-B72328D5",
      status: "open",
      triageOutcome: null,
      activeBuildId: null,
    });

    const result = await dispatchConsolidationBet({ betKey: "BET-11", userId: "u1" });
    if ("error" in result) throw new Error("unexpected error result");

    expect(result.promoted).toEqual([]);
    expect(result.skipped).toEqual([
      { itemId: "BI-B72328D5", reason: "not-triaged-build", detail: "untriaged" },
    ]);
    expect(mocks.promoteBacklogItemToBuildDraft).not.toHaveBeenCalled();
  });

  it("refuses by points in flight instead of promoting past the allowance (BI-3430B3A4)", async () => {
    mocks.prisma.backlogItem.findUnique.mockResolvedValue({
      itemId: "BI-B72328D5",
      status: "open",
      triageOutcome: "build",
      activeBuildId: null,
    });
    mocks.evaluateItemAdmission.mockResolvedValue({ verdict: "refuse", reason: "Starting this takes the portfolio to 11 of 8 points in flight (3 over)." });

    const result = await dispatchConsolidationBet({ betKey: "BET-11", userId: "u1" });
    if ("error" in result) throw new Error("unexpected error result");

    expect(result.skipped).toEqual([
      { itemId: "BI-B72328D5", reason: "promotion-error", detail: expect.stringContaining("wip_allowance_reached") },
    ]);
    expect(mocks.evaluateItemAdmission).toHaveBeenCalledWith(expect.anything(), { itemId: "BI-B72328D5", startKind: "autonomous" });
    expect(mocks.recordAdmissionOutcome).toHaveBeenCalled();
  });

  it("surfaces promotion-core errors per item", async () => {
    mocks.prisma.backlogItem.findUnique.mockResolvedValue({
      itemId: "BI-B72328D5",
      status: "open",
      triageOutcome: "build",
      activeBuildId: null,
    });
    mocks.promoteBacklogItemToBuildDraft.mockResolvedValue({
      kind: "error",
      error: "Item already has an active build",
      message: "…",
    });

    const result = await dispatchConsolidationBet({ betKey: "BET-11", userId: "u1" });
    if ("error" in result) throw new Error("unexpected error result");

    expect(result.skipped[0]).toMatchObject({ reason: "promotion-error" });
  });
});

describe("resolveCoworkerForProfession", () => {
  it("walks the registry roles in order and returns the first live agent", async () => {
    mocks.prisma.agent.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ agentId: "AGT-2", name: "Second Role", slugId: "role-2" });

    const coworker = await resolveCoworkerForProfession("software-engineer");
    expect(coworker?.agentId).toBe("AGT-2");
  });

  it("returns null for an unknown profession", async () => {
    expect(await resolveCoworkerForProfession("not-a-family")).toBeNull();
  });
});
