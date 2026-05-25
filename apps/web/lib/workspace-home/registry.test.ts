import { describe, expect, it } from "vitest";

import {
  BASELINE_WORKSPACE_HOME_SLOT_IDS,
  createWorkspaceHomeRegistry,
  resolveWorkspaceHomeContribution,
  validateWorkspaceHomeComponent,
  validateWorkspaceHomeContribution,
  type WorkspaceHomeContribution,
} from "./registry";

function makeContribution(
  overrides: Partial<WorkspaceHomeContribution> = {},
): WorkspaceHomeContribution {
  return {
    id: "home-trades-maintenance",
    label: "Trades maintenance home",
    semanticArchetypeIds: ["hvac-contractor"],
    archetypeCategories: ["trades-maintenance"],
    setupActivation: {
      status: "ready",
      primitiveWidgets: ["service-queue", "customer-map", "coworker-handoffs"],
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
        key: "service-queue",
        slotId: "today-now",
        primitiveKey: "service-queue",
        title: "Service queue",
        dataRefs: [{ kind: "projection", key: "workspaceHome.workOrders", required: true }],
      },
      {
        key: "customer-map",
        slotId: "today-now",
        primitiveKey: "customer-map",
        title: "Customer map",
        dataRefs: [{ kind: "projection", key: "workspaceHome.customerLocations", required: true }],
      },
      {
        key: "coworker-handoff-list",
        slotId: "coworker-handoffs",
        primitiveKey: "coworker-handoffs",
        title: "Coworker handoffs",
        dataRefs: [{ kind: "projection", key: "workspaceHome.coworkerHandoffs", required: false }],
      },
    ],
    ...overrides,
  };
}

describe("workspace home contribution registry", () => {
  it("requires every contribution to honor the baseline workspace slot covenant", () => {
    const contribution = makeContribution({
      slots: [
        { id: "today-now", label: "Today" },
        { id: "coworker-handoffs", label: "Coworker handoffs" },
      ],
    });

    const validation = validateWorkspaceHomeContribution(contribution);

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("missing baseline slot: exceptions-needs-review");
    expect(BASELINE_WORKSPACE_HOME_SLOT_IDS).toEqual([
      "today-now",
      "exceptions-needs-review",
      "coworker-handoffs",
    ]);
  });

  it("fails closed when an unknown component key is declared", () => {
    const validation = validateWorkspaceHomeComponent({
      key: "unsupported-widget",
      slotId: "today-now",
      primitiveKey: "service-queue",
      title: "Mystery widget",
      dataRefs: [{ kind: "projection", key: "workspaceHome.workOrders", required: true }],
    });

    expect(validation.ok).toBe(false);
    expect(validation.placeholder).toEqual({
      componentKey: "unsupported-widget",
      reason: "unknown-component-key",
    });
  });

  it("rejects inline component data in favor of typed canonical data references", () => {
    const validation = validateWorkspaceHomeComponent({
      key: "service-queue",
      slotId: "today-now",
      primitiveKey: "service-queue",
      title: "Service queue",
      dataRefs: [
        {
          kind: "inline",
          key: "raw-work-orders",
          required: true,
          value: [{ customer: "Dale" }],
        },
      ],
    });

    expect(validation.ok).toBe(false);
    expect(validation.errors).toContain("unsupported dataRef kind: inline");
  });

  it("resolves exact semantic archetype contributions before category fallbacks", () => {
    const exact = makeContribution({ id: "exact-hvac", label: "HVAC dispatcher" });
    const category = makeContribution({
      id: "category-trades",
      label: "Trades dispatcher",
      semanticArchetypeIds: [],
      archetypeCategories: ["trades-maintenance"],
    });
    const registry = createWorkspaceHomeRegistry([category, exact]);

    const resolution = resolveWorkspaceHomeContribution({
      storefrontConfig: {
        archetype: {
          archetypeId: "hvac-contractor",
          category: "trades-maintenance",
          name: "HVAC Contractor",
        },
      },
      registry,
    });

    expect(resolution.mode).toBe("vertical");
    expect(resolution.match).toBe("exact");
    expect(resolution.contribution?.id).toBe("exact-hvac");
  });

  it("resolves a category fallback when no exact contribution exists", () => {
    const registry = createWorkspaceHomeRegistry([
      makeContribution({
        id: "category-trades",
        semanticArchetypeIds: [],
        archetypeCategories: ["trades-maintenance"],
      }),
    ]);

    const resolution = resolveWorkspaceHomeContribution({
      storefrontConfig: {
        archetype: {
          archetypeId: "plumbing-contractor",
          category: "trades-maintenance",
          name: "Plumbing Contractor",
        },
      },
      registry,
    });

    expect(resolution.mode).toBe("vertical");
    expect(resolution.match).toBe("category");
    expect(resolution.contribution?.id).toBe("category-trades");
  });

  it("returns an honest unconfigured fallback when no storefront archetype is available", () => {
    const registry = createWorkspaceHomeRegistry([makeContribution()]);

    const resolution = resolveWorkspaceHomeContribution({
      storefrontConfig: null,
      registry,
    });

    expect(resolution).toEqual({
      mode: "unconfigured",
      match: "none",
      contribution: null,
      fallback: "platform",
      setupAction: "choose-or-finish-business-setup",
    });
  });

  it("re-evaluates the selected contribution when the archetype changes", () => {
    const registry = createWorkspaceHomeRegistry([
      makeContribution({ id: "hvac-home", semanticArchetypeIds: ["hvac-contractor"] }),
      makeContribution({ id: "msp-home", semanticArchetypeIds: ["managed-service-provider"] }),
    ]);

    const first = resolveWorkspaceHomeContribution({
      storefrontConfig: {
        archetype: {
          archetypeId: "hvac-contractor",
          category: "trades-maintenance",
          name: "HVAC Contractor",
        },
      },
      registry,
    });
    const second = resolveWorkspaceHomeContribution({
      storefrontConfig: {
        archetype: {
          archetypeId: "managed-service-provider",
          category: "professional-services",
          name: "Managed Service Provider",
        },
      },
      registry,
    });

    expect(first.contribution?.id).toBe("hvac-home");
    expect(second.contribution?.id).toBe("msp-home");
  });
});
