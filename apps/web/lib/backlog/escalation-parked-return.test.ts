import { describe, expect, it } from "vitest";
import {
  countEscalationParkedOrphans,
  decideParkedItemReturn,
  extractEscalationReportId,
  reconcileEscalationParkedItems,
  type EscalationParkedReturnDb,
} from "./escalation-parked-return";

// BI-5BF1D4D0 — a backlog item parked behind a build escalation comes back when
// that escalation resolves, by any path, and a repeated stall on the same cause
// is routed instead of looping.

const NOW = new Date("2026-11-13T21:00:00.000Z");
const OWNER = "principal-owner";

function triggerFor(reportId: string): string {
  // Exactly what buildEscalationDeferral writes (escalate-build-to-human.ts).
  return (
    `The escalation is answered (${reportId} resolved), ` +
    `so the blocking question has an answer and the item can be re-promoted.`
  );
}

type ItemRow = {
  id: string;
  itemId: string;
  status: string;
  body: string | null;
  deferReason: string | null;
  deferTrigger: string | null;
  deferReviewAt: Date | null;
  deferOwnerPrincipalId: string | null;
  deferredAt: Date | null;
  updatedAt?: Date;
};
type ReportRow = { reportId: string; status: string; triggerKind: string | null };
type ActivityRow = { backlogItemId: string; kind: string; summary: string; payload: Record<string, unknown> };

function makeDb(seed: { items: ItemRow[]; reports: ReportRow[]; activities?: ActivityRow[] }) {
  const items = seed.items.map((i) => ({ ...i }));
  const reports = seed.reports.map((r) => ({ ...r }));
  const activities: ActivityRow[] = (seed.activities ?? []).map((a) => ({ ...a }));

  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([k, v]) => {
      if (v && typeof v === "object" && !(v instanceof Date)) {
        const op = v as Record<string, unknown>;
        if ("contains" in op) return typeof row[k] === "string" && (row[k] as string).includes(op.contains as string);
        if ("in" in op) return (op.in as unknown[]).includes(row[k]);
        return false;
      }
      return row[k] === v;
    });

  const db: EscalationParkedReturnDb = {
    backlogItem: {
      findMany: async ({ where }) => items.filter((i) => matches(i, where)).map((i) => ({ ...i })),
      updateMany: async ({ where, data }) => {
        const hit = items.filter((i) => matches(i, where));
        for (const i of hit) Object.assign(i, data);
        return { count: hit.length };
      },
    },
    platformIssueReport: {
      findMany: async ({ where }) => reports.filter((r) => matches(r, where)).map((r) => ({ ...r })),
    },
    backlogItemActivity: {
      findMany: async ({ where }) =>
        activities
          .filter((a) => matches(a as unknown as Record<string, unknown>, where))
          .map((a) => ({ backlogItemId: a.backlogItemId, payload: a.payload })),
      create: async ({ data }) => {
        activities.push(data as ActivityRow);
        return {};
      },
    },
    $transaction: async (fn) => fn(db),
  };
  return { db, items, reports, activities };
}

function parkedItem(id: string, reportId: string, extra: Partial<ItemRow> = {}): ItemRow {
  return {
    id,
    itemId: `BI-${id.toUpperCase()}`,
    status: "deferred",
    body: "local work",
    deferReason: `Build Studio could not self-repair; tracked as ${reportId}.`,
    deferTrigger: triggerFor(reportId),
    deferReviewAt: new Date("2026-11-27T00:00:00.000Z"),
    deferOwnerPrincipalId: OWNER,
    deferredAt: new Date("2026-11-12T00:00:00.000Z"),
    ...extra,
  };
}

function escalationActivity(backlogItemId: string, reportId: string): ActivityRow {
  return {
    backlogItemId,
    kind: "status_change",
    summary: "in-progress → deferred",
    payload: { from: "in-progress", to: "deferred", escalationReportId: reportId },
  };
}

describe("extractEscalationReportId", () => {
  it("reads the report id an escalation deferral names", () => {
    expect(extractEscalationReportId(triggerFor("PIR-QGQUH"))).toBe("PIR-QGQUH");
  });
  it("returns null when the trigger names no escalation", () => {
    expect(extractEscalationReportId("Waiting for the vendor contract")).toBeNull();
    expect(extractEscalationReportId(null)).toBeNull();
  });
});

