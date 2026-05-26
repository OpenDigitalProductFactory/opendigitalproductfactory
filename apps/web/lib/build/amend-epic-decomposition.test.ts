import { describe, expect, it, vi } from "vitest";

import type { BuildDesignDoc, BuildPhase } from "@/lib/feature-build-types";
import type {
  AmendEpicDecompositionDb,
  AmendEpicDecompositionStartQuiescence,
  DecompositionAmendmentChild,
  DecompositionAmendmentTx,
} from "./amend-epic-decomposition";
import {
  amendEpicDecomposition,
  deriveDecompositionAmendmentImpact,
} from "./amend-epic-decomposition";

type FakeChild = DecompositionAmendmentChild & {
  designDoc: BuildDesignDoc;
};

type FakeEpic = {
  id: string;
  epicId: string;
  title: string;
  designDoc: BuildDesignDoc | null;
  decompositionState: unknown;
  featureBuilds: FakeChild[];
};

type RecordedWrites = {
  epicUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  buildUpdates: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }>;
  activities: Array<Record<string, unknown>>;
};

const currentParentDoc: BuildDesignDoc = {
  problemStatement: "Dale needs truck parts on hand without return trips.",
  reusePlan: "Reuse Build Studio FeatureBuild flow.",
  proposedApproach: "Create truck inventory read, use, and restock slices.",
  acceptanceCriteria: ["read parts", "mark part used", "see usage audit", "see low stock"],
};

const amendedParentDoc: BuildDesignDoc = {
  ...currentParentDoc,
  proposedApproach: "Prioritize in-truck part lookup and defer supplier automation.",
  acceptanceCriteria: ["read parts fast", "mark part used", "see usage audit", "see low stock"],
};

function makeChild(overrides: Partial<FakeChild>): FakeChild {
  const childOrder = overrides.childOrder ?? 1;
  return {
    id: `child-row-${childOrder}`,
    buildId: `FB-CHILD${childOrder}`,
    title: `Child ${childOrder}`,
    phase: "plan",
    childOrder,
    designDoc: {
      ...currentParentDoc,
      proposedApproach: `Child ${childOrder}`,
      acceptanceCriteria: [currentParentDoc.acceptanceCriteria[childOrder - 1] ?? "fallback"],
    },
    phaseRuns: [],
    ...overrides,
  };
}

function makeState(overrides: Record<string, unknown> = {}) {
  return {
    sourceBuildId: "FB-PARENT",
    candidateId: "cand-approved",
    candidateRationale: "Split read, usage, and restock.",
    approvedAt: "2026-05-24T20:00:00.000Z",
    approvedByUserId: "user-1",
    approvedByAgentId: "agent-1",
    partition: [
      {
        childOrder: 1,
        title: "Read parts",
        summary: "Show parts on a truck.",
        acceptanceCriteriaIndices: [0],
        dependsOn: [],
      },
      {
        childOrder: 2,
        title: "Use parts",
        summary: "Record parts used on a job.",
        acceptanceCriteriaIndices: [1, 2],
        dependsOn: [1],
      },
      {
        childOrder: 3,
        title: "Restock",
        summary: "Show low-stock items for follow-up.",
        acceptanceCriteriaIndices: [3],
        dependsOn: [1, 2],
      },
    ],
    ...overrides,
  };
}

function makeEpic(overrides: Partial<FakeEpic> = {}): FakeEpic {
  return {
    id: "epic-row-1",
    epicId: "EP-TRUCK-PARTS",
    title: "Truck inventory",
    designDoc: currentParentDoc,
    decompositionState: makeState(),
    featureBuilds: [
      makeChild({ childOrder: 1, phase: "complete" }),
      makeChild({
        childOrder: 2,
        phase: "plan",
        phaseRuns: [{ phase: "plan", completedAt: null }],
      }),
      makeChild({ childOrder: 3, phase: "plan" }),
    ],
    ...overrides,
  };
}

function makeFakeDb(epic: FakeEpic | null): {
  db: AmendEpicDecompositionDb;
  writes: RecordedWrites;
} {
  const writes: RecordedWrites = {
    epicUpdates: [],
    buildUpdates: [],
    activities: [],
  };

  const tx: DecompositionAmendmentTx = {
    epic: {
      update: vi.fn(async (args) => {
        writes.epicUpdates.push(args);
        return null;
      }),
    },
    featureBuild: {
      update: vi.fn(async (args) => {
        writes.buildUpdates.push(args);
        return null;
      }),
    },
    buildActivity: {
      create: vi.fn(async ({ data }) => {
        writes.activities.push(data);
        return null;
      }),
    },
  };

  return {
    writes,
    db: {
      epic: {
        findUnique: vi.fn(async () => epic) as AmendEpicDecompositionDb["epic"]["findUnique"],
      },
      $transaction: vi.fn(async (fn) => fn(tx)) as AmendEpicDecompositionDb["$transaction"],
    },
  };
}

function fakeQuiescence(runId = "QR-2026-05-24-amend"): AmendEpicDecompositionStartQuiescence {
  return vi.fn(async () => ({
    runId,
    awaitReady: vi.fn(async () => ({
      ok: true,
      outcome: "ready-to-swap",
      runId,
      finalSnapshot: {
        capturedAt: "2026-05-24T20:05:00.000Z",
        thresholdMs: 300000,
        totalBlockers: 0,
        hardBlockers: 0,
        softBlockers: 0,
        unobservableSurfaces: [],
        surfaces: [],
      },
    })),
  }));
}

