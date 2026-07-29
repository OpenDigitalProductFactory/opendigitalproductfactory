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
  artifacts: Map<string, {
    artifactId: string;
    taskRunId: string;
    parts: unknown;
    metadata: unknown;
  }>;
} {
  const rows: WorkPatternStoredTaskRun[] = [];
  const ledgers = new Map<string, Record<string, unknown>>();
  const artifacts = new Map<string, {
    artifactId: string;
    taskRunId: string;
    parts: unknown;
    metadata: unknown;
  }>();
  let rowSequence = 0;
  let lock = Promise.resolve();

  return {
    rows,
    ledgers,
    artifacts,
    async withDefinitionLock(_definitionKey, work) {
      const prior = lock;
      let release = () => {};
      lock = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prior;
      try {
        return await work(this);
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
    async findTaskArtifact(artifactId) {
      return artifacts.get(artifactId) ?? null;
    },
    async createTaskArtifact(data) {
      const existing = artifacts.get(data.artifactId);
      if (existing) return existing;
      const artifact = {
        artifactId: data.artifactId,
        taskRunId: data.taskRunId,
        parts: data.parts,
        metadata: data.metadata,
      };
      artifacts.set(data.artifactId, artifact);
      return artifact;
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
    installScope: "canonical" as const,
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

  it("persists one immutable fixture before child dispatch and reuses it on resume", async () => {
    const persistence = makePersistence();
    const fixtureParts = {
      schemaVersion: 1,
      kind: "build-replay-v1",
      objective: "Implement the bounded helper.",
      targetFile: "apps/web/lib/fixtures/bounded.ts",
      testFiles: ["apps/web/lib/fixtures/bounded.test.ts"],
      methodInstructions: {
        baseline: "Prefer the smallest pure implementation.",
        candidate: "Prefer explicit branches.",
      },
    };
    const buildInput = {
      ...input,
      activityKey: "build.implement",
      cells: input.cells.map((cell) => ({
        ...cell,
        executionRequest: {
          fixtureKey: "bounded-helper-v1",
        },
        fixtureParts,
      })),
    };
    const deps = {
      persistence,
      resolveOwnerUserId: vi.fn().mockResolvedValue("user-owner"),
    };

    const first = await createOrResumeWorkPatternExperiment(buildInput, deps);
    const resumed = await createOrResumeWorkPatternExperiment(buildInput, deps);

    expect(persistence.artifacts.size).toBe(1);
    expect(persistence.artifacts.values().next().value?.parts).toEqual([
      expect.objectContaining({
        type: "work-pattern-experiment-fixture",
        mimeType: "application/json",
        data: fixtureParts,
      }),
    ]);
    for (const child of first.children) {
      expect(
        child.a2aMetadata.workPatternExperimentCell?.executionRequest,
      ).toMatchObject({
        fixtureKey: expect.stringMatching(/^ta_wpf_/),
      });
    }
    expect(resumed.children.map((child) => child.taskRunId)).toEqual(
      first.children.map((child) => child.taskRunId),
    );
  });

  it("fails closed when a logical fixture identity is reused with changed bytes", async () => {
    const persistence = makePersistence();
    const deps = {
      persistence,
      resolveOwnerUserId: vi.fn().mockResolvedValue("user-owner"),
    };
    const fixtureParts = {
      schemaVersion: 1,
      kind: "build-replay-v1",
      objective: "First version.",
      targetFile: "apps/web/lib/fixtures/bounded.ts",
      testFiles: ["apps/web/lib/fixtures/bounded.test.ts"],
      methodInstructions: { baseline: "Smallest implementation." },
    };
    const withFixture = (parts: typeof fixtureParts) => ({
      ...input,
      activityKey: "build.implement",
      cells: input.cells.map((cell) => ({
        ...cell,
        executionRequest: { fixtureKey: "bounded-helper-v1" },
        fixtureParts: parts,
      })),
    });

    await createOrResumeWorkPatternExperiment(withFixture(fixtureParts), deps);
    await expect(createOrResumeWorkPatternExperiment(withFixture({
      ...fixtureParts,
      objective: "Changed version.",
    }), deps)).rejects.toThrow("work_pattern_experiment_fixture_changed");
    expect(persistence.artifacts.size).toBe(1);
  });

  it("fails before child creation when a referenced artifact is unavailable", async () => {
    const persistence = makePersistence();
    const deps = {
      persistence,
      resolveOwnerUserId: vi.fn().mockResolvedValue("user-owner"),
    };

    await expect(createOrResumeWorkPatternExperiment({
      ...input,
      cells: input.cells.map((cell) => ({
        ...cell,
        executionRequest: { fixtureKey: "ta_wpf_missing" },
      })),
    }, deps)).rejects.toThrow(
      "work_pattern_experiment_fixture_unavailable:ta_wpf_missing",
    );
    expect(
      persistence.rows.filter((row) => row.parentTaskRunId !== null),
    ).toHaveLength(0);
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
    expect(retry.a2aMetadata.workPatternExperimentCell!.attempt).toBe(2);
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
      expect(parent.a2aMetadata.workPatternExperiment!.lifecycle).toBe(lifecycle);
    }
    await expect(
      transitionWorkPatternExperiment(run.parent.taskRunId, "running", { persistence }),
    ).rejects.toThrow("illegal_work_pattern_experiment_transition");
  });

  it("fails closed when stored lifecycle metadata and A2A status have diverged", async () => {
    const persistence = makePersistence();
    const deps = {
      persistence,
      resolveOwnerUserId: vi.fn().mockResolvedValue("user-owner"),
    };
    const run = await createOrResumeWorkPatternExperiment(input, deps);
    await persistence.updateTaskRun(run.parent.taskRunId, { status: "working" });

    await expect(createOrResumeWorkPatternExperiment(input, deps)).rejects.toThrow(
      "work_pattern_experiment_status_divergence",
    );
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
    expect(persistence.ledgers.size).toBe(1);
    expect(first.agentId).toBe("agent-orchestrator");
    expect(first.metadata).toMatchObject({ modelProfileId: "candidate-model" });
  });
});
