import { describe, expect, it, vi } from "vitest";

import { resolveRecoveryPredecessor } from "@/lib/self-upgrade/recovery-predecessor";

const SHA = "d2f76addcafe0000000000000000000000000000";

/** A dispatched run that then died — SUR-E18E0141's shape. */
function dispatchedFailure(overrides: Record<string, unknown> = {}) {
  return {
    runId: "SUR-E18E0141",
    status: "failed",
    completedAt: new Date("2026-09-06T23:10:00Z"),
    admissionFingerprint: "fp-1",
    dispatchStatus: "acknowledged",
    targetSha: SHA,
    targetTag: "v2026.09.06-readiness-doc-closeout.1",
    dispatchAttemptCount: 1,
    dispatchAcknowledgedAt: new Date("2026-09-06T23:05:00Z"),
    dispatchEventIds: ["evt-1"],
    completionEvidence: null as unknown,
    ...overrides,
  };
}

/** A never-dispatched failure — the one shape that IS a typed predecessor. */
function neverDispatched(overrides: Record<string, unknown> = {}) {
  return dispatchedFailure({
    runId: "SUR-6B312E24",
    dispatchStatus: "pending",
    dispatchAttemptCount: 0,
    dispatchAcknowledgedAt: null,
    dispatchEventIds: [],
    ...overrides,
  });
}

function trail(step: string, targetSha = SHA) {
  return `2026-09-06T23:06:00Z\treal\t${step}\t${targetSha}`;
}

const silent = () => {};

describe("resolveRecoveryPredecessor — eligibility is unchanged", () => {
  it("still returns no typed predecessor for a dispatched failure", async () => {
    // AC-SUA-015: a dispatched failure admits a FRESH run with no
    // recoveryOfRunId. Returning it here would make the operator's next
    // "Upgrade now" click fail with recovery-binding-required instead.
    const resolved = await resolveRecoveryPredecessor(dispatchedFailure(), {
      readTrail: async () => trail("docker-build"),
      persist: vi.fn().mockResolvedValue(undefined),
      log: silent,
    });
    expect(resolved).toBeNull();
  });

  it("still returns a never-dispatched failure as the typed predecessor", async () => {
    // AC-SUA-016: typed recovery is preserved for the never-dispatched lane.
    const run = neverDispatched();
    const readTrail = vi.fn();
    expect(await resolveRecoveryPredecessor(run, { readTrail, log: silent })).toBe(run);
    // It needs no trail: its own dispatch record already proves the install
    // was untouched. This path must not acquire a filesystem dependency.
    expect(readTrail).not.toHaveBeenCalled();
  });

  it("returns null for no run at all", async () => {
    expect(await resolveRecoveryPredecessor(null)).toBeNull();
  });
});

describe("resolveRecoveryPredecessor — interruption is recorded", () => {
  it("records that the swap provably never started", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    await resolveRecoveryPredecessor(dispatchedFailure(), {
      readTrail: async () => [trail("prepare"), trail("docker-build")].join("\n"),
      persist,
      log: silent,
    });
    expect(persist).toHaveBeenCalledWith(
      "SUR-E18E0141",
      expect.objectContaining({
        swapApplied: false,
        lastStep: "docker-build",
        lastStepAt: "2026-09-06T23:06:00Z",
        basis: "pre-swap-step",
      }),
    );
  });

  it("records an inconclusive verdict rather than nothing", async () => {
    // "We looked and could not tell" is the answer an operator needs; the
    // absence of exactly this record is what left SUR-E18E0141 unexplainable.
    const persist = vi.fn().mockResolvedValue(undefined);
    await resolveRecoveryPredecessor(dispatchedFailure(), {
      readTrail: async () => null,
      persist,
      log: silent,
    });
    expect(persist).toHaveBeenCalledWith(
      "SUR-E18E0141",
      expect.objectContaining({ swapApplied: null, basis: "no-trail" }),
    );
  });

  it("records that the trail reached the swap, so nothing is provable", async () => {
    const persist = vi.fn().mockResolvedValue(undefined);
    await resolveRecoveryPredecessor(dispatchedFailure(), {
      readTrail: async () => trail("docker-up"),
      persist,
      log: silent,
    });
    expect(persist).toHaveBeenCalledWith(
      "SUR-E18E0141",
      expect.objectContaining({ swapApplied: null, basis: "step-at-or-past-swap" }),
    );
  });

  it("logs the verdict so it is visible without a database read", async () => {
    const log = vi.fn();
    await resolveRecoveryPredecessor(dispatchedFailure(), {
      readTrail: async () => trail("backup"),
      persist: vi.fn().mockResolvedValue(undefined),
      log,
    });
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("interruption-classified: SUR-E18E0141 swapApplied=false"),
    );
  });

  it("does not re-classify a run that already carries a verdict", async () => {
    // Re-reading could flip a recorded "unknown" to "not applied" after the
    // trail rotated past the entry that justified it.
    const readTrail = vi.fn();
    const persist = vi.fn();
    await resolveRecoveryPredecessor(
      dispatchedFailure({ completionEvidence: { interruption: { swapApplied: null } } }),
      { readTrail, persist, log: silent },
    );
    expect(readTrail).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("preserves evidence recorded by anything else on the run", async () => {
    // completionEvidence is shared with recordRunRecoveryPoint and the
    // readiness report; classification must never clobber them.
    const persist = vi.fn().mockResolvedValue(undefined);
    await resolveRecoveryPredecessor(
      dispatchedFailure({ completionEvidence: { recoveryPoint: { step: "backup" } } }),
      { readTrail: async () => trail("prepare"), persist, log: silent },
    );
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a still-running run", { status: "running", completedAt: null }],
    ["a failure with no completedAt", { completedAt: null }],
    ["a run with no target SHA", { targetSha: null }],
    ["a never-dispatched failure", {
      dispatchAttemptCount: 0,
      dispatchAcknowledgedAt: null,
      dispatchEventIds: [],
    }],
  ])("never classifies %s", async (_label, overrides) => {
    const readTrail = vi.fn();
    const persist = vi.fn();
    await resolveRecoveryPredecessor(dispatchedFailure(overrides), {
      readTrail,
      persist,
      log: silent,
    });
    expect(readTrail).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });
});

describe("resolveRecoveryPredecessor — the post-mortem never blocks an upgrade", () => {
  it("still resolves when reading the trail throws", async () => {
    const run = neverDispatched({ completionEvidence: null });
    const resolved = await resolveRecoveryPredecessor(
      { ...run, dispatchAttemptCount: 1, dispatchEventIds: ["evt-1"] },
      {
        readTrail: async () => {
          throw new Error("EACCES: permission denied");
        },
        log: silent,
      },
    );
    expect(resolved).toBeNull();
  });

  it("still resolves the typed predecessor when persisting throws", async () => {
    const run = dispatchedFailure();
    const log = vi.fn();
    await expect(
      resolveRecoveryPredecessor(run, {
        readTrail: async () => trail("prepare"),
        persist: async () => {
          throw new Error("database is starting up");
        },
        log,
      }),
    ).resolves.toBeNull();
    expect(log).toHaveBeenCalledWith(
      expect.stringContaining("interruption-classify-failed: SUR-E18E0141 database is starting up"),
    );
  });
});
