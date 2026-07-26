import { describe, expect, it } from "vitest";

import {
  canTransitionWorkPatternExperiment,
  experimentLifecycleToTaskStatus,
  parseWorkPatternExecutionProfile,
  parseWorkPatternExperimentMetadata,
} from "./work-pattern-experiment-types";

function executionProfile(overrides: Record<string, unknown> = {}) {
  return {
    patternKey: "build.review",
    patternVersion: 3,
    variantKey: "review-with-focused-tests",
    activityKey: "build.review",
    riskClass: "internal-reversible",
    providerId: "provider-routed",
    modelId: "model-after-fallback",
    modelProfileId: "MP-REVIEW",
    toolPackDigest: "sha256:tools",
    promptOrSkillDigest: "sha256:prompt",
    contextPolicyKey: "context.minimized.v1",
    recoveryPolicyKey: "recovery.build-review.v2",
    installScope: "dpf_dogfood",
    organizationId: "ORG-DPF",
    taskCorpusKey: "build-review-corpus",
    taskCorpusVersion: "2026-07-25",
    environmentKey: "local-integration-ci",
    sourceCommitSha: "0123456789abcdef0123456789abcdef01234567",
    ...overrides,
  };
}

function experimentMetadata(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    experimentDefinitionKey: "WPD-123",
    experimentRunId: "WPR-123-R1",
    replicate: 1,
    patternKey: "build.review",
    activityKey: "build.review",
    riskClass: "internal-reversible",
    methodVariants: [
      { methodVariantKey: "baseline", patternVersion: 2 },
      { methodVariantKey: "candidate", patternVersion: 3 },
    ],
    modelVariants: [
      { modelVariantKey: "local", modelProfileId: "MP-LOCAL" },
      { modelVariantKey: "frontier", modelProfileId: "MP-FRONTIER" },
    ],
    requiredCellKeys: [
      "baseline:local",
      "candidate:local",
      "baseline:frontier",
      "candidate:frontier",
    ],
    taskCorpusKey: "build-review-corpus",
    taskCorpusVersion: "2026-07-25",
    oracleKey: "build-gates",
    oracleVersion: "2",
    promotionPolicyKey: "work-pattern-promotion",
    promotionPolicyVersion: 4,
    installScope: "dpf_dogfood",
    lifecycle: "planned",
    ...overrides,
  };
}

describe("parseWorkPatternExecutionProfile", () => {
  it("accepts the minimized resolved execution snapshot", () => {
    expect(parseWorkPatternExecutionProfile(executionProfile())).toEqual(executionProfile());
  });

  it.each([
    ["riskClass", "unknown-risk"],
    ["installScope", "dogfood"],
  ])("rejects an unknown %s", (field, value) => {
    expect(parseWorkPatternExecutionProfile(executionProfile({ [field]: value }))).toBeNull();
  });

  it.each([
    ["apiKey", "secret"],
    ["providerConfig", { token: "secret" }],
    ["prompt", "full prompt text"],
    ["systemPrompt", "full system prompt text"],
  ])("rejects secret-bearing or full-prompt field %s", (field, value) => {
    expect(parseWorkPatternExecutionProfile(executionProfile({ [field]: value }))).toBeNull();
  });

  it("keeps the routed provider/model rather than a requested fallback input", () => {
    const parsed = parseWorkPatternExecutionProfile(executionProfile({
      providerId: "provider-after-routing",
      modelId: "model-after-routing",
    }));

    expect(parsed).toMatchObject({
      providerId: "provider-after-routing",
      modelId: "model-after-routing",
    });
    expect(parsed).not.toHaveProperty("requestedProviderId");
    expect(parsed).not.toHaveProperty("requestedModelId");
  });
});

describe("parseWorkPatternExperimentMetadata", () => {
  it("parses a versioned factorial manifest without a two-arm restriction", () => {
    expect(parseWorkPatternExperimentMetadata(experimentMetadata())).toEqual(experimentMetadata());
  });

  it.each([
    ["lifecycle", "active"],
    ["installScope", "local"],
    ["riskClass", "critical"],
    ["schemaVersion", 2],
  ])("fails closed for malformed %s", (field, value) => {
    expect(parseWorkPatternExperimentMetadata(experimentMetadata({ [field]: value }))).toBeNull();
  });
});

describe("work-pattern experiment lifecycle", () => {
  it.each([
    ["planned", "submitted"],
    ["running", "working"],
    ["analyzing", "working"],
    ["completed", "completed"],
    ["cancelled", "canceled"],
  ] as const)("maps %s to TaskRun status %s", (lifecycle, status) => {
    expect(experimentLifecycleToTaskStatus(lifecycle)).toBe(status);
  });

  it("allows only legal transitions and idempotent resume", () => {
    expect(canTransitionWorkPatternExperiment("planned", "planned")).toBe(true);
    expect(canTransitionWorkPatternExperiment("planned", "running")).toBe(true);
    expect(canTransitionWorkPatternExperiment("running", "analyzing")).toBe(true);
    expect(canTransitionWorkPatternExperiment("analyzing", "completed")).toBe(true);
    expect(canTransitionWorkPatternExperiment("running", "cancelled")).toBe(true);

    expect(canTransitionWorkPatternExperiment("planned", "completed")).toBe(false);
    expect(canTransitionWorkPatternExperiment("completed", "running")).toBe(false);
    expect(canTransitionWorkPatternExperiment("cancelled", "planned")).toBe(false);
  });
});
