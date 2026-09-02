import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProactivityPlan } from "@/lib/proactivity/proactivity-types";
import { withScheduledWorkTrigger } from "./scheduled-work-trigger";

const mocks = vi.hoisted(() => ({
  prisma: { workroom: { findFirst: vi.fn() } },
  loadWorkroomPostureContext: vi.fn(),
  resolveUserAwareProactivityPlan: vi.fn(),
}));

vi.mock("@dpf/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/work-management/room-posture.server", () => ({
  loadWorkroomPostureContext: mocks.loadWorkroomPostureContext,
}));
vi.mock("@/lib/proactivity/proactivity-resolver.server", () => ({
  resolveUserAwareProactivityPlan: mocks.resolveUserAwareProactivityPlan,
}));

import { resolveScheduledTickPlan } from "./scheduled-work-posture.server";

const NOW = new Date("2026-09-02T10:00:00.000Z");

function plan(overrides: Partial<ProactivityPlan> = {}): ProactivityPlan {
  return {
    resolvedLevel: "assertive",
    actionBoundary: "preauthorized",
    evidenceRefs: [],
    explanation: "",
    ...overrides,
  } as ProactivityPlan;
}

function room(scopeClaims: unknown[] = [], dueAt: Date | null = null) {
  return {
    scopeClaims,
    activityKind: "delivery",
    decisionScope: "wwmd",
    workItem: { assignedToAgentId: "marketing-specialist", dueAt },
  };
}

function tick(taskConfig: unknown) {
  return resolveScheduledTickPlan({
    userId: "user-1",
    taskConfig,
    agentId: "marketing-specialist",
    routeContext: "/customer/marketing",
    now: NOW,
  });
}

function configFor(trigger: Parameters<typeof withScheduledWorkTrigger>[1]) {
  return withScheduledWorkTrigger({}, trigger, NOW);
}

/** Set the plan the identity ladder resolves before the room moves it. */
function inherited(overrides: Partial<ProactivityPlan> = {}) {
  mocks.resolveUserAwareProactivityPlan.mockResolvedValue(plan(overrides));
}

beforeEach(() => {
  vi.clearAllMocks();
  inherited();
  mocks.loadWorkroomPostureContext.mockResolvedValue({
    inherited: { proactivityPlan: plan(), priority: null, source: "platform" as const },
    operatingHours: null,
    stream: null,
    activityFamily: "scheduled-task",
    hardPolicy: null,
  });
});

describe("resolveScheduledTickPlan — when no room governs the tick", () => {
  it("keeps the identity-ladder plan when the task records no trigger", async () => {
    const result = await tick({});
    expect(result.posture).toBeNull();
    expect(result.trigger).toBeNull();
    expect(result.plan.resolvedLevel).toBe("assertive");
    expect(mocks.prisma.workroom.findFirst).not.toHaveBeenCalled();
  });

  // The room ladder must never invent a room.
  it("keeps the identity-ladder plan when the trigger names no room", async () => {
    const result = await tick(configFor({ kind: "time" }));
    expect(result.posture).toBeNull();
    expect(result.plan.resolvedLevel).toBe("assertive");
    expect(mocks.prisma.workroom.findFirst).not.toHaveBeenCalled();
  });

  it("keeps the identity-ladder plan when the named room is gone", async () => {
    mocks.prisma.workroom.findFirst.mockResolvedValue(null);
    const result = await tick(configFor({ kind: "time", workroomId: "WC-GONE" }));
    expect(result.posture).toBeNull();
    expect(result.plan.resolvedLevel).toBe("assertive");
  });

  // Fail-open: a posture lookup must never stop a scheduled job running.
  it("keeps the identity-ladder plan rather than throwing when the lookup fails", async () => {
    mocks.prisma.workroom.findFirst.mockRejectedValue(new Error("db down"));
    const result = await tick(configFor({ kind: "time", workroomId: "WC-1" }));
    expect(result.posture).toBeNull();
    expect(result.plan.resolvedLevel).toBe("assertive");
  });
});

