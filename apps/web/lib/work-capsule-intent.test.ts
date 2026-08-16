import { describe, expect, it } from "vitest";

import {
  WORK_CAPSULE_ACTIVITY_KINDS,
  isWorkCapsuleActivityKind,
  parseWorkIntentDeclared,
  projectLatestWorkIntent,
} from "./work-capsules";

describe("work intent activity", () => {
  it("is part of the canonical activity tuple and validator", () => {
    expect(WORK_CAPSULE_ACTIVITY_KINDS).toContain("work-intent-declared");
    expect(isWorkCapsuleActivityKind("work-intent-declared")).toBe(true);
  });

  it("validates the versioned subject-bound payload", () => {
    expect(parseWorkIntentDeclared({
      schemaVersion: 1,
      intent: "implementation",
      policyVersion: "initiative-readiness.v1",
      subject: { kind: "backlog-item", id: "BI-1" },
    })).toMatchObject({ ok: true, intent: "implementation" });
    expect(parseWorkIntentDeclared({ schemaVersion: 1, intent: "ship" })).toMatchObject({ ok: false });
  });

  it("breaks recordedAt ties by descending activity id", () => {
    expect(projectLatestWorkIntent([
      { id: "activity-a", recordedAt: new Date("2026-08-08T20:00:00Z"), payload: { schemaVersion: 1, intent: "plan", policyVersion: "v1", subject: { kind: "backlog-item", id: "BI-1" } } },
      { id: "activity-b", recordedAt: new Date("2026-08-08T20:00:00Z"), payload: { schemaVersion: 1, intent: "implementation", policyVersion: "v1", subject: { kind: "backlog-item", id: "BI-1" } } },
    ])).toMatchObject({ ok: true, intent: "implementation", activityId: "activity-b" });
  });
});
