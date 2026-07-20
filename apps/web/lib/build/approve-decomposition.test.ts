// apps/web/lib/build/approve-decomposition.test.ts
//
// Coverage for Phase 4a atomic Epic-and-children creation.
// Spec: docs/superpowers/specs/2026-05-24-build-studio-design-time-decomposition-design.md
// BI: BI-2E6CC391.

import { describe, expect, it, vi } from "vitest";

import type {
  ApproveDecompositionDb,
  TxShape,
} from "./approve-decomposition";
import {
  approveDecomposition,
  selectUnblockedChildBuildIds,
} from "./approve-decomposition";
import type { DecompositionCandidate } from "./decomposition-candidates";

// --- Fake DB harness -------------------------------------------------------

type FakeBuild = {
  id: string;
  buildId: string;
  title: string;
  phase: string;
  designDoc: unknown;
  designReview: unknown;
  planReview: unknown;
  parentEpicId: string | null;
  originatingBacklogItemId: string | null;
  originator: {
    itemId: string;
    type: string;
    workType: string | null;
    source: string | null;
  } | null;
  digitalProductId: string | null;
  portfolioId: string | null;
  accountableEmployeeId: string | null;
  createdById: string;
};

type RecordedWrites = {
  epicCreates: Array<Record<string, unknown>>;
  childBuildCreates: Array<Record<string, unknown>>;
  dependencyCreates: Array<Record<string, unknown>>;
  buildUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  backlogItemUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  backlogItemCreates: Array<Record<string, unknown>>;
  backlogActivities: Array<Record<string, unknown>>;
  activities: Array<Record<string, unknown>>;
};

function makeFakeDb(build: FakeBuild | null): {
  db: ApproveDecompositionDb;
  writes: RecordedWrites;
} {
  const writes: RecordedWrites = {
    epicCreates: [],
    childBuildCreates: [],
    dependencyCreates: [],
    buildUpdates: [],
    backlogItemUpdates: [],
    backlogItemCreates: [],
    backlogActivities: [],
    activities: [],
  };

  let epicRowSeq = 0;
  let buildRowSeq = 0;

  const tx: TxShape = {
    epic: {
      create: vi.fn(async ({ data }) => {
        writes.epicCreates.push(data);
        return { id: `epic-row-${++epicRowSeq}`, epicId: data.epicId as string };
      }),
    },
    featureBuild: {
      create: vi.fn(async ({ data }) => {
        writes.childBuildCreates.push(data);
        return { id: `build-row-${++buildRowSeq}`, buildId: data.buildId as string };
      }),
      update: vi.fn(async (args) => {
        writes.buildUpdates.push(args);
        return null;
      }),
    },
    featureBuildDependency: {
      create: vi.fn(async ({ data }) => {
        writes.dependencyCreates.push(data);
        return null;
      }),
    },
    backlogItem: {
      create: vi.fn(async ({ data }) => {
        writes.backlogItemCreates.push(data);
        return { id: `bi-child-row-${writes.backlogItemCreates.length}`, itemId: data.itemId as string };
      }),
      update: vi.fn(async (args) => {
        writes.backlogItemUpdates.push(args);
        return null;
      }),
    },
    backlogItemActivity: {
      create: vi.fn(async ({ data }) => {
        writes.backlogActivities.push(data);
        return { id: "coverage-receipt-1" };
      }),
    },
    buildActivity: {
      create: vi.fn(async ({ data }) => {
        writes.activities.push(data);
        return null;
      }),
    },
  };

  const db: ApproveDecompositionDb = {
    featureBuild: {
      findUnique: vi.fn(async () => build) as unknown as ApproveDecompositionDb["featureBuild"]["findUnique"],
    },
    $transaction: vi.fn(async (fn) => fn(tx)) as unknown as ApproveDecompositionDb["$transaction"],
  };

  return { db, writes };
}

function makeBuild(overrides: Partial<FakeBuild> = {}): FakeBuild {
  return {
    id: "build-row-parent",
    buildId: "FB-PARENT",
    title: "Truck inventory",
    phase: "ideate",
    designDoc: {
      problemStatement: "stop driving back",
      reusePlan: "n/a",
      proposedApproach: "list + usage",
      acceptanceCriteria: ["AC0", "AC1", "AC2", "AC3", "AC4"],
    },
    designReview: { decision: "pass", issues: [], summary: "ok" },
    planReview: null,
    parentEpicId: null,
    originatingBacklogItemId: "bi-row-001",
    originator: {
      itemId: "BI-PARENT",
      type: "portfolio",
      workType: "feature",
      source: "user-request",
    },
    digitalProductId: null,
    portfolioId: null,
    accountableEmployeeId: null,
    createdById: "user-1",
    ...overrides,
  };
}

