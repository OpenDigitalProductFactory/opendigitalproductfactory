import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ArchetypeActivationSummary } from "./ArchetypeActivationSummary";

describe("ArchetypeActivationSummary", () => {
  it("renders MSP capability and billing activation from the normalized profile", () => {
    const html = renderToStaticMarkup(
      <ArchetypeActivationSummary
        activationProfile={{
          profileType: "managed-service-provider",
          modules: ["customer-estate", "service-agreements", "service-operations"],
          billingReadinessMode: "prepared-not-prescribed",
          customerGraph: "separate-customer-projection",
          estateSeparation: "strict",
        }}
      />,
    );

    expect(html).toContain("Customer Estate");
    expect(html).toContain("Edge Node Customer Deployment");
    expect(html).toContain("Service Agreements");
    expect(html).toContain("Backup And Restore Posture");
    expect(html).toContain("Cybersecurity Posture");
    expect(html).toContain("Billing Readiness");
    expect(html).toContain("Recurring Agreement");
    expect(html).toContain("Strict Customer Scope");
  });

  it("renders salon checkout activation without customer estate", () => {
    const html = renderToStaticMarkup(
      <ArchetypeActivationSummary
        activationProfile={{
          profileType: "standard",
          modules: ["integrations"],
          billingReadinessMode: "none",
          customerGraph: "none",
          estateSeparation: "shared",
          axes: {
            form: "services",
            delivery: "physical",
            primaryConsumer: "individual",
            consumptionChannel: "physical",
            commercialModel: "appointment-checkout",
            provisioning: "account-with-billing",
            platform: "no",
          },
          portfolios: {
            foundational: { scope: "minimal" },
            manufactureAndDeliver: { scope: "minimal" },
            forEmployees: { scope: "minimal" },
            productsAndServicesSold: { scope: "primary" },
          },
        }}
      />,
    );

    expect(html).toContain("Appointment Checkout");
    expect(html).toContain("Point Of Sale");
    expect(html).toContain("Organization Scope");
    expect(html).not.toContain("Customer Estate");
    expect(html).not.toContain("Strict Customer Scope");
  });
});
