import { describe, expect, it, vi } from "vitest";

vi.mock("@dpf/db", () => ({ prisma: {} }));

import {
  CLOSURE_SCORECARD_ARTIFACT_KIND,
  artifactFromParts,
  closureScorecardRunId,
  runClosureScorecard,
  type ClosureScorecardArtifact,
  type ClosureScorecardStore,
  type RecordedRun,
} from "./closure-scorecard-task";
import type { ClosureCounts } from "./measures";

function counts(signalsClosed: number): ClosureCounts {
  return {
    snapshot: {
      builds: { total: 5, complete: 1, abandoned: 1, failed: 0, stranded: 3 },
      signals: { total: 10, open: 10 - signalsClosed, closed: signalsClosed },
      proposals: { total: 9, open: 9, implemented: 0, rejected: 0 },
      backlog: { total: 6, done: 3, retired: 1 },
      selfFiled: { total: 2, done: 1 },
      acceptance: { local: 2, peerOwned: 7, localMedianDaysSinceChange: 3 },
      escalations: { held: 2, oldestHeldDays: 4.5 },
    },
    window: { asks: { forOwner: 1, routedToAgent: 3 }, decisions: { total: 10, recommended: 8 } },
  };
}

type Row = { artifact: ClosureScorecardArtifact | null };

function fakeStore(seed: Record<string, Row> = {}, opts: { failArtifactOnce?: boolean; raceWinner?: Row } = {}) {
  const runs = new Map<string, Row>(Object.entries(seed));
  let failNext = opts.failArtifactOnce ?? false;
  const loadCounts = vi.fn(async () => counts(4));
  // Mirrors the row lock: the first repairer attaches, a later one finds it attached.
  const addArtifact = vi.fn(async (taskRunId: string, artifact: ClosureScorecardArtifact): Promise<"added" | "exists"> => {
    if (runs.get(taskRunId)?.artifact) return "exists";
    runs.set(taskRunId, { artifact });
    return "added";
  });
  const store: ClosureScorecardStore = {
    findRun: async (taskRunId): Promise<RecordedRun | null> => {
      const row = runs.get(taskRunId);
      return row ? { taskRunId, artifact: row.artifact } : null;
    },
    loadCounts,
    createRun: async (input) => {
      if (opts.raceWinner) {
        runs.set(input.taskRunId, opts.raceWinner);
        return "conflict";
      }
      if (runs.has(input.taskRunId)) return "conflict";
      if (failNext) {
        // The transaction rolls back: neither run nor artifact persists.
        failNext = false;
        throw new Error("artifact write failed");
      }
      runs.set(input.taskRunId, { artifact: input.artifact });
      return "created";
    },
    addArtifact,
  };
  return { store, runs, loadCounts, addArtifact };
}

const NOW = new Date("2026-11-25T06:29:00Z");
const INPUT = { ownerUserId: "u1", agentId: "platform-engineer", taskId: "closure-scorecard-daily", now: NOW };
const TODAY = closureScorecardRunId("2026-11-25");

describe("runClosureScorecard", () => {
  it("keys the run uniquely by UTC day and measures the trailing seven days", async () => {
    const { store, runs, loadCounts } = fakeStore();
    const result = await runClosureScorecard(store, INPUT);
    expect(TODAY).toBe("TR-CSC-20261125");
    expect(result.outcome).toBe("created");
    expect(loadCounts).toHaveBeenCalledWith({ since: new Date("2026-11-18T06:29:00Z"), until: NOW });
    expect(runs.get(TODAY)?.artifact?.priorPeriodKey).toBe("2026-11-18");
  });

  it("is idempotent within a UTC day once the artifact exists", async () => {
    const { store, loadCounts } = fakeStore();
    await runClosureScorecard(store, INPUT);
    const again = await runClosureScorecard(store, { ...INPUT, now: new Date("2026-11-25T18:00:00Z") });
    expect(again.outcome).toBe("idempotent");
    expect(loadCounts).toHaveBeenCalledTimes(1);
  });

  it("repairs a run that was recorded without its artifact instead of reporting success", async () => {
    const { store, addArtifact } = fakeStore({ [TODAY]: { artifact: null } });
    const result = await runClosureScorecard(store, INPUT);
    expect(result.outcome).toBe("repaired");
    expect(addArtifact).toHaveBeenCalledTimes(1);
    expect((await runClosureScorecard(store, INPUT)).outcome).toBe("idempotent");
  });

  it("leaves nothing behind when the atomic write fails, so the retry creates the day cleanly", async () => {
    const { store, runs } = fakeStore({}, { failArtifactOnce: true });
    await expect(runClosureScorecard(store, INPUT)).rejects.toThrow("artifact write failed");
    expect(runs.has(TODAY)).toBe(false);
    expect((await runClosureScorecard(store, INPUT)).outcome).toBe("created");
  });

  it("repairs the winner's run when a concurrent writer took the day key without an artifact", async () => {
    const { store, addArtifact } = fakeStore({}, { raceWinner: { artifact: null } });
    const result = await runClosureScorecard(store, INPUT);
    expect(result.outcome).toBe("repaired");
    expect(addArtifact).toHaveBeenCalledTimes(1);
  });

  it("compares against the run recorded seven days earlier", async () => {
    const prior = fakeStore();
    await runClosureScorecard(prior.store, { ...INPUT, now: new Date("2026-11-18T06:29:00Z") });
    const priorRow = prior.runs.get(closureScorecardRunId("2026-11-18"))!;
    const { store } = fakeStore({ [closureScorecardRunId("2026-11-18")]: { artifact: { ...priorRow.artifact!, counts: counts(0) } } });
    const result = await runClosureScorecard(store, INPUT);
    if (result.outcome === "idempotent") throw new Error("expected a fresh run");
    expect(result.artifact.priorFound).toBe(true);
    expect(result.artifact.changes.signalsClosed).toBe(4);
  });
});

describe("repair under the run-row lock", () => {
  it("two retries repairing the same day attach exactly one artifact", async () => {
    const { store, addArtifact, runs } = fakeStore({ [TODAY]: { artifact: null } });
    const [first, second] = await Promise.all([runClosureScorecard(store, INPUT), runClosureScorecard(store, INPUT)]);
    expect([first.outcome, second.outcome].sort()).toEqual(["idempotent", "repaired"]);
    expect(addArtifact).toHaveBeenCalledTimes(2);
    expect(runs.get(TODAY)?.artifact).not.toBeNull();
  });
});

describe("artifactFromParts", () => {
  it("reads a recorded artifact back and rejects anything malformed", () => {
    const artifact = { counts: counts(1) } as unknown as ClosureScorecardArtifact;
    expect(artifactFromParts([{ type: CLOSURE_SCORECARD_ARTIFACT_KIND, data: artifact }])?.counts.snapshot.signals.closed).toBe(1);
    expect(artifactFromParts([{ type: "other", data: artifact }])).toBeNull();
    expect(artifactFromParts([{ type: CLOSURE_SCORECARD_ARTIFACT_KIND, data: { counts: { snapshot: {} } } }])).toBeNull();
    expect(artifactFromParts(null)).toBeNull();
  });
});
