import { describe, expect, it, vi } from "vitest";

import { saveVerificationOutForBuild, resolveBuildVerificationForGate, saveVerificationRepairForBuild } from "./build-orchestrator";
import { runVerificationRepairLoop } from "./verification-repair";
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
  it.each(["success", "scope-reader-failure", "dispatch-refusal"] as const)("keeps actual initial/retry/post-repair saved facts: %s", async (scenario) => {
    let round = 0;
    const runTests = vi.fn(async () => ({ passed: round > 0, typeCheckPassed: true,
      scope: "scoped" as const, testsPassed: round > 0 ? 4 : 3, testsFailed: round > 0 ? 0 : 1,
      testsExecuted: true, testsApplicable: true, testCommandPassed: round > 0, testSummariesComplete: true,
      testOutput: round > 0 ? "Tests 4 passed" : "Tests 1 failed | 3 passed", typeCheckOutput: "",
      testCommands: ['cd /isolated/apps/web && pnpm exec vitest run "lib/fixture.test.ts"'],
    }));
    const run = () => runDeterministicBuildVerification({ changedFiles: ["stale-projection.ts"], deps: {
      containerId: "fixture", workdir: "/isolated", baseRef: "fixture-base",
      exec: async (_id, command) => {
        if (round > 0 && scenario === "scope-reader-failure") throw new Error("fixture reader unavailable");
        return command.startsWith("node -e ") ? String(round).repeat(64)
          : `apps/web/lib/fixture.ts\0${round > 0 ? "apps/web/lib/added.ts\0" : ""}`;
      }, runTests,
    } });
    const resolve = () => resolveBuildVerificationForGate({
      parsed: { typecheckPassed: true, testsPassed: 0, testsFailed: 0, parseConfidence: "low" },
      qaContent: "Checks require native verification.", changedFiles: ["stale-projection.ts"], runDeterministic: run,
    });
    const initial = await resolve();
    let latest: typeof initial | undefined;
    const loop = await runVerificationRepairLoop({ initial: initial.verdict, changedFiles: initial.changedFiles, maxRounds: 2,
      dispatchRepair: async () => { round += 1; return scenario !== "dispatch-refusal"; },
      reverify: async () => { latest = await resolve(); return latest.verdict; },
    });
    let saved: unknown;
    const execute = vi.fn(async (_name, input) => { saved = JSON.parse(JSON.stringify(input.value)); return { success: true }; });
    const repaired = await saveVerificationRepairForBuild({ executeTool: execute as never,
      buildId: "FB-REPAIR-FIXTURE", userId: "fixture-owner", initial, latest, loop });
    expect(repaired).toBe(scenario === "success");
    if (scenario === "success") {
      expect(saved).toMatchObject({ testsPassed: 4, testsFailed: 0, testsQualified: true, verificationRepaired: true,
        scopedToChangedFiles: ["apps/web/lib/fixture.ts", "apps/web/lib/added.ts"] });
      expect(runTests).toHaveBeenCalledTimes(2);
    } else if (scenario === "scope-reader-failure") {
      expect(saved).toMatchObject({ typecheckPassed: null, testsPassed: 0, testsFailed: null, testsQualified: false, verificationRepaired: false });
      expect(runTests).toHaveBeenCalledTimes(1);
    } else {
      expect(saved).toMatchObject({ testsPassed: 3, testsFailed: 1, testsQualified: false, verificationRepaired: false });
      expect(runTests).toHaveBeenCalledTimes(1);
    }
    expect(checkVerificationDepthRequirement({ verificationDepth: "shallow", transition: "build->review", verificationOut: saved }).allowed)
      .toBe(scenario === "success");
  });
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
