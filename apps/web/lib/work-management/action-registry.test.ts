import { describe, expect, it } from "vitest";

import {
  WORK_CASE_ACTION_REGISTRY,
  getWorkCaseAction,
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
