import { describe, expect, it } from "vitest";

import {
  attributeInventoryEntity,
  evaluateInventoryQuality,
  flattenEnrichmentForScoring,
  scoreTaxonomyCandidates,
  type TaxonomyNodeCandidate,
} from "./discovery-attribution";

const taxonomyNodes: TaxonomyNodeCandidate[] = [
  {
    nodeId: "foundational/compute/servers",
    name: "Servers",
    portfolioSlug: "foundational",
  },
  {
    nodeId: "foundational/platform_services/container_platform",
    name: "Container Platform",
    portfolioSlug: "foundational",
  },
  {
    nodeId: "foundational/network_management/network_connectivity",
    name: "Network Connectivity",
    portfolioSlug: "foundational",
  },
  {
    nodeId: "products_and_services_sold/customer_relationship_management",
    name: "Customer Relationship Management",
    portfolioSlug: "products_and_services_sold",
  },
  {
    nodeId: "for_employees/employee_services",
    name: "Employee Services",
    portfolioSlug: "for_employees",
  },
];

describe("scoreTaxonomyCandidates", () => {
  it("prefers close textual matches for heuristic attribution", () => {
    const ranked = scoreTaxonomyCandidates(
      "customer relationship management portal for accounts and leads",
      taxonomyNodes,
    );

    expect(ranked[0]?.nodeId).toBe("products_and_services_sold/customer_relationship_management");
    expect(ranked[0]?.score).toBeGreaterThan(ranked[1]?.score ?? 0);
  });
});

