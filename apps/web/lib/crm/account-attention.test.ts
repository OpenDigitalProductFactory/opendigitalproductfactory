import { describe, expect, it } from "vitest";
import {
  classifyAccountAttention,
  sortAccountsByAttention,
  STALE_ACTIVITY_DAYS,
  type AccountAttentionInput,
} from "./account-attention";

const NOW = new Date("2026-07-11T12:00:00Z");

function baseInput(overrides: Partial<AccountAttentionInput> = {}): AccountAttentionInput {
  return {
    status: "active",
    opportunities: [],
    quotes: [],
    engagements: [],
    lastActivityAt: NOW,
    createdAt: NOW,
    now: NOW,
    ...overrides,
  };
}

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000);
}

function inDays(days: number): Date {
  return new Date(NOW.getTime() + days * 24 * 60 * 60 * 1000);
}

describe("classifyAccountAttention", () => {
  it("returns no signal for a healthy active account with no open work", () => {
    const attention = classifyAccountAttention(baseInput());
    expect(attention.signal).toBeNull();
    expect(attention.severity).toBe(0);
    expect(attention.label).toBe("");
  });

  it("flags an explicitly at-risk account as the most urgent signal", () => {
    const attention = classifyAccountAttention(baseInput({ status: "at_risk" }));
    expect(attention.signal).toBe("at_risk");
    expect(attention.severity).toBe(4);
    expect(attention.tone).toBe("danger");
  });

  it("flags an expired quote as at-risk", () => {
    const attention = classifyAccountAttention(
      baseInput({ quotes: [{ status: "expired", validUntil: daysAgo(5) }] }),
    );
    expect(attention.signal).toBe("at_risk");
    expect(attention.reason).toContain("expired");
  });

  it("flags a dormant open opportunity as at-risk", () => {
    const attention = classifyAccountAttention(
      baseInput({
        opportunities: [{ stage: "proposal", isDormant: true, expectedClose: inDays(10) }],
      }),
    );
    expect(attention.signal).toBe("at_risk");
    expect(attention.reason).toContain("dormant");
  });

  it("flags an overdue expected close as follow-up-due", () => {
    const attention = classifyAccountAttention(
      baseInput({
        opportunities: [{ stage: "negotiation", isDormant: false, expectedClose: daysAgo(3) }],
      }),
    );
    expect(attention.signal).toBe("follow_up_due");
    expect(attention.severity).toBe(3);
    expect(attention.tone).toBe("warning");
    expect(attention.reason).toContain("past expected close");
  });

  it("flags a sent quote past its validity as follow-up-due", () => {
    const attention = classifyAccountAttention(
      baseInput({ quotes: [{ status: "sent", validUntil: daysAgo(1) }] }),
    );
    expect(attention.signal).toBe("follow_up_due");
    expect(attention.reason).toContain("past validity");
  });

  it("flags a new unworked engagement as follow-up-due", () => {
    const attention = classifyAccountAttention(
      baseInput({ engagements: [{ status: "new" }] }),
    );
    expect(attention.signal).toBe("follow_up_due");
    expect(attention.reason).toContain("awaiting first contact");
  });

  it("treats a live sent quote (still valid) as commitment-pending", () => {
    const attention = classifyAccountAttention(
      baseInput({ quotes: [{ status: "sent", validUntil: inDays(10) }] }),
    );
    expect(attention.signal).toBe("commitment_pending");
    expect(attention.severity).toBe(2);
    expect(attention.tone).toBe("accent");
    expect(attention.reason).toContain("awaiting the customer");
  });

  it("treats an in-negotiation opportunity as commitment-pending", () => {
    const attention = classifyAccountAttention(
      baseInput({
        opportunities: [{ stage: "negotiation", isDormant: false, expectedClose: inDays(20) }],
      }),
    );
    expect(attention.signal).toBe("commitment_pending");
    expect(attention.reason).toContain("negotiation");
  });

  it("flags open work with no recent activity as stale", () => {
    const attention = classifyAccountAttention(
      baseInput({
        opportunities: [{ stage: "discovery", isDormant: false, expectedClose: inDays(30) }],
        lastActivityAt: daysAgo(STALE_ACTIVITY_DAYS + 5),
      }),
    );
    expect(attention.signal).toBe("stale");
    expect(attention.severity).toBe(1);
    expect(attention.reason).toContain("No activity");
  });

  it("does NOT flag a brand-new account with open work as stale", () => {
    const attention = classifyAccountAttention(
      baseInput({
        opportunities: [{ stage: "discovery", isDormant: false, expectedClose: inDays(30) }],
        lastActivityAt: null,
        createdAt: daysAgo(2),
      }),
    );
    expect(attention.signal).toBeNull();
  });

  it("does NOT flag a quiet account that has no open work", () => {
    const attention = classifyAccountAttention(
      baseInput({
        opportunities: [{ stage: "closed_won", isDormant: false, expectedClose: daysAgo(90) }],
        lastActivityAt: daysAgo(120),
      }),
    );
    expect(attention.signal).toBeNull();
  });

  it("prefers the more urgent signal when several apply", () => {
    // Dormant open opp (at_risk) AND an overdue close (follow_up_due) — at_risk wins.
    const attention = classifyAccountAttention(
      baseInput({
        opportunities: [
          { stage: "proposal", isDormant: true, expectedClose: daysAgo(5) },
          { stage: "discovery", isDormant: false, expectedClose: daysAgo(5) },
        ],
      }),
    );
    expect(attention.signal).toBe("at_risk");
  });

  it("ignores closed opportunities when deciding open-work signals", () => {
    const attention = classifyAccountAttention(
      baseInput({
        opportunities: [{ stage: "closed_lost", isDormant: true, expectedClose: daysAgo(10) }],
      }),
    );
    expect(attention.signal).toBeNull();
  });
});

describe("sortAccountsByAttention", () => {
  it("orders accounts by descending severity, ties broken by name", () => {
    const accounts = [
      { name: "Zephyr", attention: classifyAccountAttention(baseInput()) },
      {
        name: "Northwind",
        attention: classifyAccountAttention(baseInput({ status: "at_risk" })),
      },
      {
        name: "Emma3D",
        attention: classifyAccountAttention(
          baseInput({ engagements: [{ status: "new" }] }),
        ),
      },
      {
        name: "Acme",
        attention: classifyAccountAttention(baseInput()),
      },
    ];

    const ordered = sortAccountsByAttention(
      accounts,
      (a) => a.attention,
      (a) => a.name,
    ).map((a) => a.name);

    // at_risk (Northwind) first, then follow_up_due (Emma3D), then the two
    // no-signal accounts in name order (Acme, Zephyr).
    expect(ordered).toEqual(["Northwind", "Emma3D", "Acme", "Zephyr"]);
  });
});