describe("resolveScheduledTickPlan — the room's declaration reaches the plan", () => {
  // The headline defect: an operator quietens a room, a scheduled turn fires in
  // it, and the declaration is ignored because nothing consulted the room.
  it("applies a room's declared quiet posture to the tick's plan", async () => {
    mocks.prisma.workroom.findFirst.mockResolvedValue(
      room([{ workroomPosture: { proactivityLevel: "quiet" }, recordedAt: NOW.toISOString() }]),
    );
    inherited({ resolvedLevel: "assertive" });

    const result = await tick(configFor({ kind: "time", workroomId: "WC-1" }));

    expect(result.posture?.proactivityLevel).toBe("quiet");
    expect(result.plan.resolvedLevel).toBe("quiet");
  });

  it("carries the trigger it resolved through, so the run can record why", async () => {
    mocks.prisma.workroom.findFirst.mockResolvedValue(room());
    const result = await tick(configFor({ kind: "detected-need", workroomId: "WC-1" }));
    expect(result.trigger?.kind).toBe("detected-need");
    expect(result.trigger?.workroomId).toBe("WC-1");
  });

  it("looks the room up by capsule id or row id", async () => {
    mocks.prisma.workroom.findFirst.mockResolvedValue(room());
    await tick(configFor({ kind: "time", workroomId: "WC-1" }));
    const where = mocks.prisma.workroom.findFirst.mock.calls[0]![0].where;
    expect(where.OR).toEqual([{ capsuleId: "WC-1" }, { id: "WC-1" }]);
    expect(where.archivedAt).toBeNull();
  });
});

describe("resolveScheduledTickPlan — the obligation drives the clock", () => {
  // temporalInputForTrigger's reason to exist: a tick racing a 12:00 obligation
  // is deadline work even though the ROOM carries no due date of its own.
  it("uses the trigger's obligation as the effective due date", async () => {
    mocks.prisma.workroom.findFirst.mockResolvedValue(room([], null));
    inherited({ resolvedLevel: "balanced" });

    const withObligation = await tick(
      configFor({
        kind: "time",
        workroomId: "WC-1",
        obligation: { dueAt: "2026-09-02T12:00:00.000Z", label: "Q3 filing" },
      }),
    );
    expect(withObligation.posture?.temporalBand).toBe("pre-deadline");

    // The contrast is the load-bearing half: same room, no obligation, no band.
    const withoutObligation = await tick(configFor({ kind: "time", workroomId: "WC-1" }));
    expect(withoutObligation.posture?.temporalBand).not.toBe("pre-deadline");
  });

  it("falls back to the room's own due date when no obligation is recorded", async () => {
    mocks.prisma.workroom.findFirst.mockResolvedValue(
      room([], new Date("2026-09-02T11:00:00.000Z")),
    );
    inherited({ resolvedLevel: "balanced" });
    const result = await tick(configFor({ kind: "time", workroomId: "WC-1" }));
    expect(result.posture?.temporalBand).toBe("pre-deadline");
  });
});

describe("resolveScheduledTickPlan — tighten-only at this call site", () => {
  // A scheduled job must never acquire MORE authority by running in a room.
  it("never widens the inherited action boundary", async () => {
    mocks.prisma.workroom.findFirst.mockResolvedValue(
      room([{ workroomPosture: { actionBoundary: "preauthorized" }, recordedAt: NOW.toISOString() }]),
    );
    inherited({ actionBoundary: "advise" });

    const result = await tick(configFor({ kind: "time", workroomId: "WC-1" }));
    expect(result.plan.actionBoundary).toBe("advise");
  });

  it("applies a room boundary narrower than the inherited one", async () => {
    mocks.prisma.workroom.findFirst.mockResolvedValue(
      room([{ workroomPosture: { actionBoundary: "advise" }, recordedAt: NOW.toISOString() }]),
    );
    inherited({ actionBoundary: "preauthorized" });

    const result = await tick(configFor({ kind: "time", workroomId: "WC-1" }));
    expect(result.plan.actionBoundary).toBe("advise");
  });
});

// BI-27C8484F exists because scheduled-work-trigger.ts shipped, passed its own
// tests, and had no caller in the execution path. A module can be correct and
// still do nothing. This asserts the seam is production-reachable — not that it
// merely compiles.
describe("caller existence", () => {
  const schedulerSource = readFileSync(
    join(__dirname, "..", "actions", "agent-task-scheduler.ts"),
    "utf8",
  );

  it("the scheduler imports and awaits the seam", () => {
    expect(schedulerSource).toContain('from "@/lib/scheduling/scheduled-work-posture.server"');
    expect(schedulerSource).toContain("await resolveScheduledTickPlan(");
  });

  it("the resolved plan is what the run actually uses", () => {
    // The call is worthless if its result is computed and discarded.
    expect(schedulerSource).toMatch(/\{\s*plan: proactivity\s*\}\s*=\s*await resolveScheduledTickPlan/);
    expect(schedulerSource).toContain("resolvedPlan = proactivity;");
  });
});
