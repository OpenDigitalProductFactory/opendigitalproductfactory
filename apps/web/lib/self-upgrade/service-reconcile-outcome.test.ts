import { describe, expect, it, vi } from "vitest";
import {
  attachServiceReconcileOutcome,
  parseServiceReconcileOutcome,
  serviceReconcileFromEvidence,
  type ServiceReconcileOutcome,
} from "./service-reconcile-outcome";

// BI-5ACBAC50: promote.sh step 7d writes what it created and what it could not
// to the state mount, because its stderr dies with the promoter and the portal
// has already marked the run succeeded at boot. These pin how that file becomes
// the run's evidence.

const TARGET = "7dacb4519a3b6cc9a481b1709dfad56b9c3ca671";

const degraded: ServiceReconcileOutcome = {
  targetSha: TARGET,
  at: "2026-10-02T17:00:55.000Z",
  outcome: "degraded",
  required: ["portal", "prometheus", "dpf-tts"],
  created: ["prometheus"],
  failed: ["dpf-tts"],
};

describe("parseServiceReconcileOutcome", () => {
  it("parses the file promote.sh writes", () => {
    expect(parseServiceReconcileOutcome(JSON.stringify(degraded))).toEqual(degraded);
  });

  it("returns null for an absent, torn or foreign file rather than throwing", () => {
    expect(parseServiceReconcileOutcome(null)).toBeNull();
    expect(parseServiceReconcileOutcome('{"targetSha":"abc","outc')).toBeNull();
    expect(parseServiceReconcileOutcome(JSON.stringify({ ...degraded, outcome: "fine" }))).toBeNull();
    expect(parseServiceReconcileOutcome(JSON.stringify({ ...degraded, failed: "dpf-tts" }))).toBeNull();
  });
});

describe("serviceReconcileFromEvidence", () => {
  it("reads the outcome back off a run's completionEvidence", () => {
    expect(serviceReconcileFromEvidence({ readiness: {}, serviceReconcile: degraded })).toEqual(degraded);
    expect(serviceReconcileFromEvidence({ readiness: {} })).toBeNull();
    expect(serviceReconcileFromEvidence(null)).toBeNull();
  });
});

describe("attachServiceReconcileOutcome", () => {
  const run = {
    runId: "SUR-AC15769C",
    targetSha: TARGET,
    deployedSha: TARGET,
    completionEvidence: { readiness: { result: "ready" } },
  };

  it("records a degraded outcome on the run that promoted that target", async () => {
    const record = vi.fn().mockResolvedValue(undefined);
    const findRun = vi.fn().mockResolvedValue(run);
    const result = await attachServiceReconcileOutcome({
      readOutcome: async () => JSON.stringify(degraded),
      findRun,
      record,
    });
    expect(findRun).toHaveBeenCalledWith(TARGET);
    expect(record).toHaveBeenCalledWith("SUR-AC15769C", degraded);
    expect(result).toEqual({ runId: "SUR-AC15769C", outcome: "degraded" });
  });

  it("does not rewrite a run that already carries this exact outcome", async () => {
    const record = vi.fn();
    const result = await attachServiceReconcileOutcome({
      readOutcome: async () => JSON.stringify(degraded),
      findRun: async () => ({ ...run, completionEvidence: { serviceReconcile: degraded } }),
      record,
    });
    expect(record).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it("does nothing when there is no outcome file or no matching run", async () => {
    const record = vi.fn();
    expect(await attachServiceReconcileOutcome({ readOutcome: async () => null, findRun: vi.fn(), record })).toBeNull();
    expect(
      await attachServiceReconcileOutcome({
        readOutcome: async () => JSON.stringify(degraded),
        findRun: async () => null,
        record,
      }),
    ).toBeNull();
    expect(record).not.toHaveBeenCalled();
  });
});
