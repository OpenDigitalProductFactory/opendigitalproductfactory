import { describe, it, expect } from "vitest";

import {
  buildTierStats,
  gateKeysForTier,
  profileKindsForTier,
  tierForGateKey,
  tierForProfileKind,
  tierForRow,
  tierWhere,
  toAuditRow,
  type DecisionAuditRowInput,
  buildCallerStats,
} from "./decision-audit";

function makeRow(overrides: Partial<DecisionAuditRowInput> = {}): DecisionAuditRowInput {
  return {
    interactionId: "DI-ABC123",
    createdAt: new Date("2026-07-06T10:00:00Z"),
    question: "Which approach?",
    options: ["a", "b"],
    outcomeType: "recommend",
    riskTier: "low",
    principleConflict: false,
    domainClass: "kernel-consult",
    routeContext: "mcp:principle_decide",
    rationale: "Recommends a.",
    confidenceAfter: 0.9,
    outcomePayload: { recommendedOptionId: "a" },
    humanOutcome: null,
    profile: { kind: "platform", name: "Mark / DPF platform" },
    escalationCapture: null,
    deferralCapture: null,
    ...overrides,
  };
}

describe("tierForProfileKind", () => {
  it("maps profile kinds onto the three governance tiers", () => {
    expect(tierForProfileKind("platform")).toBe("wwmd");
    expect(tierForProfileKind("organization")).toBe("wwwd");
    expect(tierForProfileKind("profession")).toBe("wsid");
    expect(tierForProfileKind("persona-real")).toBe("other");
    expect(tierForProfileKind(null)).toBe("other");
  });

  it("round-trips with profileKindsForTier", () => {
    for (const tier of ["wwmd", "wwwd", "wsid"] as const) {
      for (const kind of profileKindsForTier(tier)) {
        expect(tierForProfileKind(kind)).toBe(tier);
      }
    }
  });
});

describe("tierForGateKey", () => {
  it("maps gate keys onto the three governance tiers", () => {
    expect(tierForGateKey("build-studio")).toBe("wwmd");
    expect(tierForGateKey("backlog-triage")).toBe("wwmd");
    expect(tierForGateKey("kernel-consult")).toBe("wwmd");
    expect(tierForGateKey("org-business")).toBe("wwwd");
    expect(tierForGateKey("profession")).toBe("wsid");
    expect(tierForGateKey("not-a-gate")).toBe("other");
    expect(tierForGateKey(null)).toBe("other");
  });

  it("round-trips with gateKeysForTier", () => {
    for (const tier of ["wwmd", "wwwd", "wsid"] as const) {
      for (const key of gateKeysForTier(tier)) {
        expect(tierForGateKey(key)).toBe(tier);
      }
    }
  });
});

describe("tierForRow (BI-1BE30A9A)", () => {
  // The regression this whole change exists for: the profession gate falls
  // back to MARK_DPF_PLATFORM_PROFILE when the craft corpus has no material
  // for a decision class. Tiering on the resolved profile filed that WSID
  // decision under WWMD, so the WSID tier read "never used" no matter how
  // often the gate ran.
  it("keeps a profession decision in WSID even when doctrine fell back to platform", () => {
    expect(
      tierForRow({ gateKey: "profession", profile: { kind: "platform" } }),
    ).toBe("wsid");
  });

  it("keeps an org decision in WWWD even when doctrine fell back to platform", () => {
    expect(
      tierForRow({ gateKey: "org-business", profile: { kind: "platform" } }),
    ).toBe("wwwd");
  });

  it("prefers the gate over the profile kind whenever both are present", () => {
    expect(tierForRow({ gateKey: "build-studio", profile: { kind: "profession" } })).toBe("wwmd");
  });

  it("falls back to profile kind for rows written before gateKey existed", () => {
    expect(tierForRow({ gateKey: null, profile: { kind: "organization" } })).toBe("wwwd");
    expect(tierForRow({ profile: { kind: "platform" } })).toBe("wwmd");
  });

  it("reports 'other' when neither dimension resolves", () => {
    expect(tierForRow({ gateKey: null, profile: null })).toBe("other");
  });
});

describe("tierWhere", () => {
  it("matches the gate first and profile kind only for pre-column rows", () => {
    expect(tierWhere("wsid")).toEqual({
      OR: [
        { gateKey: { in: ["profession"] } },
        { gateKey: null, profile: { kind: { in: ["profession"] } } },
      ],
    });
  });

  // A filter that diverges from tierForRow would make the tier counts
  // disagree with the rows the timeline actually shows.
  it("agrees with tierForRow on both branches, for every tier", () => {
    for (const tier of ["wwmd", "wwwd", "wsid"] as const) {
      const where = tierWhere(tier) as {
        OR: [
          { gateKey: { in: string[] } },
          { gateKey: null; profile: { kind: { in: string[] } } },
        ];
      };
      for (const gateKey of where.OR[0].gateKey.in) {
        expect(tierForRow({ gateKey, profile: null })).toBe(tier);
      }
      for (const kind of where.OR[1].profile.kind.in) {
        expect(tierForRow({ gateKey: null, profile: { kind } })).toBe(tier);
      }
    }
  });
});