describe("attributeInventoryEntity", () => {
  it("maps a host to the foundational compute taxonomy by rule", () => {
    const result = attributeInventoryEntity(
      {
        entityKey: "host:hostname:dpf-dev",
        entityType: "host",
        itemType: "host",
        name: "dpf-dev",
        properties: { platform: "linux" },
      },
      taxonomyNodes,
    );

    expect(result.taxonomyNodeId).toBe("foundational/compute/servers");
    expect(result.portfolioSlug).toBe("foundational");
    expect(result.attributionMethod).toBe("rule");
    expect(result.attributionStatus).toBe("attributed");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("maps a docker runtime to the container platform taxonomy by rule", () => {
    const result = attributeInventoryEntity(
      {
        entityKey: "runtime:socket:/var/run/docker.sock",
        entityType: "runtime",
        itemType: "docker_runtime",
        name: "Docker",
        properties: { socketPath: "/var/run/docker.sock" },
      },
      taxonomyNodes,
    );

    expect(result.taxonomyNodeId).toBe("foundational/platform_services/container_platform");
    expect(result.attributionMethod).toBe("rule");
    expect(result.attributionStatus).toBe("attributed");
  });

  it("falls back to heuristic matching for non-obvious discovered functions", () => {
    const result = attributeInventoryEntity(
      {
        entityKey: "service:crm-portal",
        entityType: "service",
        itemType: "application_service",
        name: "CRM Portal",
        properties: {
          description: "Customer relationship management portal for accounts and leads",
        },
      },
      taxonomyNodes,
    );

    expect(result.taxonomyNodeId).toBe("products_and_services_sold/customer_relationship_management");
    expect(result.portfolioSlug).toBe("products_and_services_sold");
    expect(result.attributionMethod).toBe("heuristic");
    expect(result.attributionStatus).toBe("attributed");
    expect(result.confidence).toBeGreaterThan(0.55);
    expect(result.candidateTaxonomy?.[0]?.nodeId).toBe(
      "products_and_services_sold/customer_relationship_management",
    );
  });

  it("maps a VLAN to network connectivity by rule", () => {
    const result = attributeInventoryEntity(
      {
        entityKey: "vlan:default",
        entityType: "vlan",
        itemType: "vlan",
        name: "Default",
        properties: { vlanId: 1 },
      },
      taxonomyNodes,
    );

    expect(result.taxonomyNodeId).toBe("foundational/network_management/network_connectivity");
    expect(result.attributionMethod).toBe("rule");
    expect(result.attributionStatus).toBe("attributed");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("maps a wireless access point to network connectivity by rule", () => {
    const result = attributeInventoryEntity(
      {
        entityKey: "ap:u6-lr",
        entityType: "access_point",
        itemType: "access_point",
        name: "U6 LR",
        properties: { model: "U6-LR" },
      },
      taxonomyNodes,
    );

    expect(result.taxonomyNodeId).toBe("foundational/network_management/network_connectivity");
    expect(result.attributionMethod).toBe("rule");
    expect(result.attributionStatus).toBe("attributed");
    expect(result.confidence).toBeGreaterThan(0.9);
  });

  it("keeps low-confidence matches in needs-review with candidates", () => {
    const result = attributeInventoryEntity(
      {
        entityKey: "service:mystery-engine",
        entityType: "service",
        itemType: "application_service",
        name: "Mystery Engine",
        properties: {
          description: "Internal automation engine",
        },
      },
      taxonomyNodes,
    );

    expect(result.attributionStatus).toBe("needs_review");
    expect(result.attributionMethod).toBe("heuristic");
    expect(result.taxonomyNodeId).toBeNull();
    expect(result.candidateTaxonomy?.length).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThan(0.55);
  });
});

describe("flattenEnrichmentForScoring", () => {
  it("flattens enrichment with industry markets", () => {
    const result = flattenEnrichmentForScoring({
      offeringConsiderations: "Standard tier; Premium tier",
      commercialMarket: "AWS EC2; Azure VM",
      industryMarkets: {
        banking: "FIS core banking",
        healthcare: "Epic EHR",
      },
    });
    expect(result).toContain("Standard tier");
    expect(result).toContain("AWS EC2");
    expect(result).toContain("FIS core banking");
    expect(result).toContain("Epic EHR");
  });

  it("returns empty string for null input", () => {
    expect(flattenEnrichmentForScoring(null)).toBe("");
    expect(flattenEnrichmentForScoring(undefined)).toBe("");
  });

  it("skips empty values", () => {
    const result = flattenEnrichmentForScoring({
      offeringConsiderations: "Some text",
      commercialMarket: "",
      digitalPhysical: "Digital",
    });
    expect(result).toContain("Some text");
    expect(result).toContain("Digital");
    expect(result).not.toContain("commercialMarket");
  });
});

describe("scoreTaxonomyCandidates with enrichment", () => {
  const enrichedNodes: TaxonomyNodeCandidate[] = [
    {
      nodeId: "foundational/network_management/network_security",
      name: "Network Security",
      portfolioSlug: "foundational",
      description: "Firewall, intrusion detection, and network access control services",
      enrichmentText: "Palo Alto Networks; Fortinet FortiGate; Cisco ASA; Check Point; Ubiquiti UniFi Security Gateway; Zscaler; Cloudflare WAF",
    },
    {
      nodeId: "foundational/network_management/wireless_networking",
      name: "Wireless Networking",
      portfolioSlug: "foundational",
      description: "Wi-Fi infrastructure and wireless LAN management",
      enrichmentText: "Ubiquiti UniFi; Cisco Meraki; Aruba Networks; Ruckus; Cambium; EnGenius; wireless access points; controllers",
    },
    {
      nodeId: "foundational/compute/servers",
      name: "Servers",
      portfolioSlug: "foundational",
    },
  ];

  it("scores higher when enrichment contains matching vendor names", () => {
    const ranked = scoreTaxonomyCandidates("Ubiquiti UniFi wireless access point", enrichedNodes);
    expect(ranked[0]?.nodeId).toContain("wireless_networking");
    expect(ranked[0]?.score).toBeGreaterThan(0.5);
  });

  it("enrichment-only matches do not overpower strong core matches", () => {
    const ranked = scoreTaxonomyCandidates("Server compute physical hardware", enrichedNodes);
    expect(ranked[0]?.nodeId).toContain("servers");
  });

  it("vendor name match boosts score compared to unenriched nodes", () => {
    const unenrichedNodes: TaxonomyNodeCandidate[] = [
      { nodeId: "foundational/network_management/wireless_networking", name: "Wireless Networking", portfolioSlug: "foundational" },
    ];
    const enrichedResult = scoreTaxonomyCandidates("Ubiquiti UniFi", enrichedNodes);
    const unenrichedResult = scoreTaxonomyCandidates("Ubiquiti UniFi", unenrichedNodes);

    const enrichedScore = enrichedResult.find((r) => r.nodeId.includes("wireless_networking"))?.score ?? 0;
    const unenrichedScore = unenrichedResult.find((r) => r.nodeId.includes("wireless_networking"))?.score ?? 0;
    expect(enrichedScore).toBeGreaterThan(unenrichedScore);
  });
});

describe("evaluateInventoryQuality", () => {
  it("creates a taxonomy low-confidence issue for reviewable entities", () => {
    const result = evaluateInventoryQuality([
      {
        entityKey: "service:mystery-engine",
        entityType: "service",
        attributionStatus: "needs_review",
        attributionMethod: "heuristic",
        attributionConfidence: 0.32,
        candidateTaxonomy: [
          { nodeId: "for_employees/employee_services", score: 0.32 },
        ],
        taxonomyNodeId: null,
        digitalProductId: null,
        qualityStatus: "warning",
      },
    ]);

    expect(result.issues.map((issue) => issue.issueType)).toContain(
      "taxonomy_attribution_low_confidence",
    );
  });
});