describe("deriveDecompositionAmendmentImpact", () => {
  it("keeps completed children immutable, rederives planning children, and requires quiescence for in-flight Plan work", () => {
    const impact = deriveDecompositionAmendmentImpact({
      parentDesignDoc: amendedParentDoc,
      decompositionState: makeState(),
      children: makeEpic().featureBuilds,
    });

    expect(impact.ok).toBe(true);
    if (!impact.ok) throw new Error("unreachable");
    expect(impact.requiresQuiescence).toBe(true);
    expect(impact.completedChildBuildIds).toEqual(["FB-CHILD1"]);
    expect(impact.updatedChildren.map((child) => child.buildId)).toEqual(["FB-CHILD2", "FB-CHILD3"]);
    expect(impact.updatedChildren[0]!.designDoc.acceptanceCriteria).toEqual([
      "mark part used",
      "see usage audit",
    ]);
    expect(impact.updatedChildren[1]!.designDoc.acceptanceCriteria).toEqual(["see low stock"]);
  });

  it("blocks automatic amendment when an affected child has entered build, review, or ship", () => {
    const impact = deriveDecompositionAmendmentImpact({
      parentDesignDoc: amendedParentDoc,
      decompositionState: makeState(),
      children: makeEpic({
        featureBuilds: [
          makeChild({ childOrder: 1, phase: "complete" }),
          makeChild({ childOrder: 2, phase: "build" }),
          makeChild({ childOrder: 3, phase: "plan" }),
        ],
      }).featureBuilds,
    });

    expect(impact.ok).toBe(false);
    if (impact.ok) throw new Error("unreachable");
    expect(impact.code).toBe("execution-child-requires-operator-review");
    expect(impact.blockedChildBuildIds).toEqual(["FB-CHILD2"]);
  });

  it("rejects parent design amendments that change acceptance-criteria shape before a new partition is chosen", () => {
    const impact = deriveDecompositionAmendmentImpact({
      parentDesignDoc: {
        ...amendedParentDoc,
        acceptanceCriteria: [...amendedParentDoc.acceptanceCriteria, "new supplier automation"],
      },
      decompositionState: makeState(),
      children: makeEpic().featureBuilds,
    });

    expect(impact.ok).toBe(false);
    if (impact.ok) throw new Error("unreachable");
    expect(impact.code).toBe("acceptance-criteria-shape-changed");
  });
});

describe("amendEpicDecomposition", () => {
  it("drains in-flight Plan work, updates the parent Epic, rederives planning children, and leaves completed children untouched", async () => {
    const { db, writes } = makeFakeDb(makeEpic());
    const startQuiescence = fakeQuiescence();

    const result = await amendEpicDecomposition({
      epicId: "EP-TRUCK-PARTS",
      proposedDesignDoc: amendedParentDoc,
      rationale: "Dale needs lookup speed before supplier automation.",
      userId: "user-1",
      db,
      startQuiescence,
      now: () => new Date("2026-05-24T21:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.quiescenceRunId).toBe("QR-2026-05-24-amend");
    expect(result.updatedChildBuildIds).toEqual(["FB-CHILD2", "FB-CHILD3"]);
    expect(result.skippedCompletedChildBuildIds).toEqual(["FB-CHILD1"]);

    expect(startQuiescence).toHaveBeenCalledWith({
      trigger: "manual",
      triggerRefId: "decomposition-amendment:EP-TRUCK-PARTS",
      budgetMs: 300000,
    });

    expect(writes.epicUpdates).toHaveLength(1);
    expect(writes.epicUpdates[0]!.where).toEqual({ id: "epic-row-1" });
    expect(writes.epicUpdates[0]!.data.designDoc).toEqual(amendedParentDoc);
    const nextState = writes.epicUpdates[0]!.data.decompositionState as { amendments: Array<Record<string, unknown>> };
    expect(nextState.amendments).toHaveLength(1);
    expect(nextState.amendments[0]).toMatchObject({
      amendedByUserId: "user-1",
      amendedAt: "2026-05-24T21:00:00.000Z",
      rationale: "Dale needs lookup speed before supplier automation.",
      quiescenceRunId: "QR-2026-05-24-amend",
      affectedChildBuildIds: ["FB-CHILD2", "FB-CHILD3"],
      skippedCompletedChildBuildIds: ["FB-CHILD1"],
    });

    expect(writes.buildUpdates.map((write) => write.where)).toEqual([
      { buildId: "FB-CHILD2" },
      { buildId: "FB-CHILD3" },
    ]);
    expect(writes.buildUpdates[0]!.data.designDoc).toMatchObject({
      proposedApproach: "Record parts used on a job.",
      acceptanceCriteria: ["mark part used", "see usage audit"],
    });
    expect(writes.activities.map((activity) => activity.buildId)).toEqual(["FB-CHILD2", "FB-CHILD3"]);
  });

  it("does not start quiescence or write when an execution child would be mutated silently", async () => {
    const { db, writes } = makeFakeDb(makeEpic({
      featureBuilds: [
        makeChild({ childOrder: 1, phase: "complete" }),
        makeChild({ childOrder: 2, phase: "review" }),
        makeChild({ childOrder: 3, phase: "plan" }),
      ],
    }));
    const startQuiescence = fakeQuiescence();

    const result = await amendEpicDecomposition({
      epicId: "EP-TRUCK-PARTS",
      proposedDesignDoc: amendedParentDoc,
      rationale: "Dale needs lookup speed before supplier automation.",
      userId: "user-1",
      db,
      startQuiescence,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("execution-child-requires-operator-review");
    expect(startQuiescence).not.toHaveBeenCalled();
    expect(writes.epicUpdates).toHaveLength(0);
    expect(writes.buildUpdates).toHaveLength(0);
  });
});
