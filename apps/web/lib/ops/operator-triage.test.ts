import { describe, it, expect } from "vitest";
import {
  classifyOperatorReason,
  selectOperatorQueue,
  partitionOperatorQueue,
  resolveOperatorScope,
  type OperatorTriageReason,
} from "./operator-triage";
import type { BacklogItemWithRelations } from "@/lib/backlog";

const NOW = new Date("2026-07-11T00:00:00.000Z");

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

function item(overrides: Partial<BacklogItemWithRelations>): BacklogItemWithRelations {
  return {
    id: overrides.id ?? overrides.itemId ?? "cuid",
    itemId: overrides.itemId ?? "BI-TEST",
    title: overrides.title ?? "Test item",
    status: "open",
    type: "product",
    workType: null,
    source: null,
    body: null,
    priority: null,
    epicId: null,
    triageOutcome: null,
    effortSize: null,
    activeBuildId: null,
    activeBuild: null,
    digitalProduct: null,
    taxonomyNode: null,
    submittedBy: null,
    completedAt: null,
    agentId: null,
    createdAt: daysAgo(10),
    updatedAt: daysAgo(10),
    upstreamIssueNumber: null,
    upstreamIssueUrl: null,
    ...overrides,
  };
}

describe("classifyOperatorReason", () => {
  it("flags a triaging item as awaiting-triage", () => {
    expect(classifyOperatorReason(item({ status: "triaging" }))).toBe("awaiting-triage");
  });

  it("flags a build-ready item as ready-to-build", () => {
    expect(
      classifyOperatorReason(
        item({ status: "open", triageOutcome: "build", effortSize: "medium" }),
      ),
    ).toBe("ready-to-build");
  });

  it("flags a failed linked build as build-attention", () => {
    expect(
      classifyOperatorReason(
        item({ activeBuildId: "b1", activeBuild: { buildId: "b1", phase: "failed" } }),
      ),
    ).toBe("build-attention");
  });

  it("flags an unavailable linked build (id set, relation missing) as build-attention", () => {
    expect(classifyOperatorReason(item({ activeBuildId: "b1", activeBuild: null }))).toBe(
      "build-attention",
    );
  });

  it("flags a blocked claim as blocked", () => {
    expect(classifyOperatorReason(item({ claimStatus: "blocked" }))).toBe("blocked");
  });

  it("flags an explicitly-stale live item as stalled", () => {
    expect(
      classifyOperatorReason(item({ status: "open", stalenessDetectedAt: daysAgo(30) })),
    ).toBe("stalled");
  });

  it("returns null for a healthy in-flight build (an agent is working)", () => {
    expect(
      classifyOperatorReason(
        item({ activeBuildId: "b1", activeBuild: { buildId: "b1", phase: "build" } }),
      ),
    ).toBeNull();
  });

  it("returns null for terminal items", () => {
    expect(classifyOperatorReason(item({ status: "done" }))).toBeNull();
    expect(classifyOperatorReason(item({ status: "deferred" }))).toBeNull();
  });

  it("returns null for closed dispositions (discard / duplicate / defer)", () => {
    expect(classifyOperatorReason(item({ status: "open", triageOutcome: "discard" }))).toBeNull();
    expect(classifyOperatorReason(item({ status: "open", triageOutcome: "duplicate" }))).toBeNull();
    expect(classifyOperatorReason(item({ status: "open", triageOutcome: "defer" }))).toBeNull();
  });

  it("returns null for a plain open item with no actionable signal", () => {
    expect(classifyOperatorReason(item({ status: "open" }))).toBeNull();
  });

  it("prioritizes build-attention over a stale flag on the same item", () => {
    const reason: OperatorTriageReason | null = classifyOperatorReason(
      item({
        activeBuildId: "b1",
        activeBuild: { buildId: "b1", phase: "failed" },
        stalenessDetectedAt: daysAgo(40),
      }),
    );
    expect(reason).toBe("build-attention");
  });
});

