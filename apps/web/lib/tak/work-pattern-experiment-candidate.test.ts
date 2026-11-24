import { describe, expect, it, vi } from "vitest";

import {
  proposeWorkPatternExperimentCandidate,
  type ProposeWorkPatternExperimentCandidateDb,
} from "./work-pattern-experiment-candidate";
import { parseReviewedExperimentCandidate } from "./work-pattern-experiment-scheduler";
import { parseWorkPatternMetadata } from "./work-pattern-types";

function makeCandidate(overrides?: {
  environmentKey?: string;
  riskClass?: string;
  omitFixture?: boolean;
}) {
  const methods = [
    { methodVariantKey: "baseline", patternVersion: 1 },
    { methodVariantKey: "candidate", patternVersion: 2 },
  ];
  const models = [
    { modelVariantKey: "frontier", modelProfileId: "frontier-coding" },
    { modelVariantKey: "local", modelProfileId: "local-coding" },
  ];
  const fixtureParts = {
    schemaVersion: 1 as const,
    kind: "build-replay-v1" as const,
    objective: "Implement the bounded helper cleanly.",
    targetFile: "apps/web/lib/build/bounded-helper.ts",
    testFiles: ["apps/web/lib/build/bounded-helper.test.ts"],
    methodInstructions: {
      baseline: "Keep the baseline implementation minimal.",
      candidate: "Use explicit guards and narrow helpers.",
    },
  };
  const riskClass = overrides?.riskClass ?? "internal-reversible";
  const environmentKey = overrides?.environmentKey ?? "shadow";
  return {
    definition: {
      patternKey: "build.implement:dpf-standard",
      taskCorpusKey: "dpf-repository",
      taskCorpusVersion: "1",
      oracleKey: "vitest-and-next-build",
      oracleVersion: "1",
      methodVariants: methods,
      modelVariants: models,
      installScope: "dpf_dogfood",
      promotionPolicyKey: "governed-build-playbook-promotion",
      promotionPolicyVersion: 1,
    },
    activityKey: "build.implement",
    riskClass,
    pairKey: "pair-v1",
    cells: methods.flatMap((method) =>
      models.map((model) => ({
        methodVariantKey: method.methodVariantKey,
        modelVariantKey: model.modelVariantKey,
        executionRequest: {
          experimentRunId: "WPR-1",
          childTaskRunId: "TR-CELL-1",
          cellKey: `${method.methodVariantKey}:${model.modelVariantKey}`,
          pairKey: "pair-v1",
          methodVariantKey: method.methodVariantKey,
          modelVariantKey: model.modelVariantKey,
          executionProfile: {
            patternKey: "build.implement:dpf-standard",
            patternVersion: method.patternVersion,
            variantKey: method.methodVariantKey,
            activityKey: "build.implement",
            riskClass,
            providerId: "anthropic",
            modelId: model.modelVariantKey,
            modelProfileId: model.modelProfileId,
            toolPackDigest: "tools-v1",
            promptOrSkillDigest: method.methodVariantKey,
            contextPolicyKey: "hermetic",
            recoveryPolicyKey: "bounded",
            installScope: "dpf_dogfood",
            taskCorpusKey: "dpf-repository",
            taskCorpusVersion: "1",
            environmentKey,
            sourceCommitSha: "f9dc75c01fe6",
          },
          fixtureKey: "bounded-helper-v1",
          oracleKey: "vitest-and-next-build",
          oracleVersion: "1",
          resourcePolicyKey: "bounded",
        },
        ...(overrides?.omitFixture ? {} : { fixtureParts }),
      })),
    ),
  };
}

function makeDb(
  overrides?: Partial<ProposeWorkPatternExperimentCandidateDb>,
): ProposeWorkPatternExperimentCandidateDb & {
  createProposal: ReturnType<typeof vi.fn>;
} {
  return {
    findCoworker: vi.fn(async (agentId: string) => ({ agentId })),
    listOpenNeeds: vi.fn(async () => []),
    createProposal: vi.fn(async () => undefined),
    ...overrides,
  } as ProposeWorkPatternExperimentCandidateDb & {
    createProposal: ReturnType<typeof vi.fn>;
  };
}

