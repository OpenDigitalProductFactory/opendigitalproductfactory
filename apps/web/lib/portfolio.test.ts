import { describe, it, expect } from "vitest";
import { buildPortfolioTree, resolveNodeFromSlug, computeHealth } from "./portfolio";
import type { PortfolioTreeNode } from "./portfolio";

// Minimal fixture: 2 portfolio roots, one with a 2-level subtree
const NODES = [
  { id: "root1", nodeId: "foundational",          name: "Foundational",      parentId: null,    portfolioId: "port1" },
  { id: "l1a",   nodeId: "foundational/compute",   name: "Compute",           parentId: "root1", portfolioId: null },
  { id: "l2a",   nodeId: "foundational/compute/physical_compute", name: "Physical Compute", parentId: "l1a", portfolioId: null },
  { id: "l1b",   nodeId: "foundational/platform_services", name: "Platform Services", parentId: "root1", portfolioId: null },
  { id: "root2", nodeId: "for_employees",          name: "For Employees",     parentId: null,    portfolioId: "port2" },
];

const COUNTS = [
  { taxonomyNodeId: "root1", _count: { id: 2 } },
  { taxonomyNodeId: "l1a",   _count: { id: 1 } },
  { taxonomyNodeId: "l2a",   _count: { id: 1 } },
];

describe("buildPortfolioTree()", () => {
  it("returns one root per portfolio root node", () => {
    const roots = buildPortfolioTree(NODES, COUNTS);
    expect(roots).toHaveLength(2);
  });

  it("nests children under their parent", () => {
    const roots = buildPortfolioTree(NODES, COUNTS);
    const foundational = roots.find((r) => r.nodeId === "foundational")!;
    expect(foundational.children).toHaveLength(2);
    expect(foundational.children.map((c) => c.nodeId)).toContain("foundational/compute");
    expect(foundational.children.map((c) => c.nodeId)).toContain("foundational/platform_services");
  });

  it("builds a 3-level subtree correctly", () => {
    const roots = buildPortfolioTree(NODES, COUNTS);
    const foundational = roots.find((r) => r.nodeId === "foundational")!;
    const compute = foundational.children.find((c) => c.nodeId === "foundational/compute")!;
    expect(compute.children).toHaveLength(1);
    expect(compute.children[0]?.nodeId).toBe("foundational/compute/physical_compute");
  });

  it("sets directCount from counts array (matching on .id, not .nodeId)", () => {
    const roots = buildPortfolioTree(NODES, COUNTS);
    const foundational = roots.find((r) => r.nodeId === "foundational")!;
    // root1 has 2 direct products
    expect(foundational.directCount).toBe(2);
  });

  it("sets totalCount as sum of subtree directCounts", () => {
    const roots = buildPortfolioTree(NODES, COUNTS);
    const foundational = roots.find((r) => r.nodeId === "foundational")!;
    // root1: 2 direct + l1a: 1 direct + l2a: 1 direct = 4 total
    expect(foundational.totalCount).toBe(4);
  });

  it("nodes with no counts get directCount=0 and totalCount=0", () => {
    const roots = buildPortfolioTree(NODES, COUNTS);
    const forEmployees = roots.find((r) => r.nodeId === "for_employees")!;
    expect(forEmployees.directCount).toBe(0);
    expect(forEmployees.totalCount).toBe(0);
  });
});

describe("resolveNodeFromSlug()", () => {
  it("returns null for an empty slug array", () => {
    const roots = buildPortfolioTree(NODES, COUNTS);
    const result = resolveNodeFromSlug(roots, []);
    expect(result).toBeNull();
  });

  it("finds a portfolio root by single slug segment", () => {
    const roots = buildPortfolioTree(NODES, COUNTS);
    const node = resolveNodeFromSlug(roots, ["foundational"]);
    expect(node?.nodeId).toBe("foundational");
  });

  it("finds an L1 node by two slug segments", () => {
    const roots = buildPortfolioTree(NODES, COUNTS);
    const node = resolveNodeFromSlug(roots, ["foundational", "compute"]);
    expect(node?.nodeId).toBe("foundational/compute");
  });

  it("finds an L2 node by three slug segments", () => {
    const roots = buildPortfolioTree(NODES, COUNTS);
    const node = resolveNodeFromSlug(roots, ["foundational", "compute", "physical_compute"]);
    expect(node?.nodeId).toBe("foundational/compute/physical_compute");
  });

  it("returns null for a slug that doesn't exist", () => {
    const roots = buildPortfolioTree(NODES, COUNTS);
    const result = resolveNodeFromSlug(roots, ["foundational", "nonexistent"]);
    expect(result).toBeNull();
  });
});

describe("computeHealth()", () => {
  it("returns '—' when total is 0", () => {
    expect(computeHealth(0, 0)).toBe("—");
  });

  it("returns '100%' when all products are active", () => {
    expect(computeHealth(10, 10)).toBe("100%");
  });

  it("returns '0%' when no products are active", () => {
    expect(computeHealth(0, 5)).toBe("0%");
  });

  it("rounds to nearest integer", () => {
    expect(computeHealth(1, 3)).toBe("33%");  // 33.33... rounds down
    expect(computeHealth(2, 3)).toBe("67%");  // 66.66... rounds up
  });

  it("clamps to 100% when active exceeds total (data inconsistency guard)", () => {
    expect(computeHealth(12, 10)).toBe("100%");
  });
});
