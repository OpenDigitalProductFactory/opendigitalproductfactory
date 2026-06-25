import { describe, it, expect } from "vitest";
import {
  isOverrideTier,
  overrideReason,
  compareAttention,
  orderAttention,
  orderReason,
  residueReasonLabel,
  attentionAgeLabel,
  timeToActFromDeadline,
  summarizeAttention,
} from "./triage";
import type { AttentionItem, AttentionTriage } from "./types";

// ─── Fixture helper ──────────────────────────────────────────────────────────

let seq = 0;
function item(overrides: Omit<Partial<AttentionItem>, "triage"> & { triage?: Partial<AttentionTriage> } = {}): AttentionItem {
  const { triage: triageOverrides, ...rest } = overrides;
  seq += 1;
  return {
    id: rest.id ?? `escalation:PIR-${seq}`,
    source: rest.source ?? "escalation",
    title: rest.title ?? "An item",
    context: rest.context ?? "context",
    decisionClass: rest.decisionClass ?? { scorability: "unscorable" },
    riskClass: rest.riskClass ?? "bounded-write",
    createdAtIso: rest.createdAtIso ?? "2026-06-23T12:00:00.000Z",
    actions: rest.actions ?? [],
    deepLink: rest.deepLink ?? "/build",
    audience: rest.audience ?? { operator: true },
    triage: {
      timeToAct: "none",
      residueReason: "self-fix-exhausted",
      decideEffort: "judgment",
      irreversible: false,
      ...triageOverrides,
    },
  };
}

// ─── Override tier ───────────────────────────────────────────────────────────

describe("isOverrideTier", () => {
  it("floats an overdue deadline to the override tier", () => {
    expect(isOverrideTier(item({ triage: { timeToAct: "overdue" } }))).toBe(true);
  });
  it("floats a due-today deadline to the override tier", () => {
    expect(isOverrideTier(item({ triage: { timeToAct: "due-today" } }))).toBe(true);
  });
  it("does NOT float a due-soon deadline", () => {
    expect(isOverrideTier(item({ triage: { timeToAct: "due-soon" } }))).toBe(false);
  });
  it("floats an irreversible high-risk item even with no deadline", () => {
    expect(
      isOverrideTier(item({ riskClass: "high-risk", triage: { irreversible: true } })),
    ).toBe(true);
  });
  it("does NOT float a reversible high-risk item", () => {
    expect(
      isOverrideTier(item({ riskClass: "high-risk", triage: { irreversible: false } })),
    ).toBe(false);
  });
  it("does NOT float an irreversible but low-risk item", () => {
    expect(
      isOverrideTier(item({ riskClass: "read", triage: { irreversible: true } })),
    ).toBe(false);
  });
});

describe("overrideReason", () => {
  it("explains an overdue override", () => {
    expect(overrideReason(item({ triage: { timeToAct: "overdue" } }))).toBe("deadline passed");
  });
  it("explains a due-today override", () => {
    expect(overrideReason(item({ triage: { timeToAct: "due-today" } }))).toBe("deadline today");
  });
  it("explains an irreversible-high-risk override", () => {
    expect(
      overrideReason(item({ riskClass: "high-risk", triage: { irreversible: true } })),
    ).toBe("irreversible, high-risk");
  });
  it("returns null for a non-override item", () => {
    expect(overrideReason(item())).toBeNull();
  });
});

// ─── Tiered ordering ─────────────────────────────────────────────────────────

