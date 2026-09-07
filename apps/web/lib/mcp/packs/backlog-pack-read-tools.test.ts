import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  findEpic: vi.fn(),
  countEpics: vi.fn(),
  findEpics: vi.fn(),
  buildReferenceIndex: vi.fn(),
  searchSpecsAndPlans: vi.fn(),
  specPlanCorpusCaveat: vi.fn(),
  loadBacklogWorkroomOwnership: vi.fn(),
  mapDemandRows: vi.fn(),
  projectReadiness: vi.fn(),
}));

const CORPUS_AVAILABLE = { available: true, root: "/repo", searchedPaths: ["docs/superpowers/specs", "docs/superpowers/plans"], missingPaths: [], fileCount: 2, reason: "Searched 2 markdown file(s)." };

vi.mock("@dpf/db", () => ({
  prisma: {
    backlogItem: { count: mocks.count, findMany: mocks.findMany, findUnique: mocks.findUnique, findFirst: vi.fn().mockResolvedValue(null) },
    backlogItemActivity: { findMany: vi.fn().mockResolvedValue([]) },
    epic: { findFirst: mocks.findEpic, count: mocks.countEpics, findMany: mocks.findEpics },
  },
}));

vi.mock("@/lib/backlog/spec-plan-search", () => ({
  buildSpecPlanReferenceIndex: mocks.buildReferenceIndex,
  searchSpecsAndPlans: mocks.searchSpecsAndPlans,
  specPlanCorpusCaveat: mocks.specPlanCorpusCaveat,
}));

vi.mock("@/lib/work-capsules/backlog-workroom-ownership", () => ({
  loadBacklogWorkroomOwnership: mocks.loadBacklogWorkroomOwnership,
}));

vi.mock("@/lib/demand/demand-data", () => ({ mapDemandRows: mocks.mapDemandRows }));
vi.mock("@/lib/backlog/initiative-readiness/entry-adapter", () => ({
  projectBacklogItemReadinessSummary: mocks.projectReadiness,
}));

import { getBacklogItem, listBacklogItems } from "./backlog-pack-read-tools";

const baseItem = {
  itemId: "BI-DEFERRAL",
  title: "Parked work",
  status: "deferred",
  type: "portfolio",
  workType: "feature",
  source: "user-request",
  priority: 1,
  effortSize: "small",
  demandStage: "qualified",
  demandScore: null,
  demandScoreFramework: null,
  scopeKind: "platform",
  archetypeCategories: [],
  archetypeIds: [],
  scopeRationale: null,
  lifecycleTags: [],
  activeBuildId: null,
  activeBuild: null,
  updatedAt: new Date("2026-08-15T12:00:00Z"),
  triageOutcome: "defer",
  epic: null,
};

