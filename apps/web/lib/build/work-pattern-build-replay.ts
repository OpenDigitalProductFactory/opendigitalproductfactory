import { createHash } from "node:crypto";

import type { WorkPatternExecutionProfile } from "@/lib/tak/work-pattern-experiment-types";
import { DEFAULT_WORK_PATTERN_PROMOTION_POLICY } from "@/lib/tak/work-pattern-promotion-policy";
import {
  parseHermeticBuildReplayFixture,
} from "@/lib/tak/work-pattern-experiment-fixture";

export {
  parseHermeticBuildReplayFixture,
  type HermeticBuildReplayFixture,
} from "@/lib/tak/work-pattern-experiment-fixture";

import {
  buildSandboxWorktreeAddCommand,
  buildSandboxWorktreeRemoveCommand,
  buildWorktreePath,
} from "./sandbox/build-branch";
import {
  runSandboxTypecheckBuildGate,
  type SandboxGateResult,
} from "./sandbox/sandbox-verification";
import {
  runSandboxTests,
  type SandboxTestResult,
} from "./coding-agent";
import {
  executeWorkPatternExperimentCell,
  type WorkPatternExperimentCellRequest,
  type WorkPatternExperimentCellResult,
} from "./work-pattern-experiment-adapter";

type InferenceResult = {
  content: string;
  providerId: string;
  modelId: string;
  inputTokens: number;
  outputTokens: number;
};

export type HermeticBuildReplayDeps = {
  containerId: string;
  exec: (containerId: string, command: string) => Promise<string>;
  infer: (input: {
    messages: Array<{ role: "user"; content: string }>;
    systemPrompt: string;
    profile: WorkPatternExecutionProfile;
    agentId: string;
  }) => Promise<InferenceResult>;
  runTests: (
    containerId: string,
    opts: { changedFiles: string[]; workdir: string },
  ) => Promise<Pick<SandboxTestResult, "passed">>;
  runBuild: (
    containerId: string,
    exec?: undefined,
    workdir?: string,
  ) => Promise<Pick<SandboxGateResult, "allPassed">>;
};

export type HermeticBuildReplayExecution = {
  result: WorkPatternExperimentCellResult;
  outputDigest: string;
  inputTokens: number;
  outputTokens: number;
};

const SAFE_TASK_ID = /^[a-zA-Z0-9-]+$/;
const SAFE_COMMIT = /^[a-fA-F0-9]{7,64}$/;

