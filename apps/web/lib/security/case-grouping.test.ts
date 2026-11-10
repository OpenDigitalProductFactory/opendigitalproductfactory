// EP-SOVEREIGN-SOC P2 — detection → case grouping unit tests.
import { describe, expect, it } from "vitest";

import {
  deriveGroupingKey,
  detectionFamily,
  detectionRowToGroupingInput,
  groupDetectionsIntoCases,
  maxSeverity,
  type DetectionForGrouping,
  type DetectionRowForGrouping,
} from "./case-grouping";

const T0 = new Date("2026-06-25T12:00:00.000Z");
const T1 = new Date("2026-06-25T12:05:00.000Z");
const T2 = new Date("2026-06-25T12:10:00.000Z");

function det(overrides: Partial<DetectionForGrouping>): DetectionForGrouping {
  return {
    detectionKey: "pack:r:e1",
    scopeKey: "customer:acct_1",
    customerAccountId: "acct_1",
    customerSiteId: null,
    severity: "medium",
    groupingKey: deriveGroupingKey({ scopeKey: "customer:acct_1", entityKey: "HOST1", family: "credential-access" }),
    title: "Suspicious logon",
    ruleName: "Suspicious logon",
    entityKey: "HOST1",
    firstSeenAt: T0,
    lastSeenAt: T0,
    ...overrides,
  };
}

describe("maxSeverity / deriveGroupingKey", () => {
  it("ranks severities", () => {
    expect(maxSeverity("low", "critical")).toBe("critical");
    expect(maxSeverity("high", "medium")).toBe("high");
    expect(maxSeverity("info", "info")).toBe("info");
  });
  it("derives a stable grouping key", () => {
    const k = deriveGroupingKey({ scopeKey: "customer:acct_1", entityKey: "HOST1", family: "x" });
    expect(k).toBe("customer:acct_1|HOST1|x");
  });
});

describe("groupDetectionsIntoCases", () => {
  it("merges detections sharing a grouping key into one stable case", () => {
    const gk = deriveGroupingKey({ scopeKey: "customer:acct_1", entityKey: "HOST1", family: "credential-access" });
    const out = groupDetectionsIntoCases([
      det({ detectionKey: "pack:r:e1", severity: "medium", firstSeenAt: T0, lastSeenAt: T0, title: "logon a" }),
      det({ detectionKey: "pack:r:e2", severity: "high", firstSeenAt: T1, lastSeenAt: T2, title: "logon b (high)" }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      caseKey: `case:${gk}`,
      severity: "high", // max
      title: "logon b (high)", // highest-severity title
      detectionKeys: ["pack:r:e1", "pack:r:e2"],
      firstSeenAt: T0,
      lastSeenAt: T2,
    });
  });

  it("keeps distinct grouping keys in separate cases", () => {
    const out = groupDetectionsIntoCases([
      det({ detectionKey: "d1", groupingKey: "customer:acct_1|HOST1|x" }),
      det({ detectionKey: "d2", groupingKey: "customer:acct_1|HOST2|x" }),
    ]);
    expect(out).toHaveLength(2);
  });

  it("is order-independent (deterministic)", () => {
    const a = det({ detectionKey: "d1", severity: "low", title: "a" });
    const b = det({ detectionKey: "d2", severity: "critical", title: "b" });
    const forward = groupDetectionsIntoCases([a, b])[0]!;
    const reverse = groupDetectionsIntoCases([b, a])[0]!;
    expect(forward.severity).toBe("critical");
    expect(reverse.severity).toBe("critical");
    expect(forward.title).toBe("b");
    expect(reverse.title).toBe("b");
    expect(forward.detectionKeys.sort()).toEqual(reverse.detectionKeys.sort());
  });
});

describe("detectionFamily / detectionRowToGroupingInput (the sweep bridge)", () => {
  function row(overrides: Partial<DetectionRowForGrouping>): DetectionRowForGrouping {
    return {
      detectionKey: "dpf-kernel:windows-audit-log-cleared:e1",
      scopeKey: "organization:internal",
      customerAccountId: null,
      customerSiteId: null,
      severity: "high",
      firstSeenAt: T0,
      lastSeenAt: T0,
      enrichment: {
        ruleKey: "dpf-kernel:windows-audit-log-cleared",
        ruleName: "Windows audit log cleared",
        mitreTechniques: ["T1070.001"],
        entityKey: "HOST-1",
      },
      ...overrides,
    };
  }

  it("families by primary ATT&CK technique, else rule key", () => {
    expect(detectionFamily({ mitreTechniques: ["T1110"], ruleKey: "r" })).toBe("attack:T1110");
    expect(detectionFamily({ ruleKey: "dpf-kernel:x" })).toBe("rule:dpf-kernel:x");
    expect(detectionFamily({})).toBe("uncategorized");
  });

  it("maps a detection row to a grouping input with entity + family in the key", () => {
    const g = detectionRowToGroupingInput(row({}));
    expect(g.groupingKey).toBe("organization:internal|HOST-1|attack:T1070.001");
    expect(g.title).toBe("Windows audit log cleared — HOST-1");
    expect(g.severity).toBe("high");
    expect(g.detectionKey).toBe("dpf-kernel:windows-audit-log-cleared:e1");
    // BI-7D1EC4B9: rule name + raw entity are carried separately so a persist
    // step can re-render the title with a resolved actor label.
    expect(g.ruleName).toBe("Windows audit log cleared");
    expect(g.entityKey).toBe("HOST-1");
  });

  it("carries the winning detection's ruleName + entityKey onto the candidate (BI-7D1EC4B9)", () => {
    // Same actor + family (so they group into one case), different rule + severity.
    const base = {
      mitreTechniques: ["T1070.001"],
      entityKey: "cmuser0000000000000000000",
    };
    const low = detectionRowToGroupingInput(
      row({ detectionKey: "k:e1", severity: "low", enrichment: { ...base, ruleKey: "r-low", ruleName: "Low signal" } }),
    );
    const high = detectionRowToGroupingInput(
      row({ detectionKey: "k:e2", severity: "critical", enrichment: { ...base, ruleKey: "r-high", ruleName: "Internal authorization denied" } }),
    );
    const cands = groupDetectionsIntoCases([low, high]);
    // Same entity + family → one candidate; the critical detection's title wins,
    // so its ruleName + the carried entityKey win with it.
    expect(cands).toHaveLength(1);
    expect(cands[0]!.ruleName).toBe("Internal authorization denied");
    expect(cands[0]!.entityKey).toBe("cmuser0000000000000000000");
  });

  it("falls back to entity 'unknown' (group by scope+family) when entity is absent", () => {
    const g = detectionRowToGroupingInput(row({ enrichment: { ruleKey: "r", mitreTechniques: ["T1098"] } }));
    expect(g.groupingKey).toBe("organization:internal|unknown|attack:T1098");
    expect(g.title).toBe("r"); // no entity qualifier
  });

  it("two same-host same-technique detections collapse to one case via the bridge", () => {
    const inputs = [
      detectionRowToGroupingInput(row({ detectionKey: "k:e1" })),
      detectionRowToGroupingInput(row({ detectionKey: "k:e2" })),
    ];
    const cases = groupDetectionsIntoCases(inputs);
    expect(cases).toHaveLength(1);
    expect(cases[0]!.detectionKeys).toEqual(["k:e1", "k:e2"]);
  });
});
