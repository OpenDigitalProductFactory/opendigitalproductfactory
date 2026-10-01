/**
 * Coordinator tests for the "upgrade waits for work" drain (BI-F9EE05E5,
 * spec §11a). Drives the ops/quiescence-run handler with a fake step tool and a
 * fake QuiescenceRun row, so the wait loop's decisions are visible without a
 * job engine or a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Surface = { surface: string; kind: "hard" | "soft"; evidence?: Record<string, unknown> };
type ControlEvent = { name: string; data: Record<string, unknown> } | null;

const world = vi.hoisted(() => ({
  status: "pending",
  budgetMs: 60 * 60 * 1000,
  drainStartedAt: null as string | null,
  forced: false,
  abortRequestedBy: null as string | null,
  surfaces: [] as Surface[],
  stepIds: [] as string[],
  captureArgs: [] as unknown[],
  transitions: [] as string[],
  levels: [] as string[],
  order: [] as string[],
  progressWrites: 0,
  waits: [] as { id: string; event: string; timeout: unknown; if?: string }[],
  onControlWait: null as null | ((n: number) => ControlEvent),
  swapEvent: { name: "ops/quiescence.swap-complete", data: { runId: "QR-1", outcome: "succeeded" } } as ControlEvent,
}));

const sendMock = vi.hoisted(() => vi.fn(async () => ({ ids: [] })));

vi.mock("@/lib/jobs", () => ({
  jobs: {
    createFunction: (opts: unknown, handler: unknown) => ({ id: () => "ops/quiescence-run", opts, handler }),
    send: sendMock,
  },
}));

vi.mock("@/lib/tak/agent-event-bus", () => ({ agentEventBus: { broadcastSystem: vi.fn() } }));

vi.mock("@/lib/self-upgrade/quiescence", () => ({
  captureActiveSessionBlockers: vi.fn(async (opts?: unknown) => {
    world.order.push("snapshot");
    world.captureArgs.push(opts);
    const surfaces = world.surfaces;
    return {
      capturedAt: new Date().toISOString(),
      thresholdMs: 300_000,
      totalBlockers: surfaces.length,
      hardBlockers: surfaces.filter((s) => s.kind === "hard").length,
      softBlockers: surfaces.filter((s) => s.kind === "soft").length,
      unobservableSurfaces: [],
      surfaces,
    };
  }),
  flipActiveTaskRunsToQuiescing: vi.fn(async () => {
    world.order.push("flip-taskruns");
    return 2;
  }),
  invalidateQuiescenceCache: vi.fn(),
  pickPrimaryBlocker: (snap: { surfaces: Surface[] } | null) => snap?.surfaces[0]?.surface ?? null,
  setQuiescenceLevel: vi.fn(async (level: string) => {
    world.levels.push(level);
    world.order.push(`level:${level}`);
  }),
  transitionState: vi.fn(async (_runId: string, to: string) => {
    world.status = to;
    world.transitions.push(to);
    world.order.push(`state:${to}`);
    if (to === "draining" && !world.drainStartedAt) world.drainStartedAt = new Date().toISOString();
    return { status: to, enteredStateAt: {} };
  }),
}));

vi.mock("@/lib/self-upgrade/drain-admission", () => ({
  reassertDrainingLevel: vi.fn(async (runId: string) => {
    if (world.levels.at(-1) === "draining") return false;
    world.levels.push("draining");
    world.order.push(`reassert:${runId}`);
    return true;
  }),
}));

vi.mock("@/lib/self-upgrade/drain-wait", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/self-upgrade/drain-wait")>()),
  readDrainControl: vi.fn(async () => ({
    status: world.status,
    budgetMs: world.budgetMs,
    drainStartedAt: world.drainStartedAt ?? new Date().toISOString(),
    forced: world.forced,
    abortRequestedBy: world.abortRequestedBy,
  })),
  recordDrainProgress: vi.fn(async () => {
    world.progressWrites += 1;
  }),
}));

import { MAX_WAIT_CHECKS, quiescenceRun } from "./quiescence-run";

const T0 = new Date("2026-09-30T17:00:00.000Z");
const MIN = 60 * 1000;
const PHASE: Surface = {
  surface: "build-studio.phase.build",
  kind: "hard",
  evidence: { buildId: "FB-1", phase: "build", startedAt: T0.toISOString() },
};

function durationMs(timeout: unknown): number {
  if (typeof timeout === "number") return timeout;
  const m = /^(\d+)(ms|s|m|h)$/.exec(String(timeout));
  if (!m) throw new Error(`unparsed timeout ${String(timeout)}`);
  const n = Number(m[1]);
  return m[2] === "ms" ? n : m[2] === "s" ? n * 1000 : m[2] === "m" ? n * MIN : n * 60 * MIN;
}

let controlWaits = 0;
const step = {
  run: async (id: string, fn: () => unknown) => {
    world.stepIds.push(id);
    return await fn();
  },
  sleep: async (_id: string, d: unknown) => {
    vi.setSystemTime(Date.now() + durationMs(d));
  },
  sleepUntil: async () => {},
  waitForEvent: async (id: string, opts: { event: string; timeout: unknown; if?: string }) => {
    world.stepIds.push(id);
    world.waits.push({ id, event: opts.event, timeout: opts.timeout, if: opts.if });
    if (opts.event === "ops/quiescence.swap-complete") return world.swapEvent;
    controlWaits += 1;
    world.order.push("wait");
    const scripted = world.onControlWait?.(controlWaits) ?? null;
    if (!scripted) vi.setSystemTime(Date.now() + durationMs(opts.timeout));
    return scripted;
  },
};

async function runCoordinator(data: Record<string, unknown>) {
  const handler = (quiescenceRun as unknown as { handler: (ctx: unknown) => Promise<Record<string, unknown>> }).handler;
  return handler({ event: { name: "ops/quiescence.start", data: { runId: "QR-1", triggerRefId: "SUR-1", shipForce: false, ...data } }, step });
}

beforeEach(async () => {
  vi.useFakeTimers({ now: T0, toFake: ["Date"] });
  Object.assign(world, {
    status: "pending",
    budgetMs: 60 * MIN,
    drainStartedAt: null,
    forced: false,
    abortRequestedBy: null,
    surfaces: [PHASE],
    stepIds: [],
    captureArgs: [],
    transitions: [],
    levels: [],
    order: [],
    progressWrites: 0,
    waits: [],
    onControlWait: null,
    swapEvent: { name: "ops/quiescence.swap-complete", data: { runId: "QR-1", outcome: "succeeded" } },
  });
  controlWaits = 0;
  sendMock.mockClear();
  const q = await import("@/lib/self-upgrade/quiescence");
  vi.mocked(q.flipActiveTaskRunsToQuiescing).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

const UPGRADE = { budgetMs: 60 * MIN, awaitOperatorAtBudget: true };

describe("quiescence coordinator — an upgrade waits for work (BI-F9EE05E5)", () => {
  it("closes admission first, then waits while a phase runs without flipping its TaskRuns", async () => {
    world.onControlWait = (n) => {
      if (n === 3) world.surfaces = []; // the build phase finishes on its own
      return null;
    };

    const result = await runCoordinator(UPGRADE);

    expect(result).toMatchObject({ ok: true, outcome: "succeeded" });
    // Admission closes (level draining) before the first wait.
    expect(world.order.indexOf("level:draining")).toBeLessThan(world.order.indexOf("wait"));
    // Work is never stopped while it runs: the TaskRun flip happens only after
    // the blockers clear, and just before ready-to-swap.
    const flipAt = world.order.indexOf("flip-taskruns");
    expect(flipAt).toBeGreaterThan(world.order.lastIndexOf("wait"));
    expect(flipAt).toBeLessThan(world.order.indexOf("state:ready-to-swap"));
    expect(world.transitions).not.toContain("awaiting-operator");
    expect(world.transitions).not.toContain("deferred");
  });

  it("sleeps on operator-control events filtered to its run, not short sleeps", async () => {
    world.onControlWait = (n) => {
      if (n === 2) world.surfaces = [];
      return null;
    };

    await runCoordinator(UPGRADE);

    const controls = world.waits.filter((w) => w.event === "ops/quiescence.control");
    expect(controls.length).toBeGreaterThan(0);
    for (const w of controls) {
      expect(durationMs(w.timeout)).toBeGreaterThanOrEqual(15_000);
      expect(w.if).toContain('"QR-1"');
    }
    // A live blocker snapshot is persisted every tick for the progress panel.
    expect(world.progressWrites).toBeGreaterThanOrEqual(controls.length);
  });

  it("pauses as awaiting-operator at the bound, keeps the level draining and keeps heartbeating", async () => {
    let writesAtPause = -1;
    world.onControlWait = () => {
      if (world.status === "awaiting-operator" && writesAtPause < 0) writesAtPause = world.progressWrites;
      if (world.status === "awaiting-operator" && world.progressWrites >= writesAtPause + 3) {
        return { name: "ops/quiescence.control", data: { runId: "QR-1", action: "abort", operatorUserId: "op-1" } };
      }
      return null;
    };

    await runCoordinator(UPGRADE);

    expect(world.transitions).toContain("awaiting-operator");
    expect(world.transitions).not.toContain("deferred");
    // While paused the level stayed draining; it only reopened on the abort.
    expect(world.levels).toEqual(["draining", "normal"]);
    expect(world.progressWrites).toBeGreaterThan(writesAtPause);
    // The pause came at the 60-minute bound, not before.
    expect(Date.now() - T0.getTime()).toBeGreaterThanOrEqual(60 * MIN);
  });

  it("keep-waiting extends the bound: back to draining, then swaps once the work clears", async () => {
    let extended = false;
    world.onControlWait = () => {
      if (world.status === "awaiting-operator" && !extended) {
        extended = true;
        world.budgetMs += 30 * MIN; // what extendQuiescenceWait persists
        return { name: "ops/quiescence.control", data: { runId: "QR-1", action: "keep-waiting", operatorUserId: "op-1" } };
      }
      if (extended && world.status === "draining") world.surfaces = [];
      return null;
    };

    const result = await runCoordinator(UPGRADE);

    expect(result).toMatchObject({ ok: true, outcome: "succeeded" });
    const pause = world.transitions.indexOf("awaiting-operator");
    expect(pause).toBeGreaterThan(-1);
    expect(world.transitions.slice(pause + 1)).toContain("draining");
    expect(world.transitions).toContain("ready-to-swap");
  });

  it("blockers clearing while awaiting the operator proceed to swap automatically", async () => {
    world.onControlWait = () => {
      if (world.status === "awaiting-operator") world.surfaces = [];
      return null;
    };

    const result = await runCoordinator(UPGRADE);

    expect(result).toMatchObject({ ok: true, outcome: "succeeded" });
    expect(world.transitions.indexOf("awaiting-operator")).toBeLessThan(world.transitions.indexOf("ready-to-swap"));
  });

  it("force (the existing Force-now escalation) flips the TaskRuns and swaps with work still running", async () => {
    world.onControlWait = (n) => {
      if (n === 2) {
        world.forced = true; // escalateQuiescenceToForced wrote shipForceEscalatedAt
        return { name: "ops/quiescence.control", data: { runId: "QR-1", action: "force", operatorUserId: "op-1" } };
      }
      return null;
    };

    const result = await runCoordinator(UPGRADE);

    expect(result).toMatchObject({ ok: true, outcome: "succeeded" });
    expect(world.surfaces).toHaveLength(1); // the phase was still running
    const flipAt = world.order.indexOf("flip-taskruns");
    expect(flipAt).toBeGreaterThan(-1);
    expect(flipAt).toBeLessThan(world.order.indexOf("state:ready-to-swap"));
  });

  it("abort mid-drain ends the run aborted, reopens admission and emits cleared", async () => {
    world.onControlWait = (n) =>
      n === 2 ? { name: "ops/quiescence.control", data: { runId: "QR-1", action: "abort", operatorUserId: "op-7" } } : null;

    const result = await runCoordinator(UPGRADE);

    expect(result).toMatchObject({ ok: false, outcome: "aborted" });
    expect(world.transitions.at(-1)).toBe("aborted");
    expect(world.levels.at(-1)).toBe("normal");
    expect(world.order).not.toContain("flip-taskruns");
    expect(world.transitions).not.toContain("ready-to-swap");
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "platform.quiescence-cleared",
        data: expect.objectContaining({ runId: "QR-1", outcome: "aborted" }),
      }),
    );
  });

  it("re-asserts draining on the next check after an external reset to normal (restart mid-drain)", async () => {
    world.onControlWait = (n) => {
      if (n === 2) world.levels.push("normal"); // resetStuckQuiescenceLevelOnBoot / anything else reopened admission
      if (n === 4) world.surfaces = [];
      return null;
    };

    await runCoordinator(UPGRADE);

    const reset = world.levels.indexOf("normal");
    expect(reset).toBeGreaterThan(-1);
    expect(world.levels[reset + 1]).toBe("draining");
    expect(world.order).toContain("reassert:QR-1");
    // ...and admission was closed again before the swap.
    expect(world.order.indexOf("reassert:QR-1")).toBeLessThan(world.order.indexOf("state:ready-to-swap"));
  });

  it("a durable abort recorded while no waitForEvent listens still aborts at the next check (event lost)", async () => {
    world.onControlWait = (n) => {
      if (n === 2) {
        // abortQuiescence wrote the marker, but its wake-up event arrived while
        // the coordinator was inside a check step, so the engine dropped it.
        world.abortRequestedBy = "op-9";
        world.surfaces = []; // the work also finished at the same moment
      }
      return null;
    };

    const result = await runCoordinator(UPGRADE);

    expect(result).toMatchObject({ ok: false, outcome: "aborted" });
    expect(world.transitions).not.toContain("ready-to-swap");
    expect(world.order).not.toContain("flip-taskruns");
    expect(world.transitions.at(-1)).toBe("aborted");
    expect(world.levels.at(-1)).toBe("normal");
    const q = await import("@/lib/self-upgrade/quiescence");
    expect(vi.mocked(q.transitionState)).toHaveBeenLastCalledWith(
      "QR-1",
      "aborted",
      expect.objectContaining({ outcomeNotes: expect.stringContaining("op-9") }),
    );
  });

  it("draining <-> awaiting-operator transitions happen inside the check step (no extra steps)", async () => {
    let extended = false;
    world.onControlWait = () => {
      if (world.status === "awaiting-operator" && !extended) {
        extended = true;
        world.budgetMs += 30 * MIN;
      }
      if (extended && world.status === "draining") world.surfaces = [];
      return null;
    };

    await runCoordinator(UPGRADE);

    expect(world.transitions).toEqual(expect.arrayContaining(["awaiting-operator", "draining", "ready-to-swap"]));
    expect(world.stepIds.filter((id) => id.startsWith("enter-awaiting") || /^enter-draining-\d/.test(id))).toEqual([]);
  });

  it("worst case stays under the job engine's step cap: every check used, then a full swap", async () => {
    world.onControlWait = (n) => {
      if (n === MAX_WAIT_CHECKS - 1) world.surfaces = []; // clears on the last possible check
      if (world.status === "awaiting-operator" && n % 50 === 0) world.budgetMs += 10 * MIN; // repeated Keep waiting
      return null;
    };

    const result = await runCoordinator(UPGRADE);

    expect(result).toMatchObject({ ok: true, outcome: "succeeded" });
    expect(world.stepIds.length).toBeLessThanOrEqual(950);
    expect(new Set(world.stepIds).size).toBe(world.stepIds.length);
  });

  it("snapshots use the run budget as the recency window for other triggers, the default for an upgrade", async () => {
    world.budgetMs = 5 * MIN;
    await runCoordinator({ budgetMs: 5 * MIN });
    expect(world.captureArgs.length).toBeGreaterThan(1);
    expect(world.captureArgs.every((a) => JSON.stringify(a) === JSON.stringify({ thresholdMs: 5 * MIN }))).toBe(true);

    world.captureArgs = [];
    world.surfaces = [];
    world.status = "pending";
    world.levels = [];
    await runCoordinator(UPGRADE);
    expect(world.captureArgs.every((a) => a === undefined)).toBe(true);
  });

  it("announces ready-to-swap so the waiting upgrade wakes without polling", async () => {
    world.surfaces = [];

    await runCoordinator(UPGRADE);

    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: "ops/quiescence.ready-to-swap", data: expect.objectContaining({ runId: "QR-1" }) }),
    );
  });

  it("other triggers keep the bounded drain: flip at start, defer at the budget", async () => {
    world.budgetMs = 5 * MIN; // startQuiescence writes the event's budget on the row
    const result = await runCoordinator({ budgetMs: 5 * MIN });

    expect(result).toMatchObject({ ok: false, outcome: "deferred" });
    expect(world.order.indexOf("flip-taskruns")).toBeLessThan(world.order.indexOf("wait"));
    expect(world.transitions).not.toContain("awaiting-operator");
    expect(world.levels.at(-1)).toBe("normal");
  });
});
