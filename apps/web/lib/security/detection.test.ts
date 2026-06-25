// EP-SOVEREIGN-SOC P1 — detection evaluator + threat-intel matcher unit tests.
import { describe, expect, it } from "vitest";

import {
  evaluateRulesForEvent,
  matchPredicate,
  ruleAppliesToScope,
  type DetectionRuleView,
  type SecurityEventView,
} from "./detection";
import {
  buildIndicatorIndex,
  matchIndicatorValues,
  type ThreatIndicatorView,
} from "./threat-intel";

const NOW = new Date("2026-06-24T12:00:00.000Z");

const event: SecurityEventView = {
  eventKey: "e1",
  ocsfClassUid: 6003,
  severityId: 2,
  sourceKind: "aws.cloudtrail",
  scopeKey: "customer:acct_1",
  customerAccountId: "acct_1",
  customerSiteId: null,
  time: NOW,
  observables: [{ name: "src_endpoint.ip", type: "IP Address", value: "1.2.3.4" }],
  normalized: { api: { operation: "DeleteBucket" } },
};

function rule(overrides: Partial<DetectionRuleView>): DetectionRuleView {
  return {
    id: "rule_1",
    ruleKey: "pack:rule-1",
    name: "Test rule",
    severity: "high",
    scopeKey: "kernel",
    enabled: true,
    predicate: {},
    mitreTechniques: ["T1078"],
    ...overrides,
  };
}

describe("threat-intel index + matching", () => {
  const indicators: ThreatIndicatorView[] = [
    { indicatorKey: "i1", indicatorType: "ip", value: "1.2.3.4", source: "feed", confidence: "high" },
    { indicatorKey: "i2", indicatorType: "ip", value: "9.9.9.9", source: "feed", confidence: "low", validUntil: new Date("2026-06-01T00:00:00.000Z") },
  ];
  it("drops expired indicators from the index", () => {
    const index = buildIndicatorIndex(indicators, NOW);
    expect(index.has("1.2.3.4")).toBe(true);
    expect(index.has("9.9.9.9")).toBe(false); // expired
  });
  it("matches observable values and dedupes", () => {
    const index = buildIndicatorIndex(indicators, NOW);
    const matches = matchIndicatorValues(["1.2.3.4", "1.2.3.4", "8.8.8.8"], index);
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ indicatorType: "ip", value: "1.2.3.4", source: "feed" });
  });
});

describe("ruleAppliesToScope", () => {
  it("applies a kernel rule to any event scope", () => {
    expect(ruleAppliesToScope("kernel", "customer:acct_1")).toBe(true);
  });
  it("restricts a tenant overlay to its own scope", () => {
    expect(ruleAppliesToScope("customer:acct_1", "customer:acct_1")).toBe(true);
    expect(ruleAppliesToScope("customer:acct_2", "customer:acct_1")).toBe(false);
  });
});

describe("matchPredicate", () => {
  it("matches on classUid / sourceKind / minSeverityId", () => {
    expect(matchPredicate({ classUid: 6003 }, event, {})).toBe(true);
    expect(matchPredicate({ classUid: 3002 }, event, {})).toBe(false);
    expect(matchPredicate({ sourceKind: "aws.cloudtrail" }, event, {})).toBe(true);
    expect(matchPredicate({ minSeverityId: 2 }, event, {})).toBe(true);
    expect(matchPredicate({ minSeverityId: 3 }, event, {})).toBe(false);
  });
  it("matches an equals path on the normalized body", () => {
    expect(matchPredicate({ equals: { path: "api.operation", value: "DeleteBucket" } }, event, {})).toBe(true);
    expect(matchPredicate({ equals: { path: "api.operation", value: "GetObject" } }, event, {})).toBe(false);
    expect(matchPredicate({ equals: { path: "missing.path", value: "x" } }, event, {})).toBe(false);
  });
  it("requires a threat-intel index to fire matchThreatIndicator", () => {
    const index = buildIndicatorIndex(
      [{ indicatorKey: "i1", indicatorType: "ip", value: "1.2.3.4", source: "feed", confidence: "high" }],
      NOW,
    );
    expect(matchPredicate({ matchThreatIndicator: true }, event, {})).toBe(false);
    expect(matchPredicate({ matchThreatIndicator: true }, event, { indicatorIndex: index })).toBe(true);
  });
  it("ANDs allOf and ORs anyOf", () => {
    expect(matchPredicate({ allOf: [{ classUid: 6003 }, { minSeverityId: 2 }] }, event, {})).toBe(true);
    expect(matchPredicate({ allOf: [{ classUid: 6003 }, { minSeverityId: 5 }] }, event, {})).toBe(false);
    expect(matchPredicate({ anyOf: [{ classUid: 3002 }, { sourceKind: "aws.cloudtrail" }] }, event, {})).toBe(true);
  });
});

describe("evaluateRulesForEvent", () => {
  it("fires only enabled, in-scope, matching rules", () => {
    const rules = [
      rule({ id: "r-fire", ruleKey: "pack:fire", predicate: { sourceKind: "aws.cloudtrail" } }),
      rule({ id: "r-disabled", ruleKey: "pack:disabled", enabled: false, predicate: { sourceKind: "aws.cloudtrail" } }),
      rule({ id: "r-scope", ruleKey: "pack:scope", scopeKey: "customer:other", predicate: { sourceKind: "aws.cloudtrail" } }),
      rule({ id: "r-nomatch", ruleKey: "pack:nomatch", predicate: { classUid: 3002 } }),
    ];
    const out = evaluateRulesForEvent(rules, event, {});
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      detectionKey: "pack:fire:e1",
      ruleId: "r-fire",
      scopeKey: "customer:acct_1",
      customerAccountId: "acct_1",
      severity: "high",
      matchedEventRefs: ["e1"],
    });
    expect(out[0]!.enrichment).toMatchObject({ ruleKey: "pack:fire", mitreTechniques: ["T1078"] });
    expect(out[0]!.riskScore).toBe(75); // high, no IOC boost
  });

  it("boosts riskScore and records indicator matches on an IOC hit", () => {
    const index = buildIndicatorIndex(
      [{ indicatorKey: "i1", indicatorType: "ip", value: "1.2.3.4", source: "feed", confidence: "high" }],
      NOW,
    );
    const out = evaluateRulesForEvent(
      [rule({ ruleKey: "pack:ioc", severity: "medium", predicate: { matchThreatIndicator: true } })],
      event,
      { indicatorIndex: index },
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.riskScore).toBe(60); // medium 50 + 10 IOC boost
    expect(out[0]!.enrichment.indicatorMatches).toHaveLength(1);
  });
});
