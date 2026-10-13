import { describe, expect, it, vi } from "vitest";

import { saveVerificationOutForBuild } from "./build-orchestrator";

/**
 * The orchestrator saved verificationOut without a buildId. With more than one
 * open build the tool refuses to guess (BI-F82915D7), and the refusal was
 * ignored: on the live install (128 open builds) no build since 2026-09-15
 * kept a typecheck verdict, so evidence auto-accept never fired and every
 * build stalled at review->ship.
 */
describe("saveVerificationOutForBuild", () => {
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
