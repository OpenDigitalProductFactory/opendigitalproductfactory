import { describe, expect, it, vi } from "vitest";

import {
  executeHermeticBuildReplay,
  parseHermeticBuildReplayFixture,
} from "./work-pattern-build-replay";

const request = {
  experimentRunId: "WPR-1",
  childTaskRunId: "TR-CELL-1",
  cellKey: "control",
  pairKey: "pair",
  methodVariantKey: "baseline",
  modelVariantKey: "model-a",
  executionProfile: {
    patternKey: "implementation-loop",
    patternVersion: 1,
    variantKey: "baseline",
    activityKey: "build.implement",
    riskClass: "internal-reversible" as const,
    providerId: "provider-a",
    modelId: "model-a",
    modelProfileId: "profile-a",
    toolPackDigest: "bounded-code",
    promptOrSkillDigest: "method-digest",
    contextPolicyKey: "hermetic",
    recoveryPolicyKey: "bounded",
    installScope: "canonical" as const,
    taskCorpusKey: "bounded-build-corpus",
    taskCorpusVersion: "1",
    environmentKey: "shadow",
    sourceCommitSha: "abc123",
  },
  fixtureKey: "fixture-1",
  oracleKey: "fixture-tests",
  oracleVersion: "1",
  resourcePolicyKey: "bounded",
};

const fixture = {
  schemaVersion: 1,
  kind: "build-replay-v1",
  objective: "Implement the bounded helper.",
  targetFile: "apps/web/lib/fixtures/bounded.ts",
  testFiles: ["apps/web/lib/fixtures/bounded.test.ts"],
  methodInstructions: {
    "method-digest": "Prefer the smallest pure implementation.",
  },
};

describe("hermetic build replay", () => {
  it("rejects traversal, shell-bearing paths, and mutable authority", () => {
    expect(parseHermeticBuildReplayFixture({
      ...fixture,
      targetFile: "../../etc/passwd",
    })).toBeNull();
    expect(parseHermeticBuildReplayFixture({
      ...fixture,
      testFiles: ["apps/web/x.test.ts; touch /tmp/owned"],
    })).toBeNull();
    expect(parseHermeticBuildReplayFixture({
      ...fixture,
      targetFile: "apps/web/app/build/page.tsx",
    })).toBeNull();
    expect(parseHermeticBuildReplayFixture({
      ...fixture,
      targetFile: "apps/web/package.json",
    })).toBeNull();
  });

  it("escalates a high-risk fixture before creating a workspace", async () => {
    const exec = vi.fn();
    await expect(executeHermeticBuildReplay({
      request: {
        ...request,
        executionProfile: {
          ...request.executionProfile,
          riskClass: "outbound-or-floor",
        },
      },
      fixtureParts: fixture,
      agentId: "agent-1",
      deps: {
        containerId: "sandbox",
        exec,
        infer: vi.fn(),
        runTests: vi.fn(),
        runBuild: vi.fn(),
      },
    })).rejects.toThrow("work_pattern_experiment_authority_ceiling");
    expect(exec).not.toHaveBeenCalled();
  });

  it("uses an isolated worktree, bounded coding dispatch, scoped tests, and production build", async () => {
    const exec = vi.fn().mockResolvedValue("");
    const infer = vi.fn().mockResolvedValue({
      content: "```typescript\nexport const bounded = true;\n```",
      providerId: "provider-actual",
      modelId: "model-actual",
      inputTokens: 30,
      outputTokens: 8,
    });
    const runTests = vi.fn().mockResolvedValue({ passed: true });
    const runBuild = vi.fn().mockResolvedValue({
      allPassed: true,
      typecheck: { passed: true },
      build: { passed: true },
    });

    const execution = await executeHermeticBuildReplay({
      request,
      fixtureParts: fixture,
      agentId: "agent-1",
      deps: {
        containerId: "sandbox",
        exec,
        infer,
        runTests,
        runBuild,
      },
    });

    expect(exec.mock.calls[0]?.[1]).toContain("git worktree add");
    expect(exec.mock.calls[1]?.[1]).toContain("base64 -d");
    expect(exec.mock.calls.at(-1)?.[1]).toContain("git worktree remove");
    expect(infer).toHaveBeenCalledWith(expect.objectContaining({
      profile: expect.objectContaining({
        providerId: "provider-a",
        modelId: "model-a",
      }),
      systemPrompt: expect.stringContaining("Prefer the smallest pure implementation."),
    }));
    expect(runTests).toHaveBeenCalledWith(
      "sandbox",
      expect.objectContaining({
        changedFiles: [
          "apps/web/lib/fixtures/bounded.ts",
          "apps/web/lib/fixtures/bounded.test.ts",
        ],
      }),
    );
    expect(runBuild).toHaveBeenCalledWith(
      "sandbox",
      undefined,
      expect.stringContaining(".builds/TR-CELL-1"),
    );
    expect(execution.result).toMatchObject({
      success: true,
      actualProviderId: "provider-actual",
      actualModelId: "model-actual",
      filesChanged: ["apps/web/lib/fixtures/bounded.ts"],
      buildGate: {
        unitTests: "pass",
        productionBuild: "pass",
      },
    });
  });

  it("always removes the isolated worktree after a dispatch failure", async () => {
    const exec = vi.fn().mockResolvedValue("");
    await expect(executeHermeticBuildReplay({
      request,
      fixtureParts: fixture,
      agentId: "agent-1",
      deps: {
        containerId: "sandbox",
        exec,
        infer: vi.fn().mockRejectedValue(new Error("provider unavailable")),
        runTests: vi.fn(),
        runBuild: vi.fn(),
      },
    })).rejects.toThrow("provider unavailable");
    expect(exec.mock.calls.at(-1)?.[1]).toContain("git worktree remove");
  });
});
