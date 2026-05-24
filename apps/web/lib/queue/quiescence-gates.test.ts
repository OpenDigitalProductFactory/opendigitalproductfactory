/**
 * Tests for the Inngest quiescence gate helpers (BI-QUIESCE-004a + 004b).
 *
 * Pure-logic tests with a fake step runner — no Inngest framework needed.
 * Confirms the gate returns the documented shape for each level and that
 * step.waitForEvent is invoked for the between-steps variant.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  gateAtEntry,
  gateBetweenSteps,
  type GateBetweenStepsRunner,
} from "./quiescence-gates";

// Mock the dynamic import of @/lib/self-upgrade/quiescence so each test can
// pin the returned level deterministically.
vi.mock("@/lib/self-upgrade/quiescence", () => {
  return {
    getQuiescenceLevel: vi.fn(),
  };
});

import { getQuiescenceLevel } from "@/lib/self-upgrade/quiescence";

beforeEach(() => {
  vi.mocked(getQuiescenceLevel).mockReset();
});

type FakeStep = GateBetweenStepsRunner & {
  run: ReturnType<typeof vi.fn>;
  waitForEvent: ReturnType<typeof vi.fn>;
};

function makeFakeStep(): FakeStep {
  const step = {
    run: vi.fn(async (_name: string, fn: () => unknown) => fn()),
    waitForEvent: vi.fn(),
  };
  return step as unknown as FakeStep;
}

describe("gateAtEntry", () => {
  it("returns { proceed: true } when level is normal", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("normal");
    const step = makeFakeStep();
    const result = await gateAtEntry(step);
    expect(result).toEqual({ proceed: true });
    expect(step.run).toHaveBeenCalledTimes(1);
    expect(step.run.mock.calls[0][0]).toBe("quiescence-gate-at-entry");
  });

  it("returns { proceed: false, skipped: true, reason } when draining", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("draining");
    const step = makeFakeStep();
    const result = await gateAtEntry(step);
    expect(result.proceed).toBe(false);
    if (!result.proceed) {
      expect(result.skipped).toBe(true);
      expect(result.reason).toBe("quiescing(draining)");
    }
  });

  it("returns the same shape for swapping (callable contract)", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("swapping");
    const step = makeFakeStep();
    const result = await gateAtEntry(step);
    expect(result.proceed).toBe(false);
    if (!result.proceed) {
      expect(result.reason).toBe("quiescing(swapping)");
    }
  });

  it("wraps the level check in step.run for Inngest checkpointing", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("normal");
    const step = makeFakeStep();
    await gateAtEntry(step);
    // Sole step.run call uses the documented step name; the fn it received
    // is what reads the level (test simply ensures the wrapping happens).
    expect(step.run).toHaveBeenCalledTimes(1);
    expect(step.run.mock.calls[0][0]).toBe("quiescence-gate-at-entry");
  });
});

describe("gateBetweenSteps", () => {
  it("returns immediately with no wait when level is normal", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("normal");
    const step = makeFakeStep();
    const result = await gateBetweenSteps(step, "after-snapshot");
    expect(result.resumedAfterWait).toBe(false);
    expect(step.waitForEvent).not.toHaveBeenCalled();
  });

  it("suspends via step.waitForEvent when level is draining", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("draining");
    const step = makeFakeStep();
    step.waitForEvent.mockResolvedValue({ data: { outcome: "succeeded" } });
    const result = await gateBetweenSteps(step, "between-branches");
    expect(step.waitForEvent).toHaveBeenCalledTimes(1);
    const [waitName, opts] = step.waitForEvent.mock.calls[0];
    expect(waitName).toBe("await-quiescence-cleared-between-branches");
    expect(opts.event).toBe("platform.quiescence-cleared");
    expect(opts.timeout).toBe("30m");
    expect(result.resumedAfterWait).toBe(true);
  });

  it("suspends for swapping level too", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("swapping");
    const step = makeFakeStep();
    step.waitForEvent.mockResolvedValue({ data: { outcome: "succeeded" } });
    await gateBetweenSteps(step, "after-step");
    expect(step.waitForEvent).toHaveBeenCalledTimes(1);
  });

  it("returns timed-out reason when waitForEvent returns null", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("draining");
    const step = makeFakeStep();
    step.waitForEvent.mockResolvedValue(null);
    const result = await gateBetweenSteps(step, "after-step");
    expect(result.resumedAfterWait).toBe(false);
    expect(result.reason).toBe("timed-out-waiting-for-cleared");
  });

  it("uses unique step labels per call site (avoids Inngest step-id collision)", async () => {
    vi.mocked(getQuiescenceLevel).mockResolvedValue("draining");
    const step = makeFakeStep();
    step.waitForEvent.mockResolvedValue({ data: { outcome: "succeeded" } });
    await gateBetweenSteps(step, "branch-1");
    await gateBetweenSteps(step, "branch-2");
    expect(step.run.mock.calls.map((c) => c[0])).toEqual([
      "quiescence-gate-branch-1",
      "quiescence-gate-branch-2",
    ]);
    expect(step.waitForEvent.mock.calls.map((c) => c[0])).toEqual([
      "await-quiescence-cleared-branch-1",
      "await-quiescence-cleared-branch-2",
    ]);
  });
});