describe("orderAttention", () => {
  it("puts override-tier items before everything else", () => {
    const normal = item({ id: "a:normal", riskClass: "high-risk", triage: { blastRadius: "delivery" } });
    const override = item({ id: "a:override", riskClass: "read", triage: { timeToAct: "overdue" } });
    const ordered = orderAttention([normal, override]);
    expect(ordered.map((i) => i.id)).toEqual(["a:override", "a:normal"]);
  });

  it("orders by risk within the same time tier", () => {
    const read = item({ id: "r:read", riskClass: "read" });
    const high = item({ id: "r:high", riskClass: "high-risk" });
    const bounded = item({ id: "r:bounded", riskClass: "bounded-write" });
    const ordered = orderAttention([read, high, bounded]);
    expect(ordered.map((i) => i.id)).toEqual(["r:high", "r:bounded", "r:read"]);
  });

  it("orders something-blocked before nothing-blocked within the same risk", () => {
    const blocked = item({ id: "b:blocked", triage: { blastRadius: "BI-123" } });
    const free = item({ id: "b:free" });
    expect(orderAttention([free, blocked]).map((i) => i.id)).toEqual(["b:blocked", "b:free"]);
  });

  it("breaks ties by age (oldest first, FIFO)", () => {
    const newer = item({ id: "age:new", createdAtIso: "2026-06-23T15:00:00.000Z" });
    const older = item({ id: "age:old", createdAtIso: "2026-06-23T09:00:00.000Z" });
    expect(orderAttention([newer, older]).map((i) => i.id)).toEqual(["age:old", "age:new"]);
  });

  it("is deterministic and does not mutate the input", () => {
    const input = [item({ id: "z" }), item({ id: "a" })];
    const snapshot = input.map((i) => i.id);
    const ordered = orderAttention(input);
    expect(input.map((i) => i.id)).toEqual(snapshot); // input untouched
    // Same risk/time/blast/age → final id tiebreak is stable.
    expect(ordered.map((i) => i.id)).toEqual(["a", "z"]);
  });

  it("a deadline override outranks an irreversible-high-risk override (time tier within override)", () => {
    const irreversible = item({ id: "o:irrev", riskClass: "high-risk", triage: { irreversible: true } });
    const overdue = item({ id: "o:overdue", riskClass: "read", triage: { timeToAct: "overdue" } });
    expect(orderAttention([irreversible, overdue]).map((i) => i.id)).toEqual(["o:overdue", "o:irrev"]);
  });
});

// ─── Explainability ──────────────────────────────────────────────────────────

describe("orderReason", () => {
  it("leads with the pin reason for an override", () => {
    expect(orderReason(item({ triage: { timeToAct: "overdue" } }))).toContain("pinned to top: deadline passed");
  });
  it("names high risk and what is blocked", () => {
    const reason = orderReason(item({ riskClass: "high-risk", triage: { blastRadius: "delivery" } }));
    expect(reason).toContain("high risk");
    expect(reason).toContain("blocks delivery");
  });
  it("falls back to the residue reason when nothing else is salient", () => {
    expect(orderReason(item({ triage: { residueReason: "coverage-gap" } }))).toBe(
      residueReasonLabel("coverage-gap"),
    );
  });
});

// ─── Deadline mapping ────────────────────────────────────────────────────────

describe("timeToActFromDeadline", () => {
  const now = new Date("2026-06-23T12:00:00.000Z").getTime();
  it("returns none when there is no deadline", () => {
    expect(timeToActFromDeadline(null, now)).toBe("none");
    expect(timeToActFromDeadline(undefined, now)).toBe("none");
  });
  it("returns overdue for a past deadline", () => {
    expect(timeToActFromDeadline("2026-06-23T06:00:00.000Z", now)).toBe("overdue");
  });
  it("returns due-today within the 24h window", () => {
    expect(timeToActFromDeadline("2026-06-24T06:00:00.000Z", now)).toBe("due-today");
  });
  it("returns due-soon within the week", () => {
    expect(timeToActFromDeadline("2026-06-27T12:00:00.000Z", now)).toBe("due-soon");
  });
  it("returns none for a far-off deadline", () => {
    expect(timeToActFromDeadline("2026-08-01T12:00:00.000Z", now)).toBe("none");
  });
});

describe("attentionAgeLabel", () => {
  const now = new Date("2026-06-23T12:00:00.000Z").getTime();
  it("reads just now under a minute", () => {
    expect(attentionAgeLabel("2026-06-23T11:59:30.000Z", now)).toBe("just now");
  });
  it("reads minutes, hours, and days", () => {
    expect(attentionAgeLabel("2026-06-23T11:30:00.000Z", now)).toBe("30m ago");
    expect(attentionAgeLabel("2026-06-23T09:00:00.000Z", now)).toBe("3h ago");
    expect(attentionAgeLabel("2026-06-21T12:00:00.000Z", now)).toBe("2d ago");
  });
});

describe("summarizeAttention", () => {
  it("counts total, pinned (override tier), high-risk, and groups by source", () => {
    const items = [
      item({ id: "e1", source: "escalation", riskClass: "high-risk" }),
      item({ id: "e2", source: "escalation" }),
      item({ id: "b1", source: "approval-bill", triage: { timeToAct: "overdue" } }),
      item({ id: "r1", source: "research-proposal", riskClass: "read" }),
    ];
    const s = summarizeAttention(items);
    expect(s.total).toBe(4);
    expect(s.pinned).toBe(1); // the overdue bill
    expect(s.highRisk).toBe(1);
    expect(s.bySource[0]).toEqual({ source: "escalation", count: 2 }); // highest count first
  });

  it("is empty-safe", () => {
    expect(summarizeAttention([])).toEqual({ total: 0, pinned: 0, highRisk: 0, bySource: [] });
  });
});
