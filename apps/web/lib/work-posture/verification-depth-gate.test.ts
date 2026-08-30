import { describe, expect, it, vi } from "vitest";

import { checkBuildPhaseGate, type VerificationDepthShadowRecord } from "./verification-depth-gate";

describe("checkBuildPhaseGate", () => {
  const evidence = {
    designDoc: { problemStatement: "x" },
    buildPlan: { tasks: [] },
    acceptanceMet: true,
    verificationOut: { typecheckPassed: true, testsFailed: 2 },
    uxVerificationStatus: "failed",
  };

  it("records a newly-blocking shadow decision without changing the actual verdict", async () => {
    const records: VerificationDepthShadowRecord[] = [];
    const result = await checkBuildPhaseGate({
      buildId: "FB-1",
      from: "review",
      to: "ship",
      evidence,
    }, {
      resolveDepth: async () => "shallow",
      record: async (record) => { records.push(record); },
    });

    expect(result).toEqual({ allowed: true });
    expect(records).toEqual([expect.objectContaining({
      buildId: "FB-1",
      transition: "review->ship",
      declaredDepth: "shallow",
      actualAllowed: true,
      wouldBlock: true,
      wouldNewlyBlock: true,
    })]);
  });

  it("records absent depth as none and preserves today's verdict exactly", async () => {
    const record = vi.fn(async (_decision: VerificationDepthShadowRecord) => undefined);
    const result = await checkBuildPhaseGate({
      buildId: "FB-2",
      from: "review",
      to: "ship",
      evidence,
    }, { resolveDepth: async () => undefined, record });

    expect(result).toEqual({ allowed: true });
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      declaredDepth: "none",
      wouldBlock: false,
      wouldNewlyBlock: false,
    }));
  });

  it("passes the existing rightsizing evidence into posture depth resolution", async () => {
    const resolveDepth = vi.fn(async (
      _buildId: string,
      gateEvidence: Record<string, unknown>,
    ) => gateEvidence.qualityFirst === true && gateEvidence.deliverableSensitivity === "high"
      ? "deep" as const
      : undefined);
    const record = vi.fn(async (_decision: VerificationDepthShadowRecord) => undefined);

    await checkBuildPhaseGate({
      buildId: "FB-RIGHTSIZED",
      from: "review",
      to: "ship",
      evidence: { ...evidence, qualityFirst: true, deliverableSensitivity: "high" },
    }, { resolveDepth, record });

    expect(resolveDepth).toHaveBeenCalledWith("FB-RIGHTSIZED", expect.objectContaining({
      qualityFirst: true,
      deliverableSensitivity: "high",
    }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({
      declaredDepth: "deep",
    }));
  });

  it("fails open when posture resolution or shadow recording is unavailable", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = await checkBuildPhaseGate({
      buildId: "FB-3",
      from: "review",
      to: "ship",
      evidence,
    }, {
      resolveDepth: async () => { throw new Error("posture unavailable"); },
      record: async () => { throw new Error("ledger unavailable"); },
    });

    expect(result).toEqual({ allowed: true });
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
