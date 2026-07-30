import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  CoworkerCatalogView,
  projectOfferPresentation,
} from "./CoworkerCatalogView";
import type { CoworkerCatalog } from "@/lib/coworker-service-catalog/catalog";

const catalog: CoworkerCatalog = {
  services: [
    {
      serviceId: "svc-legal-packets",
      name: "Prepare attorney-review packet",
      summary: "Assemble a counsel-ready packet.",
      description: null,
      status: "active",
      riskTier: "high",
      hitlTier: 1,
      authorityBoundary: "proposal-only",
      availabilityScope: "internal",
      personas: ["founder", "operator"],
      portfolioRoles: ["foundational"],
      valueStreams: ["operate"],
      archetypes: ["software-and-platforms"],
      jurisdictions: ["us"],
      requiredInputs: [{ label: "Draft document" }],
      producedOutputs: [{ label: "Counsel packet" }],
      costModel: {},
      contractTerms: {},
      dataBoundary: { sensitivity: "confidential" },
      metadata: {},
      portfolio: { slug: "foundation", name: "Foundation" },
      provider: {
        agentId: "legal-operations-counsel",
        displayName: "Legal Operations Counsel",
        kind: "specialist",
        valueStream: "cross-cutting",
        hitlTierDefault: 1,
        sensitivity: "confidential",
        portfolio: { slug: "foundation", name: "Foundation" },
      },
      backing: {
        skillIds: ["prepare-counsel-packet"],
        toolNames: ["doc_save"],
        grantKeys: ["document_write"],
      },
      digitalProduct: { productId: "dpf-platform", name: "Digital Product Factory", portfolio: { slug: "foundation", name: "Foundation" } },
      serviceOfferingId: null,
    },
  ],
  offers: [],
};

catalog.offers = [
  {
    offerId: "offer-example-works-legal-packet",
    serviceId: "svc-legal-packets",
    serviceName: "Prepare attorney-review packet",
    name: "Example Works legal packet review",
    summary: "Internal, high-risk, attorney-review-required offer.",
    description: null,
    status: "active",
    version: "1.0.0",
    providerOrganization: "Example Works",
    availabilityScope: "internal",
    riskTier: "high",
    authorityBoundary: "proposal-only",
    eligibleConsumers: ["founder", "operator"],
    budgetEnvelope: { estimate: "internal-budget" },
    sla: { turnaround: "2 business days" },
    requiredApprovals: [{ type: "attorney-review" }],
    legalTerms: { termsRequired: true },
    dataBoundary: { sensitivity: "confidential" },
    deliverables: ["Counsel packet"],
    filters: { artifact: "legal-review-packet" },
    metadata: { legalRisk: "attorney-review-required" },
    expiresAt: null,
    provider: catalog.services[0].provider,
    service: catalog.services[0],
    digitalProduct: catalog.services[0].digitalProduct,
  },
];

describe("CoworkerCatalogView", () => {
  it("renders a dense operating catalog with separate service, offer, and engagement language", () => {
    const html = renderToStaticMarkup(<CoworkerCatalogView catalog={catalog} />);

    expect(html).toContain("Coworker Service Catalog");
    expect(html).toContain("Example Works legal packet review");
    expect(html).toContain("Legal Operations Counsel");
    expect(html).toContain("Service");
    expect(html).toContain("Offer");
    expect(html).toContain("Engagement");
    expect(html).toContain("proposal-only");
    expect(html).toContain("attorney-review-required");
    expect(html).toContain('data-catalog-layout="mobile"');
    expect(html).toContain('data-catalog-layout="desktop"');
    expect(html).toContain("lg:hidden");
    expect(html).toContain("lg:block");
    expect(html).toContain("<table");
    expect(html).toContain("<thead");
    expect(html.match(/scope="col"/g)).toHaveLength(5);
    expect(html).toContain("<tbody");
    const desktopRegion = html.match(
      /<div[^>]*data-catalog-layout="desktop"[^>]*>/,
    )?.[0];
    expect(desktopRegion).toContain('role="region"');
    expect(desktopRegion).toContain('aria-label="Coworker offers"');
    expect(desktopRegion).toContain('tabindex="0"');
    expect(desktopRegion).toContain("overflow-x-auto");
    expect(html).toContain('role="note"');
    expect(html).toContain(
      'aria-label="Provider organization: Example Works"',
    );
    expect(html).not.toContain("Provider organization: <!-- -->");
  });

  it("shares one complete offer interpretation across desktop and mobile", () => {
    const presentation = projectOfferPresentation(catalog.offers[0]);

    expect(presentation).toMatchObject({
      provider: {
        primary: "Legal Operations Counsel",
        secondary: "Example Works",
        secondaryLabel: "Provider organization",
      },
      risk: {
        primary: "high",
      },
      authority: {
        primary: "proposal-only",
        secondary: "Approval required",
      },
      availability: {
        primary: "internal",
        secondary: "Digital Product Factory",
      },
    });
    expect(presentation.mobileFacts).toEqual(
      expect.arrayContaining([
        { label: "Version", value: "1.0.0" },
        { label: "Provider organization", value: "Example Works" },
        {
          label: "Availability",
          value: "internal; Digital Product Factory",
        },
      ]),
    );
  });

  it("does not present a provider type as an organization", () => {
    const presentation = projectOfferPresentation({
      ...catalog.offers[0],
      providerOrganization: null,
    });

    expect(presentation.provider).toEqual({
      primary: "Legal Operations Counsel",
      secondary: "specialist",
      secondaryLabel: "Provider type",
    });
    expect(presentation.mobileFacts).toContainEqual({
      label: "Provider type",
      value: "specialist",
    });
    expect(presentation.mobileFacts).not.toContainEqual({
      label: "Provider organization",
      value: "specialist",
    });
  });
});
