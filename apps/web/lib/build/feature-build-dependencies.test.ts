import { describe, expect, it } from "vitest";

import {
  deriveFeatureBuildDependencyGate,
  deriveReadyDependentsAfterCompletion,
  recordReadyDependentsAfterCompletion,
} from "./feature-build-dependencies";

describe("deriveFeatureBuildDependencyGate", () => {
  it("allows top-level builds because dependency gates only apply inside execution Epics", () => {
    const gate = deriveFeatureBuildDependencyGate({
      id: "build-row-top",
      buildId: "FB-TOP",
      title: "Top-level feature",
      parentEpicId: null,
      phase: "plan",
      dependenciesOut: [],
    });

    expect(gate.allowed).toBe(true);
  });

  it("blocks child builds whose upstream sibling is not complete", () => {
    const gate = deriveFeatureBuildDependencyGate({
      id: "build-row-dependent",
      buildId: "FB-DEPENDENT",
      title: "Record usage",
      parentEpicId: "epic-row-1",
      phase: "plan",
      dependenciesOut: [
        {
          dependsOn: {
            id: "build-row-upstream",
            buildId: "FB-UPSTREAM",
            title: "Truck and parts read",
            phase: "build",
          },
        },
      ],
    });

    expect(gate.allowed).toBe(false);
    if (gate.allowed) throw new Error("unreachable");
    expect(gate.waitingOn).toEqual([
      {
        buildId: "FB-UPSTREAM",
        title: "Truck and parts read",
        phase: "build",
      },
    ]);
    expect(gate.message).toContain("Waiting on: Truck and parts read");
    expect(gate.message).not.toContain("build-row-upstream");
  });

  it("allows child builds when every upstream sibling is complete", () => {
    const gate = deriveFeatureBuildDependencyGate({
      id: "build-row-dependent",
      buildId: "FB-DEPENDENT",
      title: "Record usage",
      parentEpicId: "epic-row-1",
      phase: "plan",
      dependenciesOut: [
        {
          dependsOn: {
            id: "build-row-upstream",
            buildId: "FB-UPSTREAM",
            title: "Truck and parts read",
            phase: "complete",
          },
        },
      ],
    });

    expect(gate.allowed).toBe(true);
  });
});

describe("deriveReadyDependentsAfterCompletion", () => {
  it("returns only incomplete dependents whose full dependency set is complete", () => {
    const ready = deriveReadyDependentsAfterCompletion({
      completedBuild: {
        id: "build-row-read",
        buildId: "FB-READ",
        title: "Truck and parts read",
        parentEpicId: "epic-row-1",
        phase: "complete",
      },
      dependents: [
        {
          id: "build-row-usage",
          buildId: "FB-USAGE",
          title: "Record usage",
          parentEpicId: "epic-row-1",
          phase: "plan",
          dependenciesOut: [
            {
              dependsOn: {
                id: "build-row-read",
                buildId: "FB-READ",
                title: "Truck and parts read",
                phase: "complete",
              },
            },
          ],
        },
        {
          id: "build-row-low-stock",
          buildId: "FB-LOW",
          title: "Low-stock surfacing",
          parentEpicId: "epic-row-1",
          phase: "plan",
          dependenciesOut: [
            {
              dependsOn: {
                id: "build-row-read",
                buildId: "FB-READ",
                title: "Truck and parts read",
                phase: "complete",
              },
            },
            {
              dependsOn: {
                id: "build-row-usage",
                buildId: "FB-USAGE",
                title: "Record usage",
                phase: "build",
              },
            },
          ],
        },
        {
          id: "build-row-done",
          buildId: "FB-DONE",
          title: "Already shipped child",
          parentEpicId: "epic-row-1",
          phase: "complete",
          dependenciesOut: [
            {
              dependsOn: {
                id: "build-row-read",
                buildId: "FB-READ",
                title: "Truck and parts read",
                phase: "complete",
              },
            },
          ],
        },
      ],
    });

    expect(ready).toEqual([
      {
        buildId: "FB-USAGE",
        title: "Record usage",
        phase: "plan",
        createdById: null,
      },
    ]);
  });
});

describe("recordReadyDependentsAfterCompletion — dispatches the released child's plan (BI-E49DDE47)", () => {
  function mockDb(completed: unknown) {
    return {
      featureBuild: { findUnique: async (_args: unknown) => completed as never },
      buildActivity: { create: async (_args: unknown) => ({}) as never },
    };
  }

  it("dispatches plan for a dependent whose upstream is now complete, keyed by its owner", async () => {
    const dispatched: Array<{ buildId: string; userId: string }> = [];
    const ready = await recordReadyDependentsAfterCompletion({
      buildId: "FB-UP",
      db: mockDb({
        id: "row-up",
        buildId: "FB-UP",
        title: "Upstream",
        parentEpicId: "epic-1",
        phase: "complete",
        dependenciesIn: [
          {
            dependent: {
              id: "row-dep",
              buildId: "FB-DEP",
              title: "Downstream child",
              parentEpicId: "epic-1",
              phase: "plan",
              createdById: "user-42",
              dependenciesOut: [
                { dependsOn: { id: "row-up", buildId: "FB-UP", title: "Upstream", phase: "complete" } },
              ],
            },
          },
        ],
      }),
      dispatchPlanForChild: async (p) => {
        dispatched.push(p);
      },
    });

    expect(ready.map((r) => r.buildId)).toEqual(["FB-DEP"]);
    expect(dispatched).toEqual([{ buildId: "FB-DEP", userId: "user-42" }]); // ← the fix: it dispatches, not just logs
  });

  it("does NOT dispatch a dependent still waiting on an incomplete sibling", async () => {
    const dispatched: string[] = [];
    await recordReadyDependentsAfterCompletion({
      buildId: "FB-UP",
      db: mockDb({
        id: "row-up",
        buildId: "FB-UP",
        title: "Upstream",
        parentEpicId: "epic-1",
        phase: "complete",
        dependenciesIn: [
          {
            dependent: {
              id: "row-dep",
              buildId: "FB-DEP",
              title: "Still blocked",
              parentEpicId: "epic-1",
              phase: "plan",
              createdById: "user-42",
              dependenciesOut: [
                { dependsOn: { id: "row-up", buildId: "FB-UP", title: "Upstream", phase: "complete" } },
                { dependsOn: { id: "row-other", buildId: "FB-OTHER", title: "Other", phase: "build" } },
              ],
            },
          },
        ],
      }),
      dispatchPlanForChild: async (p) => {
        dispatched.push(p.buildId);
      },
    });
    expect(dispatched).toEqual([]);
  });

  it("skips dispatch (does not throw) when the ready dependent has no owner", async () => {
    const dispatched: string[] = [];
    const ready = await recordReadyDependentsAfterCompletion({
      buildId: "FB-UP",
      db: mockDb({
        id: "row-up",
        buildId: "FB-UP",
        title: "Upstream",
        parentEpicId: "epic-1",
        phase: "complete",
        dependenciesIn: [
          {
            dependent: {
              id: "row-dep",
              buildId: "FB-DEP",
              title: "Ownerless child",
              parentEpicId: "epic-1",
              phase: "plan",
              createdById: null,
              dependenciesOut: [
                { dependsOn: { id: "row-up", buildId: "FB-UP", title: "Upstream", phase: "complete" } },
              ],
            },
          },
        ],
      }),
      dispatchPlanForChild: async (p) => {
        dispatched.push(p.buildId);
      },
    });
    expect(ready.map((r) => r.buildId)).toEqual(["FB-DEP"]);
    expect(dispatched).toEqual([]);
  });
});
