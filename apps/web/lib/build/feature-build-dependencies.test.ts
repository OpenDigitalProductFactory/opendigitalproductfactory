import { describe, expect, it } from "vitest";

import {
  deriveFeatureBuildDependencyGate,
  deriveReadyDependentsAfterCompletion,
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
      },
    ]);
  });
});