function sourceFromResponse(content: string): string | null {
  const fenced = content.match(/```(?:typescript|tsx|ts|javascript|jsx|js)?\s*\n([\s\S]*?)```/i);
  const source = (fenced?.[1] ?? content).trim();
  return source.length > 0 ? `${source}\n` : null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function buildHermeticDependencyInstallCommand(workdir: string): string {
  const linkedDependencyPaths = [
    `${workdir}/node_modules`,
    `${workdir}/apps/web/node_modules`,
    `${workdir}/packages/db/node_modules`,
    `${workdir}/packages/dpf-skill-pack/node_modules`,
    `${workdir}/packages/dpf-bootstrap/node_modules`,
  ];
  const unlinkCommands = linkedDependencyPaths
    .map((path) => `if [ -L ${path} ]; then rm ${path}; fi`)
    .join(" && ");
  return [
    unlinkCommands,
    `cd ${workdir}`,
    "CI=true pnpm install --offline --frozen-lockfile",
  ].join(" && ");
}

async function productionDeps(): Promise<HermeticBuildReplayDeps> {
  const [{ execInSandbox }, { routeAndCall }] = await Promise.all([
    import("./sandbox/sandbox"),
    import("@/lib/routed-inference"),
  ]);
  return {
    containerId: process.env.SANDBOX_CONTAINER_ID ?? "dpf-sandbox-1",
    exec: execInSandbox,
    infer: async ({ messages, systemPrompt, profile, agentId }) => {
      const response = await routeAndCall(messages, systemPrompt, "internal", {
        taskType: profile.activityKey,
        preferredProviderId: profile.providerId,
        preferredModelId: profile.modelId,
        agentId,
        persistDecision: true,
      });
      return {
        content: response.content,
        providerId: response.providerId,
        modelId: response.modelId,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
      };
    },
    runTests: runSandboxTests,
    runBuild: runSandboxTypecheckBuildGate,
  };
}

/**
 * Executes one immutable build fixture in a detached sandbox worktree. The
 * surface is intentionally smaller than a FeatureBuild: one declared source
 * file, up to four pre-existing tests, and the canonical production-build gate.
 * It has no FeatureBuild, PR, merge, release, or live-state dependency.
 */
export async function executeHermeticBuildReplay(input: {
  request: WorkPatternExperimentCellRequest;
  fixtureParts: unknown;
  agentId: string;
  deps?: HermeticBuildReplayDeps;
}): Promise<HermeticBuildReplayExecution> {
  const fixture = parseHermeticBuildReplayFixture(input.fixtureParts);
  if (!fixture) {
    throw new Error(`work_pattern_experiment_fixture_unavailable:${input.request.fixtureKey}`);
  }
  if (
    !DEFAULT_WORK_PATTERN_PROMOTION_POLICY.supportedActivityKeys.includes(
      input.request.executionProfile.activityKey,
    )
    || input.request.executionProfile.environmentKey !== "shadow"
    || !DEFAULT_WORK_PATTERN_PROMOTION_POLICY.supportedRiskClasses.includes(
      input.request.executionProfile.riskClass,
    )
  ) {
    throw new Error(
      `work_pattern_experiment_authority_ceiling:${input.request.childTaskRunId}`,
    );
  }
  if (
    !SAFE_TASK_ID.test(input.request.childTaskRunId)
    || !SAFE_COMMIT.test(input.request.executionProfile.sourceCommitSha)
  ) {
    throw new Error(
      `invalid_work_pattern_build_identity:${input.request.childTaskRunId}`,
    );
  }
  const instruction =
    fixture.methodInstructions[input.request.executionProfile.promptOrSkillDigest];
  if (!instruction) {
    throw new Error(
      `work_pattern_experiment_method_unavailable:${input.request.executionProfile.promptOrSkillDigest}`,
    );
  }

  const deps = input.deps ?? await productionDeps();
  const workdir = buildWorktreePath(input.request.childTaskRunId);
  let generatedSource = "";
  let inputTokens = 0;
  let outputTokens = 0;

  await deps.exec(
    deps.containerId,
    buildSandboxWorktreeAddCommand(
      input.request.childTaskRunId,
      input.request.executionProfile.sourceCommitSha,
    ),
  );
  try {
    await deps.exec(
      deps.containerId,
      buildHermeticDependencyInstallCommand(workdir),
    );
    const result = await executeWorkPatternExperimentCell(input.request, {
      prepareWorkspace: async () => ({
        workspaceId:
          `${input.request.childTaskRunId}:${input.request.executionProfile.sourceCommitSha}`,
        workdir,
      }),
      dispatch: async () => {
        const inference = await deps.infer({
          messages: [{
            role: "user",
            content: [
              fixture.objective,
              `Implement only ${fixture.targetFile}.`,
              "Return only the complete file in one fenced code block.",
            ].join("\n"),
          }],
          systemPrompt: [
            "You are executing a bounded, hermetic Build Studio implementation fixture.",
            "Do not call tools, access networks, modify any other file, or describe delivery actions.",
            instruction,
          ].join("\n"),
          profile: input.request.executionProfile,
          agentId: input.agentId,
        });
        inputTokens = inference.inputTokens;
        outputTokens = inference.outputTokens;
        const source = sourceFromResponse(inference.content);
        if (!source) {
          return {
            success: false,
            providerId: inference.providerId,
            modelId: inference.modelId,
            filesChanged: [],
            toolCalls: 1,
            toolFailures: 1,
            error: "empty_code_generation",
          };
        }
        generatedSource = source;
        const encoded = Buffer.from(source).toString("base64");
        await deps.exec(
          deps.containerId,
          `printf %s '${encoded}' | base64 -d > ${workdir}/${fixture.targetFile}`,
        );
        return {
          success: true,
          providerId: inference.providerId,
          modelId: inference.modelId,
          filesChanged: [fixture.targetFile],
          toolCalls: 2,
          toolFailures: 0,
        };
      },
      verify: async () => {
        const tests = await deps.runTests(deps.containerId, {
          changedFiles: [fixture.targetFile, ...fixture.testFiles],
          workdir,
        });
        const build = await deps.runBuild(deps.containerId, undefined, workdir);
        return {
          unitTests: tests.passed ? "pass" : "fail",
          productionBuild: build.allPassed ? "pass" : "fail",
          uxVerification: "not-applicable",
          migration: "not-applicable",
        };
      },
    });
    return {
      result,
      outputDigest: sha256(generatedSource),
      inputTokens,
      outputTokens,
    };
  } finally {
    await deps.exec(
      deps.containerId,
      buildSandboxWorktreeRemoveCommand(input.request.childTaskRunId),
    ).catch(() => undefined);
  }
}
