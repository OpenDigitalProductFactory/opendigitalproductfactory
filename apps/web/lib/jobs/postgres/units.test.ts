import { describe, expect, it, vi } from "vitest";

import { durationMs, positiveIntFromEnv, retryBackoffMs } from "./durations";
import { evaluateCondition, evaluateKey, UnsupportedExpressionError } from "./expressions";
import { lanesFor } from "./lanes";
import { isPostgresFunction, registeredFunction, resetPostgresRegistry } from "./registry";
import { createRoutingJobsClient, inngestStillServes, readJobsEngineSelection, routesToPostgres } from "../routing";
import type { JobsClient } from "../types";

describe("expressions (the subset the facade uses)", () => {
  const event = { name: "build/run", data: { buildId: "B-1", n: 3 } };

  it("evaluates paths and quoted constants as concurrency keys", () => {
    expect(evaluateKey("event.data.buildId", { event })).toBe("B-1");
    expect(evaluateKey("'dpf-build-pipeline'", { event })).toBe("dpf-build-pipeline");
    expect(evaluateKey("event.data.missing", { event })).toBe("");
  });

  it("evaluates == comparisons joined by &&", () => {
    const async = { data: { runId: "R-1", workItemId: "W-9", buildId: "B-1" } };
    expect(evaluateCondition(`async.data.runId == "R-1"`, { event, async })).toBe(true);
    expect(evaluateCondition(`async.data.runId == "R-2"`, { event, async })).toBe(false);
    expect(evaluateCondition(`event.data.buildId == async.data.buildId && async.data.workItemId == 'W-9'`, { event, async })).toBe(true);
    expect(evaluateCondition(`event.data.n == 3`, { event, async })).toBe(true);
  });

  it("refuses anything outside the subset instead of guessing", () => {
    for (const bad of ["event.data.x != 1", "event.data.x > 1", "size(event.data.list)", "ctx.data.x == 1"]) {
      expect(() => evaluateCondition(bad, { event })).toThrow(UnsupportedExpressionError);
    }
    expect(() => evaluateKey("event.data.x + 1", { event })).toThrow(UnsupportedExpressionError);
  });
});

describe("durations", () => {
  it("accepts milliseconds and Inngest's duration strings", () => {
    expect(durationMs(1_500)).toBe(1_500);
    expect(durationMs("10s")).toBe(10_000);
    expect(durationMs("30m")).toBe(1_800_000);
    expect(durationMs("2h")).toBe(7_200_000);
    expect(durationMs("1h30m")).toBe(5_400_000);
    expect(durationMs("1d")).toBe(86_400_000);
    expect(() => durationMs("soon")).toThrow();
    expect(() => durationMs("10 sec")).toThrow();
  });

  it("backs off exponentially from 10 s, capped at 10 min", () => {
    expect(retryBackoffMs(1)).toBe(10_000);
    expect(retryBackoffMs(2)).toBe(20_000);
    expect(retryBackoffMs(20)).toBe(600_000);
  });

  it("reads a sizing variable, falling back when compose passes it blank", () => {
    expect(positiveIntFromEnv(undefined, 8)).toBe(8);
    expect(positiveIntFromEnv("", 8)).toBe(8);
    expect(positiveIntFromEnv("0", 8)).toBe(8);
    expect(positiveIntFromEnv("abc", 8)).toBe(8);
    expect(positiveIntFromEnv(" 12 ", 8)).toBe(12);
  });
});

describe("concurrency lanes", () => {
  const event = { data: { buildId: "B-1" } };

  it("gives a function-scoped constraint its own lane per key value", () => {
    expect(lanesFor("f", { limit: 1, scope: "fn" }, event)).toEqual([{ key: "fn:f:", limit: 1 }]);
    expect(lanesFor("f", [{ key: "event.data.buildId", limit: 2 }], event)).toEqual([{ key: "fn:f:B-1", limit: 2 }]);
  });

  it("shares an account lane across functions and sorts lanes for lock order", () => {
    const lanes = lanesFor("g", [{ limit: 4 }, { scope: "account", key: "'dpf-build-pipeline'", limit: 3 }], event);
    expect(lanes).toEqual([{ key: "account:dpf-build-pipeline", limit: 3 }, { key: "fn:g:", limit: 4 }]);
    expect(lanesFor("h", [{ limit: 1 }, { scope: "account", key: "'dpf-build-pipeline'", limit: 3 }], event)[0]!.key)
      .toBe("account:dpf-build-pipeline");
  });

  it("has no lanes without a concurrency option and refuses a bad limit", () => {
    expect(lanesFor("f", undefined, event)).toEqual([]);
    expect(() => lanesFor("f", { limit: 0 }, event)).toThrow();
  });
});

