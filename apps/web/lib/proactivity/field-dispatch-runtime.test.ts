import { describe, expect, it } from "vitest";
import { planDepartureActions } from "@dpf/validators";

import { buildFieldDispatchNotificationProposals } from "./field-dispatch-runtime";

describe("buildFieldDispatchNotificationProposals", () => {
  it("attaches assertive proactivity to running-late customer notification proposals", () => {
    const actions = planDepartureActions({
      jobId: "JOB-1",
      arrivalEtaIso: "2026-06-30T19:15:00.000Z",
      windowEndIso: "2026-06-30T19:00:00.000Z",
      notificationVars: { company: "Acme HVAC", etaText: "2:15 PM" },
    });

    const proposals = buildFieldDispatchNotificationProposals({
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
      actionType: "field_dispatch_customer_notification",
      parameters: {
        kind: "field-dispatch-customer-notification",
        jobId: "JOB-1",
        recommendedAction: "Send running-late customer update",
        proactivity: {
          resolvedLevel: "assertive",
          channelPolicy: "urgent-channel",
          escalationTarget: "dispatcher",
          actionBoundary: "propose",
        },
      },
    });
    expect(late?.parameters.proactivity.evidenceRefs).toContainEqual({
      kind: "dispatch-event",
      id: "running-late",
    });
    expect(late?.parameters.whyNow).toMatch(/customer appointment timing/i);
  });

  it("keeps on-my-way customer notification proposals balanced unless appointment risk is elevated", () => {
    const actions = planDepartureActions({
      jobId: "JOB-2",
      arrivalEtaIso: "2026-06-30T18:30:00.000Z",
      windowEndIso: "2026-06-30T19:00:00.000Z",
      notificationVars: { company: "Acme HVAC", etaText: "1:30 PM" },
    });

    const proposals = buildFieldDispatchNotificationProposals({ actions });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({
      parameters: {
        intent: { event: "on-my-way" },
        proactivity: { resolvedLevel: "balanced", actionBoundary: "propose" },
      },
    });
  });

  it("ignores non-notification field-dispatch actions", () => {
    const proposals = buildFieldDispatchNotificationProposals({
      actions: [{ kind: "flag-attention", jobId: "JOB-3", reason: "quote awaiting scheduling" }],
    });

    expect(proposals).toEqual([]);
  });
});
