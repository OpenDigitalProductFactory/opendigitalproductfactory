import { describe, expect, it } from "vitest";

import {
  COWORKER_SERVICE_CATALOG_OFFER_SEEDS,
  COWORKER_SERVICE_CATALOG_SERVICE_SEEDS,
} from "./coworker-service-catalog-seed";
import { COWORKER_AGENT_SEEDS } from "./workforce-seed";

function unique(values: readonly string[]) {
  return new Set(values).size === values.length;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

describe("coworker service catalog seed data", () => {
  it("seeds a compact baseline across internal, build, procurement, legal, and external surfaces", () => {
    expect(COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.length).toBeGreaterThanOrEqual(7);
    expect(COWORKER_SERVICE_CATALOG_OFFER_SEEDS.length).toBeGreaterThanOrEqual(7);

    expect(COWORKER_SERVICE_CATALOG_OFFER_SEEDS.map((offer) => offer.offerId)).toEqual(
      expect.arrayContaining([
        "offer-build-sensitive-domain-requirements",
        "offer-pci-control-requirements",
        "offer-legal-contract-packet",
        "offer-provider-cost-intake",
        "offer-customer-sales-intake",
        "offer-marketing-partner-intake",
      ]),
    );
  });

  it("references seeded coworker providers and services", () => {
    const seededAgents = new Set(COWORKER_AGENT_SEEDS.map((agent) => agent.agentId));
    const serviceIds = COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.map((service) => service.serviceId);

    expect(unique(serviceIds)).toBe(true);
    expect(unique(COWORKER_SERVICE_CATALOG_OFFER_SEEDS.map((offer) => offer.offerId))).toBe(true);

    for (const service of COWORKER_SERVICE_CATALOG_SERVICE_SEEDS) {
      expect(seededAgents.has(service.providerAgentId), service.serviceId).toBe(true);
    }
    for (const offer of COWORKER_SERVICE_CATALOG_OFFER_SEEDS) {
      expect(serviceIds.includes(offer.serviceId), offer.offerId).toBe(true);
    }
  });

  it("includes verified GAID authority metadata for public A2A offers", () => {
    const externalOffers = COWORKER_SERVICE_CATALOG_OFFER_SEEDS.filter(
      (offer) => offer.availabilityScope === "external",
    );

    expect(externalOffers.length).toBeGreaterThanOrEqual(2);
    for (const offer of externalOffers) {
      const service = COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.find((candidate) => candidate.serviceId === offer.serviceId);
      const metadata = record(offer.metadata);
      const gaidAuthority = record(metadata.gaidAuthority);

      expect(metadata.gaid, offer.offerId).toMatch(/^gaid:public:dpf:/);
      expect(metadata.aidocRef, offer.offerId).toMatch(/^aidoc:\/\/dpf\/public\//);
      expect(gaidAuthority, offer.offerId).toMatchObject({
        state: "verified",
        exposure: "public",
        subjectAgentId: service?.providerAgentId,
      });
      expect(Object.keys(record(offer.legalTerms)).length, offer.offerId).toBeGreaterThan(0);
      expect(Object.keys(record(offer.dataBoundary)).length, offer.offerId).toBeGreaterThan(0);
    }
  });
});
