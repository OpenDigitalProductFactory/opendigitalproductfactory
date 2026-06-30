import { beforeEach, describe, expect, it, vi } from "vitest";
import { planDepartureActions } from "@dpf/validators";

const mocks = vi.hoisted(() => ({
  prisma: {
    userFact: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));

import { buildUserAwareFieldDispatchNotificationProposals } from "./field-dispatch-runtime.server";

describe("buildUserAwareFieldDispatchNotificationProposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.userFact.findMany.mockResolvedValue([]);
  });

  it("applies acknowledged user proactivity overrides to running-late field-dispatch proposals", async () => {
    mocks.prisma.userFact.findMany.mockResolvedValue([
      {
        id: "fact-quiet-dispatcher",
        key: "aiCoworkerProactivity:agent:dispatcher",
        value: JSON.stringify({
          scopeKey: "agent:dispatcher",
          level: "quiet",
          acknowledgedAt: "2026-06-30T18:30:00.000Z",
        }),
        createdAt: new Date("2026-06-30T18:30:00.000Z"),
      },
    ]);
    const actions = planDepartureActions({
      jobId: "JOB-1",
      arrivalEtaIso: "2026-06-30T19:15:00.000Z",
      windowEndIso: "2026-06-30T19:00:00.000Z",
      notificationVars: { company: "Acme HVAC", etaText: "2:15 PM" },
    });

    const proposals = await buildUserAwareFieldDispatchNotificationProposals({
      userId: "user-1",
      actions,
      agentId: "dispatcher",
      routeContext: "/storefront",
      archetype: {
        archetypeId: "hvac-services",
        demandSignature: "emergency-reactive",
        capacityUnit: "slot-hours",
      },
    });

    const late = proposals.find((proposal) => proposal.parameters.intent.event === "running-late");
    expect(late).toMatchObject({
      parameters: {
        proactivity: {
          resolvedLevel: "quiet",
          preferenceSource: "user-override",
          userOverrideScopeKey: "agent:dispatcher",
          actionBoundary: "advise",
        },
      },
    });
    expect(late?.parameters.proactivity.evidenceRefs).toEqual(
      expect.arrayContaining([
        { kind: "user-fact", id: "fact-quiet-dispatcher" },
        { kind: "dispatch-event", id: "running-late" },
      ]),
    );
  });

  it("carries active proactivity cooldown facts into field-dispatch proposal metadata", async () => {
    mocks.prisma.userFact.findMany.mockResolvedValue([
      {
        id: "cooldown-dispatch",
        key: "aiCoworkerProactivityCooldown:activity-family:field-dispatch-appointment",
        value: JSON.stringify({
          scopeKey: "activity-family:field-dispatch-appointment",
          proposedLevel: "assertive",
          cooldownUntil: "2026-07-07T18:30:00.000Z",
        }),
        createdAt: new Date("2026-06-30T18:30:00.000Z"),
      },
    ]);
    const actions = planDepartureActions({
      jobId: "JOB-2",
      arrivalEtaIso: "2026-06-30T18:30:00.000Z",
      windowEndIso: "2026-06-30T19:00:00.000Z",
      notificationVars: { company: "Acme HVAC", etaText: "1:30 PM" },
    });

    const proposals = await buildUserAwareFieldDispatchNotificationProposals({
      userId: "user-1",
      now: new Date("2026-07-01T12:00:00.000Z"),
      actions,
    });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]?.parameters.proactivity).toMatchObject({
      suggestionSuppressed: true,
      suggestionCooldownUntil: "2026-07-07T18:30:00.000Z",
      suggestionCooldownScopeKey: "activity-family:field-dispatch-appointment",
    });
    expect(proposals[0]?.parameters.proactivity.evidenceRefs).toContainEqual({
      kind: "user-fact",
      id: "cooldown-dispatch",
    });
  });
});