describe("engine selection", () => {
  it("defaults to Inngest and parses the Postgres routing", () => {
    expect(readJobsEngineSelection({})).toEqual({ engine: "inngest" });
    expect(readJobsEngineSelection({ DPF_JOBS_ENGINE: " Inngest " })).toEqual({ engine: "inngest" });
    expect(readJobsEngineSelection({ DPF_JOBS_ENGINE: "postgres" })).toEqual({ engine: "postgres", functions: null });
    const narrowed = readJobsEngineSelection({ DPF_JOBS_ENGINE: "postgres", DPF_JOBS_POSTGRES_FUNCTIONS: "a, b ,," });
    expect(narrowed).toEqual({ engine: "postgres", functions: new Set(["a", "b"]) });
    expect(routesToPostgres(narrowed, "a")).toBe(true);
    expect(routesToPostgres(narrowed, "c")).toBe(false);
    expect(inngestStillServes(narrowed)).toBe(true);
    expect(inngestStillServes({ engine: "postgres", functions: null })).toBe(false);
    expect(() => readJobsEngineSelection({ DPF_JOBS_ENGINE: "redis" })).toThrow();
  });

  it("with the flag off, the facade IS the Inngest client (AC-M3-FLAG-OFF)", () => {
    const inngest = { createFunction: vi.fn(), send: vi.fn() } as unknown as JobsClient;
    const sendToPostgres = vi.fn();
    expect(createRoutingJobsClient({ engine: "inngest" }, inngest, sendToPostgres)).toBe(inngest);
    expect(sendToPostgres).not.toHaveBeenCalled();
  });

  it("routes registration per function and sends to both engines while Inngest still serves", async () => {
    resetPostgresRegistry();
    const inngestFn = { id: () => "on-inngest" };
    const inngest = {
      createFunction: vi.fn(() => inngestFn),
      send: vi.fn(async () => ({ ids: [] })),
    } as unknown as JobsClient;
    const sendToPostgres = vi.fn(async (events: Array<{ id: string }>) => events.map((e) => e.id));
    const client = createRoutingJobsClient({ engine: "postgres", functions: new Set(["on-pg"]) }, inngest, sendToPostgres);

    const pg = client.createFunction({ id: "on-pg", triggers: [{ event: "x/run" }] }, async () => null);
    const ing = client.createFunction({ id: "on-inngest", triggers: [{ event: "x/run" }] }, async () => null);
    expect(isPostgresFunction(pg)).toBe(true);
    expect(isPostgresFunction(ing)).toBe(false);
    expect(registeredFunction("on-pg")?.eventNames).toEqual(["x/run"]);

    const result = await client.send({ name: "x/run", data: { a: 1 } });
    expect(result.ids).toHaveLength(1);
    expect(sendToPostgres).toHaveBeenCalledWith([{ name: "x/run", data: { a: 1 }, id: result.ids[0] }]);
    expect(inngest.send).toHaveBeenCalledWith([{ name: "x/run", data: { a: 1 }, id: result.ids[0] }]);

    const allPg = createRoutingJobsClient({ engine: "postgres", functions: null }, inngest, sendToPostgres);
    vi.mocked(inngest.send).mockClear();
    await allPg.send([{ id: "dedupe-1", name: "x/run" }]);
    expect(inngest.send).not.toHaveBeenCalled();
  });

  it("refuses at registration a concurrency key the engine could not evaluate", () => {
    const client = createRoutingJobsClient({ engine: "postgres", functions: null }, {} as JobsClient, vi.fn());
    expect(() => client.createFunction(
      { id: "bad", triggers: [{ event: "x" }], concurrency: { limit: 1, key: "event.data.a + 1" } },
      async () => null,
    )).toThrow(UnsupportedExpressionError);
  });
});
