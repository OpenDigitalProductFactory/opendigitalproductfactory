import { describe, expect, it } from "vitest";
import { buildNotificationIntent } from "@dpf/validators";

import { resolveFieldDispatchNotificationProactivity } from "./field-dispatch-proactivity";

describe("resolveFieldDispatchNotificationProactivity", () => {
  it("treats running-late slot-hour dispatch notices as assertive proposals", () => {
    const intent = buildNotificationIntent("running-late", "JOB-1", {
      company: "Acme HVAC",
      etaText: "2:40 PM",
    });

    const plan = resolveFieldDispatchNotificationProactivity({
      intent,
      archetype: {
        archetypeId: "hvac-services",
        demandSignature: "emergency-reactive",
        capacityUnit: "slot-hours",
      },
    });

    expect(plan).toMatchObject({
      resolvedLevel: "assertive",
      channelPolicy: "urgent-channel",
      escalationTarget: "dispatcher",
      actionBoundary: "propose",
    });
    expect(plan.evidenceRefs).toContainEqual({ kind: "dispatch-event", id: "running-late" });
  });

  it("keeps ordinary dispatch confirmations balanced", () => {
    const intent = buildNotificationIntent("confirm", "JOB-2", {
      company: "Acme HVAC",
      dateText: "tomorrow",
      timeText: "9:00 AM",
    });

    expect(resolveFieldDispatchNotificationProactivity({ intent })).toMatchObject({
      resolvedLevel: "balanced",
      actionBoundary: "propose",
    });
  });
});
