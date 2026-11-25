import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import {
  CLOSURE_SCORECARD_ARTIFACT_KIND,
  closureScorecardPatternKey,
  countsFromArtifactParts,
  runClosureScorecard,
  type ClosureScorecardStore,
} from "./closure-scorecard-task";
import type { ClosureCounts } from "./measures";

function counts(signalsClosed: number): ClosureCounts {
  return {
    builds: { started: 5, completed: 1, abandoned: 1, failed: 0, stranded: 3 },
    signals: { filed: 4, closed: signalsClosed, open: 10 },
    proposals: { filed: 2, closedOrVerified: 0, open: 9 },
    escalations: { routedToAgent: 3, reachedOwner: 1, held: 2, oldestHeldDays: 4.5 },
    decisions: { total: 10, recommended: 8 },
    acceptance: { local: 2, peerOwned: 7, localMedianAgeDays: 3 },
    backlog: { filed: 6, done: 3, retired: 1 },
    selfFiled: { filed: 2, done: 1 },
  };
}

function fakeStore(seed: Record<string, ClosureCounts> = {}) {
  const runs = new Map<string, { taskRunId: string; counts: ClosureCounts }>();
  for (const [key, value] of Object.entries(seed)) runs.set(key, { taskRunId: `TR-${key}`, counts: value });
  const loadCounts = vi.fn(async () => counts(4));
  const store: ClosureScorecardStore = {
    findRun: async (key) => (runs.has(key) ? { taskRunId: runs.get(key)!.taskRunId } : null),
    findCounts: async (key) => runs.get(key)?.counts ?? null,
    loadCounts,
    recordRun: async (input) => {
      const taskRunId = `TR-${input.repeatedPatternKey}`;
      runs.set(input.repeatedPatternKey, { taskRunId, counts: input.artifact.counts });
      return { taskRunId };
    },
  };
  return { store, runs, loadCounts };
}

const NOW = new Date("2026-11-25T06:29:00Z");
const INPUT = { ownerUserId: "u1", agentId: "platform-engineer", taskId: "closure-scorecard-daily", now: NOW };

describe("runClosureScorecard", () => {
  it("measures the trailing seven days and records one run for the day", async () => {
    const { store, runs, loadCounts } = fakeStore();
    const result = await runClosureScorecard(store, INPUT);
    expect(result.idempotent).toBe(false);
    expect(loadCounts).toHaveBeenCalledWith({ since: new Date("2026-11-18T06:29:00Z"), until: NOW });
    expect(runs.has(closureScorecardPatternKey("2026-11-25"))).toBe(true);
    if (!result.idempotent) {
      expect(result.artifact.previousPeriodKey).toBe("2026-11-18");
      expect(result.artifact.previousFound).toBe(false);
    }
  });

  it("is idempotent within a UTC day", async () => {
    const { store, loadCounts } = fakeStore();
    await runClosureScorecard(store, INPUT);
    const again = await runClosureScorecard(store, { ...INPUT, now: new Date("2026-11-25T18:00:00Z") });
    expect(again.idempotent).toBe(true);
    expect(loadCounts).toHaveBeenCalledTimes(1);
  });

  it("compares against the run recorded seven days earlier", async () => {
    const { store } = fakeStore({ [closureScorecardPatternKey("2026-11-18")]: counts(0) });
    const result = await runClosureScorecard(store, INPUT);
    expect(result.idempotent).toBe(false);
    if (result.idempotent) return;
    expect(result.artifact.previousFound).toBe(true);
    const closed = result.artifact.scorecard.lines.find((l) => l.key === "signals.closed");
    expect(closed).toMatchObject({ value: 4, previous: 0, direction: "improving" });
  });
});

describe("countsFromArtifactParts", () => {
  it("reads counts back from a recorded artifact and rejects anything else", () => {
    const good = [{ type: CLOSURE_SCORECARD_ARTIFACT_KIND, data: { counts: counts(1) } }];
    expect(countsFromArtifactParts(good)?.signals.closed).toBe(1);
    expect(countsFromArtifactParts([{ type: "other", data: { counts: counts(1) } }])).toBeNull();
    expect(countsFromArtifactParts([{ type: CLOSURE_SCORECARD_ARTIFACT_KIND, data: { counts: { builds: {} } } }])).toBeNull();
    expect(countsFromArtifactParts(null)).toBeNull();
  });
});
