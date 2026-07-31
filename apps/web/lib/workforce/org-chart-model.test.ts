import { describe, expect, it } from "vitest";
import type { EmployeeDirectoryRow } from "@/lib/workforce/workforce-types";
import {
  buildOrgGraph,
  collectAncestorIds,
  collectDescendantIds,
  eligibleManagers,
  wouldCreateManagerCycle,
} from "./org-chart-model";

function emp(
  id: string,
  managerEmployeeId: string | null = null,
  overrides: Partial<EmployeeDirectoryRow> = {},
): EmployeeDirectoryRow {
  return {
    id,
    employeeId: `EMP-${id}`,
    userId: null,
    displayName: id,
    workEmail: null,
    status: "active",
    departmentId: null,
    departmentName: null,
    positionId: null,
    positionTitle: null,
    managerEmployeeId,
    managerName: null,
    dottedLineManagerId: null,
    dottedLineManagerName: null,
    workLocationId: null,
    workLocationName: null,
    ...overrides,
  };
}

describe("buildOrgGraph", () => {
  it("builds solid-line edges and roots for a simple hierarchy", () => {
    const graph = buildOrgGraph([emp("ceo"), emp("vp", "ceo"), emp("ic", "vp")]);

    expect(graph.rootIds).toEqual(["ceo"]);
    expect(graph.cyclicIds).toEqual([]);
    expect(graph.edges).toEqual([
      { source: "ceo", target: "vp", kind: "line" },
      { source: "vp", target: "ic", kind: "line" },
    ]);
  });

  it("counts direct reports, total reports, and depth", () => {
    const graph = buildOrgGraph([
      emp("ceo"),
      emp("vp", "ceo"),
      emp("ic1", "vp"),
      emp("ic2", "vp"),
    ]);

    expect(graph.metrics.get("ceo")).toMatchObject({
      directReports: 1,
      totalReports: 3,
      depth: 0,
      isRoot: true,
    });
    expect(graph.metrics.get("vp")).toMatchObject({
      directReports: 2,
      totalReports: 2,
      depth: 1,
      isRoot: false,
    });
    expect(graph.metrics.get("ic1")).toMatchObject({ directReports: 0, totalReports: 0, depth: 2 });
  });

  it("treats a manager outside the supplied set as a root rather than dropping the person", () => {
    const graph = buildOrgGraph([emp("ic", "manager-not-in-set")]);

    expect(graph.rootIds).toEqual(["ic"]);
    expect(graph.edges).toEqual([]);
  });

  it("emits a dotted edge alongside the solid one", () => {
    const graph = buildOrgGraph([
      emp("ceo"),
      emp("lead"),
      emp("ic", "ceo", { dottedLineManagerId: "lead" }),
    ]);

    expect(graph.edges).toContainEqual({ source: "lead", target: "ic", kind: "dotted" });
    expect(graph.edges).toContainEqual({ source: "ceo", target: "ic", kind: "line" });
  });

  it("does not duplicate an edge when the dotted-line manager is also the line manager", () => {
    const graph = buildOrgGraph([emp("ceo"), emp("ic", "ceo", { dottedLineManagerId: "ceo" })]);

    expect(graph.edges).toEqual([{ source: "ceo", target: "ic", kind: "line" }]);
  });

  it("ignores a self-referencing manager instead of looping", () => {
    const graph = buildOrgGraph([emp("solo", "solo")]);

    expect(graph.rootIds).toEqual(["solo"]);
    expect(graph.cyclicIds).toEqual([]);
  });

  // Regression: the previous indented-list renderer produced no root for a cycle, so every
  // member silently disappeared from the org chart.
  it("surfaces cycle members instead of dropping them from the chart", () => {
    const graph = buildOrgGraph([emp("a", "b"), emp("b", "a"), emp("ceo")]);

    expect(graph.rootIds).toEqual(["ceo"]);
    expect(graph.cyclicIds.sort()).toEqual(["a", "b"]);
    expect(graph.metrics.get("a")?.isCyclic).toBe(true);
    expect(graph.metrics.get("ceo")?.isCyclic).toBe(false);
  });

  it("returns an empty graph for an empty workforce", () => {
    const graph = buildOrgGraph([]);

    expect(graph.rootIds).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.metrics.size).toBe(0);
  });
});

describe("collectDescendantIds", () => {
  it("returns the whole subtree", () => {
    const employees = [emp("ceo"), emp("vp", "ceo"), emp("ic", "vp")];

    expect(collectDescendantIds(employees, "ceo").sort()).toEqual(["ic", "vp"]);
    expect(collectDescendantIds(employees, "ic")).toEqual([]);
  });

  it("terminates on a cycle", () => {
    const employees = [emp("a", "b"), emp("b", "a")];

    expect(collectDescendantIds(employees, "a")).toEqual(["b"]);
  });
});

describe("collectAncestorIds", () => {
  it("walks the chain to the root", () => {
    const employees = [emp("ceo"), emp("vp", "ceo"), emp("ic", "vp")];

    expect(collectAncestorIds(employees, "ic")).toEqual({
      ancestorIds: ["vp", "ceo"],
      hitCycle: false,
    });
  });

  it("reports a cycle rather than looping forever", () => {
    const employees = [emp("a", "b"), emp("b", "a")];

    expect(collectAncestorIds(employees, "a").hitCycle).toBe(true);
  });
});

describe("wouldCreateManagerCycle", () => {
  const employees = [emp("ceo"), emp("vp", "ceo"), emp("ic", "vp")];

  it("blocks self-management", () => {
    expect(wouldCreateManagerCycle(employees, "vp", "vp")).toBe(true);
  });

  // The gap in assignEmployeeOrg: it only blocked self-management, so moving a manager
  // under their own report detached that whole branch from every root.
  it("blocks moving a person under their own direct report", () => {
    expect(wouldCreateManagerCycle(employees, "vp", "ic")).toBe(true);
  });

  it("blocks moving a person under an indirect report", () => {
    expect(wouldCreateManagerCycle(employees, "ceo", "ic")).toBe(true);
  });

  it("allows a legitimate reassignment", () => {
    expect(wouldCreateManagerCycle(employees, "ic", "ceo")).toBe(false);
  });

  it("allows clearing the manager", () => {
    expect(wouldCreateManagerCycle(employees, "ic", null)).toBe(false);
    expect(wouldCreateManagerCycle(employees, "ic", undefined)).toBe(false);
  });
});

describe("eligibleManagers", () => {
  it("excludes the person and their descendants", () => {
    const employees = [emp("ceo"), emp("vp", "ceo"), emp("ic", "vp")];

    expect(eligibleManagers(employees, "vp").map((e) => e.id)).toEqual(["ceo"]);
    expect(eligibleManagers(employees, "ic").map((e) => e.id).sort()).toEqual(["ceo", "vp"]);
  });
});
