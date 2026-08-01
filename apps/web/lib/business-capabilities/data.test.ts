import { describe, expect, it } from "vitest";

import {
  buildCapabilityTree,
  classifyMaturityGap,
  groupCapabilityTraceLinks,
  summarizeCapabilityMap,
  type BusinessCapabilityRecord,
} from "./data";
import {
  buildCapabilityEvidenceSummary,
  buildCapabilityMapRows,
  deriveCapabilityOverlayState,
} from "./view-model";
import { buildCapabilityProvenance } from "./provenance";

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
      {
        id: "link-3",
        targetType: "backlog_item",
        relationship: "impacted_by",
        note: "Open improvement work",
        label: "BI-OPEN Improve lead routing",
        href: null,
        status: "in-progress",
      },
      {
        id: "link-4",
        targetType: "backlog_item",
        relationship: "impacted_by",
        note: "Completed evidence",
        label: "BI-DONE Finish CRM mapping",
        href: null,
        status: "done",
      },
      {
        id: "link-5",
        targetType: "ea_element",
        relationship: "realized_by",
        note: "Architecture trace",
        label: "CRM Context (Application Component)",
        href: "/ea",
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
    expect(grouped.backlog_item).toHaveLength(2);
    expect(grouped.ea_element).toHaveLength(1);
  });

  it("summarizes maturity posture across the map", () => {
    const summary = summarizeCapabilityMap(rows);

    expect(summary.totalCapabilities).toBe(3);
    expect(summary.l1Count).toBe(1);
    expect(summary.gapCount).toBe(1);
    expect(summary.watchCount).toBe(1);
    expect(summary.alignedCount).toBe(1);
  });

  it("summarizes operational evidence and active backlog work", () => {
    const tree = buildCapabilityTree(rows);
    const capability = tree[0]!.children[0]!;

    const summary = buildCapabilityEvidenceSummary(capability);

    expect(summary.taxonomyCount).toBe(1);
    expect(summary.productCount).toBe(1);
    expect(summary.backlogCount).toBe(2);
    expect(summary.activeBacklogCount).toBe(1);
    expect(summary.architectureCount).toBe(1);
    expect(summary.hasOperationalEvidence).toBe(true);
  });

  it("derives overlay state for maturity, coverage, planning, and IT4IT modes", () => {
    const tree = buildCapabilityTree(rows);
    const family = tree[0]!;
    const capability = family.children[0]!;
    const subCapability = capability.children[0]!;

    expect(deriveCapabilityOverlayState(capability, "maturity")).toMatchObject({
      tone: "watch",
      shortLabel: "3/4",
    });
    expect(deriveCapabilityOverlayState(capability, "coverage")).toMatchObject({
      tone: "covered",
      shortLabel: "5 links",
    });
    expect(deriveCapabilityOverlayState(capability, "planning")).toMatchObject({
      tone: "active",
      shortLabel: "1 active",
    });
    expect(deriveCapabilityOverlayState(subCapability, "planning")).toMatchObject({
      tone: "aligned",
      shortLabel: "Aligned",
    });
    expect(deriveCapabilityOverlayState(family, "it4it")).toMatchObject({
      tone: "covered",
      shortLabel: "2 streams",
    });
  });

  it("builds deterministic map rows for the nested map seam", () => {
    const tree = buildCapabilityTree(rows);

    expect(buildCapabilityMapRows(tree)).toEqual([{ id: "row-1", families: tree }]);
    expect(buildCapabilityMapRows([])).toEqual([]);
  });

  it("describes the active archetype capability perspective provenance", () => {
    const seededRows = rows.map((row, index) => ({
      ...row,
      capabilityId: index === 0 ? "BCAP-SEED-setup" : row.capabilityId,
    }));

    const provenance = buildCapabilityProvenance({
      archetype: {
        archetypeId: "it-managed-services",
        category: "professional-services",
        name: "IT Managed Services",
      },
      records: seededRows,
    });

    expect(provenance.activePerspectiveLabel).toBe(
      "Common Small Business + Professional Services + IT Managed Services",
    );
    expect(provenance.seedCapabilityCount).toBe(1);
    expect(provenance.projectionStatus).toBe("seed-projected");
    expect(provenance.sources.map((source) => source.perspectiveId)).toEqual([
      "common-small-business",
      "professional-services",
      "it-managed-services",
    ]);
  });
});
