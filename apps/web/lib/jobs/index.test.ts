import { describe, expect, expectTypeOf, it, vi } from "vitest";

vi.mock("@/lib/network/off-threadpool-fetch", () => ({
  createOffThreadpoolFetchTransport: () => ({ close: vi.fn(), fetch: vi.fn() }),
}));

import {
  cron,
  jobs,
  type JobCronEvent,
  type JobFunction,
  type JobReceivedEvent,
  type JobStepTools,
} from "./index";
import { inngestClient } from "./inngest-adapter";
import { cron as cronFromTriggers } from "./triggers";

// ─── Runtime: the Inngest adapter is a pass-through ─────────────────────

describe("jobs facade over the Inngest adapter", () => {
  it("hands the same options and handler objects to Inngest's createFunction", () => {
    const sentinel = { sentinel: true };
    const spy = vi
      .spyOn(inngestClient, "createFunction")
      .mockReturnValue(sentinel as never);
    const options = {
      id: "test/facade-pass-through",
      retries: 2 as const,
      concurrency: [{ key: "event.data.buildId", limit: 1 }] as const,
      cancelOn: [{ event: "test/cancel", match: "data.buildId" }],
      triggers: [{ event: "test/run" }],
    };
    const handler = async () => "done";

    const fn = jobs.createFunction(options, handler);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(options);
    expect(spy.mock.calls[0]![1]).toBe(handler);
    expect(fn).toBe(sentinel);
    spy.mockRestore();
  });

  it("registers a real Inngest function with the facade's id and cron trigger", () => {
    const fn = jobs.createFunction(
      { id: "test/facade-real", retries: 1, triggers: [cron("5 4 * * *")] },
      async () => null,
    );
    expect(fn.id()).toBe("test/facade-real");
  });

  it("sends events through Inngest's send unchanged, dedupe id included", async () => {
    const spy = vi
      .spyOn(inngestClient, "send")
      .mockResolvedValue({ ids: ["evt-1"] } as never);
    const payload = { id: "dedupe-1", name: "test/run", data: { buildId: "B-1" } };

    await expect(jobs.send(payload)).resolves.toEqual({ ids: ["evt-1"] });
    expect(spy).toHaveBeenCalledWith(payload);
    expect(spy.mock.calls[0]![0]).toBe(payload);
    spy.mockRestore();
  });

  it("builds cron triggers in Inngest's shape", () => {
    expect(cron("0 3 * * 0")).toEqual({ cron: "0 3 * * 0" });
    expect(cron).toBe(cronFromTriggers);
  });
});

// ─── Types: the facade admits only the spec §2 subset ───────────────────
//
// Checked by `pnpm --filter web typecheck:tests`. Never called: every
// `@ts-expect-error` below must stay an error, or the compile fails.