function makeCandidate(): DecompositionCandidate {
  return {
    candidateId: "cand-1",
    rationale: "Read first, write second, low-stock third.",
    childScopes: [
      { childOrder: 1, title: "Read", summary: "Show parts", acceptanceCriteriaIndices: [0], dependsOn: [] },
      { childOrder: 2, title: "Usage", summary: "Mark used", acceptanceCriteriaIndices: [1, 2], dependsOn: [1] },
      { childOrder: 3, title: "Low-stock", summary: "Restock view", acceptanceCriteriaIndices: [3, 4], dependsOn: [1, 2] },
    ],
  };
}

const fixedNow = () => new Date("2026-05-24T20:00:00.000Z");

// Each test that needs deterministic ids calls makeIdGen() to get its own
// counter — sharing a module-level idGen lets state leak between tests
// (children get FB-CHILD22 in the third test if the prior tests already
// burned 21 increments).
function makeIdGen(): { epicId: () => string; childBuildId: () => string; childBacklogItemId: () => string } {
  let n = 0;
  let bi = 0;
  return {
    epicId: () => "EP-TESTEPIC",
    childBuildId: () => `FB-CHILD${++n}`,
    childBacklogItemId: () => `BI-CHILD${++bi}`,
  };
}

// --- Tests -----------------------------------------------------------------

describe("approveDecomposition — eligibility checks", () => {
  it("returns build-not-found when the buildId does not exist", async () => {
    const { db } = makeFakeDb(null);
    const result = await approveDecomposition({
      buildId: "FB-MISSING",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-not-found");
  });

  it("rejects when build is neither ideate nor an oscillating plan build", async () => {
    const { db } = makeFakeDb(makeBuild({ phase: "build" }));
    const result = await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-not-in-ideate");
  });

  it("allows approval from an oscillating plan build", async () => {
    const { db, writes } = makeFakeDb(makeBuild({
      phase: "plan",
      planReview: {
        decision: "fail",
        summary: "Plan keeps trading scope issues.",
        issues: [],
        iteration: {
          round: 3,
          prior: { issueCount: 8, addressed: 2, persisted: 5, newlySurfaced: 3 },
          oscillating: true,
        },
      },
    }));
    const result = await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });

    expect(result.ok).toBe(true);
    expect(writes.epicCreates).toHaveLength(1);
    expect(writes.buildUpdates[0]!.data.supersededByEpicId).toBe("epic-row-1");
  });

  it("rejects when build has no designDoc", async () => {
    const { db } = makeFakeDb(makeBuild({ designDoc: null }));
    const result = await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-missing-design-doc");
  });

  it("rejects when designReview is not pass", async () => {
    const { db } = makeFakeDb(
      makeBuild({ designReview: { decision: "fail", issues: [], summary: "x" } }),
    );
    const result = await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-design-review-not-passed");
  });

  it("rejects recursive decomposition (build already has parentEpicId)", async () => {
    const { db } = makeFakeDb(makeBuild({ parentEpicId: "epic-row-other" }));
    const result = await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("build-already-decomposed");
  });

  it("rejects malformed candidate (e.g. only 1 child)", async () => {
    const bad: DecompositionCandidate = {
      candidateId: "cand-bad",
      rationale: "single child",
      childScopes: [
        { childOrder: 1, title: "Solo", summary: "", acceptanceCriteriaIndices: [0, 1, 2, 3, 4], dependsOn: [] },
      ],
    };
    const { db } = makeFakeDb(makeBuild());
    const result = await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: bad,
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("candidate-validation-failed");
  });
});

