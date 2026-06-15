import { describe, expect, it } from "vitest";

import { type DispatchSimWorld, ReferenceDispatcher, runScenario } from "./dispatch-sim";
import { oracleViolations, oraclesPass, runOracles } from "./oracles";
import type { Instant } from "./virtual-clock";
import { normalDay, rushHourDelay, unreachableCustomer } from "./scenarios";

describe("dispatch process simulation", () => {
  it("normal day: every job completes and invoices, all oracles pass", async () => {
    const snapshot = await runScenario(normalDay());
    const results = runOracles(snapshot);
    expect(oracleViolations(results)).toEqual([]); // readable failure if not
    expect(oraclesPass(results)).toBe(true);
    expect(snapshot.jobs.every((j) => j.status === "invoiced")).toBe(true);
    // each reachable job got a confirmation and an on-my-way
    expect(snapshot.notifications.filter((n) => n.event === "confirm").length).toBe(3);
    expect(snapshot.notifications.filter((n) => n.event === "on-my-way").length).toBe(3);
  });

  it("rush-hour delay: the dispatcher fires running-late, and oracles still hold", async () => {
    const snapshot = await runScenario(rushHourDelay());
    expect(oraclesPass(runOracles(snapshot))).toBe(true);
    expect(snapshot.notifications.some((n) => n.event === "running-late")).toBe(true);
    // ETA slipped past the promised window
    const job = snapshot.jobs[0];
    expect(job.etaAt).toBeDefined();
    expect((job.etaAt as Instant) > job.windowEnd).toBe(true);
  });

  it("unreachable customer: failed notifications surface as exceptions (O5)", async () => {
    const snapshot = await runScenario(unreachableCustomer());
    expect(oraclesPass(runOracles(snapshot))).toBe(true);
    expect(snapshot.exceptions.length).toBeGreaterThan(0);
    // the on-my-way was attempted (O1) but not delivered (O5 surfaces it)
    expect(snapshot.notifications.some((n) => n.event === "on-my-way" && !n.delivered)).toBe(true);
  });

  it("is deterministic: identical spec → identical snapshot (R6/VC3)", async () => {
    const a = await runScenario(normalDay());
    const b = await runScenario(normalDay());
    expect(a).toEqual(b);
  });

  it("CATCHES a broken dispatcher that skips on-my-way (O1 fails)", async () => {
    // a dispatcher with a real bug: it never tells the customer the tech is coming
    class SkipOnMyWayDispatcher extends ReferenceDispatcher {
      override onDeparted(_world: DispatchSimWorld, _jobId: string, _eta: Instant, _windowEnd: Instant): void {
        // bug: forgets to notify on-my-way
      }
    }
    const snapshot = await runScenario(normalDay(), new SkipOnMyWayDispatcher());
    const results = runOracles(snapshot);
    expect(oraclesPass(results)).toBe(false);
    const o1 = results.find((r) => r.id === "O1");
    expect(o1?.ok).toBe(false);
    expect(o1?.violations.length).toBe(3); // all three jobs went en-route with no on-my-way
  });
});
