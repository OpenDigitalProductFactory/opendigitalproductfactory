import { describe, expect, it } from "vitest";

import {
  type DispatchJobForNotification,
  buildNotificationIntent,
  dispatchEventUrgency,
  notificationTitle,
  renderNotificationMessage,
  selectConfirmationDueJobs,
  shouldProposeConfirmation,
} from "./field-dispatch-notifications";

describe("dispatchEventUrgency", () => {
  it("maps events to platform urgency tiers (fed to selectCommunicationPlan)", () => {
    expect(dispatchEventUrgency("confirm")).toBe("routine");
    expect(dispatchEventUrgency("complete")).toBe("routine");
    expect(dispatchEventUrgency("on-my-way")).toBe("priority");
    expect(dispatchEventUrgency("running-late")).toBe("urgent");
  });
});

describe("shouldProposeConfirmation", () => {
  const now = "2026-06-14T09:00:00Z";
  const base: DispatchJobForNotification = { jobId: "J1", status: "scheduled", scheduledForIso: "2026-06-15T09:00:00Z" };

  it("proposes for a scheduled, unconfirmed job inside the window", () => {
    expect(shouldProposeConfirmation(base, now)).toBe(true); // 24h ahead, default 36h window
  });

  it("does not propose for an already-confirmed job", () => {
    expect(shouldProposeConfirmation({ ...base, confirmedAtIso: "2026-06-14T08:00:00Z" }, now)).toBe(false);
  });

  it("does not propose for non-scheduled statuses", () => {
    expect(shouldProposeConfirmation({ ...base, status: "quoted" }, now)).toBe(false);
    expect(shouldProposeConfirmation({ ...base, status: "confirmed" }, now)).toBe(false);
    expect(shouldProposeConfirmation({ ...base, status: "cancelled" }, now)).toBe(false);
  });

  it("does not propose outside the look-ahead window or for past/unsched jobs", () => {
    expect(shouldProposeConfirmation({ ...base, scheduledForIso: "2026-06-20T09:00:00Z" }, now)).toBe(false); // too far
    expect(shouldProposeConfirmation({ ...base, scheduledForIso: "2026-06-13T09:00:00Z" }, now)).toBe(false); // past
    expect(shouldProposeConfirmation({ ...base, scheduledForIso: null }, now)).toBe(false);
    expect(shouldProposeConfirmation({ ...base, scheduledForIso: "not-a-date" }, now)).toBe(false);
  });

  it("respects a custom look-ahead window", () => {
    // 24h ahead is outside a 12h window
    expect(shouldProposeConfirmation(base, now, 12)).toBe(false);
  });

  it("selectConfirmationDueJobs filters to the due subset", () => {
    const jobs: DispatchJobForNotification[] = [
      base,
      { jobId: "J2", status: "scheduled", scheduledForIso: "2026-06-20T09:00:00Z" }, // too far
      { jobId: "J3", status: "confirmed", scheduledForIso: "2026-06-15T09:00:00Z" }, // already confirmed
    ];
    expect(selectConfirmationDueJobs(jobs, now).map((j) => j.jobId)).toEqual(["J1"]);
  });
});

describe("notification content", () => {
  const vars = {
    company: "Dale's AC",
    service: "AC tune-up",
    dateText: "Mon Jun 15",
    timeText: "10am",
    etaText: "20 min",
    technicianName: "Sam",
    resourceNoun: "technician",
    amountText: "$180",
    paymentLink: "https://pay/x",
  };

  it("renders each event body with provided vars", () => {
    expect(renderNotificationMessage("confirm", vars)).toContain("AC tune-up");
    expect(renderNotificationMessage("confirm", vars)).toContain("Mon Jun 15");
    expect(renderNotificationMessage("on-my-way", vars)).toContain("Sam");
    expect(renderNotificationMessage("on-my-way", vars)).toContain("20 min");
    expect(renderNotificationMessage("running-late", vars)).toMatch(/behind|delay/i);
    expect(renderNotificationMessage("complete", vars)).toContain("$180");
  });

  it("degrades gracefully when optional vars are missing", () => {
    const msg = renderNotificationMessage("on-my-way", { company: "Acme" });
    expect(msg).toContain("technician"); // default resource noun
    expect(msg).not.toContain("undefined");
  });

  it("provides a customer-facing title per event", () => {
    expect(notificationTitle("confirm")).toBeTruthy();
    expect(notificationTitle("running-late")).toBeTruthy();
  });
});

describe("buildNotificationIntent", () => {
  it("bundles event, urgency, title and body for the runtime to dispatch", () => {
    const intent = buildNotificationIntent("on-my-way", "J1", { company: "Dale's AC", service: "tune-up", etaText: "15 min" });
    expect(intent).toMatchObject({ event: "on-my-way", jobId: "J1", urgency: "priority" });
    expect(intent.title).toBeTruthy();
    expect(intent.body).toContain("15 min");
  });

  it("carries the right urgency for a running-late alert", () => {
    const intent = buildNotificationIntent("running-late", "J9", { company: "Acme" });
    expect(intent.urgency).toBe("urgent");
  });
});
