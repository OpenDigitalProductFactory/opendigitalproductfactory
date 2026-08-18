import { describe, expect, it } from "vitest";

import {
  WORK_CASE_ACTION_REGISTRY,
  WORKROOM_LIFECYCLE_ACTION_REGISTRY,
  getWorkCaseAction,
  getWorkroomLifecycleAction,
} from "./action-registry";
import { WORK_CASE_SOURCE_REGISTRY } from "./source-registry";

describe("Work Case action registry", () => {
  it("defines the full handoff grammar from the spec", () => {
    expect(WORK_CASE_ACTION_REGISTRY.map((entry) => entry.action)).toEqual([
      "claim",
      "pause",
      "needs-input",
      "needs-auth",
      "respond",
      "resume",
      "propose",
      "delegate",
      "handoff",
      "escalate",
      "verify",
      "complete",
      "cancel",
      "open-cycle",
      "pause-cycle",
      "verify-cycle",
      "complete-cycle",
      "carry-over",
      "renew",
      "split",
      "archive",
    ]);
  });

  it("marks consequential actions as policy and receipt gated", () => {
    for (const action of [
      "claim",
      "delegate",
      "handoff",
      "verify",
      "complete",
      "cancel",
      "open-cycle",
      "pause-cycle",
      "verify-cycle",
      "complete-cycle",
      "carry-over",
      "renew",
      "split",
      "archive",
    ]) {
      expect(getWorkCaseAction(action)).toMatchObject({
        consequential: true,
        requiresPolicyEvaluation: true,
        requiresReceipt: true,
      });
    }
  });

  it("keeps every source-registry transition backed by a registered action", () => {
    for (const source of WORK_CASE_SOURCE_REGISTRY) {
      for (const transition of source.supportedTransitions) {
        expect(
          getWorkCaseAction(transition),
          `${source.sourceKey}:${transition}`,
        ).toBeTruthy();
      }
    }
  });
});

describe("Work Room lifecycle action registry", () => {
  it("maps every room lifecycle operation to an existing receipt-aware action", () => {
    expect(WORKROOM_LIFECYCLE_ACTION_REGISTRY.map((entry) => entry.operation)).toEqual([
      "open-cycle",
      "pause-cycle",
      "verify-cycle",
      "complete-cycle",
      "carry-over",
      "renew",
      "split",
      "archive",
    ]);
    for (const entry of WORKROOM_LIFECYCLE_ACTION_REGISTRY) {
      expect(getWorkCaseAction(entry.canonicalAction)?.requiresReceipt).toBe(true);
      expect(getWorkroomLifecycleAction(entry.operation)).toEqual(entry);
    }
  });
});
