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

  it("renders configured worker home activation beside capability activation", () => {
    const html = renderToStaticMarkup(
      <ArchetypeActivationSummary
        activationProfile={{
          profileType: "standard",
          modules: ["integrations"],
          billingReadinessMode: "none",
          customerGraph: "none",
          estateSeparation: "shared",
        }}
        workspaceHomeActivation={{
          archetypeId: "hvac-contractor",
          archetypeName: "HVAC Contractor",
          mode: "vertical",
          match: "exact",
          label: "HVAC dispatcher home",
          status: "ready",
          sourceContributionId: "home-hvac-dispatch",
          primaryOperatingQuestion: null,
          primitiveWidgets: ["service-queue", "customer-map", "coworker-handoffs"],
          requiredCanonicalData: ["customer-account", "service-location", "work-order"],
          requiredSignals: ["scheduled-work", "urgent-exception", "coworker-handoff"],
          missingDataBehavior: "render-empty-state",
          fallback: null,
          setupAction: null,
        }}
      />,
    );

    expect(html).toContain("Worker Home");
    expect(html).toContain("HVAC dispatcher home");
    expect(html).toContain("Ready");
    expect(html).toContain("Service Queue");
    expect(html).toContain("Customer Map");
    expect(html).toContain("Coworker Handoffs");
    // primaryOperatingQuestion is null → operating-question line stays hidden
    expect(html).not.toContain("The worker arrives asking");
  });

  it("renders the architect-amended primaryOperatingQuestion when the contribution declares one", () => {
    const html = renderToStaticMarkup(
      <ArchetypeActivationSummary
        activationProfile={{
          profileType: "standard",
          modules: ["integrations"],
          billingReadinessMode: "none",
          customerGraph: "none",
          estateSeparation: "shared",
        }}
        workspaceHomeActivation={{
          archetypeId: "hvac-contractor",
          archetypeName: "HVAC Contractor",
          mode: "vertical",
          match: "exact",
          label: "HVAC dispatcher home",
          status: "ready",
          sourceContributionId: "home-hvac-dispatch",
          primaryOperatingQuestion: "what's on the board today?",
          primitiveWidgets: ["service-queue", "customer-map", "coworker-handoffs"],
          requiredCanonicalData: ["customer-account", "service-location", "work-order"],
          requiredSignals: ["scheduled-work", "urgent-exception", "coworker-handoff"],
          missingDataBehavior: "render-empty-state",
          fallback: null,
          setupAction: null,
        }}
      />,
    );

    expect(html).toContain("The worker arrives asking: what&#x27;s on the board today?");
    // Architect amendment must not introduce gear/cockpit vocabulary on this worker surface.
    expect(html).not.toMatch(/gear|cockpit|ring|torque|slip|wear|triple/i);
  });

  it("renders honest platform fallback when a worker home is not configured", () => {
    const html = renderToStaticMarkup(
      <ArchetypeActivationSummary
        workspaceHomeActivation={{
          archetypeId: "training-company",
          archetypeName: "Training Company",
          mode: "unconfigured",
          match: "none",
          label: "Platform workspace view",
          status: "not-configured",
          sourceContributionId: null,
          primaryOperatingQuestion: null,
          primitiveWidgets: [],
          requiredCanonicalData: [],
          requiredSignals: [],
          missingDataBehavior: "platform-fallback",
          fallback: "platform",
          setupAction: "choose-or-finish-business-setup",
        }}
      />,
    );

    expect(html).toContain("Worker Home");
    expect(html).toContain("Platform workspace view");
    expect(html).toContain("Not Configured");
    expect(html).not.toContain("The worker arrives asking");
    expect(html).not.toMatch(/gear|architecture|contribution|specialist|platform layer|business layer|market vertical/i);
  });
});
