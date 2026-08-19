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
  wipCapReached: vi.fn(),
  dispatchIdeateForApprovedBuild: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/governed-backlog-tee-up", () => ({
  promoteBacklogItemToBuildDraft: mocks.promoteBacklogItemToBuildDraft,
}));
vi.mock("@/lib/build/wip-cap", () => ({
  wipCapReached: mocks.wipCapReached,
  TERMINAL_BUILD_PHASES: ["shipped", "abandoned"],
}));
vi.mock("@/lib/build/ideate-on-approval", () => ({
  dispatchIdeateForApprovedBuild: mocks.dispatchIdeateForApprovedBuild,
}));

import { dispatchConsolidationBet, resolveCoworkerForProfession } from "./dispatch-bet";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.prisma.platformDevConfig.findUnique.mockResolvedValue({ governedBacklogEnabled: true });
  mocks.prisma.featureBuild.count.mockResolvedValue(0);
  mocks.wipCapReached.mockReturnValue(false);
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

  it("reports the WIP cap instead of promoting past it", async () => {
    mocks.prisma.backlogItem.findUnique.mockResolvedValue({
      itemId: "BI-B72328D5",
      status: "open",
      triageOutcome: "build",
      activeBuildId: null,
    });
    mocks.wipCapReached.mockReturnValue(true);

    const result = await dispatchConsolidationBet({ betKey: "BET-11", userId: "u1" });
    if ("error" in result) throw new Error("unexpected error result");

    expect(result.skipped).toEqual([
      { itemId: "BI-B72328D5", reason: "promotion-error", detail: "wip_cap_reached" },
    ]);
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
