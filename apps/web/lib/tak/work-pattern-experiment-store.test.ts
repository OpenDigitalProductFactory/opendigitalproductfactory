import { describe, expect, it, vi } from "vitest";

import {
  createOrResumeWorkPatternExperiment,
  createWorkPatternExperimentRetry,
  recordWorkPatternExperimentEvidence,
  transitionWorkPatternExperiment,
  type WorkPatternExperimentPersistence,
  type WorkPatternStoredTaskRun,
} from "./work-pattern-experiment-store";

function makePersistence(): WorkPatternExperimentPersistence & {
  rows: WorkPatternStoredTaskRun[];
  ledgers: Map<string, Record<string, unknown>>;
} {
  const rows: WorkPatternStoredTaskRun[] = [];
  const ledgers = new Map<string, Record<string, unknown>>();
  let rowSequence = 0;
  let lock = Promise.resolve();

  return {
    rows,
    ledgers,
    async withDefinitionLock(_definitionKey, work) {
      const prior = lock;
      let release = () => {};
      lock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prior;
      try {
        return await work();
      } finally {
        release();
      }
    },
    async listTaskRuns(repeatedPatternKey) {
      return rows.filter((row) => row.repeatedPatternKey === repeatedPatternKey);
    },
    async findTaskRun(taskRunId) {
      return rows.find((row) => row.taskRunId === taskRunId) ?? null;
    },
    async createTaskRun(data) {
      const existing = rows.find((row) => row.taskRunId === data.taskRunId);
      if (existing) return existing;
      const row = { ...data, id: `row-${++rowSequence}` };
      rows.push(row);
      return row;
    },
    async updateTaskRun(taskRunId, data) {
      const row = rows.find((candidate) => candidate.taskRunId === taskRunId);
      if (!row) throw new Error("missing_test_task_run");
      Object.assign(row, data);
      return row;
    },
    async upsertLedger(ledgerId, create) {
      if (!ledgers.has(ledgerId)) ledgers.set(ledgerId, create);
      return ledgers.get(ledgerId)!;
    },
  };
}

const input = {
  definition: {
    patternKey: "review-loop",
    taskCorpusKey: "review-fixtures",
    taskCorpusVersion: "1",
    oracleKey: "review-oracle",
    oracleVersion: "1",
    methodVariants: [
      { methodVariantKey: "baseline", patternVersion: 1 },
      { methodVariantKey: "candidate", patternVersion: 2 },
    ],
    modelVariants: [{ modelVariantKey: "model-a", modelProfileId: "profile-a" }],
    installScope: "platform" as const,
    promotionPolicyKey: "bounded-promotion",
    promotionPolicyVersion: 1,
  },
  activityKey: "build.review",
  riskClass: "internal-reversible" as const,
  pairKey: "baseline-v-candidate",
  cells: [
    { methodVariantKey: "baseline", modelVariantKey: "model-a" },
    { methodVariantKey: "candidate", modelVariantKey: "model-a" },
  ],
  orchestratingAgentId: "agent-orchestrator",
};

