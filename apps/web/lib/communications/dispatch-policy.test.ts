import { describe, expect, it } from "vitest";

import { selectCommunicationPlan } from "./dispatch-policy";

const bindings = [
  {
    channel: "in-app",
    verified: true,
    active: true,
    allowedUrgencies: ["routine", "priority", "urgent", "emergency"],
  },
  {
    channel: "push",
    verified: true,
    active: true,
    allowedUrgencies: ["routine", "priority", "urgent", "emergency"],
  },
  {
    channel: "teams",
    verified: true,
    active: true,
    allowedUrgencies: ["priority", "urgent", "emergency"],
  },
  {
    channel: "email",
    verified: true,
    active: true,
    allowedUrgencies: ["routine", "priority", "urgent", "emergency"],
  },
] as const;

describe("selectCommunicationPlan", () => {
  it("uses DPF-owned channels for routine work", () => {
    const plan = selectCommunicationPlan({
      urgency: "routine",
      bindings,
      now: new Date("2026-05-15T16:00:00Z"),
    });

    expect(plan.channels).toEqual(["in-app", "push", "email"]);
    expect(plan.fanOut).toBe(false);
  });

  it("adds real-time channels for urgent work", () => {
    const plan = selectCommunicationPlan({
      urgency: "urgent",
      bindings,
      now: new Date("2026-05-15T16:00:00Z"),
    });

    expect(plan.channels).toEqual(["in-app", "push", "teams", "email"]);
  });

  it("fans out emergency notifications", () => {
    const plan = selectCommunicationPlan({
      urgency: "emergency",
      bindings,
      now: new Date("2026-05-15T16:00:00Z"),
    });

    expect(plan.fanOut).toBe(true);
    expect(plan.channels).toEqual(["in-app", "push", "teams", "email"]);
  });

  it("skips inactive and unverified bindings", () => {
    const plan = selectCommunicationPlan({
      urgency: "priority",
      now: new Date("2026-05-15T16:00:00Z"),
      bindings: [
        { channel: "slack", verified: false, active: true, allowedUrgencies: ["priority"] },
        { channel: "email", verified: true, active: false, allowedUrgencies: ["priority"] },
        { channel: "in-app", verified: true, active: true, allowedUrgencies: ["priority"] },
      ],
    });

    expect(plan.channels).toEqual(["in-app"]);
  });
});
