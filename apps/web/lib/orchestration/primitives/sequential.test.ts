// apps/web/lib/orchestration/primitives/sequential.test.ts

import { describe, expect, it, vi } from "vitest";
import { Sequential } from "./sequential";
import type { Outcome, RunContext } from "../types";

const ctx: RunContext = {
  runId: "test-run",
  userId: "u1",
  governanceProfile: "balanced",
};

const ok = <T>(value: T): Outcome<T> => ({
  status: "succeeded",
  value,
  evidence: [
    {
      attemptNumber: 0,
      startedAt: "2026-04-29T00:00:00Z",
      endedAt: "2026-04-29T00:00:01Z",
      summary: "ok",
      outcome: "succeeded",
    },
  ],
});

const fail = (message: string): Outcome<never> => ({
  status: "failed",
  error: { name: "TestError", message },
  evidence: [],
});

const exhausted = (): Outcome<never> => ({
  status: "exhausted",
  reason: "max_attempts",
  evidence: [],
  attempts: 3,
});

const cancelled = (): Outcome<never> => ({
  status: "cancelled",
  reason: "user_cancelled",
  evidence: [],
  attempts: 1,
});

describe("Sequential", () => {
  it("all-succeed: returns Outcome.succeeded with array of values, evidence per step", async () => {
    const s1 = vi.fn(async () => ok("a"));
    const s2 = vi.fn(async () => ok("b"));
    const s3 = vi.fn(async () => ok("c"));

    const result = await Sequential([s1, s2, s3], ctx);

    expect(result.status).toBe("succeeded");
    if (result.status === "succeeded") {
      expect(result.value).toEqual(["a", "b", "c"]);
      expect(result.evidence).toHaveLength(3);
    }
    expect(s1).toHaveBeenCalledTimes(1);
    expect(s2).toHaveBeenCalledTimes(1);
    expect(s3).toHaveBeenCalledTimes(1);
  });

  it("first-fails: short-circuits, returns the failure unchanged, remaining steps not invoked", async () => {
    const s1 = vi.fn(async () => ok("a"));
    const s2 = vi.fn(async () => fail("boom"));
    const s3 = vi.fn(async () => ok("c"));

    const result = await Sequential([s1, s2, s3], ctx);

    expect(result.status).toBe("failed");
    expect(s1).toHaveBeenCalledTimes(1);
    expect(s2).toHaveBeenCalledTimes(1);
    expect(s3).not.toHaveBeenCalled();
  });

  it("first-exhausts: short-circuits, returns the exhaustion unchanged", async () => {
    const s1 = vi.fn(async () => exhausted());
    const s2 = vi.fn(async () => ok("b"));

    const result = await Sequential([s1, s2], ctx);

    expect(result.status).toBe("exhausted");
    expect(s2).not.toHaveBeenCalled();
  });

  it("first-cancelled: short-circuits with cancelled", async () => {
    const s1 = vi.fn(async () => cancelled());
    const s2 = vi.fn(async () => ok("b"));

    const result = await Sequential([s1, s2], ctx);

    expect(result.status).toBe("cancelled");
    expect(s2).not.toHaveBeenCalled();
  });
});
