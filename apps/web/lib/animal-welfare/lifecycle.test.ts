import { describe, expect, it } from "vitest";

import {
  advanceCustodyStage,
  closeCustodyEpisode,
  openCustodyEpisode,
  releaseLegalHold,
  type CustodyEpisodeState,
} from "./lifecycle";

const base: CustodyEpisodeState = openCustodyEpisode({
  animalProfileId: "animal-1",
  organizationId: "org-rescue",
  intakeType: "stray",
  occurredAt: new Date("2026-09-04T08:00:00Z"),
  actorPrincipalId: "principal-1",
});

describe("animal custody lifecycle", () => {
  it("preserves append-only stage history", () => {
    const assessed = advanceCustodyStage(base, {
      toStage: "health-assessment",
      occurredAt: new Date("2026-09-04T09:00:00Z"),
      actorPrincipalId: "principal-2",
      reason: "Initial veterinary assessment",
    });

    expect(assessed.currentStage).toBe("health-assessment");
    expect(assessed.version).toBe(2);
    expect(assessed.events.map((event) => event.toStage)).toEqual(["intake", "health-assessment"]);
  });

  it("blocks placement readiness and outcome while a legal hold is active", () => {
    const held = advanceCustodyStage(base, {
      toStage: "legal-hold",
      occurredAt: new Date("2026-09-04T09:00:00Z"),
      actorPrincipalId: "principal-2",
      reason: "Municipal hold",
    });

    expect(() => advanceCustodyStage(held, {
      toStage: "placement-ready",
      occurredAt: new Date("2026-09-05T09:00:00Z"),
      actorPrincipalId: "principal-2",
      reason: "Ready",
    })).toThrow("legal hold");
    expect(() => closeCustodyEpisode(held, {
      outcomeType: "adoption",
      occurredAt: new Date("2026-09-05T09:00:00Z"),
      actorPrincipalId: "principal-2",
    })).toThrow("legal hold");
  });

  it("records human-approved legal-hold release in the append-only timeline", () => {
    const held = advanceCustodyStage(base, {
      toStage: "legal-hold",
      occurredAt: new Date("2026-09-04T09:00:00Z"),
      actorPrincipalId: "principal-2",
      reason: "Municipal hold",
    });
    const released = releaseLegalHold(held, {
      approvedByHuman: true,
      occurredAt: new Date("2026-09-05T09:00:00Z"),
      actorPrincipalId: "principal-3",
      reason: "Authority released the hold",
    });
    expect(released.legalHoldActive).toBe(false);
    expect(released.events.at(-1)).toMatchObject({
      kind: "legal-hold-released",
      actorPrincipalId: "principal-3",
      reason: "Authority released the hold",
    });
  });
});
