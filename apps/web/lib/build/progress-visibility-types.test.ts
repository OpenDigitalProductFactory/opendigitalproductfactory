import { describe, expect, it } from "vitest";
import {
  BUILD_TRUTH_STALE_THRESHOLD_MS,
  getTruthSourceAge,
  hasStaleTruthConflict,
  truthSourceLabel,
} from "./progress-visibility-types";

describe("progress visibility truth-source helpers", () => {
  it("formats fresh source ages in seconds", () => {
    expect(getTruthSourceAge("2026-05-18T12:09:40.000Z", new Date("2026-05-18T12:10:00.000Z"))).toEqual({
      ageMs: 20_000,
      label: "20s ago",
      stale: false,
    });
  });

  it("formats stale source ages in minutes", () => {
    expect(getTruthSourceAge("2026-05-18T12:00:00.000Z", new Date("2026-05-18T12:10:00.000Z"))).toEqual({
      ageMs: 600_000,
      label: "10m ago",
      stale: true,
    });
  });

  it("labels unknown timestamps without pretending freshness", () => {
    expect(getTruthSourceAge(null, new Date("2026-05-18T12:10:00.000Z"))).toEqual({
      ageMs: null,
      label: "unknown age",
      stale: true,
    });
  });

  it("flags stale conflict when an older chat self-report disagrees with newer DB task results", () => {
    expect(hasStaleTruthConflict({
      staleThresholdMs: BUILD_TRUTH_STALE_THRESHOLD_MS,
      newer: {
        source: "db-task-results",
        completed: 0,
        total: 16,
        observedAt: "2026-05-18T12:00:00.000Z",
      },
      older: {
        source: "chat-self-report",
        completed: 14,
        total: 16,
        observedAt: "2026-05-17T21:00:00.000Z",
      },
    })).toBe(true);
  });

  it("does not flag matching counts as a conflict", () => {
    expect(hasStaleTruthConflict({
      staleThresholdMs: BUILD_TRUTH_STALE_THRESHOLD_MS,
      newer: {
        source: "db-task-results",
        completed: 14,
        total: 16,
        observedAt: "2026-05-18T12:00:00.000Z",
      },
      older: {
        source: "chat-self-report",
        completed: 14,
        total: 16,
        observedAt: "2026-05-17T21:00:00.000Z",
      },
    })).toBe(false);
  });

  it("maps internal truth sources to compact operator labels", () => {
    expect(truthSourceLabel("db-task-results")).toBe("DB");
    expect(truthSourceLabel("chat-self-report")).toBe("Chat");
    expect(truthSourceLabel("sandbox-git")).toBe("Sandbox");
    expect(truthSourceLabel("verification")).toBe("Verification");
  });
});
