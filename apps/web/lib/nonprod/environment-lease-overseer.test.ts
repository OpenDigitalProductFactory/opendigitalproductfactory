import { describe, expect, it } from "vitest";
import { planEnvironmentAdmission, type AdmissionLease } from "./environment-lease-admission";
import {
  AI_TURN_LIVENESS_MS,
  boundedRenewalExpiry,
  buildServiceHistory,
  CLASS_HOLD_BOUND_MS,
  classifyLease,
  decideHoldBound,
  explainQueue,
  orderWaiters,
  OVERSEER_POLICY_VERSION,
  SESSION_FAIR_SHARE_MS,
  TIER_AGING_MS,
  type OverseerLease,
} from "./environment-lease-overseer";

// BI-218A4555: the test-machine overseer. Starvation, fairness and bound tests
// for the acceptance criteria in
// docs/superpowers/specs/2026-11-12-test-machine-overseer-design.md.

const T0 = new Date("2026-11-12T15:00:00.000Z").getTime();
const at = (minutes: number) => new Date(T0 + minutes * 60_000);
const ENV = "local-integration-ci";
let seq = 0;

function waiter(input: Partial<AdmissionLease> & { claimKey: string; queuedMin: number }): AdmissionLease {
  seq += 1;
  return {
    id: input.id ?? `w${String(seq).padStart(3, "0")}`,
    environmentKey: ENV,
    status: "queued",
    slotKey: null,
    ownerSessionId: input.ownerSessionId ?? `session-${seq}`,
    ownerProvider: input.ownerProvider ?? "claude",
    expiresAt: at(input.queuedMin + 120),
    ...input,
    queuedAt: at(input.queuedMin),
    heartbeatAt: input.heartbeatAt ?? at(input.queuedMin),
  };
}

function served(input: { claimKey: string; ownerSessionId: string; ownerProvider?: string; admittedMin: number; releasedMin: number }): AdmissionLease {
  seq += 1;
  return {
    id: `s${String(seq).padStart(3, "0")}`,
    environmentKey: ENV,
    status: "released",
    slotKey: "slot-0",
    claimKey: input.claimKey,
    ownerSessionId: input.ownerSessionId,
    ownerProvider: input.ownerProvider ?? "claude",
    queuedAt: at(input.admittedMin - 1),
    admittedAt: at(input.admittedMin),
    releasedAt: at(input.releasedMin),
    expiresAt: at(input.releasedMin),
  };
}

function order(leases: AdmissionLease[], nowMin: number): string[] {
  const now = at(nowMin);
  const history = buildServiceHistory(leases, now);
  return orderWaiters(leases.filter((lease) => lease.status === "queued"), history, ENV).map((lease) => lease.id);
}

describe("classification (server-derived, not client-named)", () => {
  it("derives every class from existing lease columns", () => {
    expect(classifyLease({ environmentKey: ENV, claimKey: "gate:abc" })).toMatchObject({ holdClass: "gate", tier: 0 });
    expect(classifyLease({ environmentKey: ENV, claimKey: "inference-turn:local:NPEL-1" })).toMatchObject({ holdClass: "ai-turn", tier: 0 });
    expect(classifyLease({ environmentKey: ENV, claimKey: "served-target-check" })).toMatchObject({ holdClass: "verification", tier: 1 });
    expect(classifyLease({ environmentKey: ENV, claimKey: "dev-portal:/wt:feat/x" })).toMatchObject({ holdClass: "preview", tier: 2 });
    expect(classifyLease({ environmentKey: "host-heavy-resource", claimKey: "host-resource:x", resourceClass: "vitest" }))
      .toMatchObject({ holdClass: "check", tier: 1 });
    expect(classifyLease({ environmentKey: "host-heavy-resource", claimKey: "host-resource:x", resourceClass: "semantic-review" }))
      .toMatchObject({ holdClass: "ai-turn", tier: 0 });
  });
});

