import { describe, expect, it, vi } from "vitest";

import {
  aggregateCraftConsultDemand,
  listCraftConsultDemand,
  UNBOUND_PROFESSION_KEY,
  type CraftConsultLedgerRow,
} from "./craft-consult-demand";

function row(over: Partial<CraftConsultLedgerRow> = {}): CraftConsultLedgerRow {
  return {
    domainClass: "architecture-tradeoff",
    question: "Architectural alignment review: split the ledger",
    outcomeType: "defer",
    gateFallbackUsed: true,
    outcomePayload: { professionKey: "enterprise-architecture" },
    createdAt: new Date("2026-09-06T00:00:00Z"),
    ...over,
  };
}

describe("aggregateCraftConsultDemand", () => {
  it("groups fallback consults per profession and decision class, newest sample first", () => {
    const rows = [
      row(),
      row({ createdAt: new Date("2026-09-07T00:00:00Z"), question: "newer question" }),
      row({ outcomeType: "recommend", gateFallbackUsed: true }),
      row({
        domainClass: "professional-practice",
        outcomePayload: { professionKey: "data-architect" },
        outcomeType: "escalate",
        gateFallbackUsed: false,
      }),
    ];
    const demand = aggregateCraftConsultDemand(rows);
    expect(demand).toEqual([
      {
        professionKey: "enterprise-architecture",
        domainClass: "architecture-tradeoff",
        consults: 3,
        deferred: 2,
        sampleQuestion: "newer question",
        latestAt: new Date("2026-09-07T00:00:00Z"),
      },
      {
        professionKey: "data-architect",
        domainClass: "professional-practice",
        consults: 1,
        deferred: 0,
        sampleQuestion: "Architectural alignment review: split the ledger",
        latestAt: new Date("2026-09-06T00:00:00Z"),
      },
    ]);
  });

  it("does not count a consult the craft's own profile answered", () => {
    expect(
      aggregateCraftConsultDemand([row({ outcomeType: "recommend", gateFallbackUsed: false })]),
    ).toEqual([]);
  });

  it("files a coworker with no profession family under `unbound` instead of dropping it", () => {
    const demand = aggregateCraftConsultDemand([row({ outcomePayload: { professionKey: null } })]);
    expect(demand[0]?.professionKey).toBe(UNBOUND_PROFESSION_KEY);
  });
});

describe("listCraftConsultDemand", () => {
  it("reads only profession-gate rows inside the window that fell back or went unanswered", async () => {
    const findMany = vi.fn().mockResolvedValue([row()]);
    const now = new Date("2026-09-08T00:00:00Z");
    const demand = await listCraftConsultDemand({ decisionInteraction: { findMany } }, { now, sinceDays: 30 });

    expect(demand).toHaveLength(1);
    const args = findMany.mock.calls[0]![0] as { where: Record<string, unknown> };
    expect(args.where.gateKey).toBe("profession");
    expect(args.where.createdAt).toEqual({ gte: new Date("2026-08-09T00:00:00Z") });
    expect(args.where.OR).toEqual([
      { gateFallbackUsed: true },
      { outcomeType: { in: ["defer", "escalate"] } },
    ]);
  });
});