function typeContract() {
  // Accepted: the features in use.
  const accepted: JobFunction = jobs.createFunction(
    {
      id: "types/event",
      retries: 3,
      concurrency: [
        { key: "event.data.buildId", limit: 1 },
        { scope: "account", key: "'lane'", limit: 4 },
      ],
      cancelOn: [{ event: "types/cancel", match: "data.buildId" }],
      onFailure: async ({ event, error }) => {
        expectTypeOf(event.data).toEqualTypeOf<Record<string, any>>(); // eslint-disable-line @typescript-eslint/no-explicit-any
        expectTypeOf(error).toEqualTypeOf<Error>();
      },
      triggers: [{ event: "types/run" }, { event: "types/rerun" }],
    },
    async ({ event, step }) => {
      expectTypeOf(event).toEqualTypeOf<JobReceivedEvent<"types/run" | "types/rerun">>();
      expectTypeOf(step).toEqualTypeOf<JobStepTools>();
      const n = await step.run("count", async () => 1);
      expectTypeOf(n).toEqualTypeOf<number>();
      const d = await step.run("date", () => new Date());
      expectTypeOf(d).toEqualTypeOf<string>();
      const v = await step.run("void", async () => {});
      expectTypeOf(v).toEqualTypeOf<null>();
      await step.sleep("pause", "60s");
      await step.sleepUntil("until", new Date());
      const got = await step.waitForEvent("wait", {
        event: "types/done",
        timeout: "30m",
        if: "async.data.id == event.data.id",
      });
      expectTypeOf(got).toEqualTypeOf<JobReceivedEvent<"types/done"> | null>();
    },
  );

  jobs.createFunction(
    { id: "types/cron", concurrency: { limit: 1, scope: "fn" }, triggers: [cron("* * * * *")] },
    async ({ event }) => {
      expectTypeOf(event).toEqualTypeOf<JobCronEvent>();
      expectTypeOf(event.data.cron).toEqualTypeOf<string>();
    },
  );

  // Rejected: Inngest options outside the contract.
  jobs.createFunction(
    {
      id: "types/throttle",
      triggers: [cron("* * * * *")],
      // @ts-expect-error throttle is not part of the job contract
      throttle: { limit: 1, period: "1m" },
    },
    async () => {},
  );
  jobs.createFunction(
    {
      id: "types/rate-limit",
      triggers: [cron("* * * * *")],
      // @ts-expect-error rateLimit is not part of the job contract
      rateLimit: { limit: 1, period: "1m" },
    },
    async () => {},
  );
  jobs.createFunction(
    {
      id: "types/debounce",
      triggers: [cron("* * * * *")],
      // @ts-expect-error debounce is not part of the job contract
      debounce: { period: "1m" },
    },
    async () => {},
  );
  jobs.createFunction(
    {
      id: "types/batch",
      triggers: [cron("* * * * *")],
      // @ts-expect-error batchEvents is not part of the job contract
      batchEvents: { maxSize: 10, timeout: "1m" },
    },
    async () => {},
  );
  jobs.createFunction(
    {
      id: "types/priority",
      triggers: [cron("* * * * *")],
      // @ts-expect-error priority is not part of the job contract
      priority: { run: "0" },
    },
    async () => {},
  );
  jobs.createFunction(
    {
      id: "types/idempotency",
      triggers: [cron("* * * * *")],
      // @ts-expect-error function-level idempotency is not part of the job contract
      idempotency: "event.data.id",
    },
    async () => {},
  );
  jobs.createFunction(
    {
      id: "types/timeouts",
      triggers: [cron("* * * * *")],
      // @ts-expect-error function timeouts are not part of the job contract
      timeouts: { finish: "1h" },
    },
    async () => {},
  );
  jobs.createFunction(
    {
      id: "types/singleton",
      triggers: [cron("* * * * *")],
      // @ts-expect-error singleton is not part of the job contract
      singleton: { mode: "skip" },
    },
    async () => {},
  );
  jobs.createFunction(
    {
      id: "types/retries",
      // @ts-expect-error retries above 3 are outside the counts in use
      retries: 10,
      triggers: [cron("* * * * *")],
    },
    async () => {},
  );
  jobs.createFunction(
    {
      id: "types/cancel-timeout",
      // @ts-expect-error cancelOn takes an event and a match, nothing else
      cancelOn: [{ event: "types/cancel", match: "data.id", timeout: "1h" }],
      triggers: [{ event: "types/run" }],
    },
    async () => {},
  );
  jobs.createFunction(
    {
      id: "types/trigger-if",
      // @ts-expect-error trigger expressions are not part of the job contract
      triggers: [{ event: "types/run", if: "event.data.x == 1" }],
    },
    async () => {},
  );
  jobs.createFunction(
    {
      id: "types/mixed-triggers",
      // @ts-expect-error one function listens to events or to a schedule, not both
      triggers: [{ event: "types/run" }, cron("* * * * *")],
    },
    async () => {},
  );

  // Rejected: step tools outside the contract.
  jobs.createFunction({ id: "types/steps", triggers: [{ event: "types/run" }] }, async ({ step }) => {
    // @ts-expect-error step.invoke is not part of the job contract
    await step.invoke("call", { function: accepted, data: {} });
    // @ts-expect-error step.sendEvent is not part of the job contract; use jobs.send
    await step.sendEvent("emit", { name: "types/next" });
    // @ts-expect-error step.fetch is not part of the job contract
    await step.fetch("https://example.invalid");
    // @ts-expect-error step.ai is not part of the job contract
    await step.ai.infer("infer", {});
  });

  // Rejected: send fields outside the contract.
  void jobs.send({ id: "dedupe", name: "types/run", data: {}, ts: 1 });
  // @ts-expect-error events carry name, data, a dedupe id and a timestamp only
  void jobs.send({ name: "types/run", data: {}, v: "2026-09-26" });
}
void typeContract;