describe("work-pattern experiment store", () => {
  it("concurrent creation converges on one parent and one row per deterministic cell", async () => {
    const persistence = makePersistence();
    const resolveOwnerUserId = vi.fn().mockResolvedValue("user-owner");

    const [first, second] = await Promise.all([
      createOrResumeWorkPatternExperiment(input, { persistence, resolveOwnerUserId }),
      createOrResumeWorkPatternExperiment(input, { persistence, resolveOwnerUserId }),
    ]);

    expect(first.parent.taskRunId).toBe(second.parent.taskRunId);
    expect(persistence.rows.filter((row) => row.parentTaskRunId === null)).toHaveLength(1);
    expect(persistence.rows.filter((row) => row.parentTaskRunId !== null)).toHaveLength(2);
    expect(
      persistence.rows
        .filter((row) => row.parentTaskRunId !== null)
        .every((row) => row.parentTaskRunId === first.parent.id),
    ).toBe(true);
  });

  it("fails before opening storage when accountable owner resolution is unavailable", async () => {
    const persistence = makePersistence();
    const withDefinitionLock = vi.spyOn(persistence, "withDefinitionLock");

    await expect(
      createOrResumeWorkPatternExperiment(input, {
        persistence,
        resolveOwnerUserId: vi.fn().mockRejectedValue(new Error("no owner")),
      }),
    ).rejects.toThrow("no owner");
    expect(withDefinitionLock).not.toHaveBeenCalled();
    expect(persistence.rows).toHaveLength(0);
  });

  it("creates an explicit new replicate without rewriting prior history", async () => {
    const persistence = makePersistence();
    const deps = {
      persistence,
      resolveOwnerUserId: vi.fn().mockResolvedValue("user-owner"),
    };

    const first = await createOrResumeWorkPatternExperiment(input, deps);
    const second = await createOrResumeWorkPatternExperiment(
      { ...input, replicate: 2 },
      deps,
    );

    expect(first.manifest.replicate).toBe(1);
    expect(second.manifest.replicate).toBe(2);
    expect(second.parent.taskRunId).not.toBe(first.parent.taskRunId);
    expect(persistence.rows.filter((row) => row.parentTaskRunId === null)).toHaveLength(2);
  });

  it("resume schedules only missing or non-terminal cells", async () => {
    const persistence = makePersistence();
    const deps = {
      persistence,
      resolveOwnerUserId: vi.fn().mockResolvedValue("user-owner"),
    };
    const first = await createOrResumeWorkPatternExperiment(input, deps);
    await persistence.updateTaskRun(first.children[0]!.taskRunId, { status: "completed" });

    const resumed = await createOrResumeWorkPatternExperiment(input, deps);

    expect(resumed.scheduledChildTaskRunIds).toEqual([first.children[1]!.taskRunId]);
    expect(persistence.rows).toHaveLength(3);
  });

  it("retries by creating a new deterministic attempt and preserving the original", async () => {
    const persistence = makePersistence();
    const deps = {
      persistence,
      resolveOwnerUserId: vi.fn().mockResolvedValue("user-owner"),
    };
    const run = await createOrResumeWorkPatternExperiment(input, deps);

    const retry = await createWorkPatternExperimentRetry(
      {
        parentTaskRunId: run.parent.taskRunId,
        cellKey: "baseline:model-a",
        pairKey: input.pairKey,
      },
      deps,
    );

    expect(retry.taskRunId).not.toBe(run.children[0]!.taskRunId);
    expect(retry.parentTaskRunId).toBe(run.parent.id);
    expect(retry.a2aMetadata.workPatternExperimentCell.attempt).toBe(2);
    expect(persistence.rows).toHaveLength(4);
  });

  it("keeps parent A2A status synchronized with every legal lifecycle transition", async () => {
    const persistence = makePersistence();
    const deps = {
      persistence,
      resolveOwnerUserId: vi.fn().mockResolvedValue("user-owner"),
    };
    const run = await createOrResumeWorkPatternExperiment(input, deps);

    for (const [lifecycle, status] of [
      ["running", "working"],
      ["analyzing", "working"],
      ["completed", "completed"],
    ] as const) {
      const parent = await transitionWorkPatternExperiment(
        run.parent.taskRunId,
        lifecycle,
        { persistence },
      );
      expect(parent.status).toBe(status);
      expect(parent.a2aMetadata.workPatternExperiment.lifecycle).toBe(lifecycle);
    }
    await expect(
      transitionWorkPatternExperiment(run.parent.taskRunId, "running", { persistence }),
    ).rejects.toThrow("illegal_work_pattern_experiment_transition");
  });

  it("converges duplicate ledger writes and attributes them to the orchestrating coworker", async () => {
    const persistence = makePersistence();
    const evidence = {
      experimentRunId: "WPR-1",
      childTaskRunId: "TR-WPC-1",
      observationKind: "assignment",
      sequence: 0,
      orchestratingAgentId: "agent-orchestrator",
      activityType: "build.review",
      riskClass: "internal-reversible",
      proposedDecision: { cellKey: "baseline:model-a" },
      metadata: { modelProfileId: "candidate-model" },
    };

    const [first, second] = await Promise.all([
      recordWorkPatternExperimentEvidence(evidence, { persistence }),
      recordWorkPatternExperimentEvidence(evidence, { persistence }),
    ]);

    expect(first).toEqual(second);
    expect(persistence.ledgers).toHaveLength(1);
    expect(first.agentId).toBe("agent-orchestrator");
    expect(first.metadata).toMatchObject({ modelProfileId: "candidate-model" });
  });
});