describe("starvation (AC-OVS-1, AC-OVS-2)", () => {
  it("serves a gate before an older preview and an older verification run", () => {
    const preview = waiter({ id: "preview", claimKey: "dev-portal:/wt:a", queuedMin: 0 });
    const verification = waiter({ id: "verify", claimKey: "owner-acceptance-x", queuedMin: 1 });
    const gate = waiter({ id: "gate", claimKey: "gate:sha1", queuedMin: 5 });
    expect(order([preview, verification, gate], 6)).toEqual(["gate", "verify", "preview"]);
  });

  it("lifts a waiter one tier per 30 minutes, so a preview's wait is bounded", () => {
    const preview = waiter({ id: "preview", claimKey: "dev-portal:/wt:a", queuedMin: 0 });
    const gate = waiter({ id: "gate", claimKey: "gate:sha1", queuedMin: 59 });
    expect(order([preview, gate], 59)).toEqual(["gate", "preview"]);
    // After two aging steps the preview competes in tier 0, and the class that
    // has not been served goes first.
    const servedGate = served({ claimKey: "gate:older", ownerSessionId: "other", admittedMin: 55, releasedMin: 58 });
    expect(order([preview, gate, servedGate], 2 * TIER_AGING_MS / 60_000)).toEqual(["preview", "gate"]);
  });

  it("alternates gates and AI review turns: a live AI turn goes next after a gate was served", () => {
    const lastGate = served({ claimKey: "gate:prev", ownerSessionId: "s-a", admittedMin: 0, releasedMin: 4 });
    const gate = waiter({ id: "gate", claimKey: "gate:next", queuedMin: 1 });
    const turn = waiter({ id: "turn", claimKey: "inference-turn:local:NPEL-T", ownerSessionId: "local-inference", ownerProvider: "coworker", queuedMin: 3 });
    expect(order([lastGate, gate, turn], 4)).toEqual(["turn", "gate"]);
  });

  it("serves a gate next after an AI turn was served, even under continuous AI demand", () => {
    const servedTurn = served({ claimKey: "inference-turn:local:NPEL-A", ownerSessionId: "local-inference", admittedMin: 4, releasedMin: 4 });
    const lastGate = served({ claimKey: "gate:prev", ownerSessionId: "s-a", admittedMin: 0, releasedMin: 3 });
    const gate = waiter({ id: "gate", claimKey: "gate:next", queuedMin: 2 });
    const turn = waiter({ id: "turn", claimKey: "inference-turn:local:NPEL-B", ownerSessionId: "local-inference", ownerProvider: "coworker", queuedMin: 1 });
    expect(order([servedTurn, lastGate, gate, turn], 5)).toEqual(["gate", "turn"]);
  });

  it("holds the free slot open for a live AI turn: the gate behind it is not admitted", () => {
    const lastGate = served({ claimKey: "gate:prev", ownerSessionId: "s-a", admittedMin: 0, releasedMin: 4 });
    const gate = waiter({ id: "gate", claimKey: "gate:next", queuedMin: 1, heartbeatAt: at(4) });
    const turn = waiter({ id: "turn", claimKey: "inference-turn:local:NPEL-T", ownerSessionId: "local-inference", queuedMin: 3 });
    const plan = planEnvironmentAdmission({
      leases: [lastGate, gate, turn],
      now: at(4),
      slotKeys: ["slot-0"],
      admissibleLeaseIds: ["gate"],
      livenessWindowMs: 120_000,
    });
    expect(plan.admissions).toEqual([]);
    expect(plan.queuePositions.map((entry) => entry.leaseId)).toEqual(["turn", "gate"]);
  });

  it("stops holding the slot once the AI turn goes quiet past its liveness window", () => {
    const lastGate = served({ claimKey: "gate:prev", ownerSessionId: "s-a", admittedMin: 0, releasedMin: 4 });
    const gate = waiter({ id: "gate", claimKey: "gate:next", queuedMin: 1, heartbeatAt: at(10) });
    const turn = waiter({ id: "turn", claimKey: "inference-turn:local:NPEL-T", ownerSessionId: "local-inference", queuedMin: 3 });
    const nowMin = 3 + AI_TURN_LIVENESS_MS / 60_000 + 1;
    const plan = planEnvironmentAdmission({
      leases: [lastGate, { ...gate, heartbeatAt: at(nowMin) }, turn],
      now: at(nowMin),
      slotKeys: ["slot-0"],
      admissibleLeaseIds: ["gate"],
      livenessWindowMs: 120_000,
    });
    expect(plan.admissions).toEqual([{ leaseId: "gate", slotKey: "slot-0" }]);
  });

  it("never admits an AI turn row itself", () => {
    const turn = waiter({ id: "turn", claimKey: "inference-turn:local:NPEL-T", ownerSessionId: "local-inference", queuedMin: 0 });
    const plan = planEnvironmentAdmission({ leases: [turn], now: at(1), slotKeys: ["slot-0"] });
    expect(plan.admissions).toEqual([]);
  });

  it("keeps first-come order on active-candidate (unchanged)", () => {
    const first = { ...waiter({ id: "a", claimKey: "dev-portal:x", queuedMin: 0 }), environmentKey: "active-candidate" };
    const second = { ...waiter({ id: "b", claimKey: "gate:y", queuedMin: 1 }), environmentKey: "active-candidate" };
    const history = buildServiceHistory([first, second], at(2));
    expect(orderWaiters([second, first], history, "active-candidate").map((lease) => lease.id)).toEqual(["a", "b"]);
  });
});