describe("toAuditRow", () => {
  it("shapes a ledger row for the audit table", () => {
    const row = toAuditRow(makeRow());
    expect(row.tier).toBe("wwmd");
    expect(row.tierCode).toBe("WWMD");
    expect(row.optionCount).toBe(2);
    expect(row.recommendedOptionId).toBe("a");
    expect(row.awaitingHuman).toBe(false);
    expect(row.createdAt).toBe("2026-07-06T10:00:00.000Z");
  });

  it("marks unresolved escalations as awaiting a human", () => {
    const row = toAuditRow(makeRow({ outcomeType: "escalate" }));
    expect(row.awaitingHuman).toBe(true);
  });

  it("treats an escalation capture or human outcome as resolved", () => {
    expect(
      toAuditRow(
        makeRow({
          outcomeType: "escalate",
          escalationCapture: { createdAt: new Date() },
        }),
      ).awaitingHuman,
    ).toBe(false);
    expect(
      toAuditRow(
        makeRow({ outcomeType: "defer", humanOutcome: { clearsGate: true } }),
      ).awaitingHuman,
    ).toBe(false);
  });

  it("degrades gracefully on missing profile and payload", () => {
    const row = toAuditRow(
      makeRow({ profile: null, outcomePayload: null, options: null, routeContext: null }),
    );
    expect(row.tier).toBe("other");
    expect(row.profileName).toBe("—");
    expect(row.optionCount).toBe(0);
    expect(row.recommendedOptionId).toBeNull();
    expect(row.routeContext).toBe("—");
  });
});

describe("buildTierStats", () => {
  it("shapes per-tier usage including the never-used signal", () => {
    const stats = buildTierStats({
      tier: "wwmd",
      total: 0,
      last7d: 0,
      last30d: 0,
      unresolved: 0,
      lastDecisionAt: null,
    });
    expect(stats.code).toBe("WWMD");
    expect(stats.total).toBe(0);
    expect(stats.lastDecisionAt).toBeNull();
  });

  it("serializes the last-decision timestamp", () => {
    const stats = buildTierStats({
      tier: "wsid",
      total: 3,
      last7d: 1,
      last30d: 2,
      unresolved: 1,
      lastDecisionAt: new Date("2026-07-01T00:00:00Z"),
    });
    expect(stats.lastDecisionAt).toBe("2026-07-01T00:00:00.000Z");
  });
});

describe("caller attribution (BI-0EEBA669)", () => {
  const baseRow = {
    interactionId: "DI-1",
    createdAt: new Date("2026-07-06T08:00:00Z"),
    question: "Q",
    options: ["a", "b"],
    outcomeType: "recommend",
    riskTier: "low",
    principleConflict: false,
    domainClass: "kernel-consult",
    routeContext: "/build",
    rationale: null,
    confidenceAfter: 0.9,
    humanOutcome: null,
    profile: { kind: "platform", name: "Mark / DPF Platform" },
    escalationCapture: null,
    deferralCapture: null,
  };

  it("prefers the persisted caller client over everything else", () => {
    const row = toAuditRow({
      ...baseRow,
      outcomePayload: {
        callingSurface: "claude-code/session-x",
        caller: { client: "codex-cli/0.9", agentId: "customer-advisor", threadId: "th_123456789" },
      },
    });
    expect(row.callerLabel).toBe("codex-cli/0.9");
    expect(row.callerThreadId).toBe("th_123456789");
  });

  it("falls back to the coworker agent, then callingSurface, then unattributed", () => {
    const agentRow = toAuditRow({
      ...baseRow,
      outcomePayload: { caller: { agentId: "customer-advisor" } },
    });
    expect(agentRow.callerLabel).toBe("coworker:customer-advisor");

    const surfaceRow = toAuditRow({
      ...baseRow,
      outcomePayload: { callingSurface: "claude-code/wwwd-plan" },
    });
    expect(surfaceRow.callerLabel).toBe("claude-code/wwwd-plan");

    const bareRow = toAuditRow({ ...baseRow, outcomePayload: {} });
    expect(bareRow.callerLabel).toBe("—");
    expect(bareRow.callerThreadId).toBeNull();
  });

  it("rolls timeline rows up by caller with volume ordering", () => {
    const rows = [
      { outcomePayload: { caller: { client: "claude-code/2.1" } } },
      { outcomePayload: { caller: { client: "claude-code/2.1" } } },
      { outcomePayload: { caller: { client: "grok-cli/1.0" } } },
    ].map((extra, i) =>
      toAuditRow({
        ...baseRow,
        interactionId: `DI-${i}`,
        createdAt: new Date(Date.UTC(2026, 6, 6, 8, i)),
        ...extra,
      }),
    );
    const stats = buildCallerStats(rows);
    expect(stats.map((s) => [s.label, s.total])).toEqual([
      ["claude-code/2.1", 2],
      ["grok-cli/1.0", 1],
    ]);
    expect(stats[0]!.lastAt).toBe("2026-07-06T08:01:00.000Z");
  });
});
