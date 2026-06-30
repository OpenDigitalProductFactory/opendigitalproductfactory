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

import {
  buildUserAwareFieldDispatchNotificationProposals,
  proposeUserAwareFieldDispatchNotifications,
} from "./field-dispatch-runtime.server";

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

  it("persists field-dispatch notification proposals into the Attention Surface proposal substrate", async () => {
    const actions = planDepartureActions({
      jobId: "JOB-1",
      arrivalEtaIso: "2026-06-30T19:15:00.000Z",
      windowEndIso: "2026-06-30T19:00:00.000Z",
      notificationVars: { company: "Acme HVAC", etaText: "2:15 PM" },
    });

    const result = await proposeUserAwareFieldDispatchNotifications({
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

    expect(result).toContainEqual({
      proposalId: "field-dispatch-notification:JOB-1:running-late",
      status: "proposed",
    });
    expect(mocks.prisma.agentThread.upsert).toHaveBeenCalledWith({
      where: { userId_contextKey: { userId: "user-1", contextKey: "field-dispatch:customer-notifications" } },
      create: { userId: "user-1", contextKey: "field-dispatch:customer-notifications" },
      update: {},
      select: { id: true },
    });
    expect(mocks.prisma.agentMessage.create).toHaveBeenCalledWith({
      data: {
        threadId: "thread-dispatch",
        role: "assistant",
        content: expect.stringMatching(/^A customer update is ready to review\. Why now:/),
        agentId: "dispatcher",
        routeContext: "/storefront",
        taskType: "field-dispatch-customer-notification",
      },
      select: { id: true },
    });
    for (const call of mocks.prisma.agentMessage.create.mock.calls) {
      expect(call[0].data.content).not.toContain("JOB-1");
    }
    expect(mocks.prisma.agentActionProposal.create).toHaveBeenCalledWith({
      data: {
        proposalId: "field-dispatch-notification:JOB-1:running-late",
        threadId: "thread-dispatch",
        messageId: "message-dispatch",
        agentId: "dispatcher",
        actionType: "field_dispatch_customer_notification",
        parameters: expect.objectContaining({
          kind: "field-dispatch-customer-notification",
          jobId: "JOB-1",
          recommendedAction: "Send running-late customer update",
          proactivity: expect.objectContaining({ resolvedLevel: "assertive" }),
        }),
        status: "proposed",
      },
      select: { proposalId: true, status: true },
    });
  });

  it("returns existing field-dispatch proposals instead of duplicating attention items", async () => {
    mocks.prisma.agentActionProposal.findUnique.mockResolvedValue({
      proposalId: "field-dispatch-notification:JOB-2:on-my-way",
      status: "proposed",
    });
    const actions = planDepartureActions({
      jobId: "JOB-2",
      arrivalEtaIso: "2026-06-30T18:30:00.000Z",
      windowEndIso: "2026-06-30T19:00:00.000Z",
      notificationVars: { company: "Acme HVAC", etaText: "1:30 PM" },
    });

    const result = await proposeUserAwareFieldDispatchNotifications({
      userId: "user-1",
      actions,
    });

    expect(result).toEqual([
      {
        proposalId: "field-dispatch-notification:JOB-2:on-my-way",
        status: "proposed",
        existing: true,
      },
    ]);
    expect(mocks.prisma.agentMessage.create).not.toHaveBeenCalled();
    expect(mocks.prisma.agentActionProposal.create).not.toHaveBeenCalled();
  });
});