describe("proposeWorkPatternExperimentCandidate", () => {
  it("persists a reviewable candidate need with valid workPattern and experiment payload", async () => {
    const db = makeDb();
    let seq = 0;
    const result = await proposeWorkPatternExperimentCandidate(
      {
        agentId: "build-specialist",
        need: "Prove the standard dogfood implementation loop for autonomous Build Studio",
        blocks: "Unblocks active_pattern_binding_missing for build.implement on dpf_dogfood.",
        candidate: makeCandidate(),
      },
      {
        db,
        now: () => new Date("2026-11-24T01:00:00.000Z"),
        createId: (prefix) => `${prefix}-0000000${++seq}`,
      },
    );

    expect(result).toMatchObject({
      status: "proposed",
      assessmentId: "CWSA-00000001",
      needId: "CWN-00000002",
      agentId: "build-specialist",
      patternKey: "build.implement:dpf-standard",
      reviewRoute: "/platform/ai/agent/build-specialist",
    });
    expect(db.createProposal).toHaveBeenCalledTimes(1);
    const written = db.createProposal.mock.calls[0][0];
    expect(written.readinessJson).toMatchObject({
      readyForReview: true,
      activationProposed: true,
    });
    expect(parseWorkPatternMetadata(written.evidenceJson.workPattern)).toMatchObject({
      patternKey: "build.implement:dpf-standard",
      status: "candidate",
      scope: "activity",
      version: 2,
      decisionScope: "platform-wwmd",
    });
    expect(
      parseReviewedExperimentCandidate(written.evidenceJson.workPatternExperimentCandidate),
    ).not.toBeNull();
  });

  it("reuses an existing open candidate with the same fingerprint without duplicating", async () => {
    const db = makeDb();
    const first = await proposeWorkPatternExperimentCandidate(
      {
        agentId: "build-specialist",
        need: "Prove standard dogfood loop",
        blocks: "Unblocks enforce mode",
        candidate: makeCandidate(),
      },
      { db },
    );
    expect(first.status).toBe("proposed");
    if (first.status !== "proposed") return;

    const dbWithExisting = makeDb({
      listOpenNeeds: vi.fn(async () => [
        {
          needId: first.needId,
          assessmentId: first.assessmentId,
          evidenceJson: { fingerprint: first.fingerprint },
        },
      ]),
    });
    const second = await proposeWorkPatternExperimentCandidate(
      {
        agentId: "build-specialist",
        need: "Prove standard dogfood loop",
        blocks: "Unblocks enforce mode",
        candidate: makeCandidate(),
      },
      { db: dbWithExisting },
    );

    expect(second).toMatchObject({
      status: "reused",
      needId: first.needId,
      assessmentId: first.assessmentId,
      fingerprint: first.fingerprint,
    });
    expect(dbWithExisting.createProposal).not.toHaveBeenCalled();
  });

  it("rejects non-shadow, irreversible, missing-fixture, and unknown-coworker proposals before writing", async () => {
    const db = makeDb();
    await expect(
      proposeWorkPatternExperimentCandidate(
        {
          agentId: "build-specialist",
          need: "Live test",
          blocks: "None",
          candidate: makeCandidate({ environmentKey: "live" }),
        },
        { db },
      ),
    ).resolves.toEqual({ status: "rejected", reason: "authority_ceiling" });

    await expect(
      proposeWorkPatternExperimentCandidate(
        {
          agentId: "build-specialist",
          need: "Irreversible test",
          blocks: "None",
          candidate: makeCandidate({ riskClass: "internal-irreversible" }),
        },
        { db },
      ),
    ).resolves.toEqual({ status: "rejected", reason: "authority_ceiling" });

    await expect(
      proposeWorkPatternExperimentCandidate(
        {
          agentId: "build-specialist",
          need: "Missing fixture",
          blocks: "None",
          candidate: makeCandidate({ omitFixture: true }),
        },
        { db },
      ),
    ).resolves.toEqual({ status: "rejected", reason: "missing_build_replay_fixture" });

    const missingDb = makeDb({ findCoworker: vi.fn(async () => null) });
    await expect(
      proposeWorkPatternExperimentCandidate(
        {
          agentId: "missing-agent",
          need: "Unknown coworker",
          blocks: "None",
          candidate: makeCandidate(),
        },
        { db: missingDb },
      ),
    ).resolves.toEqual({ status: "rejected", reason: "coworker_not_found" });

    expect(db.createProposal).not.toHaveBeenCalled();
    expect(missingDb.createProposal).not.toHaveBeenCalled();
  });
});
