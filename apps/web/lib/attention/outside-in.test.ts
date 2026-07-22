import { describe, expect, it } from "vitest";

import type { AttentionItem, AttentionPortfolio, AttentionSource } from "./types";
import {
  PORTFOLIO_DEPTH,
  PORTFOLIOS_OUTSIDE_IN,
  blocksBusinessOutcome,
  buildOutsideInCockpit,
  compareOutsideIn,
  entersPrimaryQueue,
  isPrimaryPortfolio,
  orderOutsideIn,
  outsideInReason,
  portfolioForSource,
  portfolioOf,
} from "./outside-in";

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Minimal attention item with knobs for the dimensions the outside-in rule reads:
 *  source (→ default portfolio), an explicit portfolio, blastRadius (blocking),
 *  a deadline (override tier), and createdAt (the age tie-break). */
function item(
  over: Partial<{
    id: string;
    source: AttentionSource;
    portfolio: AttentionPortfolio;
    blastRadius: string | undefined;
    deadlineIso: string;
    timeToAct: AttentionItem["triage"]["timeToAct"];
    riskClass: AttentionItem["riskClass"];
    irreversible: boolean;
    createdAtIso: string;
  }> = {},
): AttentionItem {
  return {
    id: over.id ?? "item-1",
    source: over.source ?? "ai-decision",
    title: over.id ?? "item-1",
    context: "ctx",
    decisionClass: { scorability: "unscorable" },
    riskClass: over.riskClass ?? "bounded-write",
    triage: {
      timeToAct: over.timeToAct ?? "none",
      deadlineIso: over.deadlineIso,
      residueReason: "coverage-gap",
      blastRadius: over.blastRadius,
      decideEffort: "judgment",
      irreversible: over.irreversible ?? false,
    },
    createdAtIso: over.createdAtIso ?? "2026-07-11T00:00:00.000Z",
    actions: [],
    deepLink: "/x",
    audience: { operator: true },
    ...(over.portfolio ? { portfolio: over.portfolio } : {}),
  };
}

const NOW = "2026-07-11T12:00:00.000Z";
const TWELVE_DAYS_AGO = "2026-06-29T12:00:00.000Z";

// ── Classification ──────────────────────────────────────────────────────────

describe("portfolio classification", () => {
  it("orders the four portfolios outside-in (customer first, foundational last)", () => {
    expect(PORTFOLIOS_OUTSIDE_IN).toEqual([
      "products-and-services-sold",
      "for-employees",
      "manufacturing-and-delivery",
      "foundational",
    ]);
    expect(PORTFOLIO_DEPTH["products-and-services-sold"]).toBeLessThan(
      PORTFOLIO_DEPTH.foundational,
    );
  });

  it("treats only products-and-services-sold + for-employees as primary", () => {
    expect(isPrimaryPortfolio("products-and-services-sold")).toBe(true);
    expect(isPrimaryPortfolio("for-employees")).toBe(true);
    expect(isPrimaryPortfolio("manufacturing-and-delivery")).toBe(false);
    expect(isPrimaryPortfolio("foundational")).toBe(false);
  });

  it("maps customer-facing + workforce sources to the primary portfolios", () => {
    expect(portfolioForSource("approval-outbound")).toBe("products-and-services-sold");
    expect(portfolioForSource("ai-decision")).toBe("for-employees");
    expect(portfolioForSource("paused-ai")).toBe("for-employees");
    expect(portfolioForSource("coworker-memory")).toBe("for-employees");
  });

  it("maps build + back-office sources to the inner portfolios", () => {
    expect(portfolioForSource("escalation")).toBe("manufacturing-and-delivery");
    expect(portfolioForSource("approval-bill")).toBe("foundational");
    expect(portfolioForSource("compliance-submission")).toBe("foundational");
    expect(portfolioForSource("ai-readiness-blocker")).toBe("foundational");
  });

  it("an explicit portfolio tag wins over the source default", () => {
    const tagged = item({ source: "escalation", portfolio: "products-and-services-sold" });
    expect(portfolioOf(tagged)).toBe("products-and-services-sold");
    // Un-tagged falls back to the source default.
    expect(portfolioOf(item({ source: "escalation" }))).toBe("manufacturing-and-delivery");
  });
});

// ── Blocking / primary-queue membership ──────────────────────────────────────

describe("blocksBusinessOutcome + entersPrimaryQueue", () => {
  it("a blastRadius flags the item as blocking a customer/business outcome", () => {
    expect(blocksBusinessOutcome(item({ blastRadius: "BI-123" }))).toBe(true);
    expect(blocksBusinessOutcome(item({ blastRadius: undefined }))).toBe(false);
  });

  it("an imminent hard deadline (override tier) counts as blocking", () => {
    expect(blocksBusinessOutcome(item({ timeToAct: "overdue" }))).toBe(true);
    expect(blocksBusinessOutcome(item({ timeToAct: "due-today" }))).toBe(true);
    expect(blocksBusinessOutcome(item({ timeToAct: "due-soon" }))).toBe(false);
  });

  it("(c) an inner item enters the primary queue ONLY when it blocks an outcome", () => {
    const innerCalm = item({ source: "escalation", blastRadius: undefined }); // manufacturing, no block
    const innerBlocking = item({ source: "escalation", blastRadius: "BI-9" }); // manufacturing, blocking
    expect(entersPrimaryQueue(innerCalm)).toBe(false);
    expect(entersPrimaryQueue(innerBlocking)).toBe(true);
  });

  it("a primary-portfolio item is always in the primary queue, blocking or not", () => {
    expect(entersPrimaryQueue(item({ source: "approval-outbound" }))).toBe(true);
    expect(entersPrimaryQueue(item({ source: "ai-decision" }))).toBe(true);
  });
});

