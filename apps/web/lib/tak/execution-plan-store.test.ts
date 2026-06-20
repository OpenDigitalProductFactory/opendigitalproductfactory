import { beforeEach, describe, expect, it, vi } from "vitest";

const update = vi.fn();
const findUnique = vi.fn();

vi.mock("@dpf/db", () => ({
  prisma: {
    agentThread: {
      update: (...a: unknown[]) => update(...a),
      findUnique: (...a: unknown[]) => findUnique(...a),
    },
  },
  Prisma: { DbNull: { __dbnull: true } },
}));

import {
  parseStoredExecutionPlan,
  persistExecutionPlan,
  loadExecutionPlan,
} from "./execution-plan-store";

const PLAN = {
  goal: "Ship the feature",
  steps: [
    { id: "s1", description: "design", status: "done" },
    { id: "s2", description: "build", status: "in_progress" },
  ],
  createdAtIteration: 1,
  updatedAtIteration: 3,
};

beforeEach(() => {
  update.mockReset();
  findUnique.mockReset();
});

describe("parseStoredExecutionPlan", () => {
  it("round-trips a serialized plan losslessly", () => {
    expect(parseStoredExecutionPlan(JSON.parse(JSON.stringify(PLAN)))).toEqual(PLAN);
  });

  it("rejects malformed input -> null", () => {
    expect(parseStoredExecutionPlan(null)).toBeNull();
    expect(parseStoredExecutionPlan("nope")).toBeNull();
    expect(parseStoredExecutionPlan({ goal: "g" })).toBeNull(); // no steps
    expect(parseStoredExecutionPlan({ goal: "g", steps: "x" })).toBeNull();
    expect(
      parseStoredExecutionPlan({ goal: "g", steps: [{ id: "1", description: "d", status: "bogus" }] }),
    ).toBeNull();
    expect(parseStoredExecutionPlan({ goal: "g", steps: [{ id: "1", status: "done" }] })).toBeNull(); // no description
  });

  it("defaults missing iteration counters", () => {
    expect(parseStoredExecutionPlan({ goal: "g", steps: [] })).toEqual({
      goal: "g",
      steps: [],
      createdAtIteration: 0,
      updatedAtIteration: 0,
    });
  });
});

describe("persistExecutionPlan", () => {
  it("writes the serialized plan to the thread", async () => {
    update.mockResolvedValue({});
    await persistExecutionPlan("thread-1", PLAN as never);
    expect(update).toHaveBeenCalledTimes(1);
    const arg = update.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "thread-1" });
    expect(arg.data.executionPlan).toEqual(PLAN);
  });

  it("is best-effort: a DB error is swallowed (never throws)", async () => {
    update.mockRejectedValue(new Error("db down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(persistExecutionPlan("t", PLAN as never)).resolves.toBeUndefined();
    warnSpy.mockRestore();
  });
});

describe("loadExecutionPlan", () => {
  it("returns the parsed plan from the thread", async () => {
    findUnique.mockResolvedValue({ executionPlan: JSON.parse(JSON.stringify(PLAN)) });
    expect(await loadExecutionPlan("t")).toEqual(PLAN);
  });

  it("returns null on no-plan / garbage / error (resume falls back to re-planning)", async () => {
    findUnique.mockResolvedValue({ executionPlan: null });
    expect(await loadExecutionPlan("t")).toBeNull();
    findUnique.mockResolvedValue({ executionPlan: { bad: true } });
    expect(await loadExecutionPlan("t")).toBeNull();
    findUnique.mockRejectedValue(new Error("x"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await loadExecutionPlan("t")).toBeNull();
    warnSpy.mockRestore();
  });
});
