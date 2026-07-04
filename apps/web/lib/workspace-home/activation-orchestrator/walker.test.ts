import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "@dpf/db";

import { buildActivationPlan } from "./walker";
import type { CanonicalDataRegistryEntry } from "./canonical-data-registry";
import type { SignalRegistryEntry } from "./signal-registry";
import type { WorkspaceHomeContribution } from "../types";

// Synthetic prisma — never called; the walker reaches into the registry's
// count() functions instead. Registry entries below take an opaque prisma
// argument and return canned counts for the test.
const fakePrisma = {} as unknown as PrismaClient;

function counterRegistry(
  counts: Record<string, number>,
): Record<string, CanonicalDataRegistryEntry> {
  return Object.fromEntries(
    Object.entries(counts).map(([key, observed]) => [
      key,
      {
        tableName: `Fake_${key}`,
        expectedMin: 1,
        count: () => Promise.resolve(observed),
      },
    ]),
  );
}

function signalRegistry(
  entries: Record<string, { bound: boolean }>,
): Record<string, SignalRegistryEntry> {
  return Object.fromEntries(
    Object.entries(entries).map(([kind, { bound }]) => [
      kind,
      {
        loaderId: `fake.loader.${kind}`,
        bound,
        description: `fake ${kind}`,
      },
    ]),
  );
}

function hvacContribution(
  overrides: Partial<WorkspaceHomeContribution> = {},
): WorkspaceHomeContribution {
  return {
    id: "home-hvac-dispatch",
    label: "HVAC dispatcher home",
    topConcerns: ["dispatch board", "urgent exceptions", "coworker handoffs"],
    semanticArchetypeIds: ["hvac-contractor"],
    archetypeCategories: ["trades-maintenance"],
    setupActivation: {
      status: "ready",
      primitiveWidgets: ["decision-queue", "geo-map", "handoff-queue"],
      requiredCanonicalData: ["work-item", "work-schedule", "customer-account"],
      requiredSignals: ["governor-require-hitl", "communication-failed"],
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
        slotId: "exceptions-needs-review",
        primitiveKey: "decision-queue",
        title: "Unassigned jobs",
        dataRefs: [{ kind: "canonical-data", key: "work-item", required: true }],
      },
      {
        key: "today-schedule",
        slotId: "today-now",
        primitiveKey: "capacity-lanes",
        title: "Today's schedule",
        dataRefs: [
          { kind: "canonical-data", key: "work-schedule", required: true },
        ],
      },
      {
        key: "coworker-handoffs",
        slotId: "coworker-handoffs",
        primitiveKey: "handoff-queue",
        title: "Coworker handoffs",
        dataRefs: [{ kind: "signal", key: "governor-require-hitl", required: true }],
      },
    ],
    ...overrides,
  };
}