describe("fair share (AC-OVS-3, AC-OVS-4)", () => {
  it("orders a session that just released behind another session that queued later", () => {
    const greedyHeld = served({ claimKey: "gate:g1", ownerSessionId: "greedy", admittedMin: 0, releasedMin: 5 });
    const greedyAgain = waiter({ id: "greedy-2", claimKey: "gate:g2", ownerSessionId: "greedy", queuedMin: 5 });
    const patient = waiter({ id: "patient", claimKey: "gate:p1", ownerSessionId: "patient", ownerProvider: "codex", queuedMin: 8 });
    expect(order([greedyHeld, greedyAgain, patient], 9)).toEqual(["patient", "greedy-2"]);
  });

  it("bounds the fair-share discount, so age still wins and nobody is starved", () => {
    const greedyHeld = served({ claimKey: "gate:g1", ownerSessionId: "greedy", admittedMin: 0, releasedMin: 5 });
    const greedyAgain = waiter({ id: "greedy-2", claimKey: "gate:g2", ownerSessionId: "greedy", queuedMin: 5 });
    const lateArrival = waiter({
      id: "late", claimKey: "gate:l1", ownerSessionId: "late", ownerProvider: "codex",
      queuedMin: 5 + SESSION_FAIR_SHARE_MS / 60_000 + 1,
    });
    expect(order([greedyHeld, greedyAgain, lateArrival], 30)).toEqual(["greedy-2", "late"]);
  });

  it("serves each of N continuously re-queuing sessions once per N admissions", () => {
    const sessions = ["a", "b", "c", "d"];
    const history: AdmissionLease[] = [];
    const waiting = new Map<string, AdmissionLease>();
    let clock = 0;
    const requeue = (session: string) => {
      waiting.set(session, waiter({ id: `${session}-${clock}`, claimKey: `gate:${session}-${clock}`, ownerSessionId: session,
        ownerProvider: session === "a" ? "codex" : "claude", queuedMin: clock }));
    };
    sessions.forEach(requeue);
    const admittedOrder: string[] = [];
    for (let round = 0; round < 12; round += 1) {
      clock += 1;
      const plan = planEnvironmentAdmission({
        leases: [...history, ...waiting.values()],
        now: at(clock),
        slotKeys: ["slot-0"],
      });
      const [admission] = plan.admissions;
      const lease = [...waiting.values()].find((candidate) => candidate.id === admission!.leaseId)!;
      admittedOrder.push(lease.ownerSessionId!);
      waiting.delete(lease.ownerSessionId!);
      clock += 3; // a 3-minute gate run
      history.push({ ...lease, status: "released", admittedAt: at(clock - 3), releasedAt: at(clock), slotKey: "slot-0" });
      requeue(lease.ownerSessionId!); // the aggressive pattern: re-claim at once
    }
    for (let window = 0; window + sessions.length <= admittedOrder.length; window += sessions.length) {
      expect(new Set(admittedOrder.slice(window, window + sessions.length)).size).toBe(sessions.length);
    }
  });
});