describe("backlog deferral read projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.count.mockResolvedValue(1);
    mocks.findMany.mockResolvedValue([]);
    mocks.findUnique.mockResolvedValue(null);
    mocks.buildReferenceIndex.mockResolvedValue({ specs: new Set(), plans: new Set(), corpus: CORPUS_AVAILABLE });
    mocks.searchSpecsAndPlans.mockResolvedValue({ corpus: CORPUS_AVAILABLE, results: [] });
    mocks.specPlanCorpusCaveat.mockReturnValue(null);
    mocks.countEpics.mockResolvedValue(0);
    mocks.findEpics.mockResolvedValue([]);
    mocks.loadBacklogWorkroomOwnership.mockResolvedValue({ workrooms: [], liveWorkrooms: [] });
    mocks.mapDemandRows.mockReturnValue([{ activation: null, evidenceLinks: [] }]);
    mocks.projectReadiness.mockReturnValue({ verdict: "allowed" });
  });

  it("does not report a plan-only epic as having a spec", async () => {
    mocks.countEpics.mockResolvedValue(1);
    mocks.findEpics.mockResolvedValue([{
      id: "epic-row",
      epicId: "EP-PLAN-ONLY",
      title: "Plan only",
      status: "open",
      priority: 1,
      updatedAt: new Date("2026-08-22T00:00:00.000Z"),
      scopeKind: "platform",
      archetypeCategories: [],
      archetypeIds: [],
      scopeRationale: null,
      lifecycleTags: [],
      items: [],
    }]);
    mocks.buildReferenceIndex.mockResolvedValue({
      specs: new Set(),
      plans: new Set(["EP-PLAN-ONLY"]),
      corpus: CORPUS_AVAILABLE,
    });

    const { listEpics } = await import("./backlog-pack-read-tools");
    const result = await listEpics({});

    expect((result.data as { epics: unknown[] }).epics[0]).toMatchObject({
      hasSpec: false,
      hasPlan: true,
    });
  });

  it("shows bound and active Workrooms on the canonical item read", async () => {
    const active = { capsuleId: "WC-LIVE", headBranch: "fix/live", isLive: true };
    mocks.findUnique.mockResolvedValue({
      ...baseItem, id: "row-bi", itemId: "BI-WORKROOM", title: "Owned work", status: "open",
      body: null, createdAt: new Date("2026-08-31T00:00:00Z"), completedAt: null,
      deferOwnerPrincipal: null, epic: null, digitalProduct: null, organization: null,
      productLine: null, businessProduct: null, demandEvidenceLinks: [], activities: [],
    });
    mocks.loadBacklogWorkroomOwnership.mockResolvedValue({ workrooms: [active], liveWorkrooms: [active] });

    const result = await getBacklogItem({ itemId: "BI-WORKROOM" });

    expect(result).toMatchObject({ success: true, data: { workrooms: [active], activeWorkrooms: [active] } });
  });

  it("passes the persisted terminal readiness decision through the canonical item read", async () => {
    const terminalActivity = {
      id: "activity-terminal",
      kind: "initiative_readiness_decision",
      gateKey: null,
      recordedAt: new Date("2026-08-31T17:26:02.028Z"),
      payload: { schemaVersion: 1, target: "completion", verdict: "allowed" },
    };
    mocks.findUnique.mockResolvedValue({
      ...baseItem,
      id: "row-bi",
      itemId: "BI-COMPLETE",
      title: "Completed work",
      status: "done",
      body: null,
      createdAt: new Date("2026-08-01T00:00:00Z"),
      completedAt: new Date("2026-08-31T17:26:02.028Z"),
      deferOwnerPrincipal: null,
      epic: null,
      digitalProduct: null,
      organization: null,
      productLine: null,
      businessProduct: null,
      demandEvidenceLinks: [],
      activities: [terminalActivity],
    });
    mocks.projectReadiness.mockReturnValue({
      governed: true,
      artifactHints: { hasSpec: true, hasPlan: true },
      decisions: { completion: { verdict: "allowed" } },
    });

    const result = await getBacklogItem({ itemId: "BI-COMPLETE" });

    expect(result).toMatchObject({
      success: true,
      data: { status: "done", readiness: { decisions: { completion: { verdict: "allowed" } } } },
    });
    expect(mocks.projectReadiness).toHaveBeenCalledWith(expect.objectContaining({
      item: expect.objectContaining({ itemId: "BI-COMPLETE", status: "done" }),
      activities: [terminalActivity],
    }));
  });

  it("builds the nonconformant filter from the canonical projection fields", async () => {
    await listBacklogItems({ deferralConformance: "nonconformant" });

    expect(mocks.count).toHaveBeenCalledWith({
      where: {
        status: "deferred",
        OR: [
          { deferReason: null },
          { deferTrigger: null },
          { deferReviewAt: null },
          { deferOwnerPrincipalId: null },
          { deferredAt: null },
        ],
      },
    });
  });

  it("returns compliant owner, trigger, and review data without another query", async () => {
    mocks.findMany.mockResolvedValue([{
      ...baseItem,
      deferReason: "Waiting for the predecessor",
      deferTrigger: "The predecessor ships",
      deferReviewAt: new Date("2099-11-15T12:00:00Z"),
      deferOwnerPrincipalId: "principal-row-1",
      deferredAt: new Date("2026-08-15T12:00:00Z"),
      deferOwnerPrincipal: { principalId: "PRN-OWNER", displayName: "Portfolio owner" },
    }]);

    const result = await listBacklogItems({ deferralConformance: "compliant" });
    const item = (result.data as { items: Array<{ deferral: unknown }> }).items[0];

    expect(item?.deferral).toEqual({
      reason: "Waiting for the predecessor",
      trigger: "The predecessor ships",
      reviewAt: "2099-11-15T12:00:00.000Z",
      deferredAt: "2026-08-15T12:00:00.000Z",
      owner: { principalId: "PRN-OWNER", displayName: "Portfolio owner" },
      conformant: true,
      reviewDue: false,
    });
    expect(mocks.findMany).toHaveBeenCalledTimes(1);
  });

  it("rejects an invalid review horizon before querying the backlog", async () => {
    const result = await listBacklogItems({ deferralReviewDueBefore: "not-a-date" });

    expect(result).toMatchObject({ success: false, error: "invalid_deferral_review_due_before" });
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  // BI-10C34BE1: with no docs/superpowers tree every epic reads hasSpec:false /
  // hasPlan:false. That is indistinguishable from a genuinely undesigned
  // backlog, so the response has to say the measurement did not happen.
  it("states that spec/plan coverage was not measured when the corpus is absent", async () => {
    mocks.countEpics.mockResolvedValue(1);
    mocks.findEpics.mockResolvedValue([{
      id: "epic-row",
      epicId: "EP-NO-CORPUS",
      title: "Undesigned looking",
      status: "open",
      priority: 1,
      updatedAt: new Date("2026-08-26T00:00:00.000Z"),
      scopeKind: "platform",
      archetypeCategories: [],
      archetypeIds: [],
      scopeRationale: null,
      lifecycleTags: [],
      items: [],
    }]);
    const corpusAbsent = { ...CORPUS_AVAILABLE, available: false, fileCount: 0 };
    mocks.buildReferenceIndex.mockResolvedValue({
      specs: new Set(),
      plans: new Set(),
      corpus: corpusAbsent,
    });
    mocks.specPlanCorpusCaveat.mockReturnValue("Spec/plan coverage was NOT measured: no corpus.");

    const { listEpics } = await import("./backlog-pack-read-tools");
    const result = await listEpics({});

    expect(result.message).toContain("NOT measured");
    expect((result.data as { specPlanCorpus: { available: boolean } }).specPlanCorpus.available).toBe(false);
  });
});
