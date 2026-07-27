import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { WorkHighlights, WorkOfferedPanel } from "./OwnerCoworkerPanels";
import type {
  CoworkerServiceAvailability,
  RosterServiceEvidence,
} from "@/lib/coworker-record/roster-presentation";

const services: RosterServiceEvidence[] = [
  {
    serviceId: "svc-marketing-campaign-execution",
    name: "Marketing campaign execution",
    summary: "Plans and runs campaigns.",
    status: "active",
    hitlTier: 2,
    authorityBoundary: "proposal-only",
    availabilityScope: "external",
    personas: ["customer"],
    archetypes: ["food-hospitality"],
    backingSkillIds: [],
    backingToolNames: ["create_marketing_campaign"],
    backingGrantKeys: ["marketing_write"],
    metadata: { aggregate: true },
    portfolio: {
      slug: "products_and_services_sold",
      name: "Products and services sold",
    },
  },
  {
    serviceId: "svc-marketing-ab-testing",
    name: "Marketing A/B variant testing",
    summary: "Tests campaign variants.",
    status: "active",
    hitlTier: 2,
    authorityBoundary: "proposal-only",
    availabilityScope: "internal",
    personas: ["marketing"],
    archetypes: [],
    backingSkillIds: [],
    backingToolNames: ["create_asset_variant"],
    backingGrantKeys: ["marketing_write"],
    metadata: {},
    portfolio: {
      slug: "products_and_services_sold",
      name: "Products and services sold",
    },
  },
];

const serviceAvailability: CoworkerServiceAvailability[] = [
  {
    serviceId: "svc-marketing-campaign-execution",
    serviceName: "Marketing campaign execution",
    availability: {
      state: "available",
      label: "Available for your business type",
      reason: "This coworker supports the food-hospitality business category.",
      matchLevel: "category",
      evidence: [],
    },
  },
  {
    serviceId: "svc-marketing-ab-testing",
    serviceName: "Marketing A/B variant testing",
    availability: {
      state: "coverage-not-defined",
      label: "Coverage not defined",
      reason: "No supported business type is declared.",
      matchLevel: null,
      evidence: [],
    },
  },
];

describe("owner coworker service presentation", () => {
  it("shows only verified services in the first-view ready-work list", () => {
    const html = renderToStaticMarkup(
      <WorkHighlights
        services={services}
        serviceAvailability={serviceAvailability}
      />,
    );

    expect(html).toContain("Marketing campaign execution");
    expect(html).not.toContain("Marketing A/B variant testing");
  });

  it("retains unresolved sibling services with their individual status", () => {
    const html = renderToStaticMarkup(
      <WorkOfferedPanel
        services={services}
        serviceAvailability={serviceAvailability}
      />,
    );

    expect(html).toContain("Marketing campaign execution");
    expect(html).toContain("Marketing A/B variant testing");
    expect(html).toContain("Coverage not defined");
  });
});
