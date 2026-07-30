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

  it("classifies seeded services by explicit owner-facing work area", () => {
    const byId = new Map(
      COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.map((service) => [
        service.serviceId,
        service.ownerAreaSlug,
      ]),
    );

    expect(byId.get("svc-customer-sales-intake")).toBe(
      "products_and_services_sold",
    );
    expect(byId.get("svc-marketing-partner-intake")).toBe(
      "products_and_services_sold",
    );
    expect(byId.get("svc-marketing-campaign-execution")).toBe(
      "products_and_services_sold",
    );
    expect(byId.get("svc-build-sensitive-requirements")).toBe("foundational");
    expect(byId.get("svc-compliance-pci-requirements")).toBe("foundational");
    expect(byId.get("svc-legal-counsel-packet")).toBe("foundational");
    expect(byId.get("svc-finance-provider-cost-intake")).toBe("foundational");
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

  it("declares only the verified Marketing campaign service for food and hospitality", () => {
    const marketing = COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.find(
      (service) => service.serviceId === "svc-marketing-campaign-execution",
    );
    const customerAdvisor = COWORKER_SERVICE_CATALOG_SERVICE_SEEDS.find(
      (service) => service.serviceId === "svc-customer-sales-intake",
    );

    expect(marketing?.archetypes).toEqual(["food-hospitality"]);
    expect(customerAdvisor?.archetypes).toEqual([]);
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
      portfolio: {
        findMany: async () => [
          { id: "portfolio-customer", slug: "products_and_services_sold" },
          { id: "portfolio-foundational", slug: "foundational" },
        ],
      },
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
      expect(args["create"]).not.toHaveProperty("ownerAreaSlug");
      expect(args["update"]).not.toHaveProperty("ownerAreaSlug");
      expect(args["create"]).toHaveProperty("portfolioId");
      expect(args["update"]).toHaveProperty("portfolioId");
      const create = args["create"] as { serviceId?: string };
      expect(args["create"]).toHaveProperty(
        "archetypes",
        create.serviceId === "svc-marketing-campaign-execution"
          ? ["food-hospitality"]
          : [],
      );
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
        where: expect.objectContaining({
          serviceId: "svc-marketing-campaign-execution",
          archetypes: { equals: [] },
        }),
        data: { archetypes: ["food-hospitality"] },
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

  it("backfills missing Marketing applicability idempotently without overwriting operator declarations", async () => {
    function statefulPrisma(initialArchetypes: string[]) {
      const services = new Map<string, Record<string, unknown>>([
        [
          "svc-marketing-campaign-execution",
          {
            serviceId: "svc-marketing-campaign-execution",
            archetypes: [...initialArchetypes],
            digitalProductId: null,
          },
        ],
      ]);
      const matches = (
        row: Record<string, unknown>,
        where: Record<string, unknown>,
      ) => {
        const serviceId = where.serviceId;
        if (
          typeof serviceId === "string" &&
          row.serviceId !== serviceId
        ) {
          return false;
        }
        if (
          serviceId &&
          typeof serviceId === "object" &&
          !Array.isArray(serviceId) &&
          !((serviceId as { in?: unknown[] }).in ?? []).includes(
            row.serviceId,
          )
        ) {
          return false;
        }
        const archetypes = where.archetypes as
          | { equals?: unknown[] }
          | undefined;
        if (
          archetypes?.equals &&
          JSON.stringify(row.archetypes) !==
            JSON.stringify(archetypes.equals)
        ) {
          return false;
        }
        if (
          typeof where.digitalProductId === "string" &&
          row.digitalProductId !== where.digitalProductId
        ) {
          return false;
        }
        return true;
      };
      const prisma = {
        portfolio: {
          findMany: async () => [
            {
              id: "portfolio-customer",
              slug: "products_and_services_sold",
            },
            { id: "portfolio-foundational", slug: "foundational" },
          ],
        },
        coworkerService: {
          upsert: async (args: Record<string, unknown>) => {
            const where = args.where as { serviceId: string };
            const current = services.get(where.serviceId);
            services.set(where.serviceId, {
              ...(current ?? {}),
              ...((current ? args.update : args.create) as Record<
                string,
                unknown
              >),
            });
            return {};
          },
          updateMany: async (args: Record<string, unknown>) => {
            let count = 0;
            for (const [serviceId, row] of services) {
              if (
                matches(
                  row,
                  args.where as Record<string, unknown>,
                )
              ) {
                services.set(serviceId, {
                  ...row,
                  ...(args.data as Record<string, unknown>),
                });
                count += 1;
              }
            }
            return { count };
          },
        },
        coworkerOffer: {
          upsert: async () => ({}),
          updateMany: async () => ({ count: 0 }),
        },
      };
      return { prisma, services };
    }

    const missing = statefulPrisma([]);
    await seedCoworkerServiceCatalog(missing.prisma as never);
    expect(
      missing.services.get("svc-marketing-campaign-execution")
        ?.archetypes,
    ).toEqual(["food-hospitality"]);
    const once = JSON.stringify([...missing.services.entries()]);
    await seedCoworkerServiceCatalog(missing.prisma as never);
    expect(JSON.stringify([...missing.services.entries()])).toBe(once);

    const authored = statefulPrisma(["restaurant"]);
    await seedCoworkerServiceCatalog(authored.prisma as never);
    await seedCoworkerServiceCatalog(authored.prisma as never);
    expect(
      authored.services.get("svc-marketing-campaign-execution")
        ?.archetypes,
    ).toEqual(["restaurant"]);
  });

  it("fails closed when a declared owner-facing portfolio is missing", async () => {
    const prisma = {
      portfolio: {
        findMany: async () => [
          { id: "portfolio-customer", slug: "products_and_services_sold" },
        ],
      },
    };

    await expect(seedCoworkerServiceCatalog(prisma as never)).rejects.toThrow(
      "Coworker service owner areas are missing: foundational",
    );
  });
});
