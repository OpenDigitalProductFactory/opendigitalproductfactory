import { describe, it, expect } from "vitest";
import {
  computeControlCoverage,
  formatCoverage,
  groupControlsByCatalogKey,
  type CoverageControl,
} from "./compliance-control-coverage";

const reg = (id: string, short: string) => ({ id, regulationId: `REG-${id}`, shortName: short });

function control(regs: string[][]): CoverageControl {
  return {
    obligations: regs.map(([id, short]) => ({ obligation: { regulation: reg(id, short) } })),
  };
}

describe("computeControlCoverage", () => {
  it("counts distinct regulations a control crosswalks", () => {
    const c = control([
      ["sox", "SOX"],
      ["iso", "ISO 27001"],
      ["iso", "ISO 27001"], // second obligation from the same regulation
    ]);
    const cov = computeControlCoverage(c);
    expect(cov.obligationCount).toBe(3);
    expect(cov.regulationCount).toBe(2);
    expect(cov.isCrosswalk).toBe(true);
    expect(cov.regulations.map((r) => r.shortName)).toEqual(["ISO 27001", "SOX"]); // sorted
  });

  it("is not a crosswalk when a control serves one framework", () => {
    const cov = computeControlCoverage(control([["sox", "SOX"], ["sox", "SOX"]]));
    expect(cov.regulationCount).toBe(1);
    expect(cov.isCrosswalk).toBe(false);
  });

  it("handles a control with no obligations", () => {
    const cov = computeControlCoverage({ obligations: [] });
    expect(cov.obligationCount).toBe(0);
    expect(cov.regulationCount).toBe(0);
    expect(cov.isCrosswalk).toBe(false);
  });

  it("formats a readable label", () => {
    expect(formatCoverage(computeControlCoverage(control([["a", "A"], ["b", "B"]])))).toBe(
      "2 obligations · 2 frameworks",
    );
    expect(formatCoverage(computeControlCoverage(control([["a", "A"]])))).toBe(
      "1 obligation · 1 framework",
    );
  });
});

describe("groupControlsByCatalogKey", () => {
  it("consolidates controls sharing a catalog identity, standalone for null", () => {
    const groups = groupControlsByCatalogKey([
      { id: "c1", catalogKey: "access-control" },
      { id: "c2", catalogKey: "access-control" },
      { id: "c3", catalogKey: "encryption" },
      { id: "c4", catalogKey: null },
    ]);
    // Largest consolidation group first
    expect(groups[0].catalogKey).toBe("access-control");
    expect(groups[0].controls.map((c) => c.id)).toEqual(["c1", "c2"]);
    // Single-member catalog group + standalone remain
    expect(groups.find((g) => g.catalogKey === "encryption")?.controls).toHaveLength(1);
    expect(groups.find((g) => g.catalogKey === null)?.controls[0].id).toBe("c4");
  });
});
