import { beforeEach, describe, expect, it, vi } from "vitest";
import { planDepartureActions } from "@dpf/validators";

const mocks = vi.hoisted(() => ({
  prisma: {
    agentActionProposal: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    agentMessage: {
      create: vi.fn(),
    },
    agentThread: {
      upsert: vi.fn(),
    },
    userFact: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { buildUserAwareFieldDispatchNotificationProposals } from "./field-dispatch-runtime.server";

describe("buildUserAwareFieldDispatchNotificationProposals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValue(null);
    mocks.prisma.agentActionProposal.create.mockImplementation((args: { data: { proposalId: string } }) =>
      Promise.resolve({
        proposalId: args.data.proposalId,
        status: "proposed",
      }),
    );
    mocks.prisma.agentMessage.create.mockResolvedValue({ id: "message-dispatch" });
    mocks.prisma.agentThread.upsert.mockResolvedValue({ id: "thread-dispatch" });
    mocks.prisma.userFact.findMany.mockResolvedValue([]);
  });

  it("applies acknowledged user proactivity overrides to running-late field-dispatch proposals", async () => {
    // BI-87C9C91C: the override reaches the proposal through the ROUTE CONTEXT.
    // The agent-scoped fact alongside it is legacy and must be inert — a
    // coworker identity no longer carries a proactivity preference.
    mocks.prisma.userFact.findMany.mockResolvedValue([
      {
        id: "fact-quiet-storefront",
        key: "aiCoworkerProactivity:route-context:/storefront",
        value: JSON.stringify({
          scopeKey: "route-context:/storefront",
          level: "quiet",
          acknowledgedAt: "2026-06-30T18:30:00.000Z",
        }),
        createdAt: new Date("2026-06-30T18:30:00.000Z"),
      },
      {
        id: "fact-legacy-dispatcher",
        key: "aiCoworkerProactivity:agent:dispatcher",
        value: JSON.stringify({
          scopeKey: "agent:dispatcher",
          level: "assertive",
          acknowledgedAt: "2026-06-30T18:30:00.000Z",
        }),
        createdAt: new Date("2026-06-30T18:35:00.000Z"),
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
          userOverrideScopeKey: "route-context:/storefront",
          actionBoundary: "advise",
        },
      },
    });
    expect(late?.parameters.proactivity.evidenceRefs).toEqual(
      expect.arrayContaining([
        { kind: "user-fact", id: "fact-quiet-storefront" },
        { kind: "dispatch-event", id: "running-late" },
      ]),
    );
    // The legacy agent-scoped fact is newer and asserts the opposite level; if it
    // were still consulted it would win. It must not appear at all.
    expect(late?.parameters.proactivity.evidenceRefs).not.toContainEqual({
      kind: "user-fact",
      id: "fact-legacy-dispatcher",
    });
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

// PR-B (BI-7BCC87BB; spec D2 S4): the uncalled persistence function, which
// wrote an action type that is not a registered tool, is deleted. The pure
// draft builder above stays.
describe("S4 — field dispatch proposals are gone", () => {
  it("the server module no longer exports a proposal writer", async () => {
    const mod = await import("./field-dispatch-runtime.server");
    expect("proposeUserAwareFieldDispatchNotifications" in mod).toBe(false);
  });
});