describe("approveDecomposition — happy path (Dale scenario)", () => {
  it("creates one Epic, three children, two dependency edges atomically", async () => {
    const { db, writes } = makeFakeDb(makeBuild());
    const result = await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      agentId: "agent-1",
      db,
      now: fixedNow,
      idGen: {
        epicId: () => "EP-TESTEPIC",
        childBuildId: (() => {
          let n = 0;
          return () => `FB-CHILD${++n}`;
        })(),
        childBacklogItemId: (() => {
          let n = 0;
          return () => `BI-CHILD${++n}`;
        })(),
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.epicId).toBe("EP-TESTEPIC");
    expect(result.childBuildIds).toEqual(["FB-CHILD1", "FB-CHILD2", "FB-CHILD3"]);
    expect(result.childBacklogItemIds).toEqual(["BI-CHILD1", "BI-CHILD2", "BI-CHILD3"]);

    expect(writes.epicCreates).toHaveLength(1);
    expect(writes.childBuildCreates).toHaveLength(3);
    expect(writes.backlogItemCreates).toHaveLength(3);
    expect(writes.dependencyCreates).toHaveLength(3); // 1->none, 2->1, 3->{1,2}
    expect(writes.buildUpdates).toHaveLength(1); // supersession of parent
    expect(writes.backlogItemUpdates).toHaveLength(4); // 3 child active links + parent active swap
    expect(writes.backlogActivities).toHaveLength(1); // canonical plan-coverage receipt
  });

  it("copies parent designReview onto every child (transitive approval)", async () => {
    const { db, writes } = makeFakeDb(makeBuild());
    const result = await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    expect(result.ok).toBe(true);
    for (const c of writes.childBuildCreates) {
      expect(c.designReview).toEqual({ decision: "pass", issues: [], summary: "ok" });
    }
  });

  it("derives each child's designDoc to the right AC subset", async () => {
    const { db, writes } = makeFakeDb(makeBuild());
    await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    const child1 = writes.childBuildCreates[0]!;
    const child1Doc = child1.designDoc as { acceptanceCriteria: string[] };
    expect(child1Doc.acceptanceCriteria).toEqual(["AC0"]);

    const child2 = writes.childBuildCreates[1]!;
    const child2Doc = child2.designDoc as { acceptanceCriteria: string[] };
    expect(child2Doc.acceptanceCriteria).toEqual(["AC1", "AC2"]);

    const child3 = writes.childBuildCreates[2]!;
    const child3Doc = child3.designDoc as { acceptanceCriteria: string[] };
    expect(child3Doc.acceptanceCriteria).toEqual(["AC3", "AC4"]);
  });

  it("marks the originating build superseded with phase=failed + supersededByEpicId + abandonReason", async () => {
    const { db, writes } = makeFakeDb(makeBuild());
    await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    const update = writes.buildUpdates[0]!;
    expect(update.where).toEqual({ buildId: "FB-PARENT" });
    expect(update.data.phase).toBe("failed");
    expect(update.data.supersededByEpicId).toBe("epic-row-1"); // row id, not epicId string
    expect(update.data.abandonReason).toBe("decomposed-into-epic:EP-TESTEPIC");
    expect(update.data.abandonedAt).toBeInstanceOf(Date);
  });

  it("swaps the backlog item from activeBuildId to activeEpicId", async () => {
    const { db, writes } = makeFakeDb(makeBuild());
    await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    const biUpdate = writes.backlogItemUpdates[0]!;
    expect(biUpdate.where).toEqual({ id: "bi-row-001" });
    expect(biUpdate.data.activeBuildId).toBeNull();
    expect(biUpdate.data.activeEpicId).toBe("epic-row-1");
  });

  it("does not touch backlog item when originating build has no BI", async () => {
    const { db, writes } = makeFakeDb(makeBuild({ originatingBacklogItemId: null }));
    await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    expect(writes.backlogItemUpdates).toHaveLength(0);
  });

  it("preserves Q5 hybrid: child builds carry originatingBacklogItemId AND Epic also carries it", async () => {
    const { db, writes } = makeFakeDb(makeBuild());
    await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    expect(writes.epicCreates[0]!.originatingBacklogItemId).toBe("bi-row-001");
    for (const c of writes.childBuildCreates) {
      expect(c.originatingBacklogItemId).toMatch(/^bi-child-row-/);
    }
  });

  it("materializes one live child BI per independently shippable child and records dependencies", async () => {
    const { db, writes } = makeFakeDb(makeBuild());
    const result = await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });

    expect(result.ok).toBe(true);
    expect(writes.backlogItemCreates.map((row) => row.itemId)).toEqual([
      "BI-CHILD1",
      "BI-CHILD2",
      "BI-CHILD3",
    ]);
    expect(writes.backlogItemCreates.every((row) => row.epicId === "epic-row-1")).toBe(true);
    expect(writes.backlogActivities[0]).toMatchObject({
      backlogItemId: "bi-row-001",
      kind: "plan_backlog_coverage",
      payload: {
        decision: "decomposed",
        mappedItemIds: ["BI-CHILD1", "BI-CHILD2", "BI-CHILD3"],
      },
    });
    const deliverables = (writes.backlogActivities[0]!.payload as { deliverables: Array<{ dependsOn: string[] }> }).deliverables;
    expect(deliverables[2]!.dependsOn).toEqual(["child-1", "child-2"]);
  });

  it("records decompositionState on the Epic with operator + agent + timestamp", async () => {
    const { db, writes } = makeFakeDb(makeBuild());
    await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      agentId: "agent-42",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    const epic = writes.epicCreates[0]!;
    const state = epic.decompositionState as {
      sourceBuildId: string;
      candidateId: string;
      approvedByUserId: string;
      approvedByAgentId: string | null;
      approvedAt: string;
      partition: unknown[];
    };
    expect(state.sourceBuildId).toBe("FB-PARENT");
    expect(state.candidateId).toBe("cand-1");
    expect(state.approvedByUserId).toBe("user-1");
    expect(state.approvedByAgentId).toBe("agent-42");
    expect(state.approvedAt).toBe("2026-05-24T20:00:00.000Z");
    expect(state.partition).toHaveLength(3);
  });

  it("logs one activity on the parent and one per child", async () => {
    const { db, writes } = makeFakeDb(makeBuild());
    await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
    });
    expect(writes.activities).toHaveLength(4);
    expect(writes.activities[0]!.buildId).toBe("FB-PARENT");
    expect(writes.activities[0]!.tool).toBe("approveDecomposition");
    const childBuildIds = writes.activities.slice(1).map((a) => a.buildId);
    expect(childBuildIds).toEqual(["FB-CHILD1", "FB-CHILD2", "FB-CHILD3"]);
  });

  it("returns unblocked head-of-chain children and plan-dispatches only those (BI-E49DDE47)", async () => {
    const { db } = makeFakeDb(makeBuild());
    const dispatchPlanForChild = vi.fn(async () => ({ kind: "dispatched-success" }));
    const result = await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: makeCandidate(),
      userId: "user-1",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
      dispatchPlanForChild,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    // Dale fixture: child 1 has dependsOn=[], 2 depends on 1, 3 on 1+2
    expect(result.unblockedChildBuildIds).toEqual(["FB-CHILD1"]);
    // fire-and-forget — flush microtasks
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatchPlanForChild).toHaveBeenCalledTimes(1);
    expect(dispatchPlanForChild).toHaveBeenCalledWith({
      buildId: "FB-CHILD1",
      userId: "user-1",
    });
  });

  it("plan-dispatches every child when the partition has no dependency edges", async () => {
    const { db } = makeFakeDb(makeBuild());
    const dispatchPlanForChild = vi.fn(async () => ({ kind: "dispatched-success" }));
    const result = await approveDecomposition({
      buildId: "FB-PARENT",
      candidate: {
        ...makeCandidate(),
        childScopes: [
          {
            childOrder: 1,
            title: "Solo-A",
            summary: "",
            acceptanceCriteriaIndices: [0, 1],
            dependsOn: [],
          },
          {
            childOrder: 2,
            title: "Solo-B",
            summary: "",
            acceptanceCriteriaIndices: [2, 3, 4],
            dependsOn: [],
          },
        ],
      },
      userId: "user-9",
      db,
      now: fixedNow,
      idGen: makeIdGen(),
      dispatchPlanForChild,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.unblockedChildBuildIds).toEqual(["FB-CHILD1", "FB-CHILD2"]);
    await Promise.resolve();
    await Promise.resolve();
    expect(dispatchPlanForChild).toHaveBeenCalledTimes(2);
    expect(dispatchPlanForChild).toHaveBeenCalledWith({
      buildId: "FB-CHILD1",
      userId: "user-9",
    });
    expect(dispatchPlanForChild).toHaveBeenCalledWith({
      buildId: "FB-CHILD2",
      userId: "user-9",
    });
  });
});

describe("selectUnblockedChildBuildIds", () => {
  it("keeps only scopes with empty dependsOn that resolve in the order map", () => {
    const map = new Map<number, string>([
      [1, "FB-A"],
      [2, "FB-B"],
      [3, "FB-C"],
    ]);
    expect(
      selectUnblockedChildBuildIds(
        [
          { childOrder: 1, dependsOn: [] },
          { childOrder: 2, dependsOn: [1] },
          { childOrder: 3, dependsOn: [] },
          { childOrder: 99, dependsOn: [] }, // missing from map
        ],
        map,
      ),
    ).toEqual(["FB-A", "FB-C"]);
  });
});