// ── Comparator ───────────────────────────────────────────────────────────────

describe("compareOutsideIn", () => {
  it("(a) a customer-facing item outranks a foundational item of the SAME age", () => {
    const customer = item({
      id: "customer",
      source: "approval-outbound",
      createdAtIso: NOW,
    });
    const foundational = item({
      id: "foundational",
      source: "approval-bill",
      createdAtIso: NOW,
      timeToAct: "none",
    });
    const ordered = orderOutsideIn([foundational, customer]);
    expect(ordered.map((i) => i.id)).toEqual(["customer", "foundational"]);
  });

  it("(b) a just-now customer-blocking item outranks a 12-day-old inner-tooling item", () => {
    // The F7 fix: age must NOT promote the stale inner item above the fresh blocker.
    const staleInner = item({
      id: "stale-ideate",
      source: "escalation", // manufacturing-and-delivery
      blastRadius: undefined, // not blocking a customer outcome
      timeToAct: "none",
      createdAtIso: TWELVE_DAYS_AGO,
    });
    const freshBlocker = item({
      id: "fresh-outage",
      source: "escalation", // also inner, but…
      blastRadius: "checkout-service", // …blocking a customer outcome — jumps the queue
      timeToAct: "none",
      createdAtIso: NOW,
    });
    const ordered = orderOutsideIn([staleInner, freshBlocker]);
    expect(ordered[0]?.id).toBe("fresh-outage");
  });

  it("within the same blocking + portfolio band, defers to objective triage (deadline first)", () => {
    const older = item({ id: "older", source: "ai-decision", createdAtIso: TWELVE_DAYS_AGO });
    const overdue = item({
      id: "overdue",
      source: "ai-decision",
      timeToAct: "overdue",
      createdAtIso: NOW,
    });
    // overdue is blocking (override) so it jumps ahead of the calm older item.
    const ordered = orderOutsideIn([older, overdue]);
    expect(ordered[0]?.id).toBe("overdue");
  });

  it("customer-facing depth breaks ties among two blockers", () => {
    const innerBlocker = item({
      id: "inner",
      source: "escalation",
      blastRadius: "build-x",
    });
    const customerBlocker = item({
      id: "customer",
      source: "approval-outbound",
      blastRadius: "campaign-y",
    });
    const ordered = orderOutsideIn([innerBlocker, customerBlocker]);
    expect(ordered.map((i) => i.id)).toEqual(["customer", "inner"]);
  });

  it("is a pure total order (sorting a copy leaves the input untouched)", () => {
    const input = [
      item({ id: "b", source: "approval-bill" }),
      item({ id: "a", source: "approval-outbound" }),
    ];
    const snapshot = input.map((i) => i.id);
    orderOutsideIn(input);
    expect(input.map((i) => i.id)).toEqual(snapshot);
    expect(compareOutsideIn(input[0]!, input[0]!)).toBe(0);
  });
});

// ── The cockpit (single source of truth) ─────────────────────────────────────

describe("buildOutsideInCockpit", () => {
  it("(d, empty) an empty queue has count 0 and no primary items — nothing needs you", () => {
    const cockpit = buildOutsideInCockpit([]);
    expect(cockpit.count).toBe(0);
    expect(cockpit.primary).toHaveLength(0);
    expect(cockpit.primaryGroups).toHaveLength(0);
  });

  it("(d, non-empty) the count equals the primary queue length — the ONE number", () => {
    const cockpit = buildOutsideInCockpit([
      item({ id: "c", source: "approval-outbound" }),
      item({ id: "w", source: "ai-decision" }),
    ]);
    expect(cockpit.count).toBe(2);
    expect(cockpit.primary.map((i) => i.id)).toEqual(["c", "w"]);
  });

  it("keeps inner, non-blocking items OUT of the primary count (they go to secondary)", () => {
    const cockpit = buildOutsideInCockpit([
      item({ id: "customer", source: "approval-outbound" }),
      item({ id: "stale-inner", source: "approval-bill", timeToAct: "none" }),
    ]);
    expect(cockpit.count).toBe(1); // the count never inflates with demoted inner noise
    expect(cockpit.primary.map((i) => i.id)).toEqual(["customer"]);
    expect(cockpit.secondary.map((i) => i.id)).toEqual(["stale-inner"]);
  });

  it("groups the primary queue by portfolio, outside-in, omitting empty groups", () => {
    const cockpit = buildOutsideInCockpit([
      item({ id: "bill-blocking", source: "approval-bill", blastRadius: "payroll" }), // foundational, jumps
      item({ id: "worker", source: "ai-decision" }), // for-employees
      item({ id: "cust", source: "approval-outbound" }), // products
    ]);
    expect(cockpit.primaryGroups.map((g) => g.portfolio)).toEqual([
      "products-and-services-sold",
      "for-employees",
      "foundational",
    ]);
    expect(cockpit.primaryGroups[0]?.items.map((i) => i.id)).toEqual(["cust"]);
  });
});

// ── Explainability ───────────────────────────────────────────────────────────

describe("outsideInReason", () => {
  it("names the queue-jump and the portfolio for a blocking inner item", () => {
    const reason = outsideInReason(
      item({ source: "escalation", blastRadius: "checkout-service" }),
    );
    expect(reason).toContain("blocking a customer/business outcome");
    expect(reason).toContain("checkout-service");
    expect(reason).toContain("Manufacturing & delivery");
  });

  it("names just the portfolio for a calm customer-facing item", () => {
    const reason = outsideInReason(item({ source: "approval-outbound" }));
    expect(reason).toBe("Products & services sold");
  });
});
