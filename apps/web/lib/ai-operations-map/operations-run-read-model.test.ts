import { describe, expect, it } from "vitest";

import { classifyRunStatus, OPERATIONS_RUN_SELECT } from "./operations-run-read-model";

describe("classifyRunStatus (EP-8DC217EB BET-10)", () => {
  it("maps failure states to critical", () => {
    expect(classifyRunStatus("failed")).toBe("critical");
    expect(classifyRunStatus("rejected")).toBe("critical");
  });

  it("maps operator-actionable + quiescence states to attention", () => {
    for (const status of [
      "input-required",
      "auth-required",
      "stalled",
      "quiescing",
      "paused-for-upgrade",
      "paused-for-upgrade-forced",
    ]) {
      expect(classifyRunStatus(status), status).toBe("attention");
    }
  });

  it("maps ordinary running/terminal states to normal", () => {
    for (const status of ["working", "active", "submitted", "completed", "unknown-future-state"]) {
      expect(classifyRunStatus(status), status).toBe("normal");
    }
  });
});

describe("OPERATIONS_RUN_SELECT", () => {
  it("is the single canonical 11-column TaskRun projection select", () => {
    expect(Object.keys(OPERATIONS_RUN_SELECT).sort()).toEqual(
      [
        "a2aMetadata",
        "completedAt",
        "currentAgentId",
        "id",
        "repeatedPatternKey",
        "routeContext",
        "source",
        "startedAt",
        "status",
        "taskRunId",
        "title",
      ].sort(),
    );
    // Every column selected is true (a projection, not a nested include).
    expect(Object.values(OPERATIONS_RUN_SELECT).every((v) => v === true)).toBe(true);
  });
});
