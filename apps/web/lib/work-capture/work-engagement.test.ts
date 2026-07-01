import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  workEngagement: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), createMany: vi.fn() },
  workEngagementActivity: { aggregate: vi.fn(), create: vi.fn() },
  recurrenceSchedule: { create: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock("@dpf/db", () => ({ prisma: prismaMock }));

import {
  WORK_ENGAGEMENT_TRANSITIONS,
  planMaterialization,
  transitionWorkEngagement,
} from "./work-engagement";
import { evaluateTransition } from "./transition-state-machine";
import type { Occurrence } from "./recurrence-expander";

function occ(iso: string, n: number): Occurrence {
  return { occurrenceAt: new Date(iso), instanceNumber: n };
}

beforeEach(() => {
  vi.clearAllMocks();
  // $transaction(cb) runs cb with a tx that reuses the same mocks.
  prismaMock.$transaction.mockImplementation(async (cb: (tx: unknown) => unknown) => cb(prismaMock));
});

describe("WORK_ENGAGEMENT_TRANSITIONS", () => {
  it("models the lifecycle: planned → in-progress → completed, with terminals", () => {
    expect(evaluateTransition(WORK_ENGAGEMENT_TRANSITIONS, "planned", "in-progress")).toEqual({ changed: true });
    expect(evaluateTransition(WORK_ENGAGEMENT_TRANSITIONS, "in-progress", "completed")).toEqual({ changed: true });
    expect(() => evaluateTransition(WORK_ENGAGEMENT_TRANSITIONS, "completed", "in-progress")).toThrow(/Illegal/);
    expect(() => evaluateTransition(WORK_ENGAGEMENT_TRANSITIONS, "planned", "completed")).toThrow(/Illegal/);
    expect(evaluateTransition(WORK_ENGAGEMENT_TRANSITIONS, "failed", "in-progress")).toEqual({ changed: true }); // retry
  });
});

describe("planMaterialization (idempotency core)", () => {
  it("returns only occurrences not already materialized", () => {
    const occurrences = [occ("2026-05-01T09:00:00Z", 1), occ("2026-05-08T09:00:00Z", 2), occ("2026-05-15T09:00:00Z", 3)];
    const existing = new Set(["2026-05-01T09:00:00.000Z", "2026-05-08T09:00:00.000Z"]);
    expect(planMaterialization(occurrences, existing).map((o) => o.instanceNumber)).toEqual([3]);
  });
  it("is a no-op when everything is already materialized (re-run safe)", () => {
    const occurrences = [occ("2026-05-01T09:00:00Z", 1)];
    const existing = new Set(["2026-05-01T09:00:00.000Z"]);
    expect(planMaterialization(occurrences, existing)).toEqual([]);
  });
});

describe("transitionWorkEngagement", () => {
  it("errors when the engagement does not exist", async () => {
    prismaMock.workEngagement.findUnique.mockResolvedValue(null);
    const r = await transitionWorkEngagement({ engagementId: "missing", to: "in-progress" });
    expect(r).toEqual({ error: "not-found", message: expect.stringContaining("missing") });
  });

  it("is an idempotent no-op when already in the target state — records NO activity", async () => {
    prismaMock.workEngagement.findUnique.mockResolvedValue({ id: "we1", status: "completed" });
    const r = await transitionWorkEngagement({ engagementId: "we1", to: "completed" });
    expect(r).toEqual({ status: "completed", changed: false });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.workEngagementActivity.create).not.toHaveBeenCalled();
  });

  it("rejects an illegal transition with a clear error", async () => {
    prismaMock.workEngagement.findUnique.mockResolvedValue({ id: "we1", status: "completed" });
    const r = await transitionWorkEngagement({ engagementId: "we1", to: "in-progress" });
    expect(r).toMatchObject({ error: "illegal-transition" });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("applies a legal transition and records exactly one status-change activity", async () => {
    prismaMock.workEngagement.findUnique.mockResolvedValue({ id: "we1", status: "planned" });
    prismaMock.workEngagementActivity.aggregate.mockResolvedValue({ _max: { seq: 4 } });
    prismaMock.workEngagementActivity.create.mockResolvedValue({ id: "act1", seq: 5 });
    prismaMock.workEngagement.update.mockResolvedValue({});

    const r = await transitionWorkEngagement({ engagementId: "we1", to: "in-progress", actor: { agentId: "marketing-specialist" } });
    expect(r).toEqual({ status: "in-progress", changed: true });
    expect(prismaMock.workEngagement.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "we1" }, data: { status: "in-progress" } }),
    );
    // seq allocated as max+1 = 5, one status-change row.
    expect(prismaMock.workEngagementActivity.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.workEngagementActivity.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ seq: 5, kind: "status-change" }) }),
    );
  });
});
