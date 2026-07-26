import { describe, expect, it } from "vitest";
import { ALL_ARCHETYPES } from "@dpf/storefront-templates";

import {
  COWORKER_SERVICE_CATALOG_OFFER_SEEDS,
  COWORKER_SERVICE_CATALOG_SERVICE_SEEDS,
  seedCoworkerServiceCatalog,
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
      expect(service.portfolioRoles, service.serviceId).toEqual(expect.arrayContaining(["workforce"]));
    }
    for (const offer of COWORKER_SERVICE_CATALOG_OFFER_SEEDS) {
      expect(serviceIds.includes(offer.serviceId), offer.offerId).toBe(true);
    }
  });

  it("uses only governed archetype category or leaf identifiers", () => {
    const governedIdentifiers = new Set(
      ALL_ARCHETYPES.flatMap((archetype) => [archetype.archetypeId, archetype.category]),
    );

    for (const service of COWORKER_SERVICE_CATALOG_SERVICE_SEEDS) {
      const declarations = service.archetypes as unknown;
      expect(Array.isArray(declarations), service.serviceId).toBe(true);
      for (const declaration of declarations as unknown[]) {
        expect(typeof declaration, service.serviceId).toBe("string");
        expect(governedIdentifiers.has(String(declaration)), `${service.serviceId}: ${String(declaration)}`).toBe(true);
      }
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

  it("leaves services projectable per coworker and associates offers to the AI Workforce product", async () => {
    const serviceUpserts: Array<Record<string, unknown>> = [];
    const serviceUpdates: Array<Record<string, unknown>> = [];
    const offerUpserts: Array<Record<string, unknown>> = [];
    const offerUpdates: Array<Record<string, unknown>> = [];
    const prisma = {
      coworkerService: {
        upsert: async (args: Record<string, unknown>) => {
          serviceUpserts.push(args);
          return {};
        },
        updateMany: async (args: Record<string, unknown>) => {
          serviceUpdates.push(args);
          return { count: 0 };
        },
      },
      coworkerOffer: {
        upsert: async (args: Record<string, unknown>) => {
          offerUpserts.push(args);
          return {};
        },
        updateMany: async (args: Record<string, unknown>) => {
          offerUpdates.push(args);
          return { count: 0 };
        },
      },
    };

    await seedCoworkerServiceCatalog(prisma as never);

    expect(serviceUpserts).toHaveLength(COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.length);
    expect(offerUpserts).toHaveLength(COWORKER_SERVICE_CATALOG_OFFER_SEEDS.length);
    for (const args of serviceUpserts) {
      expect(args["create"]).not.toHaveProperty("digitalProductId");
      expect(args["update"]).not.toHaveProperty("digitalProductId");
      expect(args["create"]).toHaveProperty("archetypes", []);
      expect(args["update"]).not.toHaveProperty("archetypes");
    }
    // BI-74FD6420 seed-FK contract: providerAgentId stays the slug agentId
    // (build-specialist), NOT the dual-seed AGT-* twin. Collapsing to AGT-*
    // here breaks CoworkerService_providerAgentId_fkey when slug rows are the
    // seeded provider identity.
    const providerIds = serviceUpserts.map((args) => {
      const create = args["create"] as { providerAgentId?: string } | undefined;
      return create?.providerAgentId;
    });
    expect(providerIds).toContain("build-specialist");
    expect(providerIds).toContain("external-catalog-scout");
    expect(providerIds).not.toContain("AGT-WS-BUILD");
    expect(providerIds).not.toContain("AGT-WS-SCOUT");
    expect(serviceUpdates).toEqual([
      expect.objectContaining({
        where: expect.objectContaining({
          archetypes: { equals: ["software-and-platforms"] },
        }),
        data: { archetypes: [] },
      }),
      expect.objectContaining({
        where: expect.objectContaining({ digitalProductId: "dpf-portal" }),
        data: { digitalProductId: null },
      }),
    ]);
    for (const args of offerUpserts) {
      expect(args).toMatchObject({
        create: expect.objectContaining({ digitalProductId: "dpf-ai-workforce" }),
      });
      expect(args["update"]).not.toHaveProperty("digitalProductId");
    }
    expect(offerUpdates).toEqual([
      expect.objectContaining({
        where: expect.objectContaining({ digitalProductId: "dpf-portal" }),
        data: { digitalProductId: "dpf-ai-workforce" },
      }),
    ]);
  });
});
