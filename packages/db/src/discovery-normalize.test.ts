import { describe, expect, it } from "vitest";

import { normalizeDiscoveredFacts } from "./discovery-normalize";
import type { SoftwareIdentityCandidate, SoftwareNormalizationRuleInput } from "./software-normalization";
import type { TaxonomyNodeCandidate } from "./discovery-attribution";

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
];

const softwareIdentities: SoftwareIdentityCandidate[] = [
  {
    id: "identity-postgres",
    normalizedVendor: "PostgreSQL Global Development Group",
    normalizedProductName: "PostgreSQL",
    aliases: ["postgres", "postgresql"],
  },
];

const softwareRules: SoftwareNormalizationRuleInput[] = [
  {
    ruleKey: "package:postgresql",
    matchType: "package_name",
    rawSignature: "postgresql",
    source: "bootstrap_registry",
    softwareIdentity: softwareIdentities[0]!,
  },
];

describe("normalizeDiscoveredFacts", () => {
  it("defaults discovered host infrastructure into the Foundational portfolio taxonomy", () => {
    const result = normalizeDiscoveredFacts({
      items: [
        {
          sourceKind: "dpf_bootstrap",
          itemType: "host",
          name: "dpf-dev",
          externalRef: "hostname:dpf-dev",
          attributes: { hostname: "dpf-dev" },
        },
      ],
      relationships: [],
    }, {
      taxonomyNodes,
      softwareIdentities,
      softwareRules,
    });

    expect(result.inventoryEntities[0]?.portfolioSlug).toBe("foundational");
    expect(result.inventoryEntities[0]?.attributionStatus).toBe("attributed");
    expect(result.inventoryEntities[0]?.taxonomyNodeId).toBe("foundational/compute/servers");
    expect(result.inventoryEntities[0]?.attributionMethod).toBe("rule");
  });

  it("emits normalized software evidence linked to the discovered inventory entity", () => {
    const result = normalizeDiscoveredFacts({
      items: [
        {
          sourceKind: "dpf_bootstrap",
          itemType: "host",
          name: "dpf-dev",
          externalRef: "host:dpf-dev",
          naturalKey: "hostname:dpf-dev",
          attributes: { hostname: "dpf-dev" },
        },
      ],
      relationships: [],
      software: [
        {
          entityExternalRef: "host:dpf-dev",
          evidenceSource: "host_packages",
          rawPackageName: "postgresql-16",
          rawVersion: "16.3-1",
        },
      ],
    }, {
      taxonomyNodes,
      softwareIdentities,
      softwareRules,
    });

    expect(result.softwareEvidence).toHaveLength(1);
    expect(result.softwareEvidence[0]).toMatchObject({
      inventoryEntityKey: "host:hostname:dpf-dev",
      evidenceSource: "host_packages",
      normalizationStatus: "normalized",
      normalizationMethod: "rule",
    });
  });
});