describe("selectOperatorQueue", () => {
  it("excludes items that need no operator decision", () => {
    const queue = selectOperatorQueue(
      [
        item({ itemId: "BI-DONE", status: "done" }),
        item({ itemId: "BI-WORKING", activeBuildId: "b", activeBuild: { buildId: "b", phase: "build" } }),
        item({ itemId: "BI-PLAIN", status: "open" }),
      ],
      NOW,
    );
    expect(queue).toHaveLength(0);
  });

  it("orders by business outcome first, then risk, then staleness", () => {
    const bizBug = item({ itemId: "BI-BIZ", status: "triaging", workType: "bug", businessValue: 8 });
    const riskyOnly = item({ itemId: "BI-RISK", status: "triaging", riskOpportunity: 9 });
    const staleOnly = item({
      itemId: "BI-STALE",
      status: "open",
      stalenessDetectedAt: daysAgo(60),
    });

    const queue = selectOperatorQueue([staleOnly, riskyOnly, bizBug], NOW);
    expect(queue.map((e) => e.item.itemId)).toEqual(["BI-BIZ", "BI-RISK", "BI-STALE"]);
  });

  it("ranks a customer-blocking bug above a non-blocking item", () => {
    const bug = item({ itemId: "BI-BUG", status: "triaging", workType: "bug" });
    const chore = item({ itemId: "BI-CHORE", status: "triaging", workType: "chore" });
    const queue = selectOperatorQueue([chore, bug], NOW);
    expect(queue[0]?.item.itemId).toBe("BI-BUG");
    expect(queue[0]?.blocksBusinessOutcome).toBe(true);
    expect(queue[1]?.blocksBusinessOutcome).toBe(false);
  });

  it("uses staleness as the tiebreaker when business and risk tie", () => {
    const older = item({ itemId: "BI-OLD", status: "triaging", updatedAt: daysAgo(90) });
    const newer = item({ itemId: "BI-NEW", status: "triaging", updatedAt: daysAgo(2) });
    const queue = selectOperatorQueue([newer, older], NOW);
    expect(queue.map((e) => e.item.itemId)).toEqual(["BI-OLD", "BI-NEW"]);
  });

  it("falls back to priority then itemId for full determinism", () => {
    const a = item({ itemId: "BI-A", status: "triaging", priority: 5, updatedAt: daysAgo(10) });
    const b = item({ itemId: "BI-B", status: "triaging", priority: 1, updatedAt: daysAgo(10) });
    const queue = selectOperatorQueue([a, b], NOW);
    // Lower priority number wins.
    expect(queue.map((e) => e.item.itemId)).toEqual(["BI-B", "BI-A"]);
  });

  it("is stable and side-effect free (does not mutate the input array)", () => {
    const input = [
      item({ itemId: "BI-1", status: "triaging" }),
      item({ itemId: "BI-2", status: "open", triageOutcome: "build", effortSize: "small" }),
    ];
    const snapshot = input.map((i) => i.itemId);
    selectOperatorQueue(input, NOW);
    expect(input.map((i) => i.itemId)).toEqual(snapshot);
  });

  it("tags each entry with a mine/company scope", () => {
    const queue = selectOperatorQueue([item({ itemId: "BI-BLK", claimStatus: "blocked" })], NOW);
    expect(queue[0]?.scope).toBe("mine");
  });
});

describe("resolveOperatorScope (BI-01CC2356)", () => {
  it("puts broken/blocked work on the operator's plate even with no principal", () => {
    expect(resolveOperatorScope(item({}), "build-attention")).toBe("mine");
    expect(resolveOperatorScope(item({}), "blocked")).toBe("mine");
  });

  it("treats routine throughput (triage / launch / stale) as company-wide", () => {
    expect(resolveOperatorScope(item({}), "awaiting-triage")).toBe("company");
    expect(resolveOperatorScope(item({}), "ready-to-build")).toBe("company");
    expect(resolveOperatorScope(item({}), "stalled")).toBe("company");
  });

  it("claims an item as mine when the current principal owns it", () => {
    const mineItem = item({ claimedById: "user-1" });
    expect(resolveOperatorScope(mineItem, "awaiting-triage", "user-1")).toBe("mine");
  });

  it("does not claim an item owned by someone else", () => {
    const theirs = item({ claimedById: "user-2" });
    expect(resolveOperatorScope(theirs, "awaiting-triage", "user-1")).toBe("company");
  });

  it("ignores claim ownership when no principal is provided", () => {
    const claimed = item({ claimedById: "user-1" });
    expect(resolveOperatorScope(claimed, "awaiting-triage")).toBe("company");
  });
});

describe("partitionOperatorQueue (BI-01CC2356)", () => {
  it("splits the queue into a personal lens and the company-wide pool", () => {
    const broken = item({ itemId: "BI-BROKEN", activeBuildId: "b", activeBuild: null }); // build-attention → mine
    const routine = item({ itemId: "BI-ROUTINE", status: "triaging" }); // awaiting-triage → company
    const { mine, company } = partitionOperatorQueue([routine, broken], undefined, NOW);
    expect(mine.map((e) => e.item.itemId)).toEqual(["BI-BROKEN"]);
    expect(company.map((e) => e.item.itemId)).toEqual(["BI-ROUTINE"]);
  });

  it("routes a principal's claimed routine item into the personal lens", () => {
    const claimedRoutine = item({ itemId: "BI-MINE", status: "triaging", claimedById: "user-1" });
    const otherRoutine = item({ itemId: "BI-OTHER", status: "triaging" });
    const { mine, company } = partitionOperatorQueue([claimedRoutine, otherRoutine], "user-1", NOW);
    expect(mine.map((e) => e.item.itemId)).toEqual(["BI-MINE"]);
    expect(company.map((e) => e.item.itemId)).toEqual(["BI-OTHER"]);
  });

  it("preserves the full-queue ordering within each side and loses no items", () => {
    const items = [
      item({ itemId: "BI-A", status: "triaging", businessValue: 5 }),
      item({ itemId: "BI-B", claimStatus: "blocked" }),
      item({ itemId: "BI-C", status: "triaging", riskOpportunity: 9 }),
    ];
    const full = selectOperatorQueue(items, NOW);
    const { mine, company } = partitionOperatorQueue(items, undefined, NOW);
    expect(mine.length + company.length).toBe(full.length);
    // Company side keeps the same relative order it had in the full queue.
    const fullCompanyOrder = full.filter((e) => e.scope === "company").map((e) => e.item.itemId);
    expect(company.map((e) => e.item.itemId)).toEqual(fullCompanyOrder);
  });
});