describe("decideParkedItemReturn", () => {
  const base = {
    reportStatus: "resolved_locally",
    cause: "plan-review-exhausted",
    priorSameCauseEscalations: 0,
    peerOwned: false,
  };

  it("re-opens an item whose escalation resolved for the first time on this cause", () => {
    expect(decideParkedItemReturn(base)).toEqual({ kind: "reopen" });
  });

  it("treats suppressed and resolved_upstream as resolved too", () => {
    expect(decideParkedItemReturn({ ...base, reportStatus: "suppressed" })).toEqual({ kind: "reopen" });
    expect(decideParkedItemReturn({ ...base, reportStatus: "resolved_upstream" })).toEqual({ kind: "reopen" });
  });

  it("routes a repeated stall on the same cause instead of re-opening it (no loop)", () => {
    expect(decideParkedItemReturn({ ...base, priorSameCauseEscalations: 1 })).toEqual({ kind: "repeated-stall" });
  });

  it("leaves an item alone while its escalation is still open", () => {
    expect(decideParkedItemReturn({ ...base, reportStatus: "awaiting_escalation_ack" })).toEqual({
      kind: "skip",
      reason: "escalation-not-resolved",
    });
  });

  it("never writes a peer-owned mirror: the origin installation owns its status", () => {
    expect(decideParkedItemReturn({ ...base, peerOwned: true })).toEqual({ kind: "skip", reason: "peer-owned" });
  });
});

