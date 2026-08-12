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

  it("does NOT confidently file a bare network-sweep host as a server (regression: BI-BAF38ED3)", () => {
    // An ARP/UniFi host carries only a vendor + MAC, no OS/compute signal. If it
    // reached the heuristic, the fingerprint layer already missed — it must not
    // be masked as a 0.98 "server". It surfaces as needs_review instead.
    const result = attributeInventoryEntity(
      {
        entityKey: "organization:internal:host:arp:88E712000091",
        entityType: "host",
        itemType: "host",
        name: "Whirlpool 192.168.0.91",
        properties: { vendor: "Whirlpool", mac: "88:e7:12:00:00:91" },
      },
      taxonomyNodes,
    );

    expect(result.taxonomyNodeId).not.toBe("foundational/compute/servers");
    expect(result.attributionStatus).toBe("needs_review");
  });

  it("still files a corroborated compute host (OS signal) as a server", () => {
    // The demotion is surgical: a host WITH a compute signal is still a server.
    const result = attributeInventoryEntity(
      {
        entityKey: "host:hostname:app-01",
        entityType: "host",
        itemType: "host",
        name: "app-01",
        properties: { os: "ubuntu 22.04", uptime: 91234 },
      },
      taxonomyNodes,
    );

    expect(result.taxonomyNodeId).toBe("foundational/compute/servers");
    expect(result.attributionStatus).toBe("attributed");
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

  it("creates lifecycle and catalog ambiguity issues when support and identity evidence are incomplete", () => {
    const result = evaluateInventoryQuality([
      {
        entityKey: "router:main-gateway",
        entityType: "router",
        attributionStatus: "attributed",
        attributionMethod: "rule",
        attributionConfidence: 0.98,
        taxonomyNodeId: "foundational/network_management/network_connectivity",
        digitalProductId: null,
        manufacturer: null,
        observedVersion: "4.0.2",
        normalizedVersion: null,
        supportStatus: "unknown",
        hasSoftwareEvidence: true,
        normalizationStatus: "needs_review",
      },
    ]);

    expect(result.issues.map((issue) => issue.issueType)).toEqual(
      expect.arrayContaining([
        "lifecycle_unverified",
        "catalog_match_ambiguous",
      ]),
    );
  });

  it("accepts the canonical ai-proposed attribution method literal", () => {
    const result = evaluateInventoryQuality([
      {
        entityKey: "service:auto-triaged",
        entityType: "service",
        attributionStatus: "attributed",
        attributionMethod: "ai-proposed",
        attributionConfidence: 0.91,
        taxonomyNodeId: "products_and_services_sold/customer_relationship_management",
        digitalProductId: null,
        manufacturer: "OpenAI",
        supportStatus: "supported",
      },
    ]);

    expect(result.issues).toHaveLength(0);
  });

  it("emits a stale_relationship issue for a stale real-estate relationship", () => {
    // Real-estate topology still raises, unlike Docker-origin churn. The
    // exemplar is managed<->managed (gateway uplink to switch): an
    // `arp:<host>-> unifi:<ap>` link is a TRANSIENT client attachment and is
    // now classified observed — see the managed-vs-observed test below.
    const result = evaluateInventoryQuality(
      [],
      [
        {
          relationshipKey:
            "organization:internal:edge_node:HOSTS:unifi:9c:05:d6:de:8d:3f->unifi:d0:21:f9:df:56:92",
          relationshipType: "HOSTS",
          status: "stale",
        },
      ],
    );

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].issueType).toBe("stale_relationship");
  });

  it("suppresses stale_relationship issues for Docker-origin topology", () => {
    // The dpf_bootstrap self-scan churns these on every container recreation;
    // each orphaned key would otherwise open a permanent stale_relationship issue.
    const result = evaluateInventoryQuality(
      [],
      [
        {
          relationshipKey: "dpf_bootstrap:MEMBER_OF:container:94d702333fd2->docker-net:dpf_default",
          relationshipType: "MEMBER_OF",
          status: "stale",
        },
        {
          relationshipKey: "dpf_bootstrap:hosts:docker_runtime:/var/run/docker.sock->container:bd02d3f03235",
          relationshipType: "hosts",
          status: "stale",
        },
        {
          relationshipKey: "dpf_bootstrap:monitors:container:07c16aa103f0->container:ff075a384b4b",
          relationshipType: "monitors",
          status: "stale",
        },
      ],
    );

    expect(result.issues).toHaveLength(0);
  });

  it("emits stale_entity for MANAGED infrastructure but not for merely-observed things", () => {
    const result = evaluateInventoryQuality([
      // Managed: a UniFi access point vanishing is real, actionable signal.
      {
        entityKey: "organization:internal:access_point:unifi:ac:8b:a9:3f:1b:29",
        entityType: "access_point",
        attributionStatus: "stale",
      },
      // Observed: an ARP neighbour and a UniFi client leaving is normal churn.
      {
        entityKey: "organization:internal:host:arp:00A0C9123456",
        entityType: "host",
        attributionStatus: "stale",
      },
      {
        entityKey: "organization:internal:host:unifi-client:aa:bb:cc:dd:ee:ff",
        entityType: "host",
        attributionStatus: "stale",
      },
      // Observed: the platform's own Prometheus scrape target.
      {
        entityKey: "application:prom:portal:portal:3000",
        entityType: "application",
        attributionStatus: "stale",
      },
    ]);

    const stale = result.issues.filter((issue) => issue.issueType === "stale_entity");
    expect(stale).toHaveLength(1);
    expect(stale[0].inventoryEntityKey).toBe(
      "organization:internal:access_point:unifi:ac:8b:a9:3f:1b:29",
    );
  });

  it("suppresses stale_relationship when either endpoint is merely observed", () => {
    const result = evaluateInventoryQuality(
      [],
      [
        // Managed<->managed topology (gateway uplink to switch) — real signal.
        {
          relationshipKey:
            "organization:internal:edge_node:HOSTS:unifi:9c:05:d6:de:8d:3f->unifi:d0:21:f9:df:56:92",
          relationshipType: "HOSTS",
          status: "stale",
        },
        // Transient client attached to a managed AP — vanishes when it leaves.
        {
          relationshipKey:
            "organization:internal:edge_node:MEMBER_OF:arp:00A0C9123456->unifi:fc:ec:da:bc:a5:49",
          relationshipType: "MEMBER_OF",
          status: "stale",
        },
      ],
    );

    const stale = result.issues.filter((issue) => issue.issueType === "stale_relationship");
    expect(stale).toHaveLength(1);
    expect(stale[0].inventoryRelationshipKey).toContain("unifi:9c:05:d6:de:8d:3f");
  });

  it("does not emit for active (non-stale) relationships regardless of origin", () => {
    const result = evaluateInventoryQuality(
      [],
      [
        {
          relationshipKey: "organization:internal:edge_node:MEMBER_OF:arp:192.168.0.58->unifi:fc:ec:da:bc:a5:49",
          relationshipType: "MEMBER_OF",
          status: "active",
        },
      ],
    );

    expect(result.issues).toHaveLength(0);
  });
});
