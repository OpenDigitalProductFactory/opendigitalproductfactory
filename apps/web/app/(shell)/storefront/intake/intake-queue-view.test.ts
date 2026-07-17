import { describe, expect, it } from "vitest";

import {
  formatIntakeBlocker,
  summarizeIntakeQueue,
} from "./intake-queue-view";

describe("receptionist intake queue view", () => {
  it("summarizes ready, attention, and in-progress work", () => {
    expect(summarizeIntakeQueue([
      { ready: true, completionPercent: 100, openExceptions: [] },
      { ready: false, completionPercent: 70, openExceptions: [{ exceptionId: "exception-a" }] },
      { ready: false, completionPercent: 30, openExceptions: [] },
    ])).toEqual({ total: 3, ready: 1, needsAttention: 1, inProgress: 1 });
  });

  it("turns internal readiness codes into front-desk language", () => {
    expect(formatIntakeBlocker("required-answers-missing")).toBe("Required information missing");
    expect(formatIntakeBlocker("consent-incomplete")).toBe("Consent incomplete");
    expect(formatIntakeBlocker("coverage-unverified")).toBe("Coverage not verified");
    expect(formatIntakeBlocker("exceptions-unresolved")).toBe("Exception needs review");
    expect(formatIntakeBlocker("future-code")).toBe("Additional review needed");
  });
});