describe("reconcileEscalationParkedItems", () => {
  it("re-opens an orphan, clears the deferral and records a status_change row", async () => {
    const { db, items, activities } = makeDb({
      items: [parkedItem("a1", "PIR-AAAAA")],
      reports: [{ reportId: "PIR-AAAAA", status: "resolved_locally", triggerKind: "review-review-exhausted" }],
      activities: [escalationActivity("a1", "PIR-AAAAA")],
    });

    const result = await reconcileEscalationParkedItems({ db, now: NOW });

    expect(result).toMatchObject({ scanned: 1, reopened: 1, redeferred: 0 });
    expect(items[0]).toMatchObject({
      status: "open",
      deferReason: null,
      deferTrigger: null,
      deferReviewAt: null,
      deferOwnerPrincipalId: null,
      deferredAt: null,
    });
    const row = activities.at(-1)!;
    expect(row).toMatchObject({ backlogItemId: "a1", kind: "status_change" });
    expect(row.payload).toMatchObject({
      from: "deferred",
      to: "open",
      escalationReturn: { reportId: "PIR-AAAAA", cause: "review-review-exhausted" },
    });
  });

  it("re-defers a repeated same-cause stall with a fresh reason, trigger, review date and owner", async () => {
    const { db, items, activities } = makeDb({
      items: [parkedItem("b1", "PIR-BBBB2")],
      reports: [
        { reportId: "PIR-BBBB1", status: "resolved_locally", triggerKind: "plan-review-exhausted" },
        { reportId: "PIR-BBBB2", status: "resolved_locally", triggerKind: "plan-review-exhausted" },
      ],
      activities: [escalationActivity("b1", "PIR-BBBB1"), escalationActivity("b1", "PIR-BBBB2")],
    });

    const result = await reconcileEscalationParkedItems({ db, now: NOW });

    expect(result).toMatchObject({ reopened: 0, redeferred: 1 });
    const item = items[0];
    expect(item.status).toBe("deferred");
    expect(item.deferOwnerPrincipalId).toBe(OWNER);
    expect(item.deferReviewAt!.getTime()).toBeGreaterThan(NOW.getTime());
    expect(item.deferReason).toContain("plan-review-exhausted");
    // The fresh trigger must not name a PIR, or the item would be an orphan again.
    expect(extractEscalationReportId(item.deferTrigger)).toBeNull();
    expect(item.deferTrigger).toContain("BI-5E067004");
    expect(activities.at(-1)!.payload).toMatchObject({
      from: "deferred",
      to: "deferred",
      escalationReturn: { reportId: "PIR-BBBB2", cause: "plan-review-exhausted", priorSameCauseEscalations: 1 },
    });
  });

  it("does not count an earlier escalation on a DIFFERENT cause as a repeat", async () => {
    const { db, items } = makeDb({
      items: [parkedItem("c1", "PIR-CCCC2")],
      reports: [
        { reportId: "PIR-CCCC1", status: "resolved_locally", triggerKind: "ideate-review-exhausted" },
        { reportId: "PIR-CCCC2", status: "resolved_locally", triggerKind: "plan-review-exhausted" },
      ],
      activities: [escalationActivity("c1", "PIR-CCCC1"), escalationActivity("c1", "PIR-CCCC2")],
    });

    await reconcileEscalationParkedItems({ db, now: NOW });

    expect(items[0].status).toBe("open");
  });

  it("lets the routeToHuman seam replace the repeated-stall route", async () => {
    const { db, items } = makeDb({
      items: [parkedItem("d1", "PIR-DDDD2")],
      reports: [
        { reportId: "PIR-DDDD1", status: "suppressed", triggerKind: "plan-review-exhausted" },
        { reportId: "PIR-DDDD2", status: "suppressed", triggerKind: "plan-review-exhausted" },
      ],
      activities: [escalationActivity("d1", "PIR-DDDD1"), escalationActivity("d1", "PIR-DDDD2")],
    });
    const seen: unknown[] = [];

    const result = await reconcileEscalationParkedItems({
      db,
      now: NOW,
      routeRepeatedStall: async (ctx) => {
        seen.push(ctx);
        return { kind: "reopen", decisionRef: "DI-ROUTED" };
      },
    });

    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ itemId: "BI-D1", reportId: "PIR-DDDD2", cause: "plan-review-exhausted" });
    expect(result.reopened).toBe(1);
    expect(items[0].status).toBe("open");
  });

  it("is idempotent: a second run writes nothing", async () => {
    const { db, activities } = makeDb({
      items: [parkedItem("e1", "PIR-EEEEE")],
      reports: [{ reportId: "PIR-EEEEE", status: "resolved_locally", triggerKind: "plan-review-exhausted" }],
      activities: [escalationActivity("e1", "PIR-EEEEE")],
    });

    await reconcileEscalationParkedItems({ db, now: NOW });
    const after = activities.length;
    const second = await reconcileEscalationParkedItems({ db, now: NOW });

    expect(second).toMatchObject({ reopened: 0, redeferred: 0 });
    expect(activities.length).toBe(after);
  });

  it("dry run decides and counts but writes nothing", async () => {
    const { db, items, activities } = makeDb({
      items: [parkedItem("i1", "PIR-IIIII")],
      reports: [{ reportId: "PIR-IIIII", status: "resolved_locally", triggerKind: "plan-review-exhausted" }],
    });

    const result = await reconcileEscalationParkedItems({ db, now: NOW, dryRun: true });

    expect(result.reopened).toBe(1);
    expect(items[0].status).toBe("deferred");
    expect(activities).toHaveLength(0);
  });

  it("skips peer mirrors, open escalations and unknown reports", async () => {
    const { db, items } = makeDb({
      items: [
        parkedItem("f1", "PIR-FFFF1", { body: "x\n[origin:federatedWork:inst_peer:BI-F1]" }),
        parkedItem("f2", "PIR-FFFF2"),
        parkedItem("f3", "PIR-NOPE0"),
      ],
      reports: [
        { reportId: "PIR-FFFF1", status: "resolved_locally", triggerKind: "plan-review-exhausted" },
        { reportId: "PIR-FFFF2", status: "awaiting_escalation_ack", triggerKind: "plan-review-exhausted" },
      ],
    });

    const result = await reconcileEscalationParkedItems({ db, now: NOW });

    expect(result).toMatchObject({ reopened: 0, redeferred: 0 });
    expect(items.map((i) => i.status)).toEqual(["deferred", "deferred", "deferred"]);
  });

  it("does not clobber a deferral that changed between read and write", async () => {
    const { db, items } = makeDb({
      items: [parkedItem("g1", "PIR-GGGGG")],
      reports: [{ reportId: "PIR-GGGGG", status: "resolved_locally", triggerKind: "plan-review-exhausted" }],
    });
    const realUpdate = db.backlogItem.updateMany;
    db.backlogItem.updateMany = async (args) => {
      items[0].deferTrigger = "A person re-deferred this for another reason.";
      return realUpdate(args);
    };

    const result = await reconcileEscalationParkedItems({ db, now: NOW });

    expect(result.reopened).toBe(0);
    expect(items[0].status).toBe("deferred");
  });
});

describe("countEscalationParkedOrphans (invariant)", () => {
  it("counts only locally owned deferred items whose named escalation has resolved", async () => {
    const { db } = makeDb({
      items: [
        parkedItem("h1", "PIR-HHHH1"),
        parkedItem("h2", "PIR-HHHH2"),
        parkedItem("h3", "PIR-HHHH3", { body: "[origin:federatedWork:inst_peer:BI-H3]" }),
      ],
      reports: [
        { reportId: "PIR-HHHH1", status: "resolved_locally", triggerKind: "plan-review-exhausted" },
        { reportId: "PIR-HHHH2", status: "open", triggerKind: "plan-review-exhausted" },
        { reportId: "PIR-HHHH3", status: "resolved_locally", triggerKind: "plan-review-exhausted" },
      ],
    });

    expect(await countEscalationParkedOrphans(db)).toBe(1);
    await reconcileEscalationParkedItems({ db, now: NOW });
    expect(await countEscalationParkedOrphans(db)).toBe(0);
  });
});
