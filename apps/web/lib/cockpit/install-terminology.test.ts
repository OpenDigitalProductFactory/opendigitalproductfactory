import { describe, expect, it } from "vitest";
import {
  buildCockpitTerminology,
  resolveCockpitRowLabels,
  type CockpitInstallContext,
} from "./install-terminology";

const configuredContext: CockpitInstallContext = {
  organization: { name: "Dale HVAC", industry: "trades-maintenance" },
  storefront: {
    archetype: {
      archetypeId: "facilities-maintenance",
      name: "Facilities Maintenance",
      category: "trades-maintenance",
      customVocabulary: {
        portalLabel: "Service Portal",
        teamLabel: "Crew",
        agentName: "Service Coordinator",
      },
    },
  },
  agents: [{ agentId: "AGT-BUILD", slugId: "build-specialist", name: "Build Specialist" }],
};

describe("buildCockpitTerminology", () => {
  it("uses configured install identity, portal vocabulary, and archetype labels", () => {
    const terminology = buildCockpitTerminology(configuredContext);

    expect(terminology.mode).toBe("install-aware");
    expect(terminology.installName).toBe("Dale HVAC");
    expect(terminology.portalLabel).toBe("Service Portal");
    expect(terminology.verticalLabel).toBe("Facilities Maintenance");
    expect(terminology.banner).toBeNull();
  });

  it("falls back honestly when StorefrontConfig is missing", () => {
    const terminology = buildCockpitTerminology({
      organization: { name: "Dale HVAC", industry: "trades-maintenance" },
      storefront: null,
      agents: [],
    });

    expect(terminology.mode).toBe("abstract");
    expect(terminology.banner?.message).toContain("Install identity not configured");
    expect(terminology.banner?.href).toBe("/storefront/setup");
    expect(terminology.missingContext).toContain("storefront-config");
  });

  it("falls back honestly when the archetype relation is missing", () => {
    const terminology = buildCockpitTerminology({
      organization: { name: "Dale HVAC", industry: "trades-maintenance" },
      storefront: { archetype: null },
      agents: [],
    });

    expect(terminology.mode).toBe("abstract");
    expect(terminology.missingContext).toContain("storefront-archetype");
  });
});

describe("resolveCockpitRowLabels", () => {
  it("resolves coworker, capability, archetype, and interface labels for a configured install", () => {
    const terminology = buildCockpitTerminology(configuredContext);
    const labels = resolveCockpitRowLabels(
      {
        innerRing: 1,
        outerRing: 2,
        transmissionDirection: "outward",
        agentIdForTriple: "AGT-BUILD",
        actorId: "AGT-BUILD",
        capabilityName: "code-review",
        archetypeContext: "facilities-maintenance",
        shaftSourceType: "phase-run",
        outcomeType: "transmission",
        slipDetected: false,
        slipReason: null,
      },
      terminology,
    );

    expect(labels.interfaceLabel).toBe("Ring 1->2 Crew -> Service Portal workflow");
    expect(labels.agentLabel).toBe("Build Specialist");
    expect(labels.actorLabel).toBe("Build Specialist");
    expect(labels.archetypeLabel).toBe("Facilities Maintenance");
    expect(labels.capabilityLabel).toBe("code-review work in Facilities Maintenance");
    expect(labels.outcomeLabel).toBe("transmission");
  });

  it("uses registry identity when the database agent list does not include the coworker", () => {
    const terminology = buildCockpitTerminology({ ...configuredContext, agents: [] });
    const labels = resolveCockpitRowLabels(
      {
        innerRing: 1,
        outerRing: 2,
        transmissionDirection: "outward",
        agentIdForTriple: "AGT-WS-INVENTORY",
        actorId: "inventory-specialist",
        capabilityName: "inventory-reconciliation",
        archetypeContext: "facilities-maintenance",
        shaftSourceType: "phase-run",
        outcomeType: "transmission",
        slipDetected: false,
        slipReason: null,
      },
      terminology,
    );

    expect(labels.agentLabel).toBe("Digital Product Estate Specialist");
    expect(labels.actorLabel).toBe("Digital Product Estate Specialist");
    expect(labels.agentResolution).toBe("registry");
  });

  it("keeps unresolved coworker IDs visible without forcing abstract mode", () => {
    const terminology = buildCockpitTerminology(configuredContext);
    const labels = resolveCockpitRowLabels(
      {
        innerRing: 2,
        outerRing: 3,
        transmissionDirection: "outward",
        agentIdForTriple: "unknown-agent",
        actorId: "unknown-agent",
        capabilityName: "dispatch-routing",
        archetypeContext: "facilities-maintenance",
        shaftSourceType: "phase-run",
        outcomeType: "slip",
        slipDetected: true,
        slipReason: "archetype-unresolved",
      },
      terminology,
    );

    expect(terminology.mode).toBe("install-aware");
    expect(labels.agentLabel).toBe("unknown-agent");
    expect(labels.agentResolution).toBe("unresolved");
    expect(labels.outcomeLabel).toBe("slip: archetype-unresolved");
  });
});