describe("bounded holds (AC-OVS-5, AC-OVS-6)", () => {
  const holder = (claimKey: string, heldMin: number, nowMin: number): OverseerLease => ({
    id: "holder",
    environmentKey: ENV,
    status: "active",
    claimKey,
    ownerSessionId: "holder-session",
    ownerProvider: "codex",
    admittedAt: at(nowMin - heldMin),
    expiresAt: at(nowMin + 2),
  });
  const liveWaiter = (nowMin: number, overrides: Partial<OverseerLease> = {}): OverseerLease => ({
    id: "waiter",
    environmentKey: ENV,
    status: "queued",
    claimKey: "gate:w",
    ownerSessionId: "someone-else",
    queuedAt: at(nowMin - 1),
    heartbeatAt: at(nowMin),
    expiresAt: at(nowMin + 60),
    ...overrides,
  });

  it.each([
    ["gate:x", "gate"],
    ["owner-acceptance-x", "verification"],
    ["dev-portal:/wt:a", "preview"],
  ] as const)("yields a %s hold at its class bound while another session waits", (claimKey, holdClass) => {
    const boundMin = (CLASS_HOLD_BOUND_MS[holdClass] as number) / 60_000;
    const decision = decideHoldBound({
      holder: holder(claimKey, boundMin, 200),
      waiters: [liveWaiter(200)],
      now: at(200),
      waiterLivenessWindowMs: 120_000,
    });
    expect(decision).toMatchObject({ kind: "yield", contended: true, phase: `yielded:${holdClass}:hold-bound` });
  });

  it("caps a contended renewal at the class bound and never past it", () => {
    const boundMin = (CLASS_HOLD_BOUND_MS.verification as number) / 60_000;
    const decision = decideHoldBound({
      holder: holder("owner-acceptance-x", boundMin - 1, 200),
      waiters: [liveWaiter(200)],
      now: at(200),
      waiterLivenessWindowMs: 120_000,
    });
    expect(decision.kind).toBe("within-bound");
    expect(boundedRenewalExpiry(decision, at(215)).getTime()).toBe(at(201).getTime());
  });

  it("renews an uncontended hold unchanged, however long it has run", () => {
    const decision = decideHoldBound({
      holder: holder("owner-acceptance-x", 175, 200),
      waiters: [],
      now: at(200),
      waiterLivenessWindowMs: 120_000,
    });
    expect(decision).toMatchObject({ kind: "within-bound", contended: false });
    expect(boundedRenewalExpiry(decision, at(215)).getTime()).toBe(at(215).getTime());
  });

  it("does not count the holder's own queued claim or a dead row as someone waiting", () => {
    const decision = decideHoldBound({
      holder: holder("dev-portal:/wt:a", 90, 200),
      waiters: [
        liveWaiter(200, { id: "own", ownerSessionId: "holder-session" }),
        liveWaiter(200, { id: "dead", heartbeatAt: at(150) }),
      ],
      now: at(200),
      waiterLivenessWindowMs: 120_000,
    });
    expect(decision).toMatchObject({ kind: "within-bound", contended: false });
  });

  it("leaves active-candidate unbounded", () => {
    const decision = decideHoldBound({
      holder: { ...holder("candidate:x", 500, 600), environmentKey: "active-candidate" },
      waiters: [{ ...liveWaiter(600), environmentKey: "active-candidate" }],
      now: at(600),
      waiterLivenessWindowMs: 120_000,
    });
    expect(decision.kind).toBe("unbounded");
  });
});

describe("visible queue (AC-OVS-7)", () => {
  it("gives every waiter its policy position, an estimate and a plain reason", () => {
    const active: OverseerLease = {
      id: "running", environmentKey: ENV, status: "active", claimKey: "gate:r", ownerSessionId: "r",
      admittedAt: at(9), expiresAt: at(12),
    };
    const preview = waiter({ id: "preview", claimKey: "dev-portal:/wt:a", queuedMin: 0, ownerSessionId: "p" });
    const gate = waiter({ id: "gate", claimKey: "gate:g", queuedMin: 5, ownerSessionId: "g" });
    const now = at(10);
    const history = buildServiceHistory([active, preview, gate], now);
    const ordered = orderWaiters([preview, gate], history, ENV);
    const [first, second] = explainQueue({ ordered, active: [active], capacity: 1, history, waiterLivenessWindowMs: 120_000 });
    expect(first).toMatchObject({ leaseId: "gate", queuePosition: 1, holdClass: "gate", policyVersion: OVERSEER_POLICY_VERSION });
    expect(first!.estimatedWaitMs).toBe(3 * 60_000); // the running gate's typical 4 min, 1 min in
    expect(first!.queueReason).toBe("next in line.");
    expect(second).toMatchObject({ leaseId: "preview", queuePosition: 2 });
    expect(second!.estimatedWaitMs).toBe(7 * 60_000);
    expect(second!.queueReason).toContain("1 ahead: 1 gate");
    expect(second!.queueReason).toContain("gates and AI review turns go before a preview");
  });

  it("reports the planner's queue positions in policy order", () => {
    const preview = waiter({ id: "preview", claimKey: "dev-portal:/wt:a", queuedMin: 0 });
    const gate = waiter({ id: "gate", claimKey: "gate:g", queuedMin: 5 });
    const plan = planEnvironmentAdmission({ leases: [preview, gate], now: at(6), slotKeys: [] });
    expect(plan.queuePositions).toEqual([
      { leaseId: "gate", position: 1 },
      { leaseId: "preview", position: 2 },
    ]);
  });
});
