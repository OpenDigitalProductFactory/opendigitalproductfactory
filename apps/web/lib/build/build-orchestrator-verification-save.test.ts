import { describe, expect, it, vi } from "vitest";

import { saveVerificationOutForBuild } from "./build-orchestrator";
import { resolveQaVerification, runDeterministicBuildVerification } from "./deterministic-build-verification";
import { normalizeVerificationOutput } from "./verification-output";
import { checkVerificationDepthRequirement } from "../explore/verification-depth-requirement";

/**
 * The orchestrator saved verificationOut without a buildId. With more than one
 * open build the tool refuses to guess (BI-F82915D7), and the refusal was
 * ignored: on the live install (128 open builds) no build since 2026-09-15
 * kept a typecheck verdict, so evidence auto-accept never fired and every
 * build stalled at review->ship.
 */
describe("saveVerificationOutForBuild", () => {
  it("cannot save a Boolean-derived pass over explicit unrun test facts", async () => {
    const execute = vi.fn(async () => ({ success: true }));
    await saveVerificationOutForBuild(execute as never, "FB-VERIFICATION-FIXTURE", {
      typecheckPassed: true, testsPassed: 1, testsFailed: 0,
      testsExecuted: false, testsApplicable: null, testsQualified: false,
    }, "fixture-owner", "fixture-thread");
    expect(execute).toHaveBeenCalledWith("saveBuildEvidence", expect.objectContaining({
      value: expect.objectContaining({ testsPassed: 0, testsFailed: null, testsQualified: false }),
    }), "fixture-owner", expect.anything());
  });

  it("retains execution qualification and original QA through the actual save boundary and reload", async () => {
    const qaContent = `${"QA source detail ".repeat(300)}99 passed, 3 failed; END-OF-ORIGINAL-QA`;
    const deterministic = await runDeterministicBuildVerification({ changedFiles: [], deps: {
      containerId: "fixture", workdir: "/isolated-fixture", baseRef: "fixture-base", exec: async () => "",
      runTests: async () => ({ passed: true, typeCheckPassed: true, scope: "none", testsExecuted: false,
        testsApplicable: false, testsPassed: 0, testsFailed: 0, testOutput: "No tests ran.", typeCheckOutput: "" }),
    } });
    const resolved = await resolveQaVerification({
      parsed: { typecheckPassed: true, testsPassed: 99, testsFailed: 3, parseConfidence: "high" },
      qaContent, changedFiles: [], runDeterministic: async () => deterministic,
    });
    let saved: unknown;
    const execute = vi.fn(async (_name, input) => { saved = JSON.parse(JSON.stringify(input.value)); return { success: true }; });
    await saveVerificationOutForBuild(execute as never, "FB-VERIFICATION-FIXTURE", {
      ...resolved.verification, fullOutput: resolved.content.slice(0, 2000),
    }, "fixture-owner", "fixture-thread");
    expect(normalizeVerificationOutput(saved)).toMatchObject({
      testsPassed: 0, testsFailed: null, testsQualified: false, testEvidenceConflict: true,
      reportedQa: { testsPassed: 99, testsFailed: 3, content: qaContent },
    });
    expect(checkVerificationDepthRequirement({ verificationDepth: "shallow", transition: "build->review", verificationOut: saved })).toMatchObject({ allowed: false });
  });

  it("names the build it saves to", async () => {
    const executeTool = vi.fn(async () => ({ success: true, message: "saved" }));
    await saveVerificationOutForBuild(executeTool as never, "FB-B70483FC", { typecheckPassed: true }, "user-1", "thread-1");
    expect(executeTool).toHaveBeenCalledWith(
      "saveBuildEvidence",
      { buildId: "FB-B70483FC", field: "verificationOut", value: { typecheckPassed: true } },
      "user-1",
      expect.objectContaining({ agentId: "AGT-ORCH-300", threadId: "thread-1" }),
    );
  });

  it("fails loudly when the tool refuses the save, instead of dropping the verdict", async () => {
    const executeTool = vi.fn(async () => ({ success: false, error: "No active build found.", message: "No active build." }));
    await expect(
      saveVerificationOutForBuild(executeTool as never, "FB-1", { typecheckPassed: true }, "user-1", undefined),
    ).rejects.toThrow(/verificationOut not saved for FB-1: No active build found/);
  });
});
