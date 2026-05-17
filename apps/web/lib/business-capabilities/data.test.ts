import { describe, expect, it } from "vitest";

import {
  buildCapabilityTree,
  classifyMaturityGap,
  groupCapabilityTraceLinks,
  summarizeCapabilityMap,
  type BusinessCapabilityRecord,
} from "./data";

const rows: BusinessCapabilityRecord[] = [
  {
    id: "fam-1",
    capabilityId: "BC-FAM-1",
    name: "Customer Growth",
    slug: "customer-growth",
    description: null,
    level: 1,
    sortOrder: 1,
    status: "active",
    parentId: null,
    currentMaturity: 2,
    targetMaturity: 4,
    maturityRationale: null,
    it4itValueStreams: ["evaluate", "consume"],
    traceLinks: [],
  },
  {
    id: "cap-1",
    capabilityId: "BC-CAP-1",
    name: "Lead Management",
    slug: "lead-management",
    description: null,
    level: 2,
    sortOrder: 1,
    status: "active",
    parentId: "fam-1",
    currentMaturity: 3,
    targetMaturity: 4,
    maturityRationale: "Needs shared pipeline signals",
    it4itValueStreams: ["evaluate", "explore", "consume"],
    traceLinks: [
      {
        id: "link-1",
        targetType: "taxonomy_node",
        relationship: "classifies",
        note: null,
        label: "Revenue and customer growth",
        href: "/portfolio/revenue",
      },
      {
        id: "link-2",
        targetType: "digital_product",
        relationship: "supported_by",
        note: "CRM workbench",
        label: "Customer Pipeline",
        href: "/portfolio/product/prod-1",
      },
    ],
  },
  {
    id: "sub-1",
    capabilityId: "BC-SUB-1",
    name: "Lead Source Attribution",
    slug: "lead-source-attribution",
    description: null,
    level: 3,
    sortOrder: 1,
    status: "active",
    parentId: "cap-1",
    currentMaturity: 4,
    targetMaturity: 4,
    maturityRationale: null,
    it4itValueStreams: ["consume"],
    traceLinks: [],
  },
];

describe("business capability map data helpers", () => {
  it("assembles L1-L2-L3 capability hierarchy in sort order", () => {
    const tree = buildCapabilityTree([...rows].reverse());

    expect(tree).toHaveLength(1);
    expect(tree[0]?.name).toBe("Customer Growth");
    expect(tree[0]?.children[0]?.name).toBe("Lead Management");
    expect(tree[0]?.children[0]?.children[0]?.name).toBe("Lead Source Attribution");
  });

  it("classifies maturity gaps from current and target values", () => {
    expect(classifyMaturityGap(4, 4)).toBe("aligned");
    expect(classifyMaturityGap(3, 4)).toBe("watch");
    expect(classifyMaturityGap(2, 4)).toBe("gap");
  });

  it("groups trace links by supported target type", () => {
    const grouped = groupCapabilityTraceLinks(rows[1]!.traceLinks);

    expect(grouped.taxonomy_node).toHaveLength(1);
    expect(grouped.digital_product).toHaveLength(1);
    expect(grouped.backlog_item).toEqual([]);
    expect(grouped.ea_element).toEqual([]);
  });

  it("summarizes maturity posture across the map", () => {
    const summary = summarizeCapabilityMap(rows);

    expect(summary.totalCapabilities).toBe(3);
    expect(summary.l1Count).toBe(1);
    expect(summary.gapCount).toBe(1);
    expect(summary.watchCount).toBe(1);
    expect(summary.alignedCount).toBe(1);
  });
});
