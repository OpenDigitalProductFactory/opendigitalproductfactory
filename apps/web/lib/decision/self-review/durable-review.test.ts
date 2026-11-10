import { describe, expect, it, vi } from "vitest";
import { runFrozenReview } from "./durable-review";
vi.mock("@dpf/db", () => ({ prisma: {} }));

function fixture() {
  const artifacts = new Map<string, unknown>();
  const run = { cutoff: "2026-11-02T06:00:00.000Z", completed: false };
  const effects = vi.fn(async (line: { key: string }) => ({ destination: line.key }));
  const store = {
    read: async (key: string) => artifacts.get(key),
    write: async (key: string, value: unknown) => { artifacts.set(key, value); },
    complete: async () => { run.completed = true; },
  };
  return { artifacts, run, effects, store };
}
describe("frozen review recovery", () => {
  it("replays a completed result without measuring or routing again", async () => {
    const f = fixture();
    const measure = vi.fn(async () => [{ key: "a" }]);
    const first = await runFrozenReview(f.store, measure, f.effects);
    const second = await runFrozenReview(f.store, measure, f.effects);
    expect(second).toEqual(first);
    expect(measure).toHaveBeenCalledTimes(1);
    expect(f.effects).toHaveBeenCalledTimes(1);
  });
  it("retains the frozen measurement and persists intent before an uncertain effect", async () => {
    const f = fixture();
    const measure = vi.fn(async () => [{ key: "a" }]);
    await expect(runFrozenReview(f.store, measure, async () => { throw new Error("lost acknowledgement"); })).rejects.toThrow();
    expect(f.artifacts.has("measurement")).toBe(true);
    expect(f.artifacts.has("intent:a")).toBe(true);
    expect(f.artifacts.has("result")).toBe(false);
    expect(f.run.completed).toBe(false);
    await expect(runFrozenReview(f.store, measure, f.effects)).rejects.toThrow(/reconciliation/i);
    expect(f.effects).not.toHaveBeenCalled();
    expect(measure).toHaveBeenCalledTimes(1);
  });
  it("recovers an observed destination without repeating its effect", async () => {
    const f = fixture();
    const measure = vi.fn(async () => [{ key: "a" }]);
    await expect(runFrozenReview(f.store, measure, async () => { throw new Error("ack lost"); })).rejects.toThrow();
    const recovered = await runFrozenReview(f.store, measure, f.effects, {
      reconcile: async () => ({ destination: "observed-a" }),
    });
    expect(recovered.routing).toEqual([{ destination: "observed-a" }]);
    expect(f.effects).not.toHaveBeenCalled();
    expect(f.run.completed).toBe(true);
  });
  it("does not claim an effect when preparing its destination fails", async () => {
    const f = fixture();
    const measure = async () => [{ key: "a" }];
    await expect(runFrozenReview(f.store, measure, f.effects, {
      prepare: async () => { throw new Error("facts unavailable"); },
    })).rejects.toThrow("facts unavailable");
    expect(f.artifacts.has("intent:a")).toBe(false);
    await runFrozenReview(f.store, measure, f.effects);
    expect(f.effects).toHaveBeenCalledTimes(1);
  });

});
