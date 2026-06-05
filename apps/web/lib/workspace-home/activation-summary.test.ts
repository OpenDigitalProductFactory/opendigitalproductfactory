import { describe, expect, it } from "vitest";

import {
  buildWorkspaceHomeActivationSummaries,
  buildWorkspaceHomeActivationSummary,
} from "./activation-summary";
import { createWorkspaceHomeRegistry, type WorkspaceHomeContribution } from "./registry";

function makeContribution(
  overrides: Partial<WorkspaceHomeContribution> = {},
): WorkspaceHomeContribution {
  return {
    id: "home-hvac-dispatch",
    label: "HVAC dispatcher home",
    semanticArchetypeIds: ["hvac-contractor"],
    archetypeCategories: ["trades-maintenance"],
    setupActivation: {
      status: "ready",
      primitiveWidgets: ["decision-queue", "geo-map", "handoff-queue"],
      requiredCanonicalData: ["customer-account", "service-location", "work-order"],
      requiredSignals: ["scheduled-work", "urgent-exception", "coworker-handoff"],
      missingDataBehavior: "render-empty-state",
    },
    slots: [
      { id: "today-now", label: "Today" },
      { id: "exceptions-needs-review", label: "Needs review" },
      { id: "coworker-handoffs", label: "Coworker handoffs" },
    ],
    components: [
      {
        key: "unassigned-work",
        slotId: "today-now",
        primitiveKey: "decision-queue",
        title: "Service queue",
        dataRefs: [{ kind: "projection", key: "workspaceHome.workOrders", required: true }],
      },
      {
        key: "customer-map",
        slotId: "today-now",
        primitiveKey: "geo-map",
        title: "Customer map",
        dataRefs: [{ kind: "projection", key: "workspaceHome.customerLocations", required: true }],
      },
      {
        key: "coworker-handoffs",
        slotId: "coworker-handoffs",
        primitiveKey: "handoff-queue",
        title: "Coworker handoffs",
        dataRefs: [{ kind: "projection", key: "workspaceHome.coworkerHandoffs", required: false }],
      },
    ],
    ...overrides,
  };
}

describe("workspace home activation summaries", () => {
  it("summarizes an exact worker home contribution for setup without rendering workspace", () => {
    const registry = createWorkspaceHomeRegistry([makeContribution()]);

    const summary = buildWorkspaceHomeActivationSummary({
      archetype: {
        archetypeId: "hvac-contractor",
        category: "trades-maintenance",
        name: "HVAC Contractor",
      },
      registry,
    });

    expect(summary).toMatchObject({
      archetypeId: "hvac-contractor",
      archetypeName: "HVAC Contractor",
      mode: "vertical",
      match: "exact",
      label: "HVAC dispatcher home",
      status: "ready",
      sourceContributionId: "home-hvac-dispatch",
      primitiveWidgets: ["decision-queue", "geo-map", "handoff-queue"],
      requiredCanonicalData: ["customer-account", "service-location", "work-order"],
      requiredSignals: ["scheduled-work", "urgent-exception", "coworker-handoff"],
      fallback: null,
    });
  });

  it("identifies category fallback summaries separately from exact matches", () => {
    const registry = createWorkspaceHomeRegistry([
      makeContribution({
        semanticArchetypeIds: [],
        archetypeCategories: ["trades-maintenance"],
      }),
    ]);

    const summary = buildWorkspaceHomeActivationSummary({
      archetype: {
        archetypeId: "plumbing-contractor",
        category: "trades-maintenance",
        name: "Plumbing Contractor",
      },
      registry,
    });

    expect(summary.mode).toBe("vertical");
    expect(summary.match).toBe("category");
    expect(summary.sourceContributionId).toBe("home-hvac-dispatch");
  });

  it("returns an honest platform fallback summary when no worker home is configured", () => {
    const registry = createWorkspaceHomeRegistry();

    const summary = buildWorkspaceHomeActivationSummary({
      archetype: {
        archetypeId: "training-company",
        category: "education-training",
        name: "Training Company",
      },
      registry,
    });

    expect(summary).toMatchObject({
      mode: "unconfigured",
      match: "none",
      label: "Platform workspace view",
      status: "not-configured",
      sourceContributionId: null,
      primitiveWidgets: [],
      requiredCanonicalData: [],
      requiredSignals: [],
      fallback: "platform",
      setupAction: "choose-or-finish-business-setup",
    });
  });

  it("projects an architect-amended primaryOperatingQuestion into the summary when the contribution declares one", () => {
    const registry = createWorkspaceHomeRegistry([
      makeContribution({ primaryOperatingQuestion: "what's on the board today?" }),
    ]);

    const summary = buildWorkspaceHomeActivationSummary({
      archetype: {
        archetypeId: "hvac-contractor",
        category: "trades-maintenance",
        name: "HVAC Contractor",
      },
      registry,
    });

    expect(summary.primaryOperatingQuestion).toBe("what's on the board today?");
  });

  it("reports primaryOperatingQuestion as null when the contribution omits the architect-amended field", () => {
    const registry = createWorkspaceHomeRegistry([makeContribution()]);

    const summary = buildWorkspaceHomeActivationSummary({
      archetype: {
        archetypeId: "hvac-contractor",
        category: "trades-maintenance",
        name: "HVAC Contractor",
      },
      registry,
    });

    expect(summary.primaryOperatingQuestion).toBeNull();
  });

  it("reports primaryOperatingQuestion as null on the unconfigured platform fallback", () => {
    const registry = createWorkspaceHomeRegistry();

    const summary = buildWorkspaceHomeActivationSummary({
      archetype: {
        archetypeId: "training-company",
        category: "education-training",
        name: "Training Company",
      },
      registry,
    });

    expect(summary.primaryOperatingQuestion).toBeNull();
  });

  it("builds serializable summaries keyed by the archetype ids loaded by setup", () => {
    const registry = createWorkspaceHomeRegistry([makeContribution()]);

    const summaries = buildWorkspaceHomeActivationSummaries(
      [
        {
          archetypeId: "hvac-contractor",
          category: "trades-maintenance",
          name: "HVAC Contractor",
          activationProfile: { profileType: "standard" },
        },
        {
          archetypeId: "training-company",
          category: "education-training",
          name: "Training Company",
          activationProfile: { profileType: "standard" },
        },
      ],
      registry,
    );

    expect(Object.keys(summaries)).toEqual(["hvac-contractor", "training-company"]);
    expect(summaries["hvac-contractor"]?.mode).toBe("vertical");
    expect(summaries["training-company"]?.fallback).toBe("platform");
    expect(JSON.parse(JSON.stringify(summaries))).toEqual(summaries);
  });
});
