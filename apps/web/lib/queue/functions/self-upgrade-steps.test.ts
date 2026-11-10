/**
 * BI-F9EE05E5 — the self-upgrade job runs as pre-drain / wait / swap steps, so
 * an hour-long drain never sits inside one step's HTTP request.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const readQuiescenceOutcome = vi.hoisted(() => vi.fn());
vi.mock("@/lib/self-upgrade/drain-wait", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/self-upgrade/drain-wait")>()),
  readQuiescenceOutcome,
}));

import { runSelfUpgradeInSteps, type SelfUpgradePhases } from "./self-upgrade-steps";

/** The step tools runSelfUpgradeInSteps takes (run + waitForEvent). */
type StepTools = Parameters<typeof runSelfUpgradeInSteps>[0];

const ctx = { runId: "SUR-1", quiescenceRunId: "QR-1" } as never;

function fakeStep() {
  const ids: string[] = [];
  const waits: { id: string; event: string; timeout: unknown; if?: string }[] = [];
  const tools = {
    ids,
    waits,
    run: vi.fn(async (id: string, fn: () => unknown) => {
      ids.push(id);
      return await fn();
    }),
    sleep: vi.fn(),
    sleepUntil: vi.fn(),
    waitForEvent: vi.fn(async (id: string, opts: { event: string; timeout: unknown; if?: string }) => {
      ids.push(id);
      waits.push({ id, ...opts });
      return null;
    }),
  };
  // The fake runs each step's function directly; the engine's Jsonify return
  // typing is not modelled, so cast at this one boundary.
  return tools as typeof tools & StepTools;
}

function phases(overrides: Partial<SelfUpgradePhases> = {}): SelfUpgradePhases {
  return {
    begin: vi.fn(async () => ({ draining: ctx, awaitReady: async () => { throw new Error("not used in steps"); } })),
    settle: vi.fn(async () => null),
    finish: vi.fn(async () => ({ ok: true, status: "succeeded", runId: "SUR-1" })),
    ...overrides,
  } as SelfUpgradePhases;
}

beforeEach(() => {
  readQuiescenceOutcome.mockReset();
});

describe("runSelfUpgradeInSteps", () => {
  it("returns a pre-drain result (skip or failure) without waiting", async () => {
    const step = fakeStep();
    const p = phases({ begin: vi.fn(async () => ({ done: { skipped: true, reason: "disabled" } })) });

    const out = await runSelfUpgradeInSteps(step, { triggeredBy: "ops" }, p);

    expect(out).toEqual({ skipped: true, reason: "disabled" });
    expect(step.waitForEvent).not.toHaveBeenCalled();
    expect(p.finish).not.toHaveBeenCalled();
  });

  it("waits across steps while the drain is in progress, then swaps in its own step", async () => {
    readQuiescenceOutcome
      .mockResolvedValueOnce({ waiting: true, status: "draining" })
      .mockResolvedValueOnce({ waiting: true, status: "awaiting-operator" })
      .mockResolvedValueOnce({ ok: true, outcome: "ready-to-swap", runId: "QR-1", finalSnapshot: null });
    const step = fakeStep();
    const p = phases();

    const out = await runSelfUpgradeInSteps(step, { triggeredBy: "ops" }, p);

    expect(out).toMatchObject({ status: "succeeded" });
    expect(step.waits).toHaveLength(2);
    for (const w of step.waits) {
      expect(w.event).toBe("ops/quiescence.ready-to-swap");
      expect(w.if).toContain('"QR-1"');
    }
    // Each step id is unique (the job engine memoises by id).
    expect(new Set(step.ids).size).toBe(step.ids.length);
    expect(step.ids[0]).toMatch(/pre-drain/);
    expect(step.ids.at(-1)).toMatch(/swap/);
    expect(p.settle).toHaveBeenCalledWith(ctx, expect.objectContaining({ ok: true, outcome: "ready-to-swap" }));
    expect(p.finish).toHaveBeenCalledWith(ctx);
  });

  it("an operator abort settles the run and never swaps", async () => {
    readQuiescenceOutcome.mockResolvedValueOnce({ ok: false, outcome: "aborted", runId: "QR-1", reason: "op" });
    const step = fakeStep();
    const p = phases({ settle: vi.fn(async () => ({ ok: false, status: "aborted", runId: "SUR-1" })) });

    const out = await runSelfUpgradeInSteps(step, { triggeredBy: "ops" }, p);

    expect(out).toMatchObject({ status: "aborted" });
    expect(p.finish).not.toHaveBeenCalled();
  });

  it("a dry run (no drain) goes straight to the swap step", async () => {
    const step = fakeStep();
    const p = phases({ begin: vi.fn(async () => ({ draining: { runId: "SUR-1", quiescenceRunId: null } as never })) });

    await runSelfUpgradeInSteps(step, { triggeredBy: "ops", dryRun: true }, p);

    expect(readQuiescenceOutcome).not.toHaveBeenCalled();
    expect(p.finish).toHaveBeenCalled();
  });
});