describe("buildActivationPlan — orchestrator declarations walker", () => {
  it("emits all declarations satisfied + all slots with data on a populated install", async () => {
    const plan = await buildActivationPlan({
      contribution: hvacContribution(),
      archetypeContext: "hvac-contractor",
      prisma: fakePrisma,
      options: {
        canonicalDataRegistry: counterRegistry({
          "work-item": 7,
          "work-schedule": 4,
          "customer-account": 12,
        }),
        signalRegistry: signalRegistry({
          "governor-require-hitl": { bound: true },
          "communication-failed": { bound: true },
        }),
      },
    });

    expect(plan.contributionId).toBe("home-hvac-dispatch");
    expect(plan.archetypeContext).toBe("hvac-contractor");
    expect(plan.canonicalData.every((c) => c.satisfied)).toBe(true);
    expect(plan.signals.every((s) => s.bound)).toBe(true);
    expect(plan.slotBehaviors.every((s) => s.hasData)).toBe(true);
  });

  it("emits all declarations unsatisfied on an empty install", async () => {
    const plan = await buildActivationPlan({
      contribution: hvacContribution(),
      archetypeContext: "hvac-contractor",
      prisma: fakePrisma,
      options: {
        canonicalDataRegistry: counterRegistry({
          "work-item": 0,
          "work-schedule": 0,
          "customer-account": 0,
        }),
        signalRegistry: signalRegistry({
          "governor-require-hitl": { bound: false },
          "communication-failed": { bound: false },
        }),
      },
    });

    expect(plan.canonicalData.every((c) => !c.satisfied)).toBe(true);
    expect(plan.canonicalData[0]?.sample).toEqual({
      tableName: "Fake_work-item",
      expectedMin: 1,
      observed: 0,
    });
    expect(plan.signals.every((s) => !s.bound)).toBe(true);
    // Slots whose components require unsatisfied canonical data report no data.
    expect(plan.slotBehaviors.find((s) => s.slotId === "today-now")?.hasData).toBe(
      false,
    );
    expect(
      plan.slotBehaviors.find((s) => s.slotId === "exceptions-needs-review")?.hasData,
    ).toBe(false);
    expect(
      plan.slotBehaviors.find((s) => s.slotId === "coworker-handoffs")?.hasData,
    ).toBe(false);
  });

  it("reports satisfied=false + sample=null + warns on an unknown canonical-data key", async () => {
    const warn = vi.fn();
    const plan = await buildActivationPlan({
      contribution: hvacContribution({
        setupActivation: {
          status: "ready",
          primitiveWidgets: ["decision-queue"],
          requiredCanonicalData: ["mystery-table-not-in-registry"],
          requiredSignals: [],
          missingDataBehavior: "render-empty-state",
        },
      }),
      archetypeContext: "hvac-contractor",
      prisma: fakePrisma,
      options: {
        canonicalDataRegistry: counterRegistry({ "work-item": 1 }), // mystery key omitted
        signalRegistry: signalRegistry({}),
        warn,
      },
    });

    expect(plan.canonicalData).toEqual([
      { key: "mystery-table-not-in-registry", satisfied: false, sample: null },
    ]);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("[orchestrator-unknown-canonical-data]"),
    );
  });

  it("reports loaderId=null on a signal kind with no registry entry", async () => {
    const plan = await buildActivationPlan({
      contribution: hvacContribution({
        setupActivation: {
          status: "ready",
          primitiveWidgets: ["handoff-queue"],
          requiredCanonicalData: [],
          requiredSignals: ["unregistered-signal-kind"],
          missingDataBehavior: "render-empty-state",
        },
      }),
      archetypeContext: "hvac-contractor",
      prisma: fakePrisma,
      options: {
        canonicalDataRegistry: counterRegistry({}),
        signalRegistry: signalRegistry({}),
      },
    });

    expect(plan.signals).toEqual([
      { kind: "unregistered-signal-kind", loaderId: null, bound: false },
    ]);
  });

  it("reports hasData=true on a slot that has no components (layout-only)", async () => {
    const plan = await buildActivationPlan({
      contribution: hvacContribution({
        components: [],
      }),
      archetypeContext: "hvac-contractor",
      prisma: fakePrisma,
      options: {
        canonicalDataRegistry: counterRegistry({
          "work-item": 0,
          "work-schedule": 0,
          "customer-account": 0,
        }),
        signalRegistry: signalRegistry({}),
      },
    });

    expect(plan.slotBehaviors.every((s) => s.hasData)).toBe(true);
  });

  it("reports hasData=true on a slot whose component has only non-required dataRefs", async () => {
    const plan = await buildActivationPlan({
      contribution: hvacContribution({
        components: [
          {
            key: "today-schedule",
            slotId: "today-now",
            primitiveKey: "capacity-lanes",
            title: "Today's schedule",
            dataRefs: [
              { kind: "canonical-data", key: "work-schedule", required: false },
            ],
          },
        ],
      }),
      archetypeContext: "hvac-contractor",
      prisma: fakePrisma,
      options: {
        canonicalDataRegistry: counterRegistry({
          "work-item": 0,
          "work-schedule": 0,
          "customer-account": 0,
        }),
        signalRegistry: signalRegistry({}),
      },
    });

    expect(plan.slotBehaviors.find((s) => s.slotId === "today-now")?.hasData).toBe(
      true,
    );
  });

  it("treats projection-kind dataRefs as satisfied at walker time (deferred to render)", async () => {
    const plan = await buildActivationPlan({
      contribution: hvacContribution({
        components: [
          {
            key: "today-schedule",
            slotId: "today-now",
            primitiveKey: "capacity-lanes",
            title: "Today's schedule",
            dataRefs: [
              {
                kind: "projection",
                key: "workspaceHome.workOrders",
                required: true,
              },
            ],
          },
        ],
      }),
      archetypeContext: "hvac-contractor",
      prisma: fakePrisma,
      options: {
        canonicalDataRegistry: counterRegistry({
          "work-item": 0,
          "work-schedule": 0,
          "customer-account": 0,
        }),
        signalRegistry: signalRegistry({}),
      },
    });

    // The walker can't pre-evaluate projections without binding loaders; the
    // empty-state coordinator (Phase 4) refines this at render time.
    expect(plan.slotBehaviors.find((s) => s.slotId === "today-now")?.hasData).toBe(
      true,
    );
  });

  it("passes the contribution's missingDataBehavior through to every slot", async () => {
    const plan = await buildActivationPlan({
      contribution: hvacContribution({
        setupActivation: {
          status: "ready",
          primitiveWidgets: ["decision-queue"],
          requiredCanonicalData: [],
          requiredSignals: [],
          missingDataBehavior: "platform-fallback",
        },
      }),
      archetypeContext: "hvac-contractor",
      prisma: fakePrisma,
      options: {
        canonicalDataRegistry: counterRegistry({}),
        signalRegistry: signalRegistry({}),
      },
    });

    expect(
      plan.slotBehaviors.every((s) => s.missingDataBehavior === "platform-fallback"),
    ).toBe(true);
  });
});
